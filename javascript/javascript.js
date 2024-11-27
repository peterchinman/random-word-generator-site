// FORM SUBMIT LOGIC

const $form = document.querySelector('form');
$form.addEventListener('click', (event) => {
   // GENERATE click
   if (event.target.matches('#generate')) {
      // don't submit the form!
      event.preventDefault();
      
      // get number of words
      let numberOfWords = 0;

      const numberCheckboxes = $form.querySelectorAll('input[name="number-words"]');
      numberCheckboxes.forEach((checkbox) => {
         if (checkbox.checked) {
            numberOfWords = checkbox.value;
         }
      })
      if (!numberOfWords) {
         // TODO error message "must select number of words"
      }

      // get parts of speech
      let partsOfSpeech = []; // e.g ["noun", "verb", "adj", "adv"]
      const partsOfSpeechCheckboxes = $form.querySelectorAll('input[name="parts-of-speech"]');
      partsOfSpeechCheckboxes.forEach((checkbox) => {
         if (checkbox.checked) {
            partsOfSpeech.push(checkbox.value);
         }
      })
      
      // get Word Length
      minWordLength = $form.querySelector('input[name="min-word-length"]').value;
      maxWordLength = $form.querySelector('input[name="max-word-length"]').value;

      getRandomWords(numberOfWords, partsOfSpeech, minWordLength, maxWordLength);
   }
})

function getRandomWords(numberOfWords, partsOfSpeech, minWordLength, maxWordLength) {
   // Construct query parameters
   const queryParams = new URLSearchParams({ 
      numberOfWords: numberOfWords,
      partsOfSpeech: partsOfSpeech.join(','),
      minWordLength: minWordLength,
      maxWordLength: maxWordLength
   });

   // Fetch data from the server
   fetch(`get_words.php?${queryParams.toString()}`)
      .then(response => {
         if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
         }
         return response.json();
      })
      .then(data => {
         console.log(data); 

         // Example: Logging each word and its meanings
         // data.forEach(item => {
         //    console.log(`Word: ${item.word}`);
         //    item.meanings.forEach((meaning, index) => {
         //       console.log(`Definition ${index}: ${meaning.definition}`);
         //       console.log(`Example ${index}: ${meaning.example}`);
         //       console.log(`Speech part ${index}: ${meaning.speech_part}`);
         //       console.log(`Synonyms ${index}: ${meaning.synonyms}`);
         //    });
         // });

         // Pass the fetched data to another function for further processing
         processRandomWordData(data);
      })
      .catch(error => console.error('Error fetching data:', error));
}




// THE FOLLOWING CHUNK sets the FILTERS to auto-open if the page is wide, otherwise, auto-closed

// if you change this breakpoint, also change it in the css media query
const wideBreakPoint = "1020px"
function openFilters() {
   const $filters = document.querySelector('#filters')
   let mediaQuery = window.matchMedia(`(min-width: ${wideBreakPoint})`);
   if(mediaQuery.matches) {
      $filters.open = true;
   }
}
openFilters();
window.addEventListener('resize', openFilters)


// THIS EVENT LISTENER CONTROLS THE .word-sections sections, #generated-words and #saved-words

document.addEventListener("DOMContentLoaded", function() {
   // for testing:
   // processRandomWordData(pretendData);
   updateSavedWords();

   document.addEventListener('click', function(event) {

      // if there is an active dictionary panel and we click outside of a dictionary panel
      if (document.querySelector('definition-panel.active') && !event.target.matches('definition-panel, definition-panel *')) {
         // deselect <word-tile>
         let $activePanel = document.querySelector('definition-panel.active')
         updateCurrentlySelectedWord($activePanel);
         // close the panel
         panelCloseOut($activePanel)
      }
      
      // click on <word-tile>
      if (event.target.tagName === "WORD-TILE") {
         // update currently selected word-tile
         updateCurrentlySelectedWord(event.target);

         // check if there is already an open definition panel
         let openPanel = document.querySelector('definition-panel.active');
         if (openPanel){
            panelCloseOut(openPanel);
         }

         // and activate the panel
         event.target.querySelector('definition-panel').classList.add('active');
         // set the offsets
         setPanelOffsets(event.target);
      }

      // click on panel X out
      if (event.target.matches('.x-out-div, .x-out-div *')) {
         updateCurrentlySelectedWord(event.target);
         panelCloseOut(event.target.closest('definition-panel'));
      }
      
      // click on definition panel bookmark
      if (event.target.matches('.bookmark, .bookmark *')) {

         let wordName = event.target.closest('definition-panel').dataset.word;
         // note: this goes wider in scope and then back down because of ambiguity of what element exactly will be clicked, the div or the svg path
         let $bookmark = event.target.closest('.tools').querySelector('.bookmark');
         // get savedWords from session
         let savedWords = JSON.parse(sessionStorage.getItem('savedWords')) || [];
         
         // REMOVE BOOKMARK
         //  remove word from saved words list and deactivate the bookmark
         // TODO we need to do error catching for trying to add the same word to the list multiple times
         if ($bookmark.classList.contains('active')) {
            savedWords = savedWords.filter(word => word.name !== wordName);
            // then deactivate bookmark
            $bookmark.classList.remove('active');
            // if we are in the saved words panel we'll also want to deactive the corresponding bookmark in the #generate-words panel
            if(event.target.closest('section').id == "saved-words") {
               document.querySelector('#generated-words').querySelectorAll('word-tile').forEach((wordTile) => {
                  if (wordTile.dataset.word == wordName) {  
                     wordTile.querySelector('.bookmark').classList.remove('active');
                  }
               })
            }
         }
         // SAVE THE WORD
         else {
            // activate bookmark
            $bookmark.classList.add('active');

            
            let $wordTile = event.target.closest('word-tile');
            // create a deactivated clone
            let $clone = $wordTile.cloneNode(true);
            $clone.classList.remove('selected');
            $clone.querySelector('definition-panel').classList.remove('active');
            // create word object to save in Session storage
            let wordObject = {'name': wordName, 'html' : $clone.outerHTML};
            // add this wordObject to our savedWords
            savedWords.push(wordObject);
            // update bookmarkClassList
         }
         // update session
         sessionStorage.setItem('savedWords', JSON.stringify(savedWords));

         // if we're in #generated-words, immediately update #saved-words
         if (event.target.closest('word-list').id === "generated-words-list") {
            updateSavedWords();
         }
         // if we're in #saved-words, we want to wait until the panel closes to update #saved-words
         else {
            console.log("You clicked on the bookmark icon from inside saved-words");

         }
      }

      // TODO this doesn't deactiavte the bookmark on words in our word-list
      if (event.target.matches('#clear-saved-words')) {
         sessionStorage.removeItem('savedWords');
         updateSavedWords();
         $bookmarks = document.querySelectorAll('.bookmark');
         $bookmarks.forEach((bookmark) => {
            bookmark.classList.remove('active');
         })

      }
   })


   let $incrementButtons = document.querySelectorAll('.increment');
   $incrementButtons.forEach(function(item) {
      item.addEventListener('click', function(event) {
         event.preventDefault();
         item.parentElement.querySelector('input').value++;
      })
   })

   let $decrementButtons = document.querySelectorAll('.decrement');
   $decrementButtons.forEach(function(item) {
      item.addEventListener('click', function(event) {
         event.preventDefault();
         item.parentElement.querySelector('input').value--;
      })
   })


})

function panelCloseOut($panel){
   // deactivate panel
   $panel.classList.remove('active');
   // if we are in the saved panel, update saved words
   if ($panel.closest('word-list').id === "saved-words-list") {
      updateSavedWords();
   }
}

function updateSavedWords() {
   console.log("updateSavedWords")
   
   const sessionSavedWordObjects = JSON.parse(sessionStorage.getItem('savedWords')) || [];
   const sessionSavedWordNames = Array.from(sessionSavedWordObjects, sessionSavedWordObjects => sessionSavedWordObjects.name);

   // update "empty" class on the Section
   const $savedWordsSection = document.querySelector('#saved-words');
   if (sessionSavedWordObjects.length == 0) {
      $savedWordsSection.classList.add('empty');
   }
   else {
      $savedWordsSection.classList.remove('empty');
   }

   // compare current wordTiles to our list of sessionSavedWordNames
   // remove any current wordTiles that don't match
   let $wordTiles = $savedWordsSection.querySelectorAll('word-tile');
   let $currentTileWordNames = [];
   $wordTiles.forEach((wordTile) => {
      // if this word-tile is not in our saved session words, we change the class to animate it and then remove it
      if (!sessionSavedWordNames.includes(wordTile.dataset.word)) {
         wordTile.classList.add('removed');
         wordTile.addEventListener('transitionend', () => {
            console.log("transition end")
            wordTile.remove();
         })
      }
      else {
         $currentTileWordNames.push(wordTile.dataset.word)
      }
   })

   // add any new elements from saveWords to our savedWordsList
   const $savedWordsList = document.querySelector('#saved-words-list');
   sessionSavedWordObjects.forEach(function(word) {
      if (!$currentTileWordNames.includes(word.name)){
         $savedWordsList.insertAdjacentHTML('beforeend', word.html);
      }
   })
}

function processRandomWordData(data) {
   // Empty currrent word-list
   document.querySelector('#generated-words-list').innerHTML="";
   // CREATE WORD TILES FOR EACH WORD IN OUR DATA
   data.forEach(function(word) {
      createWordTileAndDefinitionPanel(word);
   })

   // Get number of words for section heading
   let numberOfWords = data.length;
   document.getElementById('number-of-words').textContent = numberOfWords;

   // If it was empty it's not anymore
   document.querySelector('#generated-words').classList.remove('empty')
}

// Function to create a word tile from a word
function createWordTileAndDefinitionPanel(word){
   let $generatedWordsSection = document.querySelector('#generated-words');

   // create <word-tile>
   let wordTile = document.createElement('word-tile');
   wordTile.innerText = word.word;
   wordTile.dataset.word = word.word;

   // definition panel
   let panelHTML = createDefinitionPanel(word);
   wordTile.insertAdjacentHTML('beforeend', panelHTML);
   
   $generatedWordsSection.querySelector('word-list').appendChild(wordTile);
}


// Given a JSON of word meanings, returns formatted HTML for Defintion Panel
function createHTMLDefinitionList(meanings){
   let response = ""
   meanings.forEach(function(meaning) {
      // get synonynms, if any
      let synonyms = ""
      if (meaning.example) {
         synonyms += `<p>example: ${meaning.example} </p>`;
      }
      if (meaning.synonyms.length > 0) {
         synonyms += "<p>synonym(s): ";
         // sloppy flag non-sense to get commas right
         let first_flag = true;
         meaning.synonyms.forEach(function(synonym) {
            if (first_flag){
               synonyms += `${synonym}`;
               first_flag = false;
            }
            else {
               synonyms += `, ${synonym}`;
            }
         })
         synonyms += "</p>"
      }
      // construct response
      response += `
         <li>
            <p>${meaning.speech_part}, ${meaning.definition}</p>
            ${synonyms}
         </li>
      `
   })
   return response;
}

function createDefinitionPanel(word) {
   
   // generate the HTML for the definition List
   let definitionList = createHTMLDefinitionList(word.meanings);


   return `
   <definition-panel data-word="${word.word}">
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
      <h3 class="attention-voice">${word.word}</h3>
      <ol class="definitions">
         ${definitionList}
      </ol>
   </definition-panel>
   
   `;   
}

function setPanelOffsets(wordTileTarget) {
   let panel = wordTileTarget.querySelector('definition-panel');

   // let's get the offests to place the panel at
   let wordTileRect = wordTileTarget.getBoundingClientRect();
   let wordListRect = wordTileTarget.parentElement.getBoundingClientRect();
   // yOffset is easy, we just want to get the distance from the top of the word-list to the bottom of the word-tile PLUS any additional gap
   yGap = 12;
   let yOffset = wordTileRect.bottom - wordListRect.top + yGap;
   // set the yOffset
   panel.style.top = yOffset + "px";

   // xOffset is more complicated
   let xOffset = 0;
   // first we'll need the width at which want to draw the panel;
   let panelStyle = window.getComputedStyle(panel);
   let panelWidth = parseInt(panelStyle.getPropertyValue('width'), 10);
   // get additional padding to add from <inner-column>
   let additionalPadding = parseInt(window.getComputedStyle(document.querySelector('.word-sections inner-column')).getPropertyValue('padding-inline'))
   // we want the defintition panel to start on the left side of the word-tile, unless there isn't enough room for the panel, in which case we want to place it exactly left enough to fit.
   // if there's not enough room
   if (wordListRect.right - wordTileRect.left < panelWidth) {
      // xOffset is from left!
      xOffset = wordListRect.right - wordListRect.left - panelWidth; 
   }
   // otherwise there is enough room for it to fit 
   else {
      xOffset = wordTileRect.left - wordListRect.left; 
   }

   // now set the offset
   panel.style.left = xOffset + "px";
}

// function to removed the "selected" class from a word-tile and then add it to the newly selected word-tile
// targetElement can be any element inside of a specific word-list
function updateCurrentlySelectedWord(targetElement) {
   // any other currently .selected?
   console.log(targetElement);
   let otherCurrentlySelectedTile = targetElement.closest('word-list').querySelector('.selected');
   // if so remove it
   if (otherCurrentlySelectedTile) {
      otherCurrentlySelectedTile.classList.remove('selected');
   }
   // is event.target a word-tile? e.g. we might call this function when closing a defintion panel
   if (targetElement) {
      if (targetElement.tagName = 'word-tile')
         {
            // then we can add it to what was clicked
            targetElement.classList.add('selected')
         }
   }
}


let pretendData = [
      {
         'word': 'accumulate',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'axle',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'talking',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'nucleus',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'paper',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word' : 'mahogany',
         'meanings' : [
            {
               'definition' : 'a shade of brown with a tinge of red',
               'speech_part' : 'noun',
               'synonyms' : ['reddish brown'],
            },
            {
               'definition': 'any of various tropical timber trees of the family Meliaceae especially the genus Swietinia valued for their hard yellowish- to reddish-brown wood that is readily worked and takes a high polish',
               'speech_part' : 'noun',
               'synonyms': ['mahogany tree'],
            },
            {
               'definition' : 'wood of any of various mahogany trees',
               'speech_part' : 'noun',
            },
         ],
         'pronunciations': [],
         
      },
      {
         'word': 'turn',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'roll',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'current',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'imply',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'accumulate',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'axle',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'talking',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'nucleus',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'paper',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word' : 'mahogany',
         'meanings' : [
            {
               'definition' : 'a shade of brown with a tinge of red',
               'speech_part' : 'noun',
               'synonyms' : ['reddish brown'],
            },
            {
               'definition': 'any of various tropical timber trees of the family Meliaceae especially the genus Swietinia valued for their hard yellowish- to reddish-brown wood that is readily worked and takes a high polish',
               'speech_part' : 'noun',
               'synonyms': ['mahogany tree'],
            },
            {
               'definition' : 'wood of any of various mahogany trees',
               'speech_part' : 'noun',
            },
         ],
         'pronunciations': [],
         
      },
      {
         'word': 'turn',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'roll',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'current',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'imply',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'accumulate',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'axle',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'talking',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'nucleus',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'paper',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word' : 'mahogany',
         'meanings' : [
            {
               'definition' : 'a shade of brown with a tinge of red',
               'speech_part' : 'noun',
               'synonyms' : ['reddish brown'],
            },
            {
               'definition': 'any of various tropical timber trees of the family Meliaceae especially the genus Swietinia valued for their hard yellowish- to reddish-brown wood that is readily worked and takes a high polish',
               'speech_part' : 'noun',
               'synonyms': ['mahogany tree'],
            },
            {
               'definition' : 'wood of any of various mahogany trees',
               'speech_part' : 'noun',
            },
         ],
         'pronunciations': [],
         
      },
      {
         'word': 'turn',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'roll',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'current',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'imply',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'accumulate',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'axle',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'talking',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'nucleus',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'paper',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word' : 'mahogany',
         'meanings' : [
            {
               'definition' : 'a shade of brown with a tinge of red',
               'speech_part' : 'noun',
               'synonyms' : ['reddish brown'],
            },
            {
               'definition': 'any of various tropical timber trees of the family Meliaceae especially the genus Swietinia valued for their hard yellowish- to reddish-brown wood that is readily worked and takes a high polish',
               'speech_part' : 'noun',
               'synonyms': ['mahogany tree'],
            },
            {
               'definition' : 'wood of any of various mahogany trees',
               'speech_part' : 'noun',
            },
         ],
         'pronunciations': [],
         
      },
      {
         'word': 'turn',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'roll',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'current',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
      {
         'word': 'imply',
         'meanings' : [
            {
               'definition' : 'This is an example definition',
               'speech_part' : 'noun',
            },
         ]
      },
   
]



