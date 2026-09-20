-- Schema for database/dictionary.db. build.py runs this on an empty file, loads the
-- Wiktionary extract into it, then adds the indexes at the bottom of build.py.
--
-- One row in word per distinct headword. Everything the site shows hangs off it.
-- The flag columns and tier exist so that a query can say which kinds of word it
-- wants; nothing is filtered out of the database itself.

CREATE TABLE meta (
   key TEXT PRIMARY KEY,
   value TEXT NOT NULL             -- which extract, when built, which rules
);

CREATE TABLE pos (
   code TEXT PRIMARY KEY,          -- Wiktionary code, as in meaning.pos: noun, verb, adj, adv, name...
   name TEXT NOT NULL,             -- display name: adjective, adverb, proper noun...
   bit INTEGER NOT NULL            -- the bit that stands for this part of speech in word.pos_mask
);

CREATE TABLE word (
   id INTEGER PRIMARY KEY,
   word TEXT NOT NULL,
   length INTEGER NOT NULL,        -- letters only; spaces, hyphens and apostrophes are not counted
   pos_mask INTEGER NOT NULL,      -- OR of pos.bit for every part of speech the word has a meaning for
   tier TEXT NOT NULL,             -- common | uncommon | scarce | rare | obscure | marginal | unattested: how much
                                   -- evidence there is that the word is in use; the rules are in build.py's docstring
   zipf REAL,                      -- how established the word is, on the Zipf scale (3 = once per million words,
                                   -- 0 = once per billion): the higher of wordfreq's score and the Google Books
                                   -- rate since 1990. tier is a band of it. NULL when neither corpus knows the word
   capitalized INTEGER NOT NULL,   -- 1 if the word starts with a capital letter
   multiword INTEGER NOT NULL,     -- 1 if the word contains a space
   hyphenated INTEGER NOT NULL,
   apostrophe INTEGER NOT NULL,
   digits INTEGER NOT NULL,
   nonascii INTEGER NOT NULL,
   pointer_only INTEGER NOT NULL,  -- 1 if no meaning is a definition: every meaning just points at another word
   archaic INTEGER NOT NULL,       -- 1 if every definition is tagged obsolete, archaic, dated or historical
   technical INTEGER NOT NULL,     -- 1 if every current definition carries a science, medicine or computing topic
   books INTEGER NOT NULL,         -- distinct books using the word, 1990-2019, from Google Books Ngrams;
                                   -- 0 when none or not scored (hyphenated, multi-word and capitalised words)
   ipa TEXT                        -- display pronunciation; all of them are in pronunciation
);

CREATE TABLE meaning (
   id INTEGER PRIMARY KEY,
   word_id INTEGER NOT NULL REFERENCES word(id),
   ord INTEGER NOT NULL,           -- display order within the word, from 1
   pos TEXT NOT NULL REFERENCES pos(code),
   kind TEXT NOT NULL,             -- definition | variant | synonym
   target TEXT,                    -- for variant and synonym: the word this meaning points to
   definition TEXT NOT NULL,
   context TEXT,                   -- for a sub-sense: the parent glosses it refines, joined with ' › '
   qualifier TEXT,                 -- e.g. 'preceded by the'
   tags TEXT NOT NULL,             -- JSON array of Wiktionary tags: usage, region, grammar
   topics TEXT NOT NULL,           -- JSON array of topic labels
   demoted INTEGER NOT NULL        -- 1 if tagged obsolete, archaic, rare, dated...; sorted after the others
);

CREATE TABLE example (
   id INTEGER PRIMARY KEY,
   meaning_id INTEGER NOT NULL REFERENCES meaning(id),
   text TEXT NOT NULL,
   ref TEXT                        -- citation for a quotation; NULL for a made-up usage example
);

CREATE TABLE synonym (
   id INTEGER PRIMARY KEY,
   meaning_id INTEGER NOT NULL REFERENCES meaning(id),
   synonym TEXT NOT NULL
);

CREATE TABLE pronunciation (
   id INTEGER PRIMARY KEY,
   word_id INTEGER NOT NULL REFERENCES word(id),
   ipa TEXT NOT NULL,
   tags TEXT NOT NULL              -- JSON array: accent labels such as US, Received-Pronunciation
);

CREATE TABLE etymology (
   id INTEGER PRIMARY KEY,
   word_id INTEGER NOT NULL REFERENCES word(id),
   pos TEXT NOT NULL,
   etym_no INTEGER,                -- Wiktionary's "Etymology 1", "Etymology 2"... within the page
   text TEXT NOT NULL
);
