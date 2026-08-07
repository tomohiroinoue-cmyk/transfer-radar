/* 独立ページ（about.html / privacy.html）用の最小スクリプト。
   テーマ切替だけを一覧ページと共有する。 */

'use strict';

(function initTheme() {
  const saved = localStorage.getItem('tr-theme');
  if (saved) document.documentElement.dataset.theme = saved;

  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('tr-theme', next);
  });
})();
