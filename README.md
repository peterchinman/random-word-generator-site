# Random Word Generator

Source for [randomwordgenerator.info](https://randomwordgenerator.info): a static page that asks a small PHP endpoint for random words from a SQLite dictionary built from English Wiktionary.

## Layout

- `public/` is the web root. `index.html` is the whole front end; `api/get_words.php` is the only server-side code. Its docblock lists the query parameters (number of words, parts of speech, word length, commonness tier, and whether to include multi-word, hyphenated, apostrophe, accented and capitalised words, pure spelling variants, archaic words and technical terms).
- `database/dictionary.db` is the SQLite dictionary the API reads. It is a build artifact published as a GitHub release asset, and the deploy fetches the release named in `database/RELEASE`. `database/schema.sql` describes its tables.
- `database/` also holds the build stages (`extract.py`, `score.py`, `books.py`, `build.py`), `check_examples.py`, their committed scoring outputs `zipf.tsv.gz` and `books.tsv.gz`, and `build-report.txt`.

## Where the words come from

The dictionary is built from the English Wiktionary data published by [kaikki.org](https://kaikki.org/dictionary/English/) (extracted from Wiktionary with [wiktextract](https://github.com/tatuylonen/wiktextract)). Wiktionary text is licensed [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).

Every English entry with at least one real sense is kept: about 884,000 words.

Each word has a score on the Zipf scale (3 means once per million words, 0 once per billion): the higher of two measurements of the same thing, the [wordfreq](https://github.com/rspeer/wordfreq) package (data CC BY-SA 4.0), a blend of Wikipedia, subtitles, news, books, web and social-media text that stops at once per hundred million words, and the [Google Books Ngram](https://books.google.com/ngrams/) counts (CC BY 3.0) for 1990 to 2019, which reach three orders of magnitude deeper. The tier is a band of the score, each step roughly ten times rarer: common (3 and up), uncommon, scarce, rare (0 to 1, about 500 to 5,000 books), obscure, marginal (about 5 to 50 books) and unattested. Words neither corpus can score, mostly hyphenated, multi-word and capitalised entries, are placed by Wiktionary's own evidence: pronunciations, translations and quotations. Two qualities that occur at every tier are flags instead: "archaic" (every definition obsolete, archaic, dated or historical) and "technical" (every definition a science, medicine or computing term). The exact rules are in `build.py`'s docstring.

## Rebuilding the database

Three stages, each a script in `database/`. Their docstrings spell out the rules.

1. **Extract** (standard library, needs the 3 GB kaikki file, about 1 minute):

       python3 database/extract.py

   Downloads `kaikki.org-dictionary-English.jsonl` into `database/build/` if it isn't there (git ignores that folder) and writes `database/build/extract.jsonl.gz`, about 170 MB: every entry, minus Wiktionary plumbing and minus inflection-only senses like "plural of cat". kaikki.org regenerates its file weekly and keeps no history, so the extract is the only durable copy of a given snapshot; it is published alongside the database on each release.

2. **Score** (needs wordfreq, about 15 seconds):

       python3 -m venv database/.venv && database/.venv/bin/pip install wordfreq
       database/.venv/bin/python database/score.py

   Writes `database/zipf.tsv.gz`, a Zipf frequency for every word wordfreq knows. This file is small and committed, so the build stage never needs wordfreq.

3. **Books** (standard library, about 20 minutes, mostly download):

       python3 database/books.py

   Downloads Google's 2020 English 1-gram files (24 files, about 13 GB) into `database/build/ngrams/`, git-ignored and deletable afterwards, and writes `database/books.tsv.gz`: for every single lowercase headword, how often and in how many books it appears since 1900 and since 1990. Committed, so the build stage needs neither the download nor any library.

4. **Build** (standard library, about half a minute):

       python3 database/build.py

   Writes `database/dictionary.db` and `database/build-report.txt`. Every judgment call (which senses count as pointers, which examples to keep, how tiers are assigned) lives in `build.py`, so changing a rule means re-running only this stage. The report lists a count for each rule, the tier sizes, random samples per tier, and a canary check of words that must land in a given tier; the build exits non-zero if a canary moves. `python3 database/build.py --limit 50000` builds from the first 50,000 entries for a quick try, and `--word cat colour` prints how the finished database holds those words.

5. **Check the site's example words** (standard library, instant):

       python3 database/check_examples.py

   The site illustrates every rareness tier and every Options pill with three example words, kept in `public/index.html`. A change to the tier rules can move one of those words into another tier and leave the page quietly wrong, so run this after every build. It also checks that the tier codes in the page, in `get_words.php` and in the database are the same list, which is what breaks when a tier is added, removed or renamed, and that the request `index.html` makes from `<head>` before the page has loaded still matches the form's default settings. It exits non-zero if anything no longer fits.

## Publishing a new dictionary

After a build you are happy with:

    TAG=dictionary-$(date +%Y-%m-%d)
    gh release create "$TAG" database/dictionary.db database/build/extract.jsonl.gz \
       --title "$TAG" --notes "Built from the kaikki.org snapshot recorded in build-report.txt"
    echo "$TAG" > database/RELEASE

Commit `database/RELEASE` (and `zipf.tsv.gz` and `build-report.txt` if they changed) and push. The deploy downloads `dictionary.db` from that release onto the server.

## Running locally

You need PHP with the SQLite extension and a `database/dictionary.db`, either built as above or downloaded from the current release:

    gh release download "$(cat database/RELEASE)" --pattern dictionary.db --dir database

Then:

    php -S localhost:8000 -t public

and open <http://localhost:8000>. Press Ctrl+C to stop the server.
