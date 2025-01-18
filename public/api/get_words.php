<?php
$numberOfWords = $_GET['numberOfWords'] ?? 15;
$partsOfSpeech = !empty($_GET['partsOfSpeech']) ? explode(',', $_GET['partsOfSpeech']) : [];
$minWordLength = $_GET['minWordLength'] ?? 0;
$maxWordLength = $_GET['maxWordLength'] ?? 0;

// construct partsOfSpeech query
$partsOfSpeechQuery = "";
if ($partsOfSpeech){
   $partsOfSpeechQuery = 'AND speech_part IN (';
   foreach ($partsOfSpeech as $part){
      $partsOfSpeechQuery .= '"' . $part . '",';
   }
   $partsOfSpeechQuery = rtrim($partsOfSpeechQuery, ',');
   $partsOfSpeechQuery .= ')';
}


// minWordLengthQuery
$minWordLengthQuery = "";
if ($minWordLength > 0 && $minWordLength < 26) {
   $minWordLengthQuery .= "AND length(word.word) >= $minWordLength";
}
// maxWordLengthQuery
$maxWordLengthQuery = "";
if ($maxWordLength > 0 && $maxWordLength < 26) {
   $maxWordLengthQuery .= "AND length(word.word) <= $maxWordLength";
}

// write the query with sting interpolation
$query = "SELECT json_object(
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
$partsOfSpeechQuery
$minWordLengthQuery
$maxWordLengthQuery
-- only includes single words
-- TODO make this a setting
AND word NOT LIKE '% %'
GROUP BY word.id
ORDER BY random()
LIMIT $numberOfWords
";

try {
   $db = new SQLite3(__DIR__ . '/../../database/dictionary.db');


   $results = $db->query($query);

   $response = [];
   while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
      $response[] = json_decode($row['words'], true);
   }

   header('Content-Type: application/json');
   echo json_encode($response);
} catch (Exception $e) {
   // Handle errors
   http_response_code(500);
   echo json_encode(['error' => 'Database connection failed']);
   exit;
}
?>
