<?php
/**
 * Returns a JSON array of random words from the dictionary, each with its meanings.
 *
 * Query parameters (all optional):
 *   numberOfWords  how many words to return, 1 to 100 (default 15)
 *   partsOfSpeech  comma-separated, by display name or Wiktionary code, e.g. "noun,verb"
 *                  or "adj"; only words with at least one meaning of one of these types
 *                  are returned
 *   minWordLength  minimum number of letters (0 means no minimum)
 *   maxWordLength  maximum number of letters (0 means no maximum)
 *   tiers          comma-separated subset of common,uncommon,scarce,rare,obscure,marginal,
 *                  unattested: bands of how established the word is, from once per
 *                  million words down to "Wiktionary lists it and nothing more"
 *                  (default "common,uncommon,scarce,rare")
 *   minScore       lowest score to allow, on the Zipf scale (3 = once per million words,
 *   maxScore       0 = once per billion); either may be omitted. Words with no score
 *                  (the corpora never saw them) never pass a score filter.
 *   multiword      1 to include entries with spaces in them ("social secretary"); default 0
 *   capitalized    1 to include capitalised words, mostly proper nouns; default 0
 *   pointers       1 to include words whose every meaning only points at another word
 *                  ("colour": Commonwealth spelling of color); default 0
 *   archaic        0 to exclude words whose every definition is obsolete, archaic, dated
 *                  or historical; default 1 (included)
 *   technical      0 to exclude words whose every definition is a science, medicine or
 *                  computing term; default 1 (included)
 *   hyphenated     0 to exclude words with a hyphen; default 1 (included)
 *   apostrophe     0 to exclude words with an apostrophe; default 1 (included)
 *   nonascii       0 to exclude words with letters outside ASCII ("café"); default 1 (included)
 *
 * Words containing digits are never returned. Letters are counted without spaces,
 * hyphens or apostrophes.
 *
 * Each word is {word, tier, score, pronunciation, meanings}; score is null for words the
 * corpora never saw. Each meaning is {speech_part,
 * definition, kind, target, context, tags, example, synonyms}. speech_part is a display
 * name (noun, adjective, proper noun...). kind is "definition", or "variant"/"synonym"
 * for a meaning that just points at target. context holds the parent senses of a
 * sub-sense. The columns behind these are described in database/schema.sql.
 *
 * Every value is bound as a prepared-statement parameter; nothing from the request is
 * ever pasted into the SQL text.
 *
 * The pick is arranged to read as little of the 400 MB database as it can, because the
 * server has too little memory to keep the file cached. First, a few hundred word ids
 * are drawn at random and looked up by primary key, keeping those that pass the filter;
 * with the usual settings a quarter of all words pass, so that is nearly always enough.
 * When it is not (a narrow filter, such as one tier and one part of speech), the words
 * that pass are sorted at random instead. That scan stays inside idx_word_pick, which
 * holds every column the filter can mention, so it never reads a word row. The meanings
 * are only read for the winners.
 *
 * The response carries a Server-Timing header with how long PHP spent opening the
 * database, picking the words, building their JSON and encoding it, so the browser's
 * network panel can show server time separately from network time. The pick entry also
 * says whether the random ids were enough or the scan was needed.
 */

declare(strict_types=1);

const DATABASE_PATH = __DIR__ . '/../../database/dictionary.db';
const MAX_NUMBER_OF_WORDS = 100;
const MAX_PARTS_OF_SPEECH = 20;
const TIERS = ['common', 'uncommon', 'scarce', 'rare', 'obscure', 'marginal', 'unattested'];
const DEFAULT_TIERS = ['common', 'uncommon', 'scarce', 'rare'];
// Random ids tried per word wanted before falling back to the scan. Each costs about one
// page read; with the usual settings a quarter pass, so 8 per word leaves a wide margin.
const RANDOM_IDS_PER_WORD = 8;

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

// Returns a query-string parameter as a number, or null if it is missing or not numeric.
function floatParam(string $name): ?float
{
   $value = filter_var($_GET[$name] ?? null, FILTER_VALIDATE_FLOAT);
   return $value === false ? null : $value;
}

// Returns a query-string flag: "1", "true", "yes" or "on" count as set, "0", "false",
// "no" or "off" as clear; missing or unrecognised gives $default.
function flagParam(string $name, bool $default = false): bool
{
   $value = filter_var($_GET[$name] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
   return $value ?? $default;
}

// Returns a comma-separated query-string parameter as a list of trimmed, non-empty strings.
function listParam(string $name, int $max): array
{
   $raw = $_GET[$name] ?? '';
   if (!is_string($raw)) {
      return [];
   }
   $values = array_map('trim', explode(',', $raw));
   $values = array_values(array_filter($values, fn ($value) => $value !== ''));
   return array_slice($values, 0, $max);
}

// A "?, ?, ?" list for an IN clause with $count entries.
function placeholders(int $count): string
{
   return implode(', ', array_fill(0, $count, '?'));
}

// Runs a statement with the given positional parameters and returns its rows.
function query(SQLite3 $db, string $sql, array $parameters): array
{
   $statement = $db->prepare($sql);
   foreach ($parameters as $index => $value) {
      // SQLite numbers its placeholders from 1.
      $statement->bindValue($index + 1, $value, is_int($value) ? SQLITE3_INTEGER : (is_float($value) ? SQLITE3_FLOAT : SQLITE3_TEXT));
   }
   $results = $statement->execute();
   $rows = [];
   while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
      $rows[] = $row;
   }
   return $rows;
}

$numberOfWords = max(1, min(intParam('numberOfWords', 15), MAX_NUMBER_OF_WORDS));
$minWordLength = max(0, intParam('minWordLength', 0));
$maxWordLength = max(0, intParam('maxWordLength', 0));
$partsOfSpeech = listParam('partsOfSpeech', MAX_PARTS_OF_SPEECH);
$minScore = floatParam('minScore');
$maxScore = floatParam('maxScore');
$tiers = array_values(array_intersect(listParam('tiers', count(TIERS)), TIERS)) ?: DEFAULT_TIERS;

// Build the filter on the word table from whichever options were supplied.
// Each "?" placeholder is filled from $parameters, in order. Every column named here is in
// idx_word_pick (digits = 0 is the index's own condition), so the scan never leaves it.
$conditions = ['word.digits = 0'];
$parameters = [];

if (!flagParam('multiword')) {
   $conditions[] = 'word.multiword = 0';
}
if (!flagParam('capitalized')) {
   $conditions[] = 'word.capitalized = 0';
}
if (!flagParam('pointers')) {
   $conditions[] = 'word.pointer_only = 0';
}
if (!flagParam('archaic', true)) {
   $conditions[] = 'word.archaic = 0';
}
if (!flagParam('technical', true)) {
   $conditions[] = 'word.technical = 0';
}
if (!flagParam('hyphenated', true)) {
   $conditions[] = 'word.hyphenated = 0';
}
if (!flagParam('apostrophe', true)) {
   $conditions[] = 'word.apostrophe = 0';
}
if (!flagParam('nonascii', true)) {
   $conditions[] = 'word.nonascii = 0';
}

$conditions[] = 'word.tier IN (' . placeholders(count($tiers)) . ')';
array_push($parameters, ...$tiers);

if ($partsOfSpeech) {
   // pos maps each part of speech to one bit of word.pos_mask, so the requested names are
   // turned into a mask inside the query and stay bound as strings.
   $list = placeholders(count($partsOfSpeech));
   $conditions[] = "(word.pos_mask & (SELECT SUM(DISTINCT bit) FROM pos WHERE name IN ($list) OR code IN ($list))) != 0";
   array_push($parameters, ...$partsOfSpeech, ...$partsOfSpeech);
}
if ($minScore !== null) {
   $conditions[] = 'word.zipf >= ?';
   $parameters[] = $minScore;
}
if ($maxScore !== null) {
   $conditions[] = 'word.zipf <= ?';
   $parameters[] = $maxScore;
}
if ($minWordLength > 0) {
   $conditions[] = 'word.length >= ?';
   $parameters[] = $minWordLength;
}
if ($maxWordLength > 0) {
   $conditions[] = 'word.length <= ?';
   $parameters[] = $maxWordLength;
}

$filter = implode("\n     AND ", $conditions);

// Step 1, first try: random ids looked up by primary key, keeping those that pass the
// filter. The ids travel as one JSON array parameter. NOT INDEXED stops SQLite from
// answering the tier test from idx_word_pick instead, which would turn the lookups back
// into a scan of the index; the primary key is still used.
$randomIdsSql = "
   SELECT id
   FROM word NOT INDEXED
   WHERE id IN (SELECT value FROM json_each(?))
     AND $filter
   ORDER BY random()
   LIMIT ?
";

// Step 1, fallback: every word that passes the filter, sorted at random.
$scanSql = "
   SELECT id
   FROM word
   WHERE $filter
   ORDER BY random()
   LIMIT ?
";

// Step 2: the JSON for the chosen words. ORDER BY random() puts the batch in random order.
// The meanings come out in their stored order (ord) because the derived table feeding
// json_group_array is sorted by it.
$jsonSql = "
   SELECT json_object(
      'word', word.word,
      'tier', word.tier,
      'score', word.zipf,
      'pronunciation', word.ipa,
      'meanings', (
         SELECT json_group_array(
            json_object(
               'speech_part', pos.name,
               'definition', meaning.definition,
               'kind', meaning.kind,
               'target', meaning.target,
               'context', meaning.context,
               'tags', json(meaning.tags),
               'example', (
                  SELECT example.text
                  FROM example
                  WHERE example.meaning_id = meaning.id
                  ORDER BY example.id
                  LIMIT 1
               ),
               'synonyms', (
                  SELECT json_group_array(synonym.synonym)
                  FROM synonym
                  WHERE synonym.meaning_id = meaning.id
               )
            )
         )
         FROM (
            SELECT * FROM meaning WHERE meaning.word_id = word.id ORDER BY meaning.ord
         ) AS meaning
         JOIN pos ON pos.code = meaning.pos
      )
   ) AS word_json
   FROM word
   WHERE word.id IN (SELECT value FROM json_each(?))
   ORDER BY random()
";

try {
   $openStarted = microtime(true);
   $db = new SQLite3(DATABASE_PATH, SQLITE3_OPEN_READONLY);
   $db->enableExceptions(true);
   $openSeconds = microtime(true) - $openStarted;

   $pickStarted = microtime(true);
   // Ids run from 1 to the highest with no gaps, so any number in that range is a word.
   $maxId = (int) $db->querySingle('SELECT MAX(id) FROM word');
   $randomIds = [];
   for ($i = 0; $i < $numberOfWords * RANDOM_IDS_PER_WORD; $i++) {
      $randomIds[] = random_int(1, $maxId);
   }
   $ids = array_column(query($db, $randomIdsSql, [json_encode($randomIds), ...$parameters, $numberOfWords]), 'id');
   $pickMethod = 'random ids';
   if (count($ids) < $numberOfWords) {
      $ids = array_column(query($db, $scanSql, [...$parameters, $numberOfWords]), 'id');
      $pickMethod = 'random ids, then scan';
   }
   $pickSeconds = microtime(true) - $pickStarted;

   $jsonStarted = microtime(true);
   $words = array_map(
      fn ($row) => json_decode($row['word_json'], true),
      query($db, $jsonSql, [json_encode($ids)]),
   );
   $jsonSeconds = microtime(true) - $jsonStarted;

   $encodeStarted = microtime(true);
   $json = json_encode($words);
   $encodeSeconds = microtime(true) - $encodeStarted;

   // Each entry is a name and a duration in milliseconds. "php" covers the whole request
   // as PHP saw it, so whatever the browser measures beyond that is network, Cloudflare
   // and web-server time. Headers must go out before any output.
   header(sprintf(
      'Server-Timing: db-open;dur=%.1f, pick;dur=%.1f;desc="%s", json;dur=%.1f;desc="meanings for the winners", encode;dur=%.1f, php;dur=%.1f;desc="whole request in PHP"',
      $openSeconds * 1000,
      $pickSeconds * 1000,
      $pickMethod,
      $jsonSeconds * 1000,
      $encodeSeconds * 1000,
      (microtime(true) - $requestStarted) * 1000,
   ));

   echo $json;
} catch (Throwable $error) {
   error_log('get_words.php: ' . $error->getMessage());
   http_response_code(500);
   echo json_encode(['error' => 'Could not fetch words']);
}
