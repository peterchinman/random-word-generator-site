<?php
   error_reporting(E_ALL);
	ini_set('display_errors', 1);

   // TODO get values from form submission
   $speech_part = "noun";
   $words_to_generate = 15;
	
	$db = new SQLite3('dictionary.db');

   $stmt = $db->prepare(
      "SELECT json_object(
         'word', word.word,
         'meanings', (
            SELECT json_group_array(
               json_object(
                  'definition', meaning.definition,
                  'speech_part', meaning.speech_part,
                  'example', meaning.example,
                  'synonyms', (
                        SELECT json_group_array(synonym.synonym)
                        FROM synonym
                        WHERE synonym.meaning_id = meaning.id
                  )
               )
            )
            FROM meaning
            WHERE meaning.word_id = word.id
         )
      ) as words
      FROM word
      JOIN meaning on word.id = meaning.word_id
      WHERE 1 = 1
      AND speech_part = :speech_part
      -- only includes single words
      -- TODO make this a setting
      AND word NOT LIKE '% %'
      GROUP BY word.id
      ORDER BY random()
      LIMIT :limit
      "
   );

   $stmt->bindValue(':speech_part', $speech_part, SQLITE3_TEXT);
   $stmt->bindValue(':limit', $words_to_generate, SQLITE3_TEXT);
   $results = $stmt->execute();

   $response = [];
   while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
      $response[] = json_decode($row['words'], true);
   }

   header('Content-Type: application/json');
   echo json_encode($response);
?>
