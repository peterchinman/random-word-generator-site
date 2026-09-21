import { TIERS } from './word-options.js';

export function createRarenessSlider(element) {
   const slider = element.querySelector('.slider');
   const thumbs = [...slider.querySelectorAll('input')];
   slider.style.setProperty('--steps', TIERS.length - 1);
   thumbs.forEach(thumb => { thumb.max = TIERS.length - 1; });
   const ticks = document.createElement('div');
   ticks.className = 'ticks';
   TIERS.slice(1, -1).forEach((tier, index) => {
      const tick = document.createElement('span');
      tick.style.setProperty('--i', index + 1);
      ticks.append(tick);
   });
   slider.querySelector('.track').after(ticks);

   function range() {
      const values = thumbs.map(thumb => Number(thumb.value));
      return [Math.min(...values), Math.max(...values)];
   }
   function update() {
      const [low, high] = range();
      slider.style.setProperty('--low', low);
      slider.style.setProperty('--high', high);
      const from = element.querySelector('.from');
      const to = element.querySelector('.to');
      from.querySelector('.preposition').textContent = low === high ? 'only' : 'from';
      for (const [line, tier] of [[from, TIERS[low]], [to, TIERS[high]]]) {
         line.querySelector('.tier-name').textContent = tier.name;
         line.querySelector('.examples').textContent = tier.examples;
      }
      to.hidden = low === high;
      thumbs.forEach(thumb => thumb.setAttribute('aria-valuetext', TIERS[Number(thumb.value)].name));
   }
   return { thumbs, range, update, selectedTiers: () => {
      const [low, high] = range();
      return TIERS.slice(low, high + 1).map(tier => tier.code);
   } };
}

export function attachLengthSteppers(form) {
   form.addEventListener('click', event => {
      const button = event.target.closest('.crement');
      if (!button) return;
      const input = button.parentElement.querySelector('input');
      if (button.classList.contains('increment')) input.stepUp();
      else input.stepDown();
      input.dispatchEvent(new Event('input', { bubbles: true }));
   });
}
