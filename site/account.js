// Homepage account awareness: the page is static, so we ask the server who the
// visitor is and swap the sign-in icon for an account icon (with logout) when
// they are already signed in. Keeps an archivist/participant from being
// mistaken for an anonymous visitor.
(() => {
  const icon = document.querySelector('.sign-in-icon');
  if (!icon) return;

  fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me || !me.signedIn) return;

      icon.href = me.dashboard || '/dashboard';
      icon.setAttribute('aria-label', 'My account');
      icon.classList.add('account-icon');
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';

      const logout = document.createElement('a');
      logout.className = 'sign-in-icon';
      logout.href = '#';
      logout.setAttribute('aria-label', 'Sign out');
      logout.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
      logout.addEventListener('click', (e) => {
        e.preventDefault();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = me.logoutUrl || '/logout';
        const csrf = document.createElement('input');
        csrf.type = 'hidden';
        csrf.name = 'csrf';
        csrf.value = me.logoutCsrf || '';
        form.appendChild(csrf);
        document.body.appendChild(form);
        form.submit();
      });
      icon.parentNode.insertBefore(logout, icon.nextSibling);

      const mobileLinks = document.querySelector('.mobile-nav-links');
      if (mobileLinks) {
        for (const a of [...mobileLinks.querySelectorAll('a')]) {
          if (a.getAttribute('href') === '/login' || a.getAttribute('href') === '/register') a.remove();
        }
        const dash = document.createElement('a');
        dash.href = me.isAdmin ? '/admin' : '/dashboard';
        dash.textContent = me.isAdmin ? 'CONTROL ROOM' : 'MY ARCHIVE';
        const so = document.createElement('a');
        so.href = '#';
        so.textContent = 'SIGN OUT';
        so.addEventListener('click', (e) => { e.preventDefault(); logout.click(); });
        const themeBtn = mobileLinks.querySelector('.mobile-theme');
        mobileLinks.insertBefore(dash, themeBtn);
        mobileLinks.insertBefore(so, themeBtn);
      }
    })
    .catch(() => {});
})();
