"""
Shared by score.py and books.py: which of a word's listed forms count as inflections.

Wiktionary lists inflections (plurals, tenses, comparatives) and spelling variants
together under "forms", each with tags. A form is an inflection when it has one of the
INFLECTION_TAGS and none of the NOT_INFLECTION_TAGS. Frequency counts for a headword
include its inflections, because a verb like "trundle" is mostly met as "trundled".
"""

import gzip
import json

INFLECTION_TAGS = {
    "plural", "past", "present", "participle", "comparative", "superlative", "singular",
    "first-person", "second-person", "third-person", "subjunctive", "imperative", "infinitive", "gerund",
}
NOT_INFLECTION_TAGS = {
    "alternative", "obsolete", "archaic", "rare", "dated", "nonstandard", "dialectal", "abbreviation",
    "pronunciation-spelling", "misspelling", "uncommon", "proscribed", "error-unrecognized-form",
}


def read_forms(extract_path):
    """Returns {headword: set of inflected forms} for every headword in the extract."""
    forms_by_word = {}
    with gzip.open(extract_path, "rt", encoding="utf-8") as extract:
        for line in extract:
            entry = json.loads(line)
            if "_meta" in entry:
                continue
            forms = forms_by_word.setdefault(entry["word"], set())
            for form in entry.get("forms", []):
                tags = set(form["tags"])
                if tags & INFLECTION_TAGS and not tags & NOT_INFLECTION_TAGS:
                    forms.add(form["form"])
    return forms_by_word
