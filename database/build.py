#!/usr/bin/env python3
"""
Builds database/dictionary.db from the Wordset dictionary.

    python3 database/build.py

Steps:
  1. Download the Wordset repository at the commit pinned below (cached in database/build/).
  2. Load every data/*.json file into a fresh SQLite file laid out by schema.sql.
  3. Run build_pick_table.sql to add the tables the API picks random words from.
  4. Check integrity, VACUUM, and move the file into place as dictionary.db.

Only the Python standard library is needed. To take a newer Wordset commit, change
WORDSET_COMMIT and re-run.

What is kept from each Wordset entry: the word, and for each meaning its definition
("def" upstream), example, part of speech and synonyms, in the order the source lists
them. Contributor, editor, label and id fields are dropped. A missing example is stored
as '' rather than NULL, and null entries in synonym lists (a few hundred upstream) are
skipped.
"""

import json
import shutil
import sqlite3
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

# The source is wordset/wordset-dictionary, a project that ended in 2017. The download comes
# from peterchinman/wordset-dictionary, a fork made so the data can't disappear if the
# original repository does. The commit is upstream master as of 2025-03-13.
WORDSET_COMMIT = "4503bfafbe4556361a296b9d368c18168dfb56c3"
WORDSET_TARBALL = f"https://github.com/peterchinman/wordset-dictionary/archive/{WORDSET_COMMIT}.tar.gz"

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / "build"
DATABASE = HERE / "dictionary.db"
SCHEMA_SQL = HERE / "schema.sql"
PICK_TABLE_SQL = HERE / "build_pick_table.sql"


def download_wordset():
    """Returns the path of the cached Wordset tarball, downloading it first if needed."""
    CACHE_DIR.mkdir(exist_ok=True)
    tarball = CACHE_DIR / f"wordset-{WORDSET_COMMIT[:8]}.tar.gz"
    if tarball.exists():
        print(f"Using cached {tarball.relative_to(HERE.parent)}")
        return tarball

    print(f"Downloading {WORDSET_TARBALL}")
    partial = tarball.with_name(tarball.name + ".part")
    with urllib.request.urlopen(WORDSET_TARBALL) as response, open(partial, "wb") as out:
        shutil.copyfileobj(response, out)
    partial.replace(tarball)
    return tarball


def read_data_files(tarball):
    """Yields (file name, entries) for each data/*.json file in the tarball, in name order."""
    with tarfile.open(tarball) as tar:
        members = [
            member for member in tar.getmembers()
            if member.isfile() and "/data/" in member.name and member.name.endswith(".json")
        ]
        if not members:
            sys.exit(f"No data/*.json files found in {tarball}")
        for member in sorted(members, key=lambda member: member.name):
            with tar.extractfile(member) as file:
                yield Path(member.name).name, json.load(file)


def load_entries(db, entries):
    """Inserts one Wordset file's entries (a dict keyed by word) into word, meaning and synonym."""
    for entry in entries.values():
        word_id = db.execute("INSERT INTO word (word) VALUES (?)", (entry["word"],)).lastrowid
        for meaning in entry.get("meanings", []):
            meaning_id = db.execute(
                "INSERT INTO meaning (definition, example, speech_part, word_id) VALUES (?, ?, ?, ?)",
                (meaning["def"], meaning.get("example", ""), meaning.get("speech_part", ""), word_id),
            ).lastrowid
            synonyms = [synonym for synonym in meaning.get("synonyms") or [] if synonym is not None]
            db.executemany(
                "INSERT INTO synonym (synonym, meaning_id) VALUES (?, ?)",
                [(synonym, meaning_id) for synonym in synonyms],
            )


def main():
    started = time.monotonic()
    tarball = download_wordset()

    # Build into a temporary file so a failed run never leaves a half-written dictionary.db.
    temp = DATABASE.with_name(DATABASE.name + ".tmp")
    temp.unlink(missing_ok=True)
    db = sqlite3.connect(temp)
    db.executescript(SCHEMA_SQL.read_text())

    print("Loading Wordset data")
    with db:  # one transaction for every insert
        for name, entries in read_data_files(tarball):
            load_entries(db, entries)
            print(f"  {name}: {len(entries):,} words")

    print("Building word_pick")
    db.executescript(PICK_TABLE_SQL.read_text())

    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        sys.exit(f"Integrity check failed: {integrity}")
    db.execute("VACUUM")

    counts = {
        table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("word", "meaning", "synonym", "word_pick")
    }
    db.close()
    temp.replace(DATABASE)

    print(f"Wrote {DATABASE.relative_to(HERE.parent)} in {time.monotonic() - started:.0f}s:")
    for table, count in counts.items():
        print(f"  {table}: {count:,}")


if __name__ == "__main__":
    main()
