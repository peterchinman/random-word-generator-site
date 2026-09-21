const feedbackTimers = new WeakMap();

export async function copyLines(button, lines) {
   if (!lines.length) return;
   await navigator.clipboard.writeText(lines.join('\n'));
   clearTimeout(feedbackTimers.get(button));
   button.textContent = 'Copied';
   feedbackTimers.set(button, setTimeout(() => { button.textContent = 'Copy'; }, 1500));
}
