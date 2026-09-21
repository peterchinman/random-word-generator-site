// Both generators erase back to a shared prefix, then type the next title word.
// Each page supplies its own word list; keep the full title's accessible name fixed.
(() => {
   const word = document.querySelector('#title-word');
   const spaces = document.querySelector('#title-spaces');
   if (!word || !spaces) return;

   const initialWord = word.textContent;
   const words = [...new Set([initialWord, ...word.dataset.titleWords.split(',')])];
   const width = Math.max(...words.map((value) => value.length));
   const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
   let timer;

   function display(value) {
      word.textContent = value;
      // Pad every frame while deleting and typing so neither "Generator" nor the
      // adjacent navigation shifts.
      spaces.textContent = '\u00a0'.repeat(width - value.length);
   }

   function changeWord() {
      const choices = words.filter((value) => value !== word.textContent);
      if (!choices.length) return;
      const next = choices[Math.floor(Math.random() * choices.length)];

      function type() {
         const current = word.textContent;
         if (!next.startsWith(current)) {
            display(current.slice(0, -1));
         } else if (current.length < next.length) {
            display(next.slice(0, current.length + 1));
         } else {
            timer = setTimeout(changeWord, 4000);
            return;
         }
         timer = setTimeout(type, 250);
      }
      type();
   }

   function start() {
      clearTimeout(timer);
      display(initialWord);
      if (!reducedMotion.matches) timer = setTimeout(changeWord, 4000);
   }
   reducedMotion.addEventListener('change', start);
   start();
})();
