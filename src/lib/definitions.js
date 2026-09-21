export function renderMeanings(list, meanings) {
   list.replaceChildren();
   for (const meaning of meanings) {
      const item = document.createElement('li');
      const definition = document.createElement('p');
      definition.textContent = `${meaning.speech_part}, ${meaning.definition}`;
      item.append(definition);
      if (meaning.example) {
         const example = document.createElement('p');
         example.textContent = `example: ${meaning.example}`;
         item.append(example);
      }
      if (Array.isArray(meaning.synonyms) && meaning.synonyms.length) {
         const synonyms = document.createElement('p');
         synonyms.textContent = `synonym(s): ${meaning.synonyms.join(', ')}`;
         item.append(synonyms);
      }
      list.append(item);
   }
}

export function scrollParent(element) {
   for (let node = element.parentElement; node; node = node.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) return node;
   }
   return null;
}
