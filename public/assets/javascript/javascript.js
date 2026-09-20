// TITLE ANIMATION
// Every few seconds the "Word" in the page title is deleted back to the longest
// prefix it shares with a randomly chosen W-word, and the new word is typed out.

const titleWords = [
   "Wind", "Wisp", "Wave", "Wool", "Womb", "Wine", "Word", "Wash", "Want", "Wage", "Whim", "Wand", "Wall", "Wail", "Worm", "Work", "Wing", "Warp", "Wood", "Wink", "Wart", "Wick", "Whip", "Weed", "Wasp", "Welt", "Wire", "Walk", "Wife", "Wolf", "Week", "Wish"
];

const $titleWord = document.querySelector('#title-word');
const $titleSpaces = document.querySelector('#title-spaces');
const initialDelay = 4000;

function changeWord() {
   const betweenWordDelay = 4000;
   const startNewWordDelay = 0;
   const typingDelay = 250;
   const deleteDelay = 250;
   const newWord = titleWords[Math.floor(Math.random() * titleWords.length)];

   let currentText = $titleWord.textContent;

   // Delete one letter at a time until what's left is a prefix of the new word
   let interval = setInterval(() => {
      if (newWord.startsWith(currentText)) {
         clearInterval(interval);
         // then type the rest of the new word, one letter at a time
         setTimeout(() => {
            const chars = newWord.slice(currentText.length).split("");
            interval = setInterval(() => {
               if (chars.length === 0) {
                  clearInterval(interval);
                  setTimeout(changeWord, betweenWordDelay);
                  return;
               }
               currentText += chars.shift();
               $titleWord.textContent = currentText;
               $titleSpaces.innerHTML = $titleSpaces.innerHTML.replace(/&nbsp;/, "");
            }, typingDelay);
         }, startNewWordDelay);
      } else {
         currentText = currentText.slice(0, -1);
         $titleWord.textContent = currentText;
         // pad with a space so the rest of the title doesn't shift left
         $titleSpaces.innerHTML += '&nbsp;';
      }
   }, deleteDelay);
}
setTimeout(changeWord, initialDelay);



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

// The arrow buttons beside the min/max fields step the number up or down, within the field's min and max
$form.addEventListener('click', (event) => {
   const $button = event.target.closest('.crement');
   if (!$button) return;
   const $input = $button.parentElement.querySelector('input');
   if ($button.classList.contains('increment')) {
      $input.stepUp();
   } else {
      $input.stepDown();
   }
});

// The form's current settings, in the shape getRandomWords expects
function optionsFromForm() {
   const formData = new FormData($form);
   return {
      numberOfWords: formData.get('number-words'),
      partsOfSpeech: formData.getAll('parts-of-speech'),
      minWordLength: formData.get('min-word-length'),
      maxWordLength: formData.get('max-word-length'),
   };
}

// The API query string for a set of options. Missing or empty values are normalised so that
// the same settings always give the same string (the prefetched batch is keyed on it).
function wordQuery({ numberOfWords, partsOfSpeech = [], minWordLength, maxWordLength } = {}) {
   return new URLSearchParams({
      numberOfWords: Number(numberOfWords) || 25,
      partsOfSpeech: partsOfSpeech.join(','),
      minWordLength: Number(minWordLength) || 0,
      maxWordLength: Number(maxWordLength) || 0,
   }).toString();
}

function fetchWords(query) {
   return fetch(`/api/get_words.php?${query}`)
      .then((response) => {
         if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
         }
         return response.json();
      });
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

// Open the Filters section automatically on wide screens.
// If you change this breakpoint, also change it in the CSS media query.
const wideBreakPoint = "1020px";
function openFilters() {
   if (window.matchMedia(`(min-width: ${wideBreakPoint})`).matches) {
      document.querySelector('#filters').open = true;
   }
}
openFilters();
window.addEventListener('resize', openFilters);



// COLOR THEMES
// Two switches: palette (pinkish or bluish) and mode (light or dark). Each combination
// is a pair of body classes, e.g. "pink dark", that style.css defines a theme for.

const $pinkBlue = document.querySelector('#pink-blue');
const $lightDark = document.querySelector('#light-dark');

function applyTheme() {
   document.body.classList.toggle('blue', $pinkBlue.checked);
   document.body.classList.toggle('pink', !$pinkBlue.checked);
   document.body.classList.toggle('dark', $lightDark.checked);
   document.body.classList.toggle('light', !$lightDark.checked);
}

// If the visitor's system prefers dark mode, start in dark
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
   $lightDark.checked = true;
}
applyTheme();
$pinkBlue.addEventListener('change', applyTheme);
$lightDark.addEventListener('change', applyTheme);



// WORD TILES, DEFINITION PANELS AND BOOKMARKS

document.addEventListener('click', (event) => {
   const $target = event.target;

   // Clicking anywhere outside an open definition panel closes it
   const $activePanel = document.querySelector('definition-panel.active');
   if ($activePanel && !$target.matches('definition-panel, definition-panel *')) {
      updateCurrentlySelectedWord($activePanel);
      panelCloseOut($activePanel);
   }

   // Clicking a word tile opens its definition panel
   if ($target.tagName === 'WORD-TILE') {
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
      copySavedWords($target);
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

function copySavedWords($button) {
   const names = getSavedWords().map((word) => word.name);
   if (names.length === 0 || !navigator.clipboard) return;
   navigator.clipboard.writeText(names.join('\n'))
      .then(() => {
         $button.textContent = 'Copied';
         setTimeout(() => { $button.textContent = 'Copy'; }, 1500);
      })
      .catch((error) => console.error('Could not copy saved words:', error));
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
   document.querySelector('#generated-words').classList.remove('empty');
}

function createWordTile(word) {
   const $wordTile = document.createElement('word-tile');
   $wordTile.textContent = word.word;
   $wordTile.dataset.word = word.word;
   $wordTile.setAttribute("tabindex", "0");
   $wordTile.insertAdjacentHTML('beforeend', createDefinitionPanel(word));
   return $wordTile;
}

// Escapes text for safe insertion into an HTML string
function escapeHTML(text) {
   return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
}

function createHTMLDefinitionList(meanings) {
   return meanings.map((meaning) => {
      let extras = "";
      if (meaning.example) {
         extras += `<p>example: ${escapeHTML(meaning.example)}</p>`;
      }
      if (meaning.synonyms.length > 0) {
         extras += `<p>synonym(s): ${meaning.synonyms.map(escapeHTML).join(', ')}</p>`;
      }
      return `
         <li>
            <p>${escapeHTML(meaning.speech_part)}, ${escapeHTML(meaning.definition)}</p>
            ${extras}
         </li>
      `;
   }).join("");
}

function createDefinitionPanel(word) {
   return `
   <definition-panel data-word="${escapeHTML(word.word)}">
      <div class="tools">
         <div class="x-out-div">
            <svg class="x-out-path" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" >
               <path  d="M1 1L31 31M1 31L31 1" stroke-width="2" stroke-linecap="round"/>
            </svg>
         </div>

         <div class="bookmark">
            <svg class=" bookmark-svg" width="31" height="43" viewBox="0 0 31 43" fill="none" xmlns="http://www.w3.org/2000/svg">
               <path  d="M2.5 0.5H28.5C29.3284 0.5 30 1.17157 30 2V37.6688C30 39.0521 28.2868 39.6981 27.3734 38.6591L17.3776 27.2887C16.382 26.1562 14.618 26.1562 13.6224 27.2887L3.62657 38.6591C2.71323 39.6981 1 39.0521 1 37.6688V2C1 1.17157 1.67157 0.5 2.5 0.5Z"  stroke-linecap="square" stroke-linejoin="round"/>
            </svg>
         </div>
      </div>
      <h3 class="attention-voice">${escapeHTML(word.word)}</h3>
      <ol class="definitions">
         ${createHTMLDefinitionList(word.meanings)}
      </ol>
   </definition-panel>
   `;
}

// Positions a tile's definition panel just below the tile, shifted left if it would overflow the list
function setPanelOffsets($wordTile) {
   const $panel = $wordTile.querySelector('definition-panel');
   const wordTileRect = $wordTile.getBoundingClientRect();
   const wordListRect = $wordTile.parentElement.getBoundingClientRect();

   const yGap = 12;
   $panel.style.top = (wordTileRect.bottom - wordListRect.top + yGap) + "px";

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

updateSavedWords();
getRandomWords(optionsFromForm());
