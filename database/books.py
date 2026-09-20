#!/usr/bin/env python3
"""
Stage 2b of the dictionary build: count how many books use each word, from the Google
Books Ngram export, to grade words that are too rare for wordfreq.

    python3 database/books.py [--extract PATH] [--out PATH] [--cache DIR]

Downloads the 2020 English 1-gram files (24 files, about 13 GB, licensed CC BY 3.0)
into database/build/ngrams/ if they are not there (git ignores that folder; delete it
afterwards if you like), scans them once, and writes database/books.tsv.gz with these
tab-separated columns:

    word  matches_1900  books_1900  matches_1990  books_1990  zipf_1900  zipf_1990

matches_* is how many times the word occurred in scanned books published from that year
to 2019; books_* is in how many distinct books. Book counts are the measure to trust:
one monograph repeating a term ten thousand times cannot inflate them. zipf_* is the
occurrence rate on wordfreq's scale (log10 of occurrences per billion words), from the
totals file Google publishes alongside.

Which words are scored: single lowercase headwords without hyphens, plus their inflected
forms (see wordforms.py), whose counts are added to the headword's. A token credits every
headword it belongs to: "lovers" counts towards the headword "lovers" and towards "lover",
whose plural it is. Google's tokenizer
splits hyphenated words, and multi-word entries would need the far larger 2-gram files,
so those stay unscored and build.py grades them by Wiktionary evidence alone. Counting
is case-folded, so the sentence-initial "Cat" counts towards "cat"; that also means
"polish" absorbs "Polish", which is why capitalised headwords are not scored here.
Tokens carrying a part-of-speech tag (cat_NOUN) are separate lines and are skipped, as
the untagged line already holds the total.

Only the standard library is needed. The download takes about a quarter of an hour;
the scan a few minutes. Words that never appear are left out of the file.
"""

import argparse
import gzip
import math
import shutil
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

from wordforms import read_forms

BASE_URL = "https://storage.googleapis.com/books/ngrams/books/20200217/eng"
NGRAM_FILES = [f"1-{index:05d}-of-00024.gz" for index in range(24)]
TOTALS_FILE = "totalcounts-1"
WINDOWS = (1900, 1990)   # each window runs from that year to the end of the corpus

HERE = Path(__file__).resolve().parent
DEFAULT_EXTRACT = HERE / "build" / "extract.jsonl.gz"
DEFAULT_CACHE = HERE / "build" / "ngrams"
DEFAULT_OUT = HERE / "books.tsv.gz"


def download(cache):
    cache.mkdir(parents=True, exist_ok=True)
    for name in NGRAM_FILES + [TOTALS_FILE]:
        target = cache / name
        if target.exists() and target.stat().st_size > 0:
            continue
        print(f"  downloading {name}", flush=True)
        partial = target.with_name(name + ".part")
        with urllib.request.urlopen(f"{BASE_URL}/{name}") as response, open(partial, "wb") as out:
            shutil.copyfileobj(response, out, length=1 << 20)
        partial.replace(target)


def read_totals(path):
    """Total tokens in the corpus for each window: {1900: n, 1990: n}."""
    totals = Counter()
    for cell in path.read_text().split("\t"):
        cell = cell.strip()
        if not cell:
            continue
        year, matches, _pages, _volumes = cell.split(",")
        for start in WINDOWS:
            if int(year) >= start:
                totals[start] += int(matches)
    return totals


def wanted_words(extract):
    """{lowercase token: [headwords it counts towards]} for every scorable headword and its inflections."""
    wanted = {}
    for word, forms in read_forms(extract).items():
        if word != word.lower() or " " in word or "-" in word:
            continue
        for token in {word} | {form.lower() for form in forms if " " not in form and "-" not in form}:
            heads = wanted.setdefault(token, [])
            if word not in heads:
                heads.append(word)
    return wanted


def scan(path, wanted, hits, stats):
    with gzip.open(path, "rt", encoding="utf-8") as ngrams:
        for line in ngrams:
            stats["lines"] += 1
            tab = line.find("\t")
            token = line[:tab]
            if "_" in token:
                continue
            heads = wanted.get(token.lower())
            if heads is None:
                continue
            stats["matched lines"] += 1
            since_1900 = [0, 0, 0, 0]
            for cell in line[tab + 1:].split("\t"):
                year, matches, volumes = cell.split(",")
                year = int(year)
                if year >= 1900:
                    matches, volumes = int(matches), int(volumes)
                    since_1900[0] += matches
                    since_1900[1] += volumes
                    if year >= 1990:
                        since_1900[2] += matches
                        since_1900[3] += volumes
            for word in heads:
                counts = hits.setdefault(word, [0, 0, 0, 0])
                for index in range(4):
                    counts[index] += since_1900[index]


def zipf(matches, total):
    return math.log10(matches / total * 1e9) if matches else 0.0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--extract", type=Path, default=DEFAULT_EXTRACT)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="where the Google files are kept")
    args = parser.parse_args()
    if not args.extract.exists():
        sys.exit(f"{args.extract} does not exist; run extract.py first")

    started = time.monotonic()
    print("Checking the Google Books files")
    download(args.cache)
    totals = read_totals(args.cache / TOTALS_FILE)
    print(f"  corpus tokens from 1900: {totals[1900]:,}; from 1990: {totals[1990]:,}")

    wanted = wanted_words(args.extract)
    print(f"Scoring {len({head for heads in wanted.values() for head in heads}):,} headwords via {len(wanted):,} tokens")

    hits, stats = {}, Counter()
    for name in NGRAM_FILES:
        step = time.monotonic()
        scan(args.cache / name, wanted, hits, stats)
        print(f"  {name}: {stats['lines']:,} lines so far, {len(hits):,} headwords hit ({time.monotonic() - step:.0f}s)", flush=True)

    partial = args.out.with_name(args.out.name + ".part")
    buckets = Counter()
    with gzip.open(partial, "wt", encoding="utf-8") as out:
        out.write("word\tmatches_1900\tbooks_1900\tmatches_1990\tbooks_1990\tzipf_1900\tzipf_1990\n")
        for word in sorted(hits):
            m1900, b1900, m1990, b1990 = hits[word]
            if not m1900:
                continue   # only seen before 1900
            out.write(f"{word}\t{m1900}\t{b1900}\t{m1990}\t{b1990}\t{zipf(m1900, totals[1900]):.2f}\t{zipf(m1990, totals[1990]):.2f}\n")
            buckets["0" if b1990 == 0 else "1-2" if b1990 < 3 else "3-19" if b1990 < 20 else "20-199" if b1990 < 200 else "200+"] += 1
    partial.replace(args.out)

    print(f"Wrote {args.out} in {time.monotonic() - started:.0f}s")
    print("headwords by number of books using them since 1990:")
    for bucket in ("0", "1-2", "3-19", "20-199", "200+"):
        print(f"  {bucket:>7}  {buckets[bucket]:>9,}")


if __name__ == "__main__":
    main()
