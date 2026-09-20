#!/usr/bin/env python3
"""
Checks that the example words shown on the site still match the dictionary.

    python3 database/check_examples.py

The site illustrates every rareness tier and every Options pill with three example words,
kept in public/index.html. A build.py run can move a word into another tier or drop a flag,
which leaves those examples quietly wrong. This reads the words out of the page, looks each
one up in database/dictionary.db and exits non-zero if any of them no longer fits, so it can
be run after every build.

It also checks that the tier codes in the page, in the API and in the database are the same
three lists, which is what breaks when a tier is added, removed or renamed, and that the
request index.html makes from <head> before the page has loaded still asks for what the
form's default settings ask for (if not, the early response is wasted and the first batch
is fetched again).
"""

import re
import sqlite3
import sys
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATABASE = HERE / "dictionary.db"
PAGE = HERE.parent / "public" / "index.html"
API = HERE.parent / "public" / "api" / "get_words.php"

# Each Options pill promises its examples have this column set to 1.
PILL_COLUMNS = {
    "multiword": "multiword",
    "hyphenated": "hyphenated",
    "apostrophe": "apostrophe",
    "capitalized": "capitalized",
    "archaic": "archaic",
    "technical": "technical",
}

# wordQuery() in javascript.js sends the Options pills last, in this order.
INCLUDE_FLAGS = ["multiword", "hyphenated", "apostrophe", "capitalized", "archaic", "technical"]


class Page(HTMLParser):
    """Pulls the tier list, the Options pills, the form's inputs and the scripts out of index.html."""

    def __init__(self):
        super().__init__()
        self.tiers = []          # (tier code, name shown, [example words])
        self.pills = []          # (pill value, name shown, [example words])
        self.inputs = []         # attributes of every <input>, in page order
        self.script = ""         # the text of every inline <script>
        self._in_tier_list = False
        self._in_script = False
        self._label = None       # the label being read: [examples, text so far]

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "datalist" and attrs.get("id") == "tiers":
            self._in_tier_list = True
        elif tag == "option" and self._in_tier_list:
            self.tiers.append((attrs["value"], attrs.get("label", ""), split(attrs.get("data-examples", ""))))
        elif tag == "label" and "data-examples" in attrs:
            self._label = [split(attrs["data-examples"]), ""]
        elif tag == "input" and self._label is not None and attrs.get("name") == "include":
            self.pills.append((attrs["value"], self._label[1].strip(), self._label[0]))
        if tag == "input":
            self.inputs.append(attrs)
        elif tag == "script":
            self._in_script = True

    def handle_endtag(self, tag):
        if tag == "datalist":
            self._in_tier_list = False
        elif tag == "label":
            self._label = None
        elif tag == "script":
            self._in_script = False

    def handle_data(self, data):
        if self._label is not None:
            self._label[1] += data
        if self._in_script:
            self.script += data


def split(value):
    return [word.strip() for word in value.split(",") if word.strip()]


def form_default_query(page):
    """The (name, value) pairs wordQuery() in javascript.js sends for the form as the page loads it."""
    def inputs(name):
        return [attrs for attrs in page.inputs if attrs.get("name") == name]

    def checked(name):
        return [attrs["value"] for attrs in inputs(name) if "checked" in attrs]

    def number(name):
        return str(int(inputs(name)[0].get("value") or 0))

    thumbs = sorted(int(attrs["value"]) for attrs in inputs("tier-a") + inputs("tier-b"))
    tiers = [code for code, _, _ in page.tiers][thumbs[0]:thumbs[-1] + 1]
    include = checked("include")
    return [
        ("numberOfWords", checked("number-words")[0]),
        ("partsOfSpeech", ",".join(checked("parts-of-speech"))),
        ("minWordLength", number("min-word-length")),
        ("maxWordLength", number("max-word-length")),
        ("tiers", ",".join(tiers)),
    ] + [(flag, "1" if flag in include else "0") for flag in INCLUDE_FLAGS]


def head_query(page):
    """The (name, value) pairs the <head> script in index.html requests, or None if there is no such script."""
    match = re.search(r"window\.firstWords.*?new URLSearchParams\(\{(.*?)\}\)", page.script, re.S)
    if match is None:
        return None
    pairs = re.findall(r"(\w+):\s*('[^']*'|\"[^\"]*\"|\d+)", match.group(1))
    return [(name, value.strip("'\"")) for name, value in pairs]


def api_tiers():
    """The tier codes listed in get_words.php's TIERS constant."""
    for line in API.read_text().splitlines():
        if line.startswith("const TIERS"):
            return split(line.split("[", 1)[1].split("]", 1)[0].replace("'", ""))
    return []


def main():
    if not DATABASE.exists():
        sys.exit(f"no database at {DATABASE}; build it or download the release first")

    page = Page()
    page.feed(PAGE.read_text())
    db = sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True)
    problems = 0

    # The same seven tiers, in the same order, in all three places?
    in_page = [code for code, _, _ in page.tiers]
    in_db = [row[0] for row in db.execute(
        "SELECT tier FROM word GROUP BY tier ORDER BY AVG(zipf) DESC")]
    for other, where in ((api_tiers(), "get_words.php"), (in_db, "the database")):
        if in_page != other:
            print(f"TIERS  page has {in_page}\n       {where} has {other}")
            problems += 1

    # The request made from <head> still what the form's default settings would ask for?
    expected, actual = form_default_query(page), head_query(page)
    if actual != expected:
        print(f"HEAD   the first-words request in <head> is {actual}\n       the form's defaults give {expected}")
        problems += 1

    # Every example word in the tier it illustrates?
    for code, name, examples in page.tiers:
        for word in examples:
            row = db.execute(
                "SELECT tier, round(zipf, 2) FROM word WHERE word = ? AND capitalized = 0", (word,)).fetchone()
            if row is None:
                print(f"{name:<9} {word:<14} is not in the dictionary")
                problems += 1
            elif row[0] != code:
                print(f"{name:<9} {word:<14} is {row[0]} now, not {code} (score {row[1]})")
                problems += 1

    # Every Options example still carrying the flag its pill is about?
    for value, name, examples in page.pills:
        column = PILL_COLUMNS.get(value)
        if column is None:
            print(f"{name:<9} no column known for the pill {value!r}")
            problems += 1
            continue
        for word in examples:
            row = db.execute(f"SELECT {column} FROM word WHERE word = ?", (word,)).fetchone()
            if row is None:
                print(f"{name:<9} {word:<14} is not in the dictionary")
                problems += 1
            elif not row[0]:
                print(f"{name:<9} {word:<14} is not {column} any more")
                problems += 1

    checked = sum(len(e) for _, _, e in page.tiers) + sum(len(e) for _, _, e in page.pills)
    print(f"{checked} example words checked, {problems} problem{'' if problems == 1 else 's'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
