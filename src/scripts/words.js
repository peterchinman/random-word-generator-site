import { wordQuery, parseWords, fetchWords } from '../lib/words-api.js';
import { createRarenessSlider, attachLengthSteppers } from '../lib/filter-controls.js';
import { copyLines } from '../lib/clipboard.js';
import { renderMeanings, scrollParent } from '../lib/definitions.js';

// TOUCHSCREEN BUTTON PRESSES
// Touch devices have no hover state, so mimic one with a class while a finger is down.

document.addEventListener('touchstart', (event) => event.target.classList.add('touch-press'), { passive: true });
document.addEventListener('touchend', (event) => event.target.classList.remove('touch-press'), { passive: true });
document.addEventListener('touchcancel', (event) => event.target.classList.remove('touch-press'), { passive: true });



// WORD OPTIONS FORM

const $form = document.querySelector('form');

// Generate (or pressing Enter in a field) fetches new words instead of reloading the page
$form.addEventListener('submit', (event) => {
   event.preventDefault();
   getRandomWords(optionsFromForm());
});

attachLengthSteppers($form);

// The form's current settings, in the shape getRandomWords expects
function optionsFromForm() {
   const formData = new FormData($form);
   return {
      numberOfWords: formData.get('number-words'),
      partsOfSpeech: formData.getAll('parts-of-speech'),
      minWordLength: formData.get('min-word-length'),
      maxWordLength: formData.get('max-word-length'),
      tiers: selectedTiers(),
      include: formData.getAll('include'),
   };
}

// PREFETCHING
// Once a batch is on screen, the next batch for the same settings is requested straight away
// and held, so a repeat click on Generate renders without waiting for the network. The held
// batch is keyed by its query string: if the settings changed in the meantime it is discarded
// and the click fetches normally. A prefetch that failed is dropped the same way.
let prefetched = null; // { query, promise } or null

function prefetchWords(query) {
   const promise = fetchWords(query);
   promise.catch(() => {}); // stops a failed prefetch being reported as an unhandled rejection
   prefetched = { query, promise };
}

function getRandomWords(options) {
   const query = wordQuery(options);
   const usePrefetched = prefetched !== null && prefetched.query === query;
   const words = usePrefetched
      ? prefetched.promise.catch(() => fetchWords(query))
      : fetchWords(query);
   prefetched = null;

   words
      .then((data) => {
         processRandomWordData(data);
         prefetchWords(query);
      })
      .catch((error) => console.error('Error fetching words:', error));
}

// The same controls power both pages; this page reads their values on Generate.
const rareness = createRarenessSlider(document.querySelector('#rareness'));
const selectedTiers = rareness.selectedTiers;
document.querySelector('#rareness').addEventListener('input', rareness.update);
$form.addEventListener('reset', () => setTimeout(rareness.update));
rareness.update();

// WORD TILES, DEFINITION PANELS AND BOOKMARKS

document.addEventListener('click', (event) => {
   const $target = event.target;

   // Clicking anywhere outside an open definition panel closes it
   const $activePanel = document.querySelector('definition-panel.active');
   const $openTile = $activePanel?.closest('word-tile');
   if ($activePanel && !$target.matches('definition-panel, definition-panel *')) {
      updateCurrentlySelectedWord($activePanel);
      panelCloseOut($activePanel);
   }

   // Clicking a word tile opens its definition panel; clicking the open one again just closes it
   if ($target.tagName === 'WORD-TILE' && $target !== $openTile) {
      updateCurrentlySelectedWord($target);
      $target.querySelector('definition-panel').classList.add('active');
      setPanelOffsets($target);
   }

   // The X in a panel's corner closes it
   if ($target.matches('.x-out-div, .x-out-div *')) {
      updateCurrentlySelectedWord($target);
      panelCloseOut($target.closest('definition-panel'));
   }

   // The bookmark in a panel saves or un-saves the word
   if ($target.matches('.bookmark, .bookmark *')) {
      toggleBookmark($target.closest('word-tile'));
   }

   if ($target.matches('#clear-saved-words')) {
      localStorage.removeItem('savedWords');
      updateSavedWords();
      document.querySelectorAll('.bookmark.active').forEach(($bookmark) => $bookmark.classList.remove('active'));
   }

   if ($target.matches('#copy-saved-words')) {
      copyWords($target, getSavedWords().map((word) => word.name));
   }
   if ($target.matches('#copy-generated-words')) {
      const names = [...document.querySelectorAll('#generated-words-list word-tile')].map(($tile) => $tile.dataset.word);
      copyWords($target, names);
   }
});

// Saved words live in localStorage as { name, html } objects, so the saved list can rebuild each tile
// and they survive reloads and new visits
function getSavedWords() {
   return JSON.parse(localStorage.getItem('savedWords')) || [];
}
function setSavedWords(savedWords) {
   localStorage.setItem('savedWords', JSON.stringify(savedWords));
}

function toggleBookmark($wordTile) {
   const wordName = $wordTile.dataset.word;
   const $bookmark = $wordTile.querySelector('.bookmark');
   const inSavedList = $wordTile.closest('word-list').id === 'saved-words-list';
   let savedWords = getSavedWords();

   if ($bookmark.classList.contains('active')) {
      // UN-SAVE
      savedWords = savedWords.filter((word) => word.name !== wordName);
      $bookmark.classList.remove('active');
      // Un-saving from the saved list should also reset the bookmark on the matching generated word
      if (inSavedList) {
         document.querySelectorAll('#generated-words-list word-tile').forEach(($tile) => {
            if ($tile.dataset.word === wordName) {
               $tile.querySelector('.bookmark').classList.remove('active');
            }
         });
      }
   } else {
      // SAVE: store a copy of the tile's HTML (with its bookmark already active) for the saved list
      $bookmark.classList.add('active');
      if (!savedWords.some((word) => word.name === wordName)) {
         const $clone = $wordTile.cloneNode(true);
         $clone.classList.remove('selected');
         $clone.querySelector('definition-panel').classList.remove('active');
         savedWords.push({ name: wordName, html: $clone.outerHTML });
      }
   }
   setSavedWords(savedWords);

   // In the generated list, refresh the saved list right away.
   // In the saved list, wait until the panel closes so the tile doesn't vanish mid-read.
   if (!inSavedList) {
      updateSavedWords();
   }
}

function copyWords(button, names) {
   copyLines(button, names).catch(error => console.error('Could not copy words:', error));
}

function panelCloseOut($panel) {
   $panel.classList.remove('active');
   // Un-saved words in the saved list are only removed once their panel closes
   if ($panel.closest('word-list').id === 'saved-words-list') {
      updateSavedWords();
   }
}

// Brings the saved-words list in line with localStorage: fades out tiles that are
// no longer saved and appends tiles for newly saved words
function updateSavedWords() {
   const savedWords = getSavedWords();
   const savedWordNames = savedWords.map((word) => word.name);

   document.querySelector('#saved-words').classList.toggle('empty', savedWords.length === 0);

   const $savedWordsList = document.querySelector('#saved-words-list');
   const currentTileWordNames = [];
   $savedWordsList.querySelectorAll('word-tile:not(.removed)').forEach(($wordTile) => {
      if (savedWordNames.includes($wordTile.dataset.word)) {
         currentTileWordNames.push($wordTile.dataset.word);
      } else {
         $wordTile.classList.add('removed');
         // Remove the tile once its fade-out finishes. The timeout is a fallback for when the
         // transition never runs, e.g. a tile added and removed within the same frame.
         const removeTile = () => $wordTile.remove();
         $wordTile.addEventListener('transitionend', removeTile, { once: true });
         setTimeout(removeTile, 500);
      }
   });

   savedWords.forEach((word) => {
      if (!currentTileWordNames.includes(word.name)) {
         $savedWordsList.insertAdjacentHTML('beforeend', word.html);
      }
   });
}

function processRandomWordData(data) {
   const $generatedWordsList = document.querySelector('#generated-words-list');
   const savedWordNames = getSavedWords().map((word) => word.name);
   $generatedWordsList.innerHTML = "";
   data.forEach((word) => {
      const $wordTile = createWordTile(word);
      // a word that is already saved should show its bookmark as active
      if (savedWordNames.includes(word.word)) {
         $wordTile.querySelector('.bookmark').classList.add('active');
      }
      $generatedWordsList.appendChild($wordTile);
   });

   document.querySelector('#number-of-words').textContent = data.length;
   document.querySelector('#copy-generated-words').disabled = data.length === 0;
   document.querySelector('#generated-words').classList.remove('empty');
}

function createWordTile(word) {
   const $wordTile = document.createElement('word-tile');
   $wordTile.textContent = word.word;
   $wordTile.dataset.word = word.word;
   $wordTile.setAttribute("tabindex", "0");
   $wordTile.append(createDefinitionPanel(word));
   return $wordTile;
}

function createDefinitionPanel(word) {
   const panel = document.querySelector('#word-definition-template').content.firstElementChild.cloneNode(true);
   panel.dataset.word = word.word;
   panel.querySelector('h3').textContent = word.word;
   renderMeanings(panel.querySelector('.definitions'), word.meanings);
   return panel;
}

// Positions a tile's definition panel: below the tile by default, above it when there isn't room
// below in the visible area, and shifted left if it would overflow the list
function setPanelOffsets($wordTile) {
   const $panel = $wordTile.querySelector('definition-panel');
   const wordTileRect = $wordTile.getBoundingClientRect();
   const wordListRect = $wordTile.parentElement.getBoundingClientRect();
   const panelRect = $panel.getBoundingClientRect();
   const yGap = 12;
   // when the panel sits above the tile it gets a little extra clearance
   const aboveExtraGap = 0.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);

   // the part of the scrolling area that is currently on screen
   const $scroller = scrollParent($wordTile);
   const scrollerRect = $scroller ? $scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
   const visibleTop = Math.max(scrollerRect.top, 0);
   const visibleBottom = Math.min(scrollerRect.bottom, window.innerHeight);

   const spaceBelow = visibleBottom - wordTileRect.bottom - yGap;
   const spaceAbove = wordTileRect.top - visibleTop - yGap - aboveExtraGap;
   const fitsBelow = panelRect.height <= spaceBelow;
   const fitsAbove = panelRect.height <= spaceAbove;
   // below unless it doesn't fit and above does; if neither fits, take the roomier side
   const above = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow);

   if (above) {
      $panel.style.top = 'auto';
      $panel.style.bottom = (wordListRect.bottom - wordTileRect.top + yGap + aboveExtraGap) + "px";
   } else {
      $panel.style.bottom = 'auto';
      $panel.style.top = (wordTileRect.bottom - wordListRect.top + yGap) + "px";
   }
   $panel.classList.toggle('above', above);

   const panelWidth = parseInt(window.getComputedStyle($panel).getPropertyValue('width'), 10);
   let xOffset;
   if (wordListRect.right - wordTileRect.left < panelWidth) {
      // not enough room to the right: align the panel's right edge with the list's right edge
      xOffset = wordListRect.right - wordListRect.left - panelWidth;
   } else {
      xOffset = wordTileRect.left - wordListRect.left;
   }
   $panel.style.left = xOffset + "px";
}

// Moves the .selected highlight to the given tile. May also be passed some other element
// inside a word list (e.g. a panel being closed), in which case it only clears the highlight.
function updateCurrentlySelectedWord($targetElement) {
   $targetElement.closest('word-list').querySelector('.selected')?.classList.remove('selected');
   if ($targetElement.tagName === 'WORD-TILE') {
      $targetElement.classList.add('selected');
   }
}



// INITIAL LOAD
// FirstWords.astro starts the first request from <head>, before the stylesheets are fetched (scripts at
// the end of the page cannot run until those have loaded), and leaves it in window.firstWords as
// { query, response }. It is treated like a prefetched batch: used if the form still asks for the
// same thing, ignored otherwise (a browser may restore other settings on reload).

if (window.firstWords) {
   const promise = window.firstWords.response.then(parseWords);
   promise.catch(() => {}); // stops a failed early request being reported as an unhandled rejection
   prefetched = { query: window.firstWords.query, promise };
}
updateSavedWords();
getRandomWords(optionsFromForm());
