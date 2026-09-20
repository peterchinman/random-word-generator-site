# Random Word Generator

Source for [randomwordgenerator.info](https://randomwordgenerator.info).

- `public/` is the web root. `index.html` is the front end, `api/get_words.php` is the API.
- `database/dictionary.db` is the SQLite dictionary the API reads. It's kept outside the web root.
- `database/build.py` rebuilds the dictionary from [Wordset](https://github.com/wordset/wordset-dictionary).

## Run locally

    php -S localhost:8000 -t public

Needs PHP with the SQLite extension. `brew install php` covers it.

## Rebuild the dictionary

    python3 database/build.py

Downloads Wordset at the commit pinned in the script, loads it into a fresh database, and builds the `word_pick` table the API selects from. The download is cached in `database/build/`.

## Deploy

Push to `master`. The workflow in `.github/workflows` rsyncs the repo to the droplet.
