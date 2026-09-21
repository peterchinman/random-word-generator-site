import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WORD_OPTIONS, INCLUDE_FLAGS } from '../src/lib/word-options.js';
import { wordQuery, parseWords } from '../src/lib/words-api.js';

test('word defaults match the existing early request, with every inclusion flag explicit', () => {
   const params = new URLSearchParams(wordQuery(DEFAULT_WORD_OPTIONS));
   assert.deepEqual(Object.fromEntries(params), {
      numberOfWords: '25', partsOfSpeech: '', minWordLength: '0', maxWordLength: '0',
      tiers: 'common,uncommon,scarce,rare', multiword: '0', hyphenated: '1',
      apostrophe: '1', capitalized: '0', archaic: '1', technical: '0',
   });
   assert.deepEqual([...params.keys()].slice(-INCLUDE_FLAGS.length), INCLUDE_FLAGS);
});

test('word requests preserve multiple speech parts, open bounds, and empty filters', () => {
   const params = new URLSearchParams(wordQuery({
      numberOfWords: '15', partsOfSpeech: ['noun', 'verb'], minWordLength: '6', include: [],
   }));
   assert.equal(params.get('numberOfWords'), '15');
   assert.equal(params.get('partsOfSpeech'), 'noun,verb');
   assert.equal(params.get('minWordLength'), '6');
   assert.equal(params.get('maxWordLength'), '0');
   assert.equal(params.get('tiers'), '');
   INCLUDE_FLAGS.forEach(flag => assert.equal(params.get(flag), '0'));
});

test('both pages accept valid dictionary responses and empty matches', async () => {
   const words = [{ word: 'crane', meanings: [{ speech_part: 'noun', definition: 'A bird.' }] }];
   assert.deepEqual(await parseWords(Response.json(words)), words);
   assert.deepEqual(await parseWords(Response.json([])), []);
});

test('both pages reject HTTP failures and malformed dictionary responses', async () => {
   await assert.rejects(parseWords(new Response('', { status: 503 })), /503/);
   for (const invalid of [{ error: 'failed' }, [{ word: 'crane' }], [{ word: '', meanings: [] }]]) {
      await assert.rejects(parseWords(Response.json(invalid)), /Invalid word response/);
   }
});
