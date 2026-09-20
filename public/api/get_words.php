<?php
/**
 * Returns a JSON array of random single words, each with its meanings.
 *
 * Query parameters (all optional):
 *   numberOfWords  how many words to return, 1 to 100 (default 15)
 *   partsOfSpeech  comma-separated, e.g. "noun,verb"; only words with at least
 *                  one meaning of one of these types are returned
 *   minWordLength  minimum number of letters (0 means no minimum)
 *   maxWordLength  maximum number of letters (0 means no maximum)
 *
 * Every value is bound as a prepared-statement parameter; nothing from the
 * request is ever pasted into the SQL text.
 *
 * The response carries a Server-Timing header with how long PHP spent opening
 * the database, running the query and encoding the JSON, so the browser's
 * network panel can show server time separately from network time.
 */

declare(strict_types=1);

const DATABASE_PATH = __DIR__ . '/../../database/dictionary.db';
const MAX_NUMBER_OF_WORDS = 100;
const MAX_PARTS_OF_SPEECH = 20;

header('Content-Type: application/json');
header('Cache-Control: no-store');

// When PHP began handling this request; the Server-Timing "php" entry is measured from here.
$requestStarted = $_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true);

// Returns a query-string parameter as an integer, or $default if it is missing or not a whole number.
function intParam(string $name, int $default): int
{
   $value = filter_var($_GET[$name] ?? null, FILTER_VALIDATE_INT);
   return $value === false ? $default : $value;
}

$numberOfWords = max(1, min(intParam('numberOfWords', 15), MAX_NUMBER_OF_WORDS));
$minWordLength = max(0, intParam('minWordLength', 0));
$maxWordLength = max(0, intParam('maxWordLength', 0));

$rawPartsOfSpeech = $_GET['partsOfSpeech'] ?? '';
$partsOfSpeech = [];
if (is_string($rawPartsOfSpeech)) {
   $partsOfSpeech = array_map('trim', explode(',', $rawPartsOfSpeech));
   $partsOfSpeech = array_values(array_filter($partsOfSpeech, fn ($part) => $part !== ''));
   $partsOfSpeech = array_slice($partsOfSpeech, 0, MAX_PARTS_OF_SPEECH);
}

// Build the WHERE clause from whichever filters were supplied.
// Each "?" placeholder is filled from $parameters, in order.
$conditions = ["word.word NOT LIKE '% %'"]; // single words only, no phrases
$parameters = [];

if ($partsOfSpeech) {
   $placeholders = implode(', ', array_fill(0, count($partsOfSpeech), '?'));
   $conditions[] = "meaning.speech_part IN ($placeholders)";
   array_push($parameters, ...$partsOfSpeech);
}
if ($minWordLength > 0) {
   $conditions[] = 'length(word.word) >= ?';
   $parameters[] = $minWordLength;
}
if ($maxWordLength > 0) {
   $conditions[] = 'length(word.word) <= ?';
   $parameters[] = $maxWordLength;
}
$parameters[] = $numberOfWords;

$sql = "
   SELECT json_object(
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
   ) AS word_json
   FROM word
   JOIN meaning ON meaning.word_id = word.id
   WHERE " . implode("\n     AND ", $conditions) . "
   GROUP BY word.id
   ORDER BY random()
   LIMIT ?
";

try {
   $openStarted = microtime(true);
   $db = new SQLite3(DATABASE_PATH, SQLITE3_OPEN_READONLY);
   $db->enableExceptions(true);
   $openSeconds = microtime(true) - $openStarted;

   $queryStarted = microtime(true);
   $statement = $db->prepare($sql);
   foreach ($parameters as $index => $value) {
      // SQLite numbers its placeholders from 1.
      $statement->bindValue($index + 1, $value, is_int($value) ? SQLITE3_INTEGER : SQLITE3_TEXT);
   }
   $results = $statement->execute();

   // SQLite runs the statement lazily, so the scan, random sort and JSON building
   // all happen inside this loop; the query time is measured around it.
   $words = [];
   while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
      $words[] = json_decode($row['word_json'], true);
   }
   $querySeconds = microtime(true) - $queryStarted;

   $encodeStarted = microtime(true);
   $json = json_encode($words);
   $encodeSeconds = microtime(true) - $encodeStarted;

   // Each entry is a name and a duration in milliseconds. "php" covers the whole request
   // as PHP saw it, so whatever the browser measures beyond that is network, Cloudflare
   // and web-server time. Headers must go out before any output.
   header(sprintf(
      'Server-Timing: db-open;dur=%.1f, query;dur=%.1f;desc="random pick + JSON", encode;dur=%.1f, php;dur=%.1f;desc="whole request in PHP"',
      $openSeconds * 1000,
      $querySeconds * 1000,
      $encodeSeconds * 1000,
      (microtime(true) - $requestStarted) * 1000,
   ));

   echo $json;
} catch (Throwable $error) {
   error_log('get_words.php: ' . $error->getMessage());
   http_response_code(500);
   echo json_encode(['error' => 'Could not fetch words']);
}
