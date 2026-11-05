// Phone navigation drawer: the three-line button in the top-left corner opens
// the menu; links, the theme switch and the BUY button live inside it.

(() => {
  const nav = document.getElementById('siteMenu');
  if (!nav) return;

  const toggle = document.querySelector('[data-menu-toggle]');
  const scrim = document.querySelector('.menu-scrim');
  const closers = document.querySelectorAll('[data-menu-close]');

  function setOpen(open) {
    nav.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    nav.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    }
    if (scrim) scrim.classList.toggle('open', open);
    if (open) {
      const first = nav.querySelector('.mobile-nav-links a');
      if (first) {
        window.setTimeout(() => {
          try { first.focus({ preventScroll: true }); } catch { first.focus(); }
        }, 60);
      }
    }
  }

  if (toggle) {
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  }
  for (const el of closers) {
    el.addEventListener('click', () => setOpen(false));
  }
  for (const link of nav.querySelectorAll('a')) {
    link.addEventListener('click', () => setOpen(false));
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('open')) setOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 720) setOpen(false);
  });

  setOpen(false);
})();
