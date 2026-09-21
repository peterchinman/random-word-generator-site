# Random Word Generator

Source for [randomwordgenerator.info](https://randomwordgenerator.info): an Astro site whose word and phrase generators call a PHP endpoint backed by a SQLite dictionary built from English Wiktionary.

## Layout

- `src/pages/index.astro` and `src/pages/phrases.astro` define `/` and `/phrases/`. Both use `src/layouts/SiteLayout.astro` for the document head, theme startup, header/navigation, and footer.
- `src/components/` contains shared filter controls, icons, and definition markup. `src/lib/word-options.js` is the single source for tier names/examples, inclusion flags, and word defaults. Browser helpers in `src/lib/` share sliders, API requests, clipboard feedback, and definition rendering; `src/scripts/words.js` and `phrases.js` own their respective page state.
- `src/styles/` contains the existing global styles and phrase-specific additions. Astro bundles and hashes CSS and JavaScript. `public/` contains files copied unchanged to the build: the PHP API, fonts/license, and share image.
- `dist/` is the generated web root, including `api/get_words.php`. It is ignored by Git. PHP reads `database/dictionary.db` relative to the repository, which works from both `public/api/` in development and `dist/api/` in production. Astro runs only during development/build; Apache and PHP serve the deployed site.
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

       npm run build
    python3 database/check_examples.py

   The site illustrates every rareness tier and every Options pill with three example words, defined in `src/lib/word-options.js` and rendered into both built pages. A change to the tier rules can move one of those words into another tier and leave the page quietly wrong, so run this after every build. It also checks that the tier codes in the page, in `get_words.php` and in the database are the same list, which is what breaks when a tier is added, removed or renamed, and that the request `FirstWords.astro` emits in `<head>` before the page has loaded still matches the form's default settings. It exits non-zero if anything no longer fits.

## Publishing a new dictionary

After a build you are happy with:

    TAG=dictionary-$(date +%Y-%m-%d)
    gh release create "$TAG" database/dictionary.db database/build/extract.jsonl.gz \
       --title "$TAG" --notes "Built from the kaikki.org snapshot recorded in build-report.txt"
    echo "$TAG" > database/RELEASE

Commit `database/RELEASE` (and `zipf.tsv.gz` and `build-report.txt` if they changed) and push. The deploy downloads `dictionary.db` from that release onto the server.

## Running locally

Use Node 24 (`nvm install` / `nvm use` reads `.nvmrc`), npm, PHP with SQLite, and `database/dictionary.db`. Build the dictionary as above or download the current release:

    gh release download "$(cat database/RELEASE)" --pattern dictionary.db --dir database

Install dependencies and start both development servers:

    npm ci
    npm run dev

Open <http://localhost:4321>. This command runs Astro with live updates and a PHP API server on `127.0.0.1:8001`; `/api` requests are proxied to PHP. Ctrl+C stops both processes. Set `PHP_PORT` to change the API port, or set `WORD_API_URL=http://localhost:8000` to reuse an existing PHP server instead. Astro flags can be passed through, for example `npm run dev -- --port 4322`.

To check the production build with PHP:

    npm run build
    npm run preview

Open <http://localhost:8080>. The preview serves `dist/` directly with PHP, including the API. Rebuild after source changes when using this preview.

## Frontend checks and deployment

    npm test
    npm run build
    npm run test:build
    npm run check:examples

The unit tests cover phrase generation, URL settings, defaults, and the shared API contract. The build checks verify routes, asset references, early theme/prefetch scripts, and PHP output. The dictionary check requires the local database and built pages.

A push to `master` builds and tests Astro in GitHub Actions with Node 24, uploads the build, fetches the selected dictionary release when needed, and points the existing `public_html` symlink at `dist/`. Astro's hashed asset URLs replace the previous commit-stamping step. No Node process is needed on the production server.

## Phrase builder

Both generators apply their theme in the document head before loading styles or content. The palette and an explicitly chosen light/dark mode persist in local storage (`palette` and `colorMode`); without an explicit mode, the site follows the system. A shared `theme.js` controls both pages, and startup transitions are disabled until the saved theme and switch positions have painted.

Open <http://localhost:8000/phrases/>. The default pattern is adjective → noun, with 10 phrases per batch and both words limited to everyday through familiar rareness. Added positions start with the same rareness range. Select a position to edit its part of speech, rareness, length, and inclusion options. Positions can be added, removed, or moved, from one to eight words; drag the pills with a mouse or touch, or use the editor’s arrow buttons to reorder them. Their filters move with them. Reset restores the default pattern and filters; Generate applies the settings.

The URL query parameters store word order, each position's settings, the number of phrases, and the selected position, including edits made before Generate is pressed. Refresh or opening a shared URL restores the builder before generating a fresh batch. Edits replace the current history entry; default settings are omitted, and Reset removes the builder's parameters. Browser-local settings do not override the URL. Bookmarked phrases remain in local storage.

For example, `/phrases/?parts=adverb,adjective,noun&count=15&word1.tiers=common,scarce&word2.min=4&word2.max=8&word3.include=technical` describes three positions with independent filters. `parts` lists positions in order; `count` optionally overrides the default batch size of 10 (whole numbers from 1 to 40, available only through the URL); `edit` optionally selects the editor's position (starting at 1). Each `wordN` accepts `tiers` (inclusive endpoints using the API tier codes, or one code for a single tier), `min`, `max`, and `include` (comma-separated flags; an empty value excludes all optional categories). Missing or malformed parameters use defaults; numeric length errors still use the normal form validation. Unrelated parameters and URL fragments survive edits and Reset.

The page uses the same dictionary endpoint and themes as the word generator. It combines independently selected words, without imposing grammatical agreement or inflecting them. Each position requests its own random sample of matching words, including positions with identical settings. The client shuffles and pairs those words, using a word at most once per position in a batch when enough matches exist. Smaller pools reuse words while keeping whole phrases unique, without constructing the entire Cartesian product. A position with no matches identifies which filters need widening; a small product produces fewer phrases rather than duplicates. Previous results remain available if a request fails or settings change while it is loading.

Click a word for definitions matching its position's part of speech. Whole phrases can be saved locally and copied one per line. They use the `savedPhrases` browser-storage key, independently of the word generator's `savedWords`. Astro generates directory-style routes so PHP/Apache serves both pages at their existing URLs.

Run the phrase logic checks with Node, and the dictionary/example consistency check with Python:

    npm test
    npm run build
    npm run check:examples
