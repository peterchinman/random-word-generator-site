import test from 'node:test';
import assert from 'node:assert/strict';
import { combineWords, defaultSlots, isPhrase, lengthError, newSlot, phraseText, settingsFromQuery, settingsQuery, slotQuery } from '../src/lib/phrase-model.mjs';

const tiers = ['common', 'uncommon', 'scarce', 'rare', 'obscure', 'marginal', 'unattested'];
const word = (name, part = 'noun') => ({ word: name, meanings: [{ speech_part: part, definition: name }] });

test('the default phrase has independent adjective and noun settings, everyday through familiar', () => {
   const slots = defaultSlots();
   assert.deepEqual(slots.map((slot) => slot.partOfSpeech), ['adjective', 'noun']);
   assert.deepEqual(slots.map((slot) => [slot.low, slot.high]), [[0, 1], [0, 1]]);
   slots[0].include.push('technical');
   slots[0].high = 6;
   assert.equal(slots[1].include.includes('technical'), false);
   assert.equal(slots[1].high, 1);
   assert.deepEqual(defaultSlots()[0].include, ['hyphenated', 'apostrophe', 'archaic']);
});

test('each word sends its own rareness, length, and every visible inclusion flag', () => {
   const slots = defaultSlots();
   Object.assign(slots[0], { low: 4, high: 5, minWordLength: '4', maxWordLength: '8', include: ['technical'] });
   const query = Object.fromEntries(new URLSearchParams(slotQuery(slots[0], 15, tiers)));
   assert.deepEqual(query, {
      numberOfWords: '15', partsOfSpeech: 'adjective', minWordLength: '4', maxWordLength: '8',
      tiers: 'obscure,marginal', multiword: '0', hyphenated: '0', apostrophe: '0', capitalized: '0', archaic: '0', technical: '1',
   });
   const nounQuery = new URLSearchParams(slotQuery(slots[1], 15, tiers));
   assert.equal(nounQuery.get('tiers'), 'common,uncommon');
   assert.equal(nounQuery.get('technical'), '0');
});

test('shared URLs restore word order, every filter, batch size, and the selected position', () => {
   const settings = {
      slots: [
         { ...newSlot('noun'), low: 2, high: 4, minWordLength: '3', maxWordLength: '8', include: ['multiword', 'technical'] },
         { ...newSlot('adverb'), low: 1, high: 6, minWordLength: '', maxWordLength: '12', include: [] },
         newSlot('verb'),
      ],
      numberOfPhrases: 25, selected: 1,
   };
   const query = settingsQuery(settings, tiers);
   const restored = settingsFromQuery(query, tiers);
   assert.deepEqual(restored, settings);
   assert.equal(settingsQuery(restored, tiers), query);
   restored.slots[0].include.push('archaic');
   assert.deepEqual(settings.slots[0].include, ['multiword', 'technical']);
});

test('missing or unusable URL structures fall back safely to the default builder', () => {
   const expected = { slots: defaultSlots(), numberOfPhrases: 10, selected: 0 };
   const invalid = [
      '', '?source=bookmark', '?parts=', '?parts=unknown', '?parts=noun,,verb',
      '?parts=constructor', '?parts=__proto__', '?parts=noun%2C%3Cscript%3E',
      `?parts=${Array(9).fill('noun').join(',')}`,
   ];
   for (const query of invalid) assert.deepEqual(settingsFromQuery(query, tiers), expected);
   assert.equal(settingsQuery(expected, tiers), '');
});

test('URL-only batch sizes accept whole numbers within the limit and otherwise default to ten', () => {
   for (const count of [1, 7, 10, 15, 20, 25, 40]) {
      const settings = settingsFromQuery(`?count=${count}`, tiers);
      assert.equal(settings.numberOfPhrases, count);
      assert.equal(settingsFromQuery(settingsQuery(settings, tiers), tiers).numberOfPhrases, count);
   }
   for (const value of ['', '0', '-1', '2.5', '41', 'Infinity', 'no']) {
      assert.equal(settingsFromQuery(`?count=${value}`, tiers).numberOfPhrases, 10);
   }
});

test('malformed URL filters use defaults without losing the valid structure and filters', () => {
   const restored = settingsFromQuery('?parts=verb,adverb&count=999&edit=-1&word1.tiers=rare,common&word1.min=no&word1.max=Infinity&word1.include=unknown&word2.min=4', tiers);
   assert.deepEqual(restored, {
      slots: [newSlot('verb'), { ...newSlot('adverb'), minWordLength: '4' }], numberOfPhrases: 10, selected: 0,
   });
   for (const value of ['unknown', 'common,unknown', 'common,uncommon,rare']) {
      assert.deepEqual(settingsFromQuery(`?word1.tiers=${value}`, tiers).slots, defaultSlots());
   }
});

test('URL preferences preserve unfinished length edits for the normal validation', () => {
   const slot = { ...newSlot('adjective'), minWordLength: '12', maxWordLength: '3' };
   const restored = settingsFromQuery('?parts=adjective&word1.min=12&word1.max=3&count=999&edit=5', tiers);
   assert.deepEqual(restored.slots, [slot]);
   assert.ok(lengthError(restored.slots[0]));
   assert.equal(restored.numberOfPhrases, 10);
   assert.equal(restored.selected, 0);
   assert.deepEqual(settingsFromQuery(settingsQuery(restored, tiers), tiers), restored);
   assert.equal(settingsFromQuery('?word1.min=.5', tiers).slots[0].minWordLength, '.5');
});

test('URL filters distinguish empty inclusions from defaults and allow one rareness tier', () => {
   const restored = settingsFromQuery('?word1.include=&word2.tiers=rare&word2.include=technical,technical,archaic', tiers);
   assert.deepEqual(restored.slots[0].include, []);
   assert.deepEqual(restored.slots[1], { ...newSlot('noun'), low: 3, high: 3, include: ['archaic', 'technical'] });
   assert.deepEqual(settingsFromQuery(settingsQuery(restored, tiers), tiers), restored);
});

test('editing and Reset replace only builder parameters, including stale and duplicate fields', () => {
   const defaults = { slots: defaultSlots(), numberOfPhrases: 10, selected: 0 };
   const query = '?source=share&parts=verb&parts=noun&count=40&edit=8&word1.min=4&word1.min=5&word8.include=&word9.max=7&source=bookmark';
   assert.equal(settingsQuery(defaults, tiers, query), 'source=share&source=bookmark');
   const updated = { ...defaults, slots: [newSlot('adverb')] };
   const result = new URLSearchParams(settingsQuery(updated, tiers, query));
   assert.deepEqual(result.getAll('parts'), ['adverb']);
   assert.deepEqual(result.getAll('source'), ['share', 'bookmark']);
   assert.equal(result.has('word8.include'), false);
   assert.deepEqual(settingsFromQuery(result, tiers), updated);
});

test('URLs round-trip the maximum builder size and encoded numeric lengths', () => {
   const settings = {
      slots: Array.from({ length: 8 }, (_, index) => ({
         ...newSlot(['noun', 'verb', 'adjective', 'adverb'][index % 4]),
         low: index % 7, high: 6, minWordLength: '1e+1', maxWordLength: '40',
         include: ['multiword', 'hyphenated', 'apostrophe', 'capitalized', 'archaic', 'technical'],
      })), numberOfPhrases: 40, selected: 7,
   };
   const query = settingsQuery(settings, tiers);
   assert.deepEqual(settingsFromQuery(query, tiers), settings);
   assert.ok(query.length < 2000);
});

test('tight filters return all available combinations without repeats or missing words', () => {
   const pools = [[word('quietly')], [word('blue'), word('small')], [word('lake'), word('bird')]];
   const phrases = combineWords(pools, 10, () => 0).map((words) => phraseText({ words }));
   assert.equal(phrases.length, 4);
   assert.deepEqual(new Set(phrases), new Set(['quietly blue lake', 'quietly small lake', 'quietly blue bird', 'quietly small bird']));
});

test('a position without matches prevents partial phrases', () => {
   assert.deepEqual(combineWords([[word('quietly')], [], [word('bird')]], 10), []);
   assert.deepEqual(combineWords([], 10), []);
});

test('eight positions and forty results do not enumerate the full product', () => {
   const pools = Array.from({ length: 8 }, (_, position) => Array.from({ length: 40 }, (_, index) => word(`${position}-${index}`)));
   const phrases = combineWords(pools, 40);
   assert.equal(phrases.length, 40);
   assert.equal(new Set(phrases.map((words) => phraseText({ words }))).size, 40);
   phrases.forEach((words) => words.forEach((item, position) => assert.ok(pools[position].includes(item))));
   pools.forEach((pool, position) => assert.equal(new Set(phrases.map((words) => words[position])).size, 40));
});

test('a normal batch uses a different word in each position for every phrase', () => {
   const pools = Array.from({ length: 3 }, (_, position) => Array.from({ length: 10 }, (_, index) => word(`${position}-${index}`)));
   // Even a constant random source must not collapse a batch onto repeated words.
   const phrases = combineWords(pools, 10, () => 0);
   assert.equal(phrases.length, 10);
   pools.forEach((pool, position) => assert.deepEqual(new Set(phrases.map((words) => words[position])), new Set(pool)));
});

test('a small pool does not make the other positions repeat words', () => {
   const pools = [[word('very'), word('quite')], Array.from({ length: 10 }, (_, index) => word(`adj-${index}`)), [word('bird')]];
   const phrases = combineWords(pools, 10, () => 0);
   assert.equal(phrases.length, 10);
   assert.equal(new Set(phrases.map((words) => words[1])).size, 10);
   assert.equal(phrases.filter((words) => words[0].word === 'very').length, 5);
   assert.ok(phrases.every((words) => words[2].word === 'bird'));
});

test('when all pools are small, use every available word and fill with distinct combinations', () => {
   const pools = [Array.from({ length: 3 }, (_, index) => word(`adj-${index}`)), Array.from({ length: 4 }, (_, index) => word(`noun-${index}`))];
   const phrases = combineWords(pools, 10, () => 0);
   assert.equal(phrases.length, 10);
   assert.equal(new Set(phrases.map((words) => phraseText({ words }))).size, 10);
   pools.forEach((pool, position) => assert.deepEqual(new Set(phrases.map((words) => words[position])), new Set(pool)));
});

test('combining words leaves source pools unchanged', () => {
   const pools = [[word('quite'), word('very')], [word('blue'), word('green')]];
   const before = structuredClone(pools);
   combineWords(pools, 2, () => 0);
   assert.deepEqual(pools, before);
});

test('a single word position works and never repeats a result within a batch', () => {
   const phrases = combineWords([[word('lake'), word('bird')]], 40);
   assert.equal(phrases.length, 2);
   assert.equal(new Set(phrases.map((words) => phraseText({ words }))).size, 2);
});

test('word lengths accept open bounds and reject invalid or reversed ranges', () => {
   assert.equal(lengthError(newSlot()), '');
   assert.equal(lengthError({ ...newSlot(), minWordLength: '8' }), '');
   assert.equal(lengthError({ ...newSlot(), maxWordLength: '8' }), '');
   for (const value of ['0', '-1', '46', '3.5', 'no']) {
      assert.ok(lengthError({ ...newSlot(), minWordLength: value }));
   }
   assert.ok(lengthError({ ...newSlot(), minWordLength: '8', maxWordLength: '4' }));
});

test('saved phrases round-trip as data and malformed saved entries are rejected', () => {
   const phrase = { words: [word('quietly', 'adverb'), word('blue', 'adjective'), word('bird')], parts: ['adverb', 'adjective', 'noun'] };
   assert.equal(isPhrase(JSON.parse(JSON.stringify(phrase))), true);
   for (const invalid of [{}, { ...phrase, parts: ['noun'] }, { ...phrase, words: [{ word: 'bird' }] }, { words: [], parts: [] }]) {
      assert.equal(Boolean(isPhrase(invalid)), false);
   }
});
