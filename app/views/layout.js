// Shared chrome for every server-rendered page, matching the File106-Rebuild
// visual identity (8_* F/106 brand mark, dark panels, red warning accents).

import { html, raw } from '../lib/html.js';
import { csrfField } from '../lib/csrf.js';

export function page({
  title,
  body,
  session,
  signedIn = false,
  signedInName = '',
  scripts = [],
  nav = null,
  terminalLabel = '',
}) {
  const csrf = session ? csrfField(session) : raw('');
  const terminal = terminalLabel || (signedIn ? 'AUTHORIZED' : 'PUBLIC TERMINAL');

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="theme-color" content="#08090b">
  <meta name="robots" content="noindex">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css?v=4">
  <script src="/theme.js?v=2"></script>
</head>
<body>
  <div class="noise" aria-hidden="true"></div>
  <a class="skip" href="#main">Skip to content</a>
  <header class="topbar">
    <a class="brand" href="/" aria-label="FILE106 home">
      <span class="brand-mark">8_*</span>
      <span>F<span class="red">/</span>106</span>
      <span class="system-state" style="margin-left:10px;font-size:10px;"><i></i> THE FILE106 ARCHIVE / ${terminal}</span>
    </a>
    <nav class="topbar-actions archive-nav" aria-label="Archive">
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch between night and normal mode"><span aria-hidden="true">◐</span><span data-theme-label>DAY</span></button>
      <a href="/">HOME</a>
      <a href="/archive">SECRET VAULT</a>
      ${nav
        ? nav
        : signedIn
          ? html`<a href="/dashboard">MY ARCHIVE</a>
              <form method="post" action="/logout" class="nav-form">
                ${csrf}
                <button type="submit" class="nav-button">SIGN OUT</button>
              </form>`
          : html`<a href="/login">SIGN IN</a><a href="/register">REGISTER</a>`}
    </nav>
  </header>

  <div class="wrap">
    <main id="main">${body}</main>
  </div>

  <footer>
    <a class="brand" href="/"><span class="brand-mark">8_*</span><span>F<span class="red">/</span>106</span></a>
    <p>PROJECT105: TERMINATED. FILE106: STILL ACTIVE.</p>
    <p class="disclaimer">
      This terminal answers ${signedInName ? 'signed-in participants' : 'public visitors'} only.
      Sessions use a single first-party cookie; there are no trackers or third-party scripts.
      Rewards are paid manually by the archive after on-chain verification — never automatically.
    </p>
    <span class="footer-code">FILE106 / F106 · THE ARCHIVE // 8_*</span>
  </footer>
  <nav class="mobile-nav" aria-label="Mobile navigation">
    <div class="mobile-nav-links">
      <a href="/">HOME</a><a href="/archive">SECRET VAULT</a><a href="/investigate">INVESTIGATE</a>${signedIn ? html`<a href="/dashboard">MY ARCHIVE</a>` : html`<a href="/login">SIGN IN</a>`}
    </div>
    <a class="buy-now" href="https://jup.ag/swap/SOL-Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE" target="_blank" rel="noopener" aria-label="Buy F106 on Jupiter">BUY F106 NOW ↗</a>
  </nav>
  ${scripts.map((src) => html`<script src="${src}" defer></script>`)}
</body>
</html>`;
}

export function notice(key, text) {
  if (!text) return raw('');
  return html`<p class="archive-notice" data-kind="${key}" role="status">${text}</p>`;
}

export function errorList(errors = {}) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return raw('');
  return html`<ul class="field-errors" role="alert">
    ${entries.map(([, message]) => html`<li>${message}</li>`)}
  </ul>`;
}
