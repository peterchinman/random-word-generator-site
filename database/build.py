#!/usr/bin/env python3
"""
Stage 3 of the dictionary build: turn the extract and the Zipf scores into dictionary.db.

    python3 database/build.py [--limit N] [--word WORD ...]

Reads database/build/extract.jsonl.gz (from extract.py), database/zipf.tsv.gz (from
score.py) and database/books.tsv.gz (from books.py), writes database/dictionary.db laid
out by schema.sql, and writes
database/build-report.txt saying what every rule below did, with samples. Only the
standard library is needed; a full build takes a few minutes.

--limit N builds from the first N entries only, for trying out rule changes quickly.
--word prints how the finished database holds the given words.

Every judgment call is in this file, so that changing one means re-running this stage
alone. The rules:

  Words.  Every headword in the extract gets a row, whatever its shape. The shape is
  recorded in flag columns (capitalized, multiword, hyphenated, apostrophe, digits,
  nonascii) so a query can exclude what it does not want.

  Meanings.  Each Wiktionary sense becomes a meaning of one of three kinds:
    definition  an ordinary definition;
    variant     the sense only says the word is a spelling of another word ("Commonwealth
                spelling of color", or a sense Wiktionary flags as alt_of);
    synonym     the sense only says "Synonym of X".
  Variant and synonym meanings keep the word they point to in target. A word with no
  definition meaning is marked pointer_only. Nested sub-senses keep their parent glosses
  in context. Meanings tagged obsolete, archaic, rare, dated and the like are demoted:
  kept, but sorted after the others. Duplicate (part of speech, definition) pairs within
  a word are dropped. Two glosses known to be Wiktionary category names leaking into
  definitions are dropped.

  Order.  Meanings are ordered by part of speech (noun, verb, adjective, adverb, then
  the rest), then Wiktionary's etymology number, then within an entry: definitions
  before pointers, live before demoted, else Wiktionary's own order.

  Examples.  Up to two per meaning: made-up usage examples first, then quotations from
  1900 onward, newest first. Anything with a citation counts as a quotation. Quotations
  with elisions ([…]) or the long s (ſ), examples over 300 characters, quotations with no
  readable year, and "examples" that are only a citation with no quoted text are skipped.

  Synonyms.  Per meaning, from Wiktionary's per-sense list, up to ten, minus the headword
  itself, duplicates and entries with broken link brackets. Entry-level synonym lists are
  ignored because Wiktionary attaches them to every etymology of a page.

  Pronunciation.  Every IPA transcription is kept with its accent tags. word.ipa is the
  one to display: General American or US first, then Received Pronunciation or UK, then
  untagged, preferring phonemic /slashes/ over phonetic [brackets].

  Score.  One number per word, on the Zipf scale (log10 of occurrences per billion
  words; 3 is once per million, 0 once per billion): the higher of wordfreq's score
  (score.py; a blend of web, subtitles, news, books and social media, max over the word
  and its inflections) and the Google Books rate for 1990 to 2019 (books.py). Where both
  know a word they agree to within a tenth of a Zipf in the median, so this is one
  measurement from two corpora: wordfreq adds a few hundred web-era words print has not
  caught up with, Google Books reaches three orders of magnitude deeper. Taking the
  higher means a word counts as established if either corpus vouches for it. Neither
  corpus scores multi-word, hyphenated or punctuated entries (score.py and books.py say
  why), and Google Books does not score capitalised ones.

  Tier.  A band of the score, each step roughly ten times rarer:
    common      3 or more        at least once per million words
    uncommon    2 to 3
    scarce      1 to 2
    rare        0 to 1           about 500 to 5,000 books since 1990
    obscure     -1 to 0          about 50 to 500 books
    marginal    -2 to -1         about 5 to 50 books
    unattested  below -2, or no score, and no other evidence
  The score is NULL in the database for words neither corpus knows.
  Words neither corpus scores fall back to Wiktionary's own evidence. Those that could
  not be looked up in Google Books at all (hyphenated, multi-word and capitalised words,
  see books.py): a pronunciation, audio, a translation or a quotation from 1990 on makes
  them rare, any older quotation or made-up example marginal. A word that could have
  been found and was not gets at most marginal from that evidence.

  Flags.  Two qualities that occur at every tier are recorded separately:
    archaic     every definition is tagged obsolete, archaic, dated or historical
    technical   every current (non-demoted) definition carries a science, medicine or
                computing topic label

  Canaries.  A short list of words with the tier or flags they must end up with. If any
  fails, the database and report are still written but the build exits with status 1.
"""

import argparse
import gzip
import json
import random
import re
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_EXTRACT = HERE / "build" / "extract.jsonl.gz"
DEFAULT_ZIPF = HERE / "zipf.tsv.gz"
DEFAULT_BOOKS = HERE / "books.tsv.gz"
DATABASE = HERE / "dictionary.db"
SCHEMA_SQL = HERE / "schema.sql"
REPORT = HERE / "build-report.txt"

# Part-of-speech codes as Wiktionary uses them, in display order. Codes not listed here
# are appended as they are met, with the code as their name.
POS_NAMES = [
    ("noun", "noun"), ("verb", "verb"), ("adj", "adjective"), ("adv", "adverb"),
    ("name", "proper noun"), ("intj", "interjection"), ("prep", "preposition"),
    ("pron", "pronoun"), ("conj", "conjunction"), ("det", "determiner"), ("num", "numeral"),
    ("particle", "particle"), ("article", "article"), ("phrase", "phrase"),
    ("prep_phrase", "prepositional phrase"), ("proverb", "proverb"), ("prefix", "prefix"),
    ("suffix", "suffix"), ("infix", "infix"), ("interfix", "interfix"), ("circumfix", "circumfix"),
    ("affix", "affix"), ("contraction", "contraction"), ("symbol", "symbol"),
    ("character", "character"), ("punct", "punctuation"), ("postp", "postposition"),
]

DEMOTE_TAGS = {
    "obsolete", "archaic", "rare", "dated", "historical", "uncommon", "neologism",
    "nonstandard", "proscribed", "hypercorrect", "misspelling",
}
ARCHAIC_TAGS = {"obsolete", "archaic", "dated", "historical"}
TECHNICAL_TOPICS = {
    "sciences", "natural-sciences", "physical-sciences", "chemistry", "organic-chemistry",
    "inorganic-chemistry", "biochemistry", "medicine", "pathology", "pharmacology", "biology",
    "microbiology", "genetics", "botany", "zoology", "anatomy", "physiology", "physics",
    "mathematics", "geometry", "statistics", "geology", "mineralogy", "astronomy", "engineering",
    "electronics", "computing", "taxonomy", "linguistics", "biotechnology", "neuroscience",
    "immunology", "oncology", "ecology", "materials",
}
QUOTATION_RECENT_YEAR = 1990
# The score at which a word enters each tier, from the top down.
TIER_FLOORS = [("common", 3), ("uncommon", 2), ("scarce", 1), ("rare", 0), ("obscure", -1), ("marginal", -2)]

# Glosses that only say "this is a spelling of X" without Wiktionary flagging them as alt_of.
POINTER_LABEL = (
    r"(?:Commonwealth|British|American|Canadian|Australian|Irish|Ireland|New Zealand|South African"
    r"|Scottish|Indian|UK|US|Oxford|Non-Oxford|English|Dated|Archaic|Obsolete|Rare|Nonstandard"
    r"|Standard|Early Modern|Modern|Censored|Elongated|Apheretic|Aphetic|Syncopic|Filter-avoidance"
    r"|Feminist|Alternative|Informal|Colloquial|Eye dialect|Pronunciation|Common|Former|Historical"
    r"|Traditional|Simplified|Hypercorrect|Humorous|Deliberate|Intentional|Jocular|Misspelling|and|,)"
)
POINTER_RE = re.compile(
    rf"^(?:{POINTER_LABEL}\s*)+(?:standard\s+)?(?:spelling|form|misspelling)\s+of\s+(?P<target>.+)$"
    r"|^Syllabic abbreviation of\s+(?P<target2>.+)$"
)
SYNONYM_PREFIX = "Synonym of "
LEAKED_GLOSS_RE = re.compile(r"^(?:Terms|Senses) (?:relating|related) to ")

EXAMPLE_MAX_LENGTH = 300
EXAMPLES_PER_MEANING = 2
QUOTATION_MIN_YEAR = 1900
SYNONYMS_PER_MEANING = 10

TIER_ORDER = ["common", "uncommon", "scarce", "rare", "obscure", "marginal", "unattested"]

# word -> what must be true of it after the build.
CANARIES = [
    ("cat", {"tier": {"common"}}),
    ("lanyard", {"tier": {"uncommon", "scarce"}}),
    ("trundle", {"tier": {"uncommon", "scarce"}}),
    ("heedless", {"tier": {"uncommon", "scarce"}}),
    ("frazzle", {"tier": {"uncommon"}}),         # mid-band: score about 2.5
    ("yardarm", {"tier": {"scarce"}}),
    ("sedulous", {"tier": {"scarce"}}),          # below wordfreq's floor, but in 27,000 books
    ("steamily", {"tier": {"rare"}}),            # score about 0.5, about 2,000 books
    ("overglow", {"tier": {"obscure"}}),         # score about -0.4, about 200 books
    ("quadragenarian", {"tier": {"obscure"}}),
    ("ornerily", {"tier": {"marginal"}}),        # score about -1.4, about 25 books
    ("hummably", {"tier": {"marginal"}}),
    ("crinklepants", {"tier": {"marginal"}}),    # not in Google Books; has a Wiktionary quotation
    ("zoophytolith", {"tier": {"unattested"}}),
    ("phosphomannoprotein", {"tier": {"unattested"}, "technical": 1}),
    ("dingthrift", {"archaic": 1}),
    ("shark", {"archaic": 0, "technical": 0}),
    ("colour", {"pointer_only": 1}),
    ("judgement", {"pointer_only": 1}),
    ("theatre", {"pointer_only": 0}),  # has a rare definition sense besides the pointer
    ("social secretary", {"multiword": 1}),
    ("French", {"capitalized": 1}),
    ("trocarised", {"absent": True}),
]


# --- per-sense rules -----------------------------------------------------------------

def clean_target(text):
    """'abstinence.' -> 'abstinence'; 'poop (“to defecate”).' -> 'poop'."""
    text = re.split(r"\s*\(", text, maxsplit=1)[0]
    return text.strip().rstrip(".").strip()


def classify(sense):
    """Returns (kind, target) for a sense: definition, variant or synonym."""
    if sense.get("alt_of"):
        return "variant", sense["alt_of"][0]
    gloss = sense["gloss"]
    if gloss.startswith(SYNONYM_PREFIX):
        return "synonym", clean_target(gloss[len(SYNONYM_PREFIX):])
    match = POINTER_RE.match(gloss)
    if match:
        return "variant", clean_target(match.group("target") or match.group("target2"))
    return "definition", None


def is_demoted(sense):
    return bool(set(sense.get("tags", [])) & DEMOTE_TAGS)


def is_archaic(sense):
    return bool(set(sense.get("tags", [])) & ARCHAIC_TAGS)


def is_technical(sense):
    return bool(set(sense.get("topics", [])) & TECHNICAL_TOPICS)


def example_evidence(example):
    """(is_quotation, year or None) for a raw example, for the tier rules. Anything with a
    citation is a quotation, as is a bare citation with no quoted text; its year is read
    from the citation, or from the text when that is all there is."""
    ref = example.get("ref")
    if ref:
        return True, quotation_year(ref)
    if example["type"] == "quotation":
        return True, None
    if re.match(r"^\d{4}\b", example["text"]):
        return True, quotation_year(example["text"])
    return False, None


def quotation_year(ref):
    match = re.match(r"\s*(?:c\.\s*|ca\.\s*|a\.\s*)?(\d{4})\b", ref or "")
    if not match:
        return None
    year = int(match.group(1))
    return year if 1000 <= year <= 2100 else None


def clean_ref(ref):
    ref = re.sub(r"→\w+", "", ref)          # →ISBN, →OCLC ...
    ref = re.sub(r"\s+", " ", ref).strip(" ,:;")
    return ref


def pick_examples(sense, counts):
    plain, quotations = [], []
    for example in sense.get("examples", []):
        text = " ".join(example["text"].split())
        if len(text) > EXAMPLE_MAX_LENGTH:
            counts["examples skipped: over 300 characters"] += 1
            continue
        if "[…]" in text or "ſ" in text:
            counts["examples skipped: elided or archaic typography"] += 1
            continue
        if not example.get("ref") and re.match(r"^\d{4}\b", text):
            counts["examples skipped: citation with no quoted text"] += 1
            continue
        if example["type"] == "quotation" or example.get("ref"):
            year = quotation_year(example.get("ref"))
            if year is None:
                counts["examples skipped: quotation without a year"] += 1
                continue
            if year < QUOTATION_MIN_YEAR:
                counts["examples skipped: quotation before 1900"] += 1
                continue
            quotations.append((year, text, clean_ref(example["ref"])))
        else:
            plain.append((text, None))
    quotations.sort(key=lambda q: -q[0])
    chosen = (plain + [(text, ref) for _, text, ref in quotations])[:EXAMPLES_PER_MEANING]
    counts["examples kept: made-up"] += sum(1 for _, ref in chosen if ref is None)
    counts["examples kept: quotation"] += sum(1 for _, ref in chosen if ref is not None)
    counts["examples skipped: beyond two per meaning"] += len(plain) + len(quotations) - len(chosen)
    return chosen


def pick_synonyms(sense, word, counts):
    chosen = []
    for item in sense.get("synonyms", []):
        synonym = item["word"]
        if "[" in synonym or "]" in synonym or synonym.startswith("Thesaurus:"):
            counts["synonyms skipped: broken link"] += 1
        elif synonym == word or synonym in chosen:
            counts["synonyms skipped: headword or duplicate"] += 1
        else:
            chosen.append(synonym)
    counts["synonyms skipped: beyond ten per meaning"] += max(0, len(chosen) - SYNONYMS_PER_MEANING)
    return chosen[:SYNONYMS_PER_MEANING]


# --- per-word rules ------------------------------------------------------------------

def ipa_rank(sound):
    tags = set(sound.get("tags", []))
    if tags & {"General-American", "US"}:
        rank = 3
    elif tags & {"Received-Pronunciation", "UK"}:
        rank = 2
    elif not tags:
        rank = 1
    else:
        rank = 0
    return rank + (0.5 if sound["ipa"].startswith("/") else 0)


def word_flags(word):
    return {
        "capitalized": int(word[:1].isupper()),
        "multiword": int(" " in word),
        "hyphenated": int("-" in word),
        "apostrophe": int("'" in word or "’" in word),
        "digits": int(any(c.isdigit() for c in word)),
        "nonascii": int(not word.isascii()),
    }


def word_length(word):
    return sum(1 for c in word if c not in " -'’")


def tier_for(score, scorable, has_ipa, has_audio, n_translations, max_quotation_year, has_example):
    """score is None when neither corpus knows the word."""
    if score is not None:
        for tier, floor in TIER_FLOORS:
            if score >= floor:
                return tier
    # Below both corpora's floors: Wiktionary's own evidence, worth less if Google Books
    # could have found the word and did not.
    strong = has_ipa or has_audio or n_translations or max_quotation_year >= QUOTATION_RECENT_YEAR
    if strong and not scorable:
        return "rare"
    if strong or has_example:
        return "marginal"
    return "unattested"


# --- helpers -------------------------------------------------------------------------

class Reservoir:
    """Keeps a uniform random sample of up to n items from a stream."""

    def __init__(self, n, seed):
        self.n, self.items, self.seen = n, [], 0
        self.random = random.Random(seed)

    def add(self, item):
        self.seen += 1
        if len(self.items) < self.n:
            self.items.append(item)
        else:
            slot = self.random.randrange(self.seen)
            if slot < self.n:
                self.items[slot] = item


def read_extract(path, limit):
    """Yields (meta, None) first, then (None, entry) for each entry."""
    with gzip.open(path, "rt", encoding="utf-8") as extract:
        for index, line in enumerate(extract):
            record = json.loads(line)
            if "_meta" in record:
                yield record["_meta"], None
                continue
            if limit and index > limit:
                return
            yield None, record


def read_zipf(path):
    scores = {}
    with gzip.open(path, "rt", encoding="utf-8") as zipf:
        next(zipf)  # header
        for line in zipf:
            word, _, zipf_max = line.rstrip("\n").split("\t")
            scores[word] = float(zipf_max)
    return scores


def read_books(path):
    """{word: (distinct books since 1990, Zipf rate since 1990)} from books.py's output."""
    books = {}
    with gzip.open(path, "rt", encoding="utf-8") as table:
        header = next(table).rstrip("\n").split("\t")
        count_column, zipf_column = header.index("books_1990"), header.index("zipf_1990")
        for line in table:
            fields = line.rstrip("\n").split("\t")
            books[fields[0]] = (int(fields[count_column]), float(fields[zipf_column]))
    return books


class PosTable:
    def __init__(self):
        self.codes = [code for code, _ in POS_NAMES]
        self.names = dict(POS_NAMES)

    def bit(self, code):
        if code not in self.names:
            self.codes.append(code)
            self.names[code] = code
        return 1 << self.codes.index(code)

    def rank(self, code):
        return self.codes.index(code) if code in self.names else len(self.codes)

    def rows(self):
        return [(code, self.names[code], 1 << index) for index, code in enumerate(self.codes)]


# --- the build -----------------------------------------------------------------------

def pass_one(args, scores, books, pos_table, counts, samples):
    """Aggregates per word: parts of speech, signals, tier, display IPA. Returns (meta, words)."""
    words = {}
    meta = None
    for extract_meta, entry in read_extract(args.extract, args.limit):
        if extract_meta:
            meta = extract_meta
            continue
        word = entry["word"]
        record = words.get(word)
        if record is None:
            record = words[word] = {
                "pos_mask": 0, "has_ipa": False, "has_audio": False, "n_translations": 0,
                "definitions": 0, "live_definitions": 0, "archaic_definitions": 0,
                "technical_live_definitions": 0, "max_quotation_year": 0, "has_example": False,
                "ipa": None, "ipa_rank": -1,
            }
        record["pos_mask"] |= pos_table.bit(entry["pos"])
        record["n_translations"] += entry.get("n_translations", 0)
        for sound in entry.get("sounds", []):
            if "ipa" in sound:
                record["has_ipa"] = True
                rank = ipa_rank(sound)
                if rank > record["ipa_rank"]:
                    record["ipa"], record["ipa_rank"] = sound["ipa"], rank
            if "audio" in sound:
                record["has_audio"] = True
        for sense in entry["senses"]:
            record["n_translations"] += sense.get("n_translations", 0)
            for example in sense.get("examples", []):
                record["has_example"] = True
                is_quotation, year = example_evidence(example)
                if is_quotation and year:
                    record["max_quotation_year"] = max(record["max_quotation_year"], year)
            kind, _ = classify(sense)
            if kind == "definition":
                record["definitions"] += 1
                if is_archaic(sense):
                    record["archaic_definitions"] += 1
                if not is_demoted(sense):
                    record["live_definitions"] += 1
                    if is_technical(sense):
                        record["technical_live_definitions"] += 1

    rows = []
    for word, record in words.items():
        flags = word_flags(word)
        wordfreq_score = scores.get(word)
        book_count, books_score = books.get(word, (0, None))
        known = [value for value in (wordfreq_score, books_score) if value is not None]
        score = max(known) if known else None
        pointer_only = int(record["definitions"] == 0)
        archaic = int(record["definitions"] > 0 and record["archaic_definitions"] == record["definitions"])
        technical = int(record["live_definitions"] > 0
                        and record["technical_live_definitions"] == record["live_definitions"])
        scorable = word == word.lower() and not flags["multiword"] and not flags["hyphenated"]
        tier = tier_for(score, scorable, record["has_ipa"], record["has_audio"],
                        record["n_translations"], record["max_quotation_year"], record["has_example"])
        counts[f"words: tier {tier}"] += 1
        if wordfreq_score is not None and books_score is not None:
            counts["words: scored by wordfreq and Google Books"] += 1
            counts["words: score taken from " + ("wordfreq" if wordfreq_score >= books_score else "Google Books")] += 1
        elif wordfreq_score is not None:
            counts["words: scored by wordfreq only"] += 1
        elif books_score is not None:
            counts["words: scored by Google Books only"] += 1
        elif scorable:
            counts["words: unscored, lookable in Google Books but absent"] += 1
        else:
            counts["words: unscored, not lookable (placed by Wiktionary evidence)"] += 1
        if pointer_only:
            counts["words: pointer only"] += 1
        if archaic:
            counts["words: flag archaic"] += 1
        if technical:
            counts["words: flag technical"] += 1
        for flag, value in flags.items():
            if value:
                counts[f"words: flag {flag}"] += 1
        plain = not any(flags.values()) and not pointer_only
        if plain and not archaic and not technical:
            samples[f"tier {tier}"].add(word)
        if plain and archaic:
            samples[f"tier {tier}, archaic"].add(word)
        if plain and technical:
            samples[f"tier {tier}, technical"].add(word)
        for flag, value in flags.items():
            if value:
                samples[f"flag {flag}"].add(word)
        if pointer_only:
            samples["pointer only"].add(word)
        rows.append((
            word, word_length(word), record["pos_mask"], tier, score,
            flags["capitalized"], flags["multiword"], flags["hyphenated"], flags["apostrophe"],
            flags["digits"], flags["nonascii"], pointer_only, archaic, technical, book_count, record["ipa"],
        ))
        counts["words"] += 1
    return meta, rows


def flush_word(db, word, word_id, entries, pos_table, counts, ord_start):
    """Writes the meanings, examples, synonyms, pronunciations and etymologies of one word."""
    entries.sort(key=lambda e: (pos_table.rank(e["pos"]), e.get("etym_no", 0)))
    ord_ = ord_start
    seen = set()
    for entry in entries:
        senses = []
        for index, sense in enumerate(entry["senses"]):
            if LEAKED_GLOSS_RE.match(sense["gloss"]):
                counts["senses dropped: leaked category name"] += 1
                continue
            kind, target = classify(sense)
            demoted = is_demoted(sense)
            senses.append((kind != "definition", demoted, index, sense, kind, target))
        senses.sort(key=lambda s: s[:3])
        for _, demoted, _, sense, kind, target in senses:
            key = (entry["pos"], sense["gloss"])
            if key in seen:
                counts["senses dropped: duplicate within word"] += 1
                continue
            seen.add(key)
            ord_ += 1
            counts[f"meanings: kind {kind}"] += 1
            counts["meanings: demoted"] += demoted
            meaning_id = db.execute(
                "INSERT INTO meaning (word_id, ord, pos, kind, target, definition, context, qualifier, tags, topics, demoted)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    word_id, ord_, entry["pos"], kind, target, sense["gloss"],
                    " › ".join(sense["parents"]) if sense.get("parents") else None,
                    sense.get("qualifier"),
                    json.dumps(sense.get("tags", []) + sense.get("raw_tags", []), ensure_ascii=False),
                    json.dumps(sense.get("topics", []), ensure_ascii=False),
                    int(demoted),
                ),
            ).lastrowid
            examples = pick_examples(sense, counts)
            if examples:
                db.executemany("INSERT INTO example (meaning_id, text, ref) VALUES (?, ?, ?)",
                               [(meaning_id, text, ref) for text, ref in examples])
            synonyms = pick_synonyms(sense, word, counts)
            if synonyms:
                db.executemany("INSERT INTO synonym (meaning_id, synonym) VALUES (?, ?)",
                               [(meaning_id, synonym) for synonym in synonyms])

    pronunciations = {}
    etymologies = []
    for entry in entries:
        for sound in entry.get("sounds", []):
            if "ipa" in sound:
                pronunciations.setdefault((sound["ipa"], json.dumps(sound.get("tags", []))), None)
        if entry.get("etymology") and entry["etymology"] not in [text for _, _, text in etymologies]:
            etymologies.append((entry["pos"], entry.get("etym_no"), entry["etymology"]))
    if pronunciations:
        db.executemany("INSERT INTO pronunciation (word_id, ipa, tags) VALUES (?, ?, ?)",
                       [(word_id, ipa, tags) for ipa, tags in pronunciations])
        counts["pronunciations"] += len(pronunciations)
    if etymologies:
        db.executemany("INSERT INTO etymology (word_id, pos, etym_no, text) VALUES (?, ?, ?, ?)",
                       [(word_id, pos, etym_no, text) for pos, etym_no, text in etymologies])
        counts["etymologies"] += len(etymologies)
    return ord_


def pass_two(args, db, word_ids, pos_table, counts):
    """Writes everything that hangs off word, one word at a time."""
    current_word, buffered = None, []
    ords = {}
    for _, entry in read_extract(args.extract, args.limit):
        if entry is None:
            continue
        if entry["word"] != current_word:
            if buffered:
                ords[current_word] = flush_word(db, current_word, word_ids[current_word], buffered,
                                                pos_table, counts, ords.get(current_word, 0))
            current_word, buffered = entry["word"], []
        buffered.append(entry)
    if buffered:
        flush_word(db, current_word, word_ids[current_word], buffered, pos_table, counts, ords.get(current_word, 0))


def check_canaries(db):
    results = []
    for word, expected in CANARIES:
        row = db.execute("SELECT tier, pointer_only, multiword, capitalized, archaic, technical FROM word WHERE word = ?",
                         (word,)).fetchone()
        if expected.get("absent"):
            ok = row is None
            actual = "absent" if row is None else f"present ({row[0]})"
            results.append((word, "absent", actual, ok))
            continue
        if row is None:
            results.append((word, str(expected), "absent", False))
            continue
        actual = dict(zip(("tier", "pointer_only", "multiword", "capitalized", "archaic", "technical"), row))
        ok = True
        for key, want in expected.items():
            if key == "tier":
                ok &= actual["tier"] in want
            else:
                ok &= actual[key] == want
        results.append((word, ", ".join(f"{k}={sorted(v) if isinstance(v, set) else v}" for k, v in expected.items()),
                        f"tier={actual['tier']} pointer_only={actual['pointer_only']}"
                        f" archaic={actual['archaic']} technical={actual['technical']}", ok))
    return results


def write_report(path, meta, args, counts, samples, canaries, db, timings):
    lines = ["dictionary.db build report", "=" * 26, ""]
    lines.append(f"extract:  {args.extract}")
    for key, value in (meta or {}).items():
        lines.append(f"  {key}: {value}")
    lines.append(f"scores:   {args.zipf}")
    lines.append(f"books:    {args.books}")
    lines.append(f"database: {DATABASE} ({DATABASE.stat().st_size / 1e6:.0f} MB)")
    if args.limit:
        lines.append(f"LIMITED BUILD: first {args.limit:,} entries only")
    lines.append("timings:  " + ", ".join(f"{name} {seconds:.0f}s" for name, seconds in timings))
    lines += ["", "Counts", "------"]
    for name in sorted(counts):
        lines.append(f"  {counts[name]:>10,}  {name}")

    lines += ["", "Words by tier and shape", "-----------------------"]
    lines.append(f"  {'tier':12s}{'all':>10s}{'plain':>10s}{'multiword':>11s}{'capital':>10s}{'pointer':>10s}"
                 f"{'archaic':>10s}{'technical':>11s}{'books p50':>11s}{'score p50':>11s}")
    for tier in TIER_ORDER:
        row = db.execute(
            "SELECT count(*),"
            " sum(multiword=0 AND capitalized=0 AND pointer_only=0 AND digits=0 AND hyphenated=0 AND apostrophe=0),"
            " sum(multiword), sum(capitalized), sum(pointer_only), sum(archaic), sum(technical)"
            " FROM word WHERE tier = ?", (tier,)).fetchone()
        scored = db.execute("SELECT count(*) FROM word WHERE tier = ? AND books > 0", (tier,)).fetchone()[0]
        median = db.execute("SELECT books FROM word WHERE tier = ? AND books > 0 ORDER BY books LIMIT 1 OFFSET ?",
                            (tier, scored // 2)).fetchone() if scored else None
        n_tier = row[0]
        n_scored = db.execute("SELECT count(*) FROM word WHERE tier = ? AND zipf IS NOT NULL", (tier,)).fetchone()[0]
        score_median = db.execute("SELECT zipf FROM word WHERE tier = ? AND zipf IS NOT NULL ORDER BY zipf LIMIT 1 OFFSET ?",
                                  (tier, n_scored // 2)).fetchone()[0] if n_scored else float("nan")
        row = row + (median[0] if median else 0,)
        widths = (10, 10, 11, 10, 10, 10, 11, 11)
        lines.append(f"  {tier:12s}" + "".join(f"{(n or 0):>{w},}" for n, w in zip(row, widths)) + f"{score_median:>11.2f}")

    lines += ["", "Samples (plain single lowercase words, neither flag, unless the heading says otherwise)", "-------"]
    for name, reservoir in samples.items():
        lines.append(f"  {name} ({reservoir.seen:,} words): " + ", ".join(sorted(reservoir.items)))

    lines += ["", "Canaries", "--------"]
    for word, expected, actual, ok in canaries:
        lines.append(f"  {'ok  ' if ok else 'FAIL'}  {word:20s} expected {expected:45s} got {actual}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return lines


def show_word(db, word):
    row = db.execute("SELECT * FROM word WHERE word = ?", (word,)).fetchone()
    if row is None:
        print(f"\n{word}: not in the database")
        return
    columns = [d[1] for d in db.execute("PRAGMA table_info(word)")]
    word_row = dict(zip(columns, row))
    print(f"\n{word}: " + ", ".join(f"{k}={v}" for k, v in word_row.items() if k not in ("id", "word")))
    for ety in db.execute("SELECT pos, etym_no, text FROM etymology WHERE word_id = ?", (word_row["id"],)):
        print(f"  etymology ({ety[0]} {ety[1] or ''}): {ety[2][:160]}")
    for pron in db.execute("SELECT ipa, tags FROM pronunciation WHERE word_id = ?", (word_row["id"],)):
        print(f"  pronunciation: {pron[0]} {pron[1]}")
    for m in db.execute("SELECT id, ord, pos, kind, target, definition, context, tags, demoted FROM meaning"
                        " WHERE word_id = ? ORDER BY ord", (word_row["id"],)):
        flags = f" [{m[3]} → {m[4]}]" if m[3] != "definition" else ""
        demoted = " (demoted)" if m[8] else ""
        context = f"  ‹{m[6]}›" if m[6] else ""
        print(f"  {m[1]:2d}. {m[2]}{flags}{demoted}: {m[5][:150]}{context}  tags={m[7]}")
        for ex in db.execute("SELECT text, ref FROM example WHERE meaning_id = ?", (m[0],)):
            print(f"        ex: {ex[0][:120]}" + (f"  — {ex[1][:60]}" if ex[1] else ""))
        syns = [s[0] for s in db.execute("SELECT synonym FROM synonym WHERE meaning_id = ?", (m[0],))]
        if syns:
            print(f"        syn: {', '.join(syns)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--extract", type=Path, default=DEFAULT_EXTRACT)
    parser.add_argument("--zipf", type=Path, default=DEFAULT_ZIPF)
    parser.add_argument("--books", type=Path, default=DEFAULT_BOOKS)
    parser.add_argument("--limit", type=int, default=0, help="build from the first N entries only")
    parser.add_argument("--word", nargs="*", default=[], help="after building, show these words")
    args = parser.parse_args()
    for path in (args.extract, args.zipf, args.books):
        if not path.exists():
            sys.exit(f"{path} does not exist; run extract.py, score.py and books.py first")

    started = time.monotonic()
    timings = []
    counts = Counter()
    samples = {}
    for index, tier in enumerate(TIER_ORDER):
        samples[f"tier {tier}"] = Reservoir(20, seed=index)
        samples[f"tier {tier}, archaic"] = Reservoir(10, seed=30 + index)
        samples[f"tier {tier}, technical"] = Reservoir(10, seed=40 + index)
    for index, flag in enumerate(("capitalized", "multiword", "hyphenated", "apostrophe", "digits", "nonascii")):
        samples[f"flag {flag}"] = Reservoir(10, seed=10 + index)
    samples["pointer only"] = Reservoir(10, seed=20)
    pos_table = PosTable()

    print("Reading scores")
    scores = read_zipf(args.zipf)
    books = read_books(args.books)

    temp = DATABASE.with_name(DATABASE.name + ".tmp")
    temp.unlink(missing_ok=True)
    db = sqlite3.connect(temp)
    db.execute("PRAGMA journal_mode = OFF")
    db.execute("PRAGMA synchronous = OFF")
    db.executescript(SCHEMA_SQL.read_text())

    print("Pass 1: words")
    step = time.monotonic()
    meta, word_rows = pass_one(args, scores, books, pos_table, counts, samples)
    with db:
        db.executemany(
            "INSERT INTO word (word, length, pos_mask, tier, zipf, capitalized, multiword, hyphenated,"
            " apostrophe, digits, nonascii, pointer_only, archaic, technical, books, ipa)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            word_rows)
    word_ids = dict(db.execute("SELECT word, id FROM word"))
    del word_rows
    timings.append(("pass 1", time.monotonic() - step))
    print(f"  {len(word_ids):,} words")

    print("Pass 2: meanings")
    step = time.monotonic()
    with db:
        pass_two(args, db, word_ids, pos_table, counts)
        db.executemany("INSERT INTO pos (code, name, bit) VALUES (?, ?, ?)", pos_table.rows())
        db.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", [
            ("extract", json.dumps(meta or {})),
            ("built", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
            ("zipf_file", args.zipf.name),
            ("books_file", args.books.name),
            ("limit", str(args.limit)),
        ])
    timings.append(("pass 2", time.monotonic() - step))

    print("Indexes and vacuum")
    step = time.monotonic()
    db.executescript("""
        CREATE INDEX idx_word_word ON word(word);
        CREATE INDEX idx_word_pick ON word(multiword, capitalized, pointer_only, tier, archaic, technical, length, pos_mask);
        CREATE INDEX idx_meaning_word ON meaning(word_id, ord);
        CREATE INDEX idx_example_meaning ON example(meaning_id);
        CREATE INDEX idx_synonym_meaning ON synonym(meaning_id);
        CREATE INDEX idx_pronunciation_word ON pronunciation(word_id);
        CREATE INDEX idx_etymology_word ON etymology(word_id);
    """)
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        sys.exit(f"Integrity check failed: {integrity}")
    db.execute("VACUUM")
    db.close()
    temp.replace(DATABASE)
    timings.append(("index+vacuum", time.monotonic() - step))
    timings.append(("total", time.monotonic() - started))

    db = sqlite3.connect(DATABASE)
    canaries = check_canaries(db)
    report = write_report(REPORT, meta, args, counts, samples, canaries, db, timings)
    print("\n".join(report[report.index("Words by tier and shape") - 1:]))
    print(f"\nWrote {DATABASE} ({DATABASE.stat().st_size / 1e6:.0f} MB) and {REPORT}")
    for word in args.word:
        show_word(db, word)
    db.close()
    if not all(ok for _, _, _, ok in canaries):
        sys.exit("Canary check failed; see the report")


if __name__ == "__main__":
    main()
