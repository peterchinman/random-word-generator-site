// Pure phrase-building logic, shared by the page and its Node tests.
import { PARTS, INCLUDE_FLAGS, DEFAULT_INCLUDE } from './word-options.js';
import { wordQuery, isWord } from './words-api.js';
export { PARTS, INCLUDE_FLAGS, isWord };
export const MAX_SLOTS = 8;
export const DEFAULT_PHRASE_COUNT = 10;
export const MAX_PHRASE_COUNT = 40;

export function newSlot(partOfSpeech = 'noun') {
   return { partOfSpeech, low: 0, high: 1, minWordLength: '', maxWordLength: '',
      include: [...DEFAULT_INCLUDE] };
}

export function defaultSlots() {
   return ['adjective', 'noun'].map(newSlot);
}

// The URL describes the builder, not its randomly generated results. Missing fields
// use defaults; malformed fields cannot introduce unsupported options into the editor.
export function settingsFromQuery(search, tiers) {
   const defaults = { slots: defaultSlots(), numberOfPhrases: DEFAULT_PHRASE_COUNT, selected: 0 };
   const params = new URLSearchParams(search);
   const parts = params.has('parts') ? params.get('parts').split(',') : defaults.slots.map((slot) => slot.partOfSpeech);
   if (parts.length > MAX_SLOTS || !parts.every((part) => Object.hasOwn(PARTS, part))) return defaults;
   const slots = parts.map((part, index) => {
      const slot = newSlot(part);
      const prefix = `word${index + 1}.`;
      if (params.has(`${prefix}tiers`)) {
         const range = params.get(`${prefix}tiers`).split(',');
         const low = tiers.indexOf(range[0]);
         const high = tiers.indexOf(range[1] ?? range[0]);
         if (range.length <= 2 && low >= 0 && high >= low) Object.assign(slot, { low, high });
      }
      for (const [param, field] of [['min', 'minWordLength'], ['max', 'maxWordLength']]) {
         const value = params.get(`${prefix}${param}`);
         // Preserve unfinished numeric edits so Generate can explain invalid lengths.
         if (value && /^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value))) slot[field] = value;
      }
      if (params.has(`${prefix}include`)) {
         const value = params.get(`${prefix}include`);
         const flags = value === '' ? [] : value.split(',');
         if (flags.every((flag) => INCLUDE_FLAGS.includes(flag))) slot.include = INCLUDE_FLAGS.filter((flag) => flags.includes(flag));
      }
      return slot;
   });
   const count = Number(params.get('count'));
   const selected = Number(params.get('edit')) - 1;
   return {
      slots, numberOfPhrases: Number.isInteger(count) && count >= 1 && count <= MAX_PHRASE_COUNT ? count : DEFAULT_PHRASE_COUNT,
      selected: Number.isInteger(selected) && selected >= 0 && selected < slots.length ? selected : 0,
   };
}

// Omit defaults to keep links short. Only replace builder-owned parameters so
// unrelated query parameters (and the URL's hash, handled by the caller) survive edits.
export function settingsQuery({ slots, numberOfPhrases, selected }, tiers, search = '') {
   const params = new URLSearchParams(search);
   for (const key of [...params.keys()]) {
      if (['parts', 'count', 'edit'].includes(key) || /^word\d+\.(tiers|min|max|include)$/.test(key)) params.delete(key);
   }
   const parts = slots.map((slot) => slot.partOfSpeech).join(',');
   if (parts !== 'adjective,noun') params.set('parts', parts);
   if (numberOfPhrases !== DEFAULT_PHRASE_COUNT) params.set('count', numberOfPhrases);
   if (selected !== 0) params.set('edit', selected + 1);
   const defaults = newSlot();
   slots.forEach((slot, index) => {
      const prefix = `word${index + 1}.`;
      if (slot.low !== defaults.low || slot.high !== defaults.high) {
         params.set(`${prefix}tiers`, slot.low === slot.high ? tiers[slot.low] : `${tiers[slot.low]},${tiers[slot.high]}`);
      }
      if (slot.minWordLength !== '') params.set(`${prefix}min`, slot.minWordLength);
      if (slot.maxWordLength !== '') params.set(`${prefix}max`, slot.maxWordLength);
      const include = INCLUDE_FLAGS.filter((flag) => slot.include.includes(flag)).join(',');
      if (include !== defaults.include.join(',')) params.set(`${prefix}include`, include);
   });
   return params.toString();
}

export function slotQuery(slot, count, tiers) {
   return wordQuery({
      numberOfWords: count, partsOfSpeech: [slot.partOfSpeech],
      minWordLength: slot.minWordLength, maxWordLength: slot.maxWordLength,
      tiers: tiers.slice(slot.low, slot.high + 1), include: slot.include,
   });
}

export function lengthError(slot) {
   for (const value of [slot.minWordLength, slot.maxWordLength]) {
      if (value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 45)) {
         return 'Use a whole word length from 1 to 45, or leave it blank.';
      }
   }
   if (slot.minWordLength !== '' && slot.maxWordLength !== '' && Number(slot.minWordLength) > Number(slot.maxWordLength)) {
      return 'The minimum word length must be no greater than the maximum.';
   }
   return '';
}

export const phraseText = (phrase) => phrase.words.map((word) => word.word).join(' ');
export const phraseKey = (phrase) => JSON.stringify(phrase.words.map((word) => word.word));

export function isPhrase(phrase) {
   return phrase && Array.isArray(phrase.words) && phrase.words.length > 0 && phrase.words.length <= MAX_SLOTS
      && phrase.words.every(isWord) && Array.isArray(phrase.parts) && phrase.parts.length === phrase.words.length
      && phrase.parts.every((part) => Object.hasOwn(PARTS, part));
}

function shuffled(values, random) {
   const result = [...values];
   for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
   }
   return result;
}

// The API already picks distinct random words. Shuffle each position's pool and pair
// them off, instead of drawing repeatedly from that small sample. A position only
// repeats words when its filters returned fewer matches than the requested batch.
export function combineWords(pools, count, random = Math.random) {
   if (!pools.length || pools.length > MAX_SLOTS || pools.some((pool) => !pool.length)) return [];
   const total = pools.reduce((product, pool) => product * pool.length, 1);
   if (!Number.isSafeInteger(total)) throw new RangeError('Too many word combinations');
   count = Math.min(count, total);
   pools = pools.map((pool) => shuffled(pool, random));

   // Encode combinations as mixed-radix integers so even tiny pools can produce
   // unique phrases without materializing the full Cartesian product.
   const chosen = new Set();
   const firstPass = Math.min(count, Math.max(...pools.map((pool) => pool.length)));
   for (let row = 0; row < firstPass; row++) {
      let index = 0;
      let stride = 1;
      for (const pool of pools) {
         index += (row % pool.length) * stride;
         stride *= pool.length;
      }
      chosen.add(index);
   }

   // If every pool is smaller than the batch, the first pass exhausts all words.
   // Fill with unused combinations. A sample of count distinct indices always has
   // enough unused ones, so this stays bounded even with a constant random source.
   if (chosen.size < count) {
      const sampled = new Set();
      for (let index = total - count; index < total; index++) {
         const candidate = Math.floor(random() * (index + 1));
         sampled.add(sampled.has(candidate) ? index : candidate);
      }
      for (const index of shuffled([...sampled], random)) {
         chosen.add(index);
         if (chosen.size === count) break;
      }
   }
   return shuffled([...chosen], random).map((index) => pools.map((pool) => {
      const word = pool[index % pool.length];
      index = Math.floor(index / pool.length);
      return word;
   }));
}
