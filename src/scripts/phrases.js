import { TIERS as tiers } from '../lib/word-options.js';
import { fetchWords } from '../lib/words-api.js';
import { createRarenessSlider, attachLengthSteppers } from '../lib/filter-controls.js';
import { copyLines } from '../lib/clipboard.js';
import { renderMeanings, scrollParent } from '../lib/definitions.js';
import { PARTS, MAX_SLOTS, DEFAULT_PHRASE_COUNT, defaultSlots, newSlot, settingsFromQuery, settingsQuery, slotQuery, lengthError, combineWords,
   phraseText, phraseKey, isPhrase } from '../lib/phrase-model.mjs';

const $ = (selector) => document.querySelector(selector);
const form = $('#phrase-options');
const editor = $('#word-editor');
const slotList = $('#phrase-slots');
const status = $('#phrase-status');
const rareness = createRarenessSlider($('#rareness'));
const thumbs = rareness.thumbs;
const tierCodes = tiers.map((tier) => tier.code);
const restoredSettings = readSettings();
let slots = restoredSettings.slots;
let selected = restoredSettings.selected;
let numberOfPhrases = restoredSettings.numberOfPhrases;
let generated = [];
let request = null;
let saved = readSaved();
let settingsTimer;

// Keep the current setup shareable before Generate is pressed. Replacing the
// current history entry avoids adding a Back-button step for every setting edit.
function readSettings() {
   return settingsFromQuery(location.search, tierCodes);
}
function persistSettings() {
   clearTimeout(settingsTimer);
   const url = new URL(location.href);
   url.search = settingsQuery({
      slots, selected, numberOfPhrases,
   }, tierCodes, url.search);
   if (url.href !== location.href) history.replaceState(history.state, '', url);
}

const updateRareness = rareness.update;

function renderSlots(focus = false) {
   const list = slotList;
   list.classList.toggle('reorderable', slots.length > 1);
   // Reuse buttons while typing, so changing a setting does not steal keyboard focus.
   while (list.children.length > slots.length) list.lastElementChild.remove();
   slots.forEach((slot, index) => {
      let item = list.children[index];
      if (!item) {
         item = document.createElement('li');
         const button = document.createElement('button');
         button.type = 'button';
         button.className = 'slot-button';
         button.setAttribute('aria-controls', 'word-editor');
         const number = document.createElement('span');
         number.className = 'slot-number';
         number.setAttribute('aria-hidden', 'true');
         button.append(number, document.createElement('span'));
         button.addEventListener('click', () => { selected = index; loadEditor(); persistSettings(); });
         item.append(button);
         list.append(item);
      }
      const button = item.firstElementChild;
      button.firstElementChild.textContent = index + 1;
      button.lastElementChild.textContent = PARTS[slot.partOfSpeech];
      button.setAttribute('aria-label', `Word ${index + 1}: ${slot.partOfSpeech}, ${tiers[slot.low].name} to ${tiers[slot.high].name}`);
      button.setAttribute('aria-pressed', String(index === selected));
   });
   $('#word-heading').textContent = `Word ${selected + 1}`;
   $('#move-left').disabled = selected === 0;
   $('#move-right').disabled = selected === slots.length - 1;
   $('#remove-word').disabled = slots.length === 1;
   $('#add-word').disabled = slots.length === MAX_SLOTS;
   $('#slot-limit').hidden = slots.length < MAX_SLOTS;
   if (focus) list.children[selected].firstElementChild.focus();
}

function loadEditor(focus = false) {
   const slot = slots[selected];
   editor.querySelectorAll('[name="parts-of-speech"]').forEach((input) => { input.checked = input.value === slot.partOfSpeech; });
   editor.querySelectorAll('[name="include"]').forEach((input) => { input.checked = slot.include.includes(input.value); });
   form.elements['min-word-length'].value = slot.minWordLength;
   form.elements['max-word-length'].value = slot.maxWordLength;
   thumbs[0].value = slot.low;
   thumbs[1].value = slot.high;
   updateRareness();
   renderSlots(focus);
}

function readEditor() {
   const values = thumbs.map((thumb) => Number(thumb.value));
   Object.assign(slots[selected], {
      partOfSpeech: form.elements['parts-of-speech'].value,
      low: Math.min(...values), high: Math.max(...values),
      minWordLength: form.elements['min-word-length'].value,
      maxWordLength: form.elements['max-word-length'].value,
      include: [...editor.querySelectorAll('[name="include"]:checked')].map((input) => input.value),
   });
}

function settingsChanged(deferUrl = false) {
   request?.abort();
   request = null;
   setLoading(false);
   status.textContent = '';
   if (deferUrl) {
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(persistSettings, 200);
   } else persistSettings();
}

form.addEventListener('input', (event) => {
   readEditor();
   updateRareness();
   renderSlots();
   // A dragged slider emits many input events. Coalesce its URL writes, then flush
   // on release so the History API is not overwhelmed by a single gesture.
   settingsChanged(event.target.type === 'range');
});
form.addEventListener('change', persistSettings);
attachLengthSteppers(form);
$('#add-word').addEventListener('click', () => {
   if (slots.length >= MAX_SLOTS) return;
   slots.push(newSlot());
   selected = slots.length - 1;
   loadEditor(true);
   settingsChanged();
});
$('#remove-word').addEventListener('click', () => {
   if (slots.length <= 1) return;
   slots.splice(selected, 1);
   selected = Math.min(selected, slots.length - 1);
   loadEditor(true);
   settingsChanged();
});
function moveWord(from, to) {
   if (to < 0 || to >= slots.length || from === to) return;
   const [slot] = slots.splice(from, 1);
   slots.splice(to, 0, slot);
   selected = to;
   loadEditor(true);
   settingsChanged();
   $('#slot-reorder-status').textContent = `Moved ${slot.partOfSpeech} from word ${from + 1} to word ${to + 1}.`;
}
$('#move-left').addEventListener('click', () => moveWord(selected, selected - 1));
$('#move-right').addEventListener('click', () => moveWord(selected, selected + 1));

// Pointer events support mouse, pen, and touch with the same drag behavior. Keep
// the real pills still until drop so wrapped rows give stable insertion targets.
let slotDrag = null;
let suppressSlotClick = false;

function slotDropPosition(x, y) {
   const bounds = slotList.getBoundingClientRect();
   if (x < bounds.left - 12 || x > bounds.right + 12 || y < bounds.top - 12 || y > bounds.bottom + 12) return null;
   let nearest = 0;
   let distance = Infinity;
   [...slotList.children].forEach((item, index) => {
      const rect = item.getBoundingClientRect();
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const nextDistance = dx * dx + dy * dy;
      if (nextDistance < distance) { nearest = index; distance = nextDistance; }
   });
   if (nearest === slotDrag.from) return nearest;
   const rect = slotList.children[nearest].getBoundingClientRect();
   const insertion = nearest + (x >= rect.left + rect.width / 2 ? 1 : 0);
   return insertion > slotDrag.from ? insertion - 1 : insertion;
}

function clearDropMarker() {
   slotList.querySelectorAll('[data-drop]').forEach((item) => { delete item.dataset.drop; });
}

function finishSlotDrag(commit = false) {
   if (!slotDrag) return;
   const drag = slotDrag;
   slotDrag = null;
   drag.preview?.remove();
   drag.button.classList.remove('slot-drag-source');
   document.body.classList.remove('reordering-slots');
   clearDropMarker();
   if (slotList.hasPointerCapture(drag.pointerId)) slotList.releasePointerCapture(drag.pointerId);
   if (commit && drag.preview && drag.to !== null) {
      if (drag.from !== drag.to) moveWord(drag.from, drag.to);
      else { selected = drag.from; loadEditor(true); persistSettings(); }
   }
}

slotList.addEventListener('pointerdown', (event) => {
   if (!event.isPrimary || event.button !== 0 || slotDrag) return;
   suppressSlotClick = false;
   const button = event.target.closest('.slot-button');
   if (!button || slots.length < 2) return;
   const rect = button.getBoundingClientRect();
   slotDrag = {
      pointerId: event.pointerId, button, from: [...slotList.children].indexOf(button.parentElement),
      startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      width: rect.width, height: rect.height, to: null, preview: null,
   };
});
document.addEventListener('pointermove', (event) => {
   if (!slotDrag || event.pointerId !== slotDrag.pointerId) return;
   if (!slotDrag.preview) {
      if (Math.hypot(event.clientX - slotDrag.startX, event.clientY - slotDrag.startY) < 6) return;
      suppressSlotClick = true;
      slotList.setPointerCapture(event.pointerId);
      const preview = slotDrag.button.cloneNode(true);
      preview.classList.add('slot-drag-preview');
      preview.removeAttribute('aria-controls');
      preview.setAttribute('aria-hidden', 'true');
      preview.tabIndex = -1;
      preview.style.width = `${slotDrag.width}px`;
      preview.style.height = `${slotDrag.height}px`;
      document.body.append(preview);
      slotDrag.preview = preview;
      slotDrag.button.classList.add('slot-drag-source');
      document.body.classList.add('reordering-slots');
   }
   slotDrag.preview.style.transform = `translate(${event.clientX - slotDrag.offsetX}px, ${event.clientY - slotDrag.offsetY}px)`;
   slotDrag.to = slotDropPosition(event.clientX, event.clientY);
   clearDropMarker();
   if (slotDrag.to !== null && slotDrag.to !== slotDrag.from) {
      slotList.children[slotDrag.to].dataset.drop = slotDrag.to < slotDrag.from ? 'before' : 'after';
   }
});
document.addEventListener('pointerup', (event) => {
   if (event.pointerId !== slotDrag?.pointerId) return;
   if (slotDrag.preview) slotDrag.to = slotDropPosition(event.clientX, event.clientY);
   finishSlotDrag(true);
});
document.addEventListener('pointercancel', (event) => {
   if (event.pointerId === slotDrag?.pointerId) finishSlotDrag();
});
slotList.addEventListener('lostpointercapture', (event) => {
   // Touch starts with implicit capture on the button; transferring it to the
   // list also emits a bubbling lost-capture event from that button.
   if (event.target === slotList && event.pointerId === slotDrag?.pointerId) finishSlotDrag();
});
slotList.addEventListener('click', (event) => {
   // A drop must not also click the pill that happens to be under the pointer.
   if (suppressSlotClick && event.detail !== 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressSlotClick = false;
   }
}, true);
document.addEventListener('keydown', (event) => {
   if (event.key === 'Escape' && slotDrag) { event.preventDefault(); finishSlotDrag(); }
});
window.addEventListener('blur', () => finishSlotDrag());
window.addEventListener('resize', () => finishSlotDrag());
document.addEventListener('scroll', () => finishSlotDrag(), { capture: true, passive: true });

form.addEventListener('reset', (event) => {
   event.preventDefault();
   finishSlotDrag();
   slots = defaultSlots();
   selected = 0;
   numberOfPhrases = DEFAULT_PHRASE_COUNT;
   $('#options').open = false;
   loadEditor();
   settingsChanged();
});
form.addEventListener('submit', (event) => {
   event.preventDefault();
   generatePhrases();
});

function setLoading(loading) {
   $('#generated-phrases-list').setAttribute('aria-busy', String(loading));
}

async function generatePhrases() {
   // Validate every position, including the ones whose controls are not on screen.
   readEditor();
   persistSettings();
   const invalid = slots.findIndex((slot) => lengthError(slot));
   if (invalid !== -1) {
      selected = invalid;
      loadEditor(true);
      $('#options').open = true;
      status.textContent = `Word ${invalid + 1}: ${lengthError(slots[invalid])}`;
      form.elements['min-word-length'].focus();
      return;
   }
   if (!form.reportValidity()) return;
   request?.abort();
   const controller = new AbortController();
   request = controller;
   const snapshot = structuredClone(slots);
   const count = numberOfPhrases;
   setLoading(true);
   status.textContent = 'Finding a little happenstance…';
   try {
      // Each position gets its own dictionary sample. Sharing a small pool between
      // identical positions would force the same words to recur across the batch.
      const pools = await Promise.all(snapshot.map(async (slot) => {
         const query = slotQuery(slot, count, tierCodes);
         const words = await fetchWords(query, controller.signal);
         return [...new Map(words.map((word) => [word.word, word])).values()];
      }));
      if (request !== controller) return;
      const empty = pools.findIndex((pool) => pool.length === 0);
      if (empty !== -1) {
         status.textContent = `No matches for word ${empty + 1} (${snapshot[empty].partOfSpeech}). Try a wider rareness range or fewer filters.`;
         return;
      }
      const parts = snapshot.map((slot) => slot.partOfSpeech);
      generated = combineWords(pools, count).map((words) => ({ words, parts }));
      renderPhrases($('#generated-phrases-list'), generated);
      $('#generated-heading').textContent = `${generated.length} Random ${generated.length === 1 ? 'Phrase' : 'Phrases'}`;
      $('#copy-phrases').disabled = false;
      status.textContent = generated.length < count
         ? `Only ${generated.length} unique ${generated.length === 1 ? 'phrase matches' : 'phrases match'} these filters. Widen a word’s settings for more.`
         : '';
   } catch (error) {
      if (request === controller && error.name !== 'AbortError') {
         status.textContent = 'Could not generate phrases. Please try again.';
      }
   } finally {
      if (request === controller) { request = null; setLoading(false); }
   }
}

// Store data, not markup. Saved phrases have their own key and never affect saved words.
function readSaved() {
   try {
      const value = JSON.parse(localStorage.getItem('savedPhrases') || '[]');
      return Array.isArray(value) ? value.filter(isPhrase) : [];
   } catch { return []; }
}
function persistSaved() {
   try { localStorage.setItem('savedPhrases', JSON.stringify(saved)); }
   catch { status.textContent = 'Saved phrases are available for this visit only; browser storage is unavailable.'; }
}
function updateSaveButtons() {
   const keys = new Set(saved.map(phraseKey));
   document.querySelectorAll('.save-phrase').forEach((button) => {
      const active = keys.has(button.dataset.key);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? 'Unsave' : 'Save'} phrase: ${button.dataset.phrase}`);
      button.title = active ? 'Remove saved phrase' : 'Save phrase';
   });
}
function renderSaved() {
   $('#saved-phrases').hidden = saved.length === 0;
   renderPhrases($('#saved-phrases-list'), saved);
   updateSaveButtons();
}
function renderPhrases(list, phrases) {
   if (list.contains(definitionPanel)) {
      closeDefinition();
      document.body.append(definitionPanel);
   }
   list.replaceChildren();
   phrases.forEach((phrase) => {
      const row = document.createElement('li');
      row.className = 'phrase-row';
      const words = document.createElement('span');
      words.className = 'phrase-words';
      phrase.words.forEach((word, index) => {
         if (index) words.append(document.createTextNode(' '));
         const button = document.createElement('button');
         button.type = 'button';
         button.className = 'phrase-word';
         button.textContent = word.word;
         button.setAttribute('aria-label', `Define ${word.word}`);
         button.setAttribute('aria-controls', 'phrase-definition');
         button.setAttribute('aria-expanded', 'false');
         button.addEventListener('click', (event) => showDefinition(word, phrase.parts[index], button, event.detail === 0));
         words.append(button);
      });
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'save-phrase';
      save.dataset.key = phraseKey(phrase);
      save.dataset.phrase = phraseText(phrase);
      save.append($('#phrase-bookmark').content.cloneNode(true));
      save.addEventListener('click', () => {
         const index = saved.findIndex((item) => phraseKey(item) === phraseKey(phrase));
         if (index === -1) saved.push(phrase);
         else saved.splice(index, 1);
         persistSaved();
         const fromSaved = list.id === 'saved-phrases-list';
         renderSaved();
         if (fromSaved) {
            const remaining = $('#saved-phrases-list').querySelectorAll('.save-phrase');
            (remaining[Math.min(index, remaining.length - 1)] || $('#copy-phrases')).focus();
         }
      });
      row.append(words, save);
      list.append(row);
   });
   updateSaveButtons();
}
$('#clear-saved-phrases').addEventListener('click', () => {
   saved = [];
   persistSaved();
   renderSaved();
   $('#copy-phrases').focus();
});
window.addEventListener('storage', (event) => {
   if (event.key === 'savedPhrases' || event.key === null) { saved = readSaved(); renderSaved(); }
});
async function copyPhrases(button, phrases) {
   if (!phrases.length) return;
   try {
      await copyLines(button, phrases.map(phraseText));
   } catch { status.textContent = 'Could not copy to the clipboard. Select the phrases and copy them manually.'; }
}
$('#copy-phrases').addEventListener('click', (event) => copyPhrases(event.currentTarget, generated));
$('#copy-saved-phrases').addEventListener('click', (event) => copyPhrases(event.currentTarget, saved));

const definitionPanel = $('#phrase-definition');
let definitionAnchor = null;

function closeDefinition(restoreFocus = false) {
   const anchor = definitionAnchor;
   anchor?.setAttribute('aria-expanded', 'false');
   definitionAnchor = null;
   definitionPanel.hidden = true;
   definitionPanel.classList.remove('active');
   if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

// Use the same above/below placement as the word generator, bounded by the visible
// part of the results column (or the viewport on mobile). The list is the containing
// block, so the card follows its word as the page scrolls without blocking other controls.
function positionDefinition() {
   if (!definitionAnchor) return;
   if (!definitionAnchor.isConnected) { closeDefinition(); return; }
   const wordRect = definitionAnchor.getBoundingClientRect();
   const listRect = definitionAnchor.closest('.phrase-list').getBoundingClientRect();
   const scroller = scrollParent(definitionAnchor);
   const bounds = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
   const visibleTop = Math.max(bounds.top, 0) + 12;
   const visibleBottom = Math.min(bounds.bottom, innerHeight) - 12;
   if (wordRect.bottom <= visibleTop || wordRect.top >= visibleBottom) { closeDefinition(); return; }

   const gap = 12;
   const aboveGap = gap + .5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
   const below = Math.max(0, visibleBottom - wordRect.bottom - gap);
   const above = Math.max(0, wordRect.top - visibleTop - aboveGap);
   // scrollHeight gives the full content height even when a previous position constrained it.
   const desiredHeight = Math.min(400, definitionPanel.scrollHeight + 2);
   const placeAbove = desiredHeight > below && (desiredHeight <= above || above > below);
   definitionPanel.style.maxHeight = `${Math.min(400, placeAbove ? above : below)}px`;
   const panelRect = definitionPanel.getBoundingClientRect();
   const leftEdge = Math.max(listRect.left, 12);
   const rightEdge = Math.min(listRect.right, innerWidth - 12) - 10; // room for the shadow
   const left = Math.max(leftEdge, Math.min(wordRect.left, rightEdge - panelRect.width));
   const top = placeAbove ? wordRect.top - aboveGap - panelRect.height : wordRect.bottom + gap;
   definitionPanel.style.left = `${left - listRect.left}px`;
   definitionPanel.style.top = `${top - listRect.top}px`;
   definitionPanel.classList.toggle('above', placeAbove);
}

function showDefinition(word, part, anchor, keyboard = false) {
   if (definitionAnchor === anchor) { closeDefinition(); return; }
   closeDefinition();
   definitionAnchor = anchor;
   anchor.setAttribute('aria-expanded', 'true');
   $('#definition-heading').textContent = word.word;
   const meanings = word.meanings.filter((meaning) => meaning.speech_part === part);
   const list = $('#phrase-meanings');
   renderMeanings(list, meanings.length ? meanings : word.meanings);
   anchor.closest('.phrase-row').append(definitionPanel);
   definitionPanel.hidden = false;
   definitionPanel.classList.add('active');
   positionDefinition();
   definitionPanel.scrollTop = 0;
   if (keyboard && !definitionPanel.hidden) definitionPanel.focus({ preventScroll: true });
}
$('#close-definition').addEventListener('click', () => closeDefinition(true));
document.addEventListener('click', (event) => {
   if (definitionAnchor && !definitionPanel.contains(event.target) && !event.target.closest('.phrase-word')) closeDefinition();
});
document.addEventListener('keydown', (event) => {
   if (event.key === 'Escape' && definitionAnchor) {
      event.preventDefault();
      closeDefinition(true);
   }
});
document.addEventListener('scroll', (event) => {
   if (!definitionPanel.contains(event.target)) positionDefinition();
}, { capture: true, passive: true });
window.addEventListener('resize', positionDefinition);
window.addEventListener('popstate', () => {
   finishSlotDrag();
   clearTimeout(settingsTimer);
   request?.abort();
   const settings = readSettings();
   slots = settings.slots;
   selected = settings.selected;
   numberOfPhrases = settings.numberOfPhrases;
   loadEditor();
   closeDefinition();
   generatePhrases();
});

loadEditor();
renderSaved();
generatePhrases();
