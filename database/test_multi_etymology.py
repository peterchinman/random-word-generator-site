"""The shared source preserves entry links for downstream consumers."""

import sqlite3
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import build


class MultiEtymologyTest(unittest.TestCase):
    def test_bluff_origins_keep_their_own_definitions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "dictionary.db"
            source = sqlite3.connect(source_path)
            source.executescript((Path(__file__).with_name("schema.sql")).read_text())
            source.execute("INSERT INTO pos VALUES ('noun','noun',1)")
            source.execute("INSERT INTO pos VALUES ('verb','verb',2)")
            source.execute(
                "INSERT INTO word (id,word,length,pos_mask,tier,zipf,capitalized,multiword,"
                "hyphenated,apostrophe,digits,nonascii,pointer_only,archaic,technical,books,ipa) "
                "VALUES (1,'bluff',5,1,'common',3.68,0,0,0,0,0,0,0,0,0,0,'/blʌf/')"
            )
            pretending = "Probably from Dutch bluffen (“to brag”), from Middle Dutch bluffen (“to make something swell; to bluff”); or from the Dutch noun bluf (“bragging”). Related to German verblüffen (“to stump, perplex”)."
            entries = [
                {"pos": "noun", "etym_no": 1,
                 "etymology": pretending,
                 "sounds": [{"ipa": "/blʌf/", "tags": ["US"]}],
                 "senses": [{"gloss": "An act of bluffing; a false expression of strength."}]},
                {"pos": "noun", "etym_no": 2,
                 "etymology": "Related to Middle Low German blaff (“smooth”).",
                 "sounds": [{"ipa": "/blɐf/", "tags": ["UK"]}],
                 "senses": [{"gloss": "A high, steep bank beside a river."}]},
                {"pos": "verb", "etym_no": 1,
                 "etymology": pretending,
                 "senses": [{"gloss": "To deceive with a false show of strength."}]},
            ]
            build.flush_word(source, "bluff", 1, entries, build.PosTable(), Counter(), 0)
            source.commit()
            source.close()

            with sqlite3.connect(source_path) as db:
                rows = db.execute(
                    "SELECT e.etym_no,e.text,m.definition,p.ipa FROM etymology e "
                    "JOIN meaning m ON m.word_id=e.word_id AND m.entry_no=e.entry_no "
                    "LEFT JOIN pronunciation p ON p.word_id=e.word_id AND p.entry_no=e.entry_no "
                    "ORDER BY e.etym_no,m.ord"
                ).fetchall()
            self.assertEqual(len(rows), 3)
            first = [row for row in rows if row[0] == 1]
            second = [row for row in rows if row[0] == 2]
            self.assertEqual(len(first), 2)
            self.assertTrue(all(row[1] == pretending for row in first))
            self.assertIn("bluffing", first[0][2])
            self.assertEqual(first[0][3], "/blʌf/")
            self.assertIn("deceive", first[1][2])
            self.assertEqual(len(second), 1)
            self.assertIn("Middle Low German", second[0][1])
            self.assertIn("steep bank", second[0][2])
            self.assertEqual(second[0][3], "/blɐf/")



if __name__ == "__main__":
    unittest.main()
