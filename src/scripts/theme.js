// Both pages share the theme selected by the inline, pre-paint bootstrap.
(() => {
   const root = document.documentElement;
   const palette = document.querySelector('#pink-blue');
   const mode = document.querySelector('#light-dark');
   const systemDark = matchMedia('(prefers-color-scheme: dark)');
   let modePreference;
   try { modePreference = localStorage.getItem('colorMode'); } catch { /* Current visit only. */ }

   palette.checked = root.classList.contains('blue');
   mode.checked = root.classList.contains('dark');
   // The stylesheet now supplies the same canvas color and native control scheme.
   root.style.removeProperty('background-color');
   root.style.removeProperty('color-scheme');

   function applyTheme() {
      root.classList.toggle('blue', palette.checked);
      root.classList.toggle('pink', !palette.checked);
      root.classList.toggle('dark', mode.checked);
      root.classList.toggle('light', !mode.checked);
   }
   function remember(key, value) {
      try { localStorage.setItem(key, value); } catch { /* Theme switches still work without storage. */ }
   }
   palette.addEventListener('change', () => {
      remember('palette', palette.checked ? 'blue' : 'pink');
      applyTheme();
   });
   mode.addEventListener('change', () => {
      modePreference = mode.checked ? 'dark' : 'light';
      remember('colorMode', modePreference);
      applyTheme();
   });
   systemDark.addEventListener('change', () => {
      if (modePreference === 'dark' || modePreference === 'light') return;
      mode.checked = systemDark.matches;
      applyTheme();
   });

   // Paint the initialized theme once before enabling transitions for user actions.
   requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-initializing')));
})();
