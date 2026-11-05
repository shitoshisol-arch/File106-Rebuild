// Theme switcher: a single icon button that flips between Night Mode ('dark')
// and Normal Mode ('light'). With no saved choice it follows the device's
// prefers-color-scheme, then remembers the visitor's manual choice.
//
// This file is loaded in <head> so the correct theme is set before first paint.

(() => {
  const STORAGE_KEY = 'file106-theme';
  const root = document.documentElement;

  function storedTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch {
      return null;
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function preferredTheme() {
    return storedTheme() || systemTheme();
  }

  function syncButtons(theme) {
    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      btn.setAttribute('data-current-theme', theme);
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.setAttribute(
        'aria-label',
        theme === 'light' ? 'Switch to night mode' : 'Switch to normal (light) mode'
      );
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'light' ? 'NIGHT' : 'DAY';
    }
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f1ea' : '#08090b');
    syncButtons(theme);
  }

  function toggleTheme() {
    const current = root.getAttribute('data-theme') || preferredTheme();
    const next = current === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage restrictions
    }
    applyTheme(next);
  }

  // Set the theme immediately, before the page paints.
  applyTheme(preferredTheme());

  function bind() {
    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      if (btn.dataset.themeBound === '1') continue;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', toggleTheme);
    }
    syncButtons(root.getAttribute('data-theme') || preferredTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (!storedTheme()) applyTheme(systemTheme());
      });
    } catch {
      // older browsers: manual toggle still works
    }
  }
})();
