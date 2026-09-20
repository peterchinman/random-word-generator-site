-- Builds the tables that public/api/get_words.php uses to choose random words quickly.
--
-- Run it again whenever the word or meaning tables change (it replaces both tables):
--
--    sqlite3 database/dictionary.db < database/build_pick_table.sql
--
-- word_pick has one row per single word (no spaces) that has at least one meaning, holding
-- the word's id, its length and a bitmask of its parts of speech. Choosing random words from
-- it means sorting 70,000 small rows instead of joining and grouping the whole meaning table
-- on every request.
--
-- speech_part_bit says which bit stands for which part of speech. The bits are assigned from
-- the distinct values in meaning.speech_part, so a new part of speech in the data gets a bit
-- automatically on the next rebuild. The API turns the requested names into a mask by looking
-- them up here, so it never needs to know the bit values.

BEGIN;

DROP TABLE IF EXISTS word_pick;
DROP TABLE IF EXISTS speech_part_bit;

CREATE TABLE speech_part_bit (
   speech_part TEXT PRIMARY KEY,
   bit INTEGER NOT NULL
);

INSERT INTO speech_part_bit (speech_part, bit)
SELECT speech_part, 1 << (row_number() OVER (ORDER BY speech_part) - 1)
FROM (SELECT DISTINCT speech_part FROM meaning WHERE speech_part IS NOT NULL);

CREATE TABLE word_pick (
   word_id INTEGER PRIMARY KEY,   -- word.id
   length INTEGER NOT NULL,       -- letters in the word
   pos_mask INTEGER NOT NULL      -- the bits of every part of speech the word has a meaning for
);

-- Each bit is a distinct power of two, so summing the distinct bits is the same as OR-ing them.
INSERT INTO word_pick (word_id, length, pos_mask)
SELECT word.id, length(word.word), COALESCE(SUM(DISTINCT speech_part_bit.bit), 0)
FROM word
JOIN meaning ON meaning.word_id = word.id
LEFT JOIN speech_part_bit ON speech_part_bit.speech_part = meaning.speech_part
WHERE word.word NOT LIKE '% %'
GROUP BY word.id;

COMMIT;
