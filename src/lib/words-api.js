import { INCLUDE_FLAGS } from './word-options.js';

export function wordQuery({
   numberOfWords, partsOfSpeech = [], minWordLength, maxWordLength, tiers = [], include = [],
} = {}) {
   const params = new URLSearchParams({
      numberOfWords: Number(numberOfWords) || 25,
      partsOfSpeech: partsOfSpeech.join(','),
      minWordLength: Number(minWordLength) || 0,
      maxWordLength: Number(maxWordLength) || 0,
      tiers: tiers.join(','),
   });
   for (const flag of INCLUDE_FLAGS) {
      params.set(flag, include.includes(flag) ? 1 : 0);
   }
   return params.toString();
}


export function isWord(word) {
   return word && typeof word.word === 'string' && word.word.length > 0 && Array.isArray(word.meanings)
      && word.meanings.every(meaning => meaning && typeof meaning.speech_part === 'string'
         && typeof meaning.definition === 'string');
}

export async function parseWords(response) {
   if (!response.ok) throw new Error(`Word request failed (${response.status})`);
   const words = await response.json();
   if (!Array.isArray(words) || !words.every(isWord)) throw new Error('Invalid word response');
   return words;
}

export function fetchWords(query, signal) {
   return fetch(`/api/get_words.php?${query}`, { signal }).then(parseWords);
}
