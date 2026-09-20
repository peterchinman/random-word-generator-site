-- Schema for database/dictionary.db.
--
-- database/build.py runs this on an empty file before loading the Wordset data, then
-- database/build_pick_table.sql adds the word_pick and speech_part_bit tables that the
-- API actually picks from. The tables below are the dictionary itself.

CREATE TABLE word (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   word TEXT NOT NULL
);

CREATE TABLE meaning (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   definition TEXT NOT NULL,
   example TEXT,                  -- '' when the source has no example sentence
   speech_part TEXT,              -- noun, verb, adjective, adverb, ...
   word_id INTEGER NOT NULL,
   FOREIGN KEY (word_id) REFERENCES word(id)
);

CREATE TABLE synonym (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   synonym TEXT NOT NULL,
   meaning_id INTEGER NOT NULL,
   FOREIGN KEY (meaning_id) REFERENCES meaning(id)
);

-- Reserved for ARPAbet pronunciations (as in the CMU Pronouncing Dictionary).
-- Nothing fills or reads it yet.
CREATE TABLE pronunciation (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   ARPAbet TEXT NOT NULL,
   word_id INTEGER NOT NULL,
   FOREIGN KEY (word_id) REFERENCES word(id)
);

CREATE INDEX idx_word_word ON word(word);
CREATE INDEX idx_meaning_word_id ON meaning(word_id);
CREATE INDEX idx_word_speech_part ON meaning(speech_part);
CREATE INDEX idx_synonym_meaning_id ON synonym(meaning_id);
