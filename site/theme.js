// Theme switcher: toggles between Night Mode ('dark') and Normal Mode ('light'),
// respecting the device preference when no manual choice is stored yet.

(() => {
  const STORAGE_KEY = 'file106-theme';

  function preferredTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore storage restrictions
    }
    return 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f1ea' : '#08090b');

    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      btn.setAttribute('data-current-theme', theme);
      btn.setAttribute(
        'aria-label',
        theme === 'light' ? 'Switch to night mode' : 'Switch to normal (light) mode'
      );
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'light' ? 'NIGHT' : 'DAY';
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || preferredTheme();
    const next = current === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage restrictions
    }
    applyTheme(next);
  }

  applyTheme(preferredTheme());

  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.addEventListener('click', toggleTheme);
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(event.matches ? 'light' : 'dark');
        }
      } catch {
        applyTheme(event.matches ? 'light' : 'dark');
      }
    });
  }
})();
