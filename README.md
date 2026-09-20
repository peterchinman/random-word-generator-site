# Random Word Generator

Source for [randomwordgenerator.info](https://randomwordgenerator.info): a static page that asks a small PHP endpoint for random words from a SQLite dictionary.

## Layout

- `public/` is the web root. `index.html` is the whole front end; `api/get_words.php` is the only server-side code.
- `database/dictionary.db` is the SQLite dictionary the API reads. It sits outside the web root so it can't be downloaded.
- The API picks random words from a precomputed `word_pick` table (one row per single word, with its length and a part-of-speech bitmask). Whenever the `word` or `meaning` tables change, rebuild it with:

      sqlite3 database/dictionary.db < database/build_pick_table.sql

## Running locally

You need PHP with the SQLite extension (check with `php -m | grep sqlite3`). On a Mac, `brew install php` provides both.

    php -S localhost:8000 -t public

Then open <http://localhost:8000>. Press Ctrl+C to stop the server.

## Deploying

Pushing to `master` runs `.github/workflows/deploy.yml`, which rsyncs the repository to the DigitalOcean droplet and reloads Apache.
