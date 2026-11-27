'use strict';
(() => {
  let saved;
  try { saved = localStorage.getItem('soyuz-theme'); } catch (_) {}
  const theme = saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
})();
