#!/usr/bin/env python3
"""
Stage 2 of the dictionary build: score every word in the extract by how common it is.

    database/.venv/bin/python database/score.py [--extract PATH] [--out PATH]

Uses the wordfreq package (a blend of Wikipedia, subtitles, news, books, web and social
media text, snapshot of about 2021) to give each word a Zipf value: log10 of occurrences
per billion words, so 3 means once per million words and 6 once per thousand. Writes
database/zipf.tsv.gz with three tab-separated columns:

    word    zipf_word    zipf_max

zipf_word is the headword's own score. zipf_max is the highest score among the headword
and its inflected forms (plurals, tenses, comparatives...), because a verb like "trundle"
is mostly met as "trundled" or "trundling". Which forms count as inflections is defined
in wordforms.py. Words wordfreq has never seen (zipf 0) are left out of the
file; build.py treats a missing word as 0.

Only words wordfreq sees as a single token are scored. For anything it would split, such
as multi-word entries, hyphenated words ("well-known") and words with punctuation inside
("p(doom)"), it estimates a phrase score from the parts, which overstates rare phrases
made of common words ("vampire number"), so those words are left out and build.py places
them by Wiktionary's own evidence. Words with apostrophes ("o'clock") are one token.

This is the only stage with a dependency outside the standard library, which is why it
is separate: build.py reads the small output file and never needs wordfreq. Re-run it
after re-running extract.py, or when upgrading wordfreq.
"""

import argparse
import gzip
import sys
import time
from collections import Counter
from pathlib import Path

try:
    from wordfreq import tokenize, zipf_frequency
except ImportError:
    sys.exit("wordfreq is not installed. Create the venv with:\n"
             "  python3 -m venv database/.venv && database/.venv/bin/pip install wordfreq")

from wordforms import read_forms

HERE = Path(__file__).resolve().parent
DEFAULT_EXTRACT = HERE / "build" / "extract.jsonl.gz"
DEFAULT_OUT = HERE / "zipf.tsv.gz"



def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--extract", type=Path, default=DEFAULT_EXTRACT)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    started = time.monotonic()
    forms_by_word = read_forms(args.extract)
    print(f"Read {len(forms_by_word):,} words in {time.monotonic() - started:.0f}s; scoring")

    buckets = Counter()
    written = 0
    partial = args.out.with_name(args.out.name + ".part")
    with gzip.open(partial, "wt", encoding="utf-8") as out:
        out.write("word\tzipf_word\tzipf_max\n")
        for word, forms in forms_by_word.items():
            if len(tokenize(word, "en")) != 1:
                buckets["skipped: several tokens"] += 1
                continue
            zipf_word = zipf_frequency(word, "en")
            zipf_max = max([zipf_word] + [zipf_frequency(form, "en") for form in forms])
            buckets[int(zipf_max) if zipf_max else "0"] += 1
            if zipf_max > 0:
                out.write(f"{word}\t{zipf_word:.2f}\t{zipf_max:.2f}\n")
                written += 1
    partial.replace(args.out)

    print(f"Wrote {args.out} ({written:,} words with a score) in {time.monotonic() - started:.0f}s")
    print(f"skipped {buckets['skipped: several tokens']:,} words wordfreq would split into several tokens")
    print("zipf_max distribution (whole-number bucket; '0' = unknown to wordfreq):")
    for bucket in ["0", 1, 2, 3, 4, 5, 6, 7]:
        if buckets[bucket]:
            print(f"  {str(bucket):>2}  {buckets[bucket]:>9,}")


if __name__ == "__main__":
    main()
