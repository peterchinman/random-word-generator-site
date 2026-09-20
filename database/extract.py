#!/usr/bin/env python3
"""
Stage 1 of the dictionary build: turn the kaikki.org English Wiktionary dump into a
compact extract that build.py consumes.

    python3 database/extract.py [--source PATH] [--out PATH]

Reads kaikki.org-dictionary-English.jsonl (about 3 GB, one JSON object per line, one
line per word + part of speech + etymology). Downloaded into database/build/ if missing,
where git ignores it. Writes database/build/extract.jsonl.gz, one line per kept entry.

The extract is meant to be lossless for anything a dictionary could want, so that every
judgment call lives in build.py and can be changed without re-reading 3 GB. It:

  * keeps every entry, whatever its part of speech or shape (capitalised, multi-word,
    hyphenated...), as long as at least one sense survives;
  * drops senses that are pure inflections ("simple past of X", carrying form_of) and
    senses with an empty gloss; nothing else is filtered;
  * keeps glosses, tags, topics, examples (all of them, including old quotations),
    per-sense and per-entry relations, forms, sounds, hyphenation and etymology prose;
  * drops Wiktionary plumbing: categories, template calls and expansions, sense
    disambiguation scores, link offsets, audio URLs and translation bodies (only the
    count of translations is kept, as a signal of how established a word is).

The first line of the extract is a metadata record ({"_meta": ...}) describing the
source file, so a build can always say which Wiktionary snapshot it came from.

Needs only the Python standard library. Takes about a minute plus compression time.
"""

import argparse
import datetime
import gzip
import json
import os
import shutil
import sys
import time
import urllib.request
from pathlib import Path

EXTRACTOR_VERSION = 1
SOURCE_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"

HERE = Path(__file__).resolve().parent
BUILD_DIR = HERE / "build"
DEFAULT_SOURCE = BUILD_DIR / "kaikki.org-dictionary-English.jsonl"
DEFAULT_OUT = BUILD_DIR / "extract.jsonl.gz"

RELATION_KEYS = ("synonyms", "antonyms", "hypernyms", "hyponyms", "related")
SOUND_KEYS = ("ipa", "enpr", "audio", "rhymes", "homophone")


def download(source):
    BUILD_DIR.mkdir(exist_ok=True)
    print(f"Downloading {SOURCE_URL} (about 3 GB)")
    partial = source.with_name(source.name + ".part")
    with urllib.request.urlopen(SOURCE_URL) as response, open(partial, "wb") as out:
        shutil.copyfileobj(response, out, length=1 << 20)
    partial.replace(source)


def etymology_prose(entry):
    """etymology_text often opens with a dumped 'Etymology tree'; return only the prose."""
    text = entry.get("etymology_text") or ""
    if text.startswith("Etymology tree"):
        marker = f"\nEnglish {entry['word']}\n"
        cut = text.rfind(marker)
        text = text[cut + len(marker):] if cut >= 0 else text.rsplit("\n", 1)[-1]
    return text.strip()


def relation(items):
    """A relation list (synonyms etc.) reduced to word, tags and sense label."""
    out = []
    for item in items or []:
        word = item.get("word")
        if not word:
            continue
        compact = {"word": word}
        if item.get("tags"):
            compact["tags"] = item["tags"]
        if item.get("sense"):
            compact["sense"] = item["sense"]
        out.append(compact)
    return out


def compact_sense(sense):
    glosses = sense.get("glosses") or []
    out = {"gloss": glosses[-1]}
    if len(glosses) > 1:
        out["parents"] = glosses[:-1]
    for key in ("tags", "raw_tags", "topics", "qualifier"):
        if sense.get(key):
            out[key] = sense[key]
    if sense.get("alt_of"):
        out["alt_of"] = [target["word"] for target in sense["alt_of"] if target.get("word")]
    examples = []
    for example in sense.get("examples") or []:
        text = (example.get("text") or "").strip()
        if not text:
            continue
        compact = {"text": text, "type": example.get("type") or ""}
        if example.get("ref"):
            compact["ref"] = example["ref"]
        examples.append(compact)
    if examples:
        out["examples"] = examples
    for key in ("synonyms", "antonyms", "hypernyms", "hyponyms"):
        items = relation(sense.get(key))
        if items:
            out[key] = items
    if sense.get("translations"):
        out["n_translations"] = len(sense["translations"])
    attestations = sense.get("attestations") or []
    if attestations and attestations[0].get("date"):
        out["attested"] = attestations[0]["date"]
    return out


def compact_entry(entry, counts):
    senses = []
    for sense in entry.get("senses") or []:
        if sense.get("form_of"):
            counts["senses dropped: inflection (form_of)"] += 1
            continue
        glosses = sense.get("glosses") or []
        if not glosses or not glosses[-1].strip():
            counts["senses dropped: empty gloss"] += 1
            continue
        senses.append(compact_sense(sense))
    if not senses:
        counts["entries dropped: no sense left"] += 1
        return None

    out = {"word": entry["word"], "pos": entry["pos"]}
    if entry.get("etymology_number"):
        out["etym_no"] = int(entry["etymology_number"])
    prose = etymology_prose(entry)
    if prose:
        out["etymology"] = prose
    forms = [
        {"form": form["form"], "tags": form.get("tags", [])}
        for form in entry.get("forms") or []
        if form.get("form")
    ]
    if forms:
        out["forms"] = forms
    sounds = []
    for sound in entry.get("sounds") or []:
        compact = {key: sound[key] for key in SOUND_KEYS if sound.get(key)}
        if not compact:
            continue
        if sound.get("tags"):
            compact["tags"] = sound["tags"]
        sounds.append(compact)
    if sounds:
        out["sounds"] = sounds
    for hyphenation in entry.get("hyphenations") or []:
        if hyphenation.get("parts"):
            out["hyphenation"] = hyphenation["parts"]
            break
    if entry.get("translations"):
        out["n_translations"] = len(entry["translations"])
    for key in RELATION_KEYS:
        items = relation(entry.get(key))
        if items:
            out[key] = items
    out["senses"] = senses
    counts["entries kept"] += 1
    counts["senses kept"] += len(senses)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="kaikki JSONL dump")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="gzipped extract to write")
    args = parser.parse_args()

    if not args.source.exists():
        if args.source != DEFAULT_SOURCE:
            sys.exit(f"{args.source} does not exist")
        download(args.source)

    stat = args.source.stat()
    meta = {
        "_meta": {
            "extractor_version": EXTRACTOR_VERSION,
            "source": args.source.name,
            "source_bytes": stat.st_size,
            "source_modified": datetime.datetime.fromtimestamp(stat.st_mtime, datetime.timezone.utc).isoformat(timespec="seconds"),
            "extracted": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        }
    }

    started = time.monotonic()
    counts = {
        "lines read": 0, "entries kept": 0, "senses kept": 0,
        "entries dropped: not English": 0, "entries dropped: no sense left": 0,
        "senses dropped: inflection (form_of)": 0, "senses dropped: empty gloss": 0,
    }
    words = set()
    partial = args.out.with_name(args.out.name + ".part")
    args.out.parent.mkdir(exist_ok=True)
    with open(args.source, encoding="utf-8") as source, gzip.open(partial, "wt", encoding="utf-8", compresslevel=6) as out:
        out.write(json.dumps(meta) + "\n")
        for line in source:
            counts["lines read"] += 1
            entry = json.loads(line)
            if entry.get("lang_code") != "en":
                counts["entries dropped: not English"] += 1
                continue
            compact = compact_entry(entry, counts)
            if compact is None:
                continue
            words.add(compact["word"])
            out.write(json.dumps(compact, ensure_ascii=False) + "\n")
            if counts["lines read"] % 250_000 == 0:
                print(f"  {counts['lines read']:,} lines, {counts['entries kept']:,} entries kept", flush=True)
    partial.replace(args.out)

    print(f"Wrote {args.out} ({os.path.getsize(args.out) / 1e6:.0f} MB) in {time.monotonic() - started:.0f}s")
    for name, count in counts.items():
        print(f"  {name}: {count:,}")
    print(f"  distinct words: {len(words):,}")


if __name__ == "__main__":
    main()
