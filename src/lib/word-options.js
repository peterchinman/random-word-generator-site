export const PARTS = { noun: 'noun', verb: 'verb', adjective: 'adj', adverb: 'adv' };
export const TIERS = [
   {
      "code": "common",
      "name": "everyday",
      "examples": "lake, crane, peppermint"
   },
   {
      "code": "uncommon",
      "name": "familiar",
      "examples": "rancid, valise, surfeit"
   },
   {
      "code": "scarce",
      "name": "unusual",
      "examples": "aspherical, buckram, fogbound"
   },
   {
      "code": "rare",
      "name": "rare",
      "examples": "ceilingward, foxskin, stonecraft"
   },
   {
      "code": "obscure",
      "name": "obscure",
      "examples": "crooningly, heliophobe, lampadomancy"
   },
   {
      "code": "marginal",
      "name": "fringe",
      "examples": "dilemmatically, clamjamfrey, equicide"
   },
   {
      "code": "unattested",
      "name": "dubious",
      "examples": "stultiloquently, noctivagator, claymorphism"
   }
];
export const INCLUDE_OPTIONS = [
   {
      "code": "multiword",
      "label": "multi-word",
      "examples": "ice cream, black hole, red tape",
      "checked": false
   },
   {
      "code": "hyphenated",
      "label": "hyphenated",
      "examples": "made-up, two-bit, tuk-tuk",
      "checked": true
   },
   {
      "code": "apostrophe",
      "label": "apostrophe",
      "examples": "o'clock, ma'am, y'all",
      "checked": true
   },
   {
      "code": "capitalized",
      "label": "capitalized",
      "examples": "Orkney, Bugatti, Kafkaesque",
      "checked": false
   },
   {
      "code": "archaic",
      "label": "archaic",
      "examples": "puissant, glaive, avaunt",
      "checked": true
   },
   {
      "code": "technical",
      "label": "technical",
      "examples": "serotonin, feldspar, enthalpy",
      "checked": false
   }
];
export const INCLUDE_FLAGS = INCLUDE_OPTIONS.map(option => option.code);
export const DEFAULT_INCLUDE = INCLUDE_OPTIONS.filter(option => option.checked).map(option => option.code);
export const DEFAULT_WORD_OPTIONS = {
   numberOfWords: 25, partsOfSpeech: [], minWordLength: '', maxWordLength: '',
   tiers: TIERS.slice(0, 4).map(tier => tier.code), include: DEFAULT_INCLUDE,
};
