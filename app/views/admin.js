import { html, raw } from '../lib/html.js';
import { csrfField } from '../lib/csrf.js';
import { dateLabel, dateTimeLabel } from '../lib/format.js';
import { DIFFICULTIES, FILE_STATUSES, FILE_TYPES, PUZZLE_TYPES, WINNER_METHODS } from '../lib/validate.js';
import { page, notice, errorList } from './layout.js';
import { STATUS_COPY } from './archive.js';

const roleLabel = (role) => String(role || '').toUpperCase();

// The archivist terminal has its own navigation inside the page; the shared top
// bar only points back at the public archive.
const ADMIN_NAV = html`<a href="/archive">VIEW ARCHIVE</a>`;

export function adminShell({ admin, active, body }) {
  return html`<section class="section archive-section">
    <div class="admin-bar">
      <div>
        <p class="eyebrow">ARCHIVIST CONTROL ROOM</p>
        <p class="admin-id">
          <strong>${admin.display_name}</strong> · ${roleLabel(admin.role)} · ${admin.email}
        </p>
      </div>
      <nav class="admin-nav" aria-label="Archivist">
        <a href="/admin" ${active === 'overview' ? raw('aria-current="page"') : raw('')}>OVERVIEW</a>
        <a href="/admin/files" ${active === 'files' ? raw('aria-current="page"') : raw('')}>SECRET FILES</a>
        <a href="/admin/files/new">[ + CREATE NEW FILE ]</a>
        <a href="/admin/clues" ${active === 'clues' ? raw('aria-current="page"') : raw('')}>CLUES</a>
        <a href="/admin/puzzles" ${active === 'puzzles' ? raw('aria-current="page"') : raw('')}>PUZZLES</a>
        <a href="/admin/chapters" ${active === 'chapters' ? raw('aria-current="page"') : raw('')}>CHAPTERS</a>
        <a href="/admin/rewards" ${active === 'rewards' ? raw('aria-current="page"') : raw('')}>REWARDS</a>
        <a href="/admin/investigators" ${active === 'investigators' ? raw('aria-current="page"') : raw('')}>INVESTIGATORS</a>
        <a href="/admin/submissions" ${active === 'submissions' ? raw('aria-current="page"') : raw('')}>SUBMISSIONS</a>
        <a href="/admin/settings" ${active === 'settings' ? raw('aria-current="page"') : raw('')}>SETTINGS</a>
        <a href="/admin/audit" ${active === 'audit' ? raw('aria-current="page"') : raw('')}>AUDIT LOG</a>
        <a href="/admin/team" ${active === 'team' ? raw('aria-current="page"') : raw('')}>TEAM</a>
        <form method="post" action="/admin/logout" class="nav-form">
          ${csrfField({ csrf: admin.csrf })}
          <button type="submit" class="nav-button">SIGN OUT</button>
        </form>
      </nav>
    </div>
    ${body}
  </section>`;
}

const sizeLabel = (bytes) => `${(Number(bytes) / 1024).toFixed(1)} KB`;

export function textField({ name, label, value = '', type = 'text', hint = '', required = true, step = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <input
      class="field-input"
      type="${type}"
      name="${name}"
      value="${value}"
      ${step ? raw(`step="${step}"`) : raw('')}
      ${required ? raw('required') : raw('')}
    >
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function textArea({ name, label, value = '', rows = 6, hint = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <textarea class="field-input" name="${name}" rows="${rows}">${value}</textarea>
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function selectField({ name, label, options, value, hint = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <select class="field-input" name="${name}">
      ${options.map(
        (option) => html`<option value="${option}" ${option === value ? raw('selected') : raw('')}>${option}</option>`
      )}
    </select>
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function adminLoginPage({ session, errors = {}, values = {}, message = '' }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TERMINAL / ARCHIVIST ACCESS</p>
      <h1 class="archive-title">STAFF SIGN IN</h1>
      <p class="lede">
        This terminal edits what the public sees. Participant accounts cannot reach it, and an
        archivist session expires far sooner than a participant session.
      </p>

      ${notice('form', message)}
      ${errorList(errors)}

      <form method="post" action="/admin/login" class="auth-form" autocomplete="on">
        ${csrfField(session)}
        ${textField({ name: 'email', label: 'EMAIL', type: 'email', value: values.email || '' })}
        ${textField({ name: 'password', label: 'PASSWORD', type: 'password' })}
        <button class="btn primary" type="submit">UNLOCK ARCHIVE</button>
      </form>
      <p class="fine">
        First time setting up the archive? Visit <a href="/admin/setup">/admin/setup</a> (only active before the first owner is created).
      </p>
    </section>`;

  return page({ title: 'FILE106 — ARCHIVIST', body, session, terminalLabel: 'ARCHIVIST' });
}

export function stat(label, value, note) {
  return html`<div class="stat">
    <span class="stat-label">${label}</span>
    <strong>${value}</strong>
    ${note ? html`<span class="stat-note">${note}</span>` : raw('')}
  </div>`;
}

export function adminOverviewPage({
  admin,
  stats,
  recent = [],
  chainFiles = [],
  chainReady = false,
  file13 = null,
  message = '',
}) {
  const body = html`
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
      <h1 class="archive-title" style="margin:0;">CONTROL ROOM OVERVIEW</h1>
      <a class="btn primary" href="/admin/files/new">[ + CREATE NEW FILE ]</a>
    </div>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('TOTAL SECRET FILES', stats.files ?? 0, `${stats.draft ?? 0} draft · ${stats.scheduled ?? 0} scheduled`)}
      ${stat('PUBLISHED FILES', stats.open ?? 0, 'Open in the public archive')}
      ${stat('LOCKED FILES', stats.locked ?? 0, `${stats.mystery_files ?? 0} mystery records`)}
      ${stat('INVESTIGATORS', stats.investigators ?? 0, 'Active registered accounts')}
      ${stat('DISCOVERIES', stats.discoveries ?? 0, `${stats.clues ?? 0} enabled clues`)}
      ${stat('PUZZLE SUBMISSIONS', stats.submissions ?? 0, `${stats.pending ?? 0} awaiting review`)}
      ${stat('PENDING REWARD CLAIMS', stats.awaiting_payment ?? 0, 'Awaiting manual payment')}
      ${stat('CONFIRMED REWARDS', stats.confirmed_rewards ?? 0, `${stats.confirmed_total ?? '0'} F106 verified on-chain`)}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">NETWORK INVESTIGATIONS // FILE 010 · 011 · 012 → 013</p>
      <p class="fine">
        Fictional mystery investigations inspired by BTC, ETH, and BNB. Created as drafts and never
        published without your approval. Once 010, 011, and 012 exist, configure FILE 013 — THE CONNECTION.
      </p>
      ${chainFiles.length < 3
        ? html`<form method="post" action="/admin/files/init-network-pack" class="inline-form">
            ${csrfField({ csrf: admin.csrf })}
            <button class="btn primary" type="submit">PREPARE FILE 010 / 011 / 012 DRAFTS</button>
          </form>`
        : html`<p class="fine mono">
            ${chainFiles.map((f) => `FILE ${String(f.file_number).padStart(3, '0')} (${f.status.toUpperCase()})`).join(' · ')}
            ${chainReady ? ' — ALL THREE SOLVED' : ''}
          </p>`}
      <div style="margin-top:0.75rem;">
        ${file13
          ? html`<a class="btn ghost" href="/admin/files/${file13.id}">EDIT FILE 013 — THE CONNECTION</a>`
          : html`<form method="post" action="/admin/files/init-013" class="inline-form">
              ${csrfField({ csrf: admin.csrf })}
              <button class="btn ghost" type="submit">CONFIGURE FILE 013 — THE CONNECTION</button>
            </form>`}
      </div>
    </div>

    <div class="admin-panel">
      <p class="eyebrow">RECENT ACTIONS (<a href="/admin/audit">VIEW FULL AUDIT LOG</a>)</p>
      ${recent.length === 0
        ? html`<p class="fine">Nothing recorded yet.</p>`
        : html`<table class="admin-table">
            <thead><tr><th>When</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>
              ${recent.map(
                (row) => html`<tr>
                  <td class="mono">${dateTimeLabel(row.created_at)}</td>
                  <td>${row.action}</td>
                  <td class="mono">${row.entity}${row.entity_id ? ` · ${String(row.entity_id).slice(0, 8)}` : ''}</td>
                </tr>`
              )}
            </tbody>
          </table>`}
    </div>`;

  return page({
    title: 'FILE106 — ARCHIVIST OVERVIEW',
    body: adminShell({ admin, active: 'overview', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

export function adminFilesPage({
  admin,
  files = [],
  filter = '',
  q = '',
  message = '',
}) {
  const csrf = admin.csrf;
  const body = html`
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
      <h1 class="archive-title" style="margin:0;">SECRET FILE MANAGER</h1>
      <a class="btn primary" href="/admin/files/new">[ + CREATE NEW FILE ]</a>
    </div>
    ${notice('admin', message)}
    <p class="fine">
      Drafts and scheduled files are invisible to the public. Publishing is a status change on the
      record itself.
    </p>

    <form method="get" action="/admin/files" class="admin-form compact-form">
      <div class="field-row">
        ${textField({ name: 'q', label: 'SEARCH TITLE / SLUG', value: q, required: false })}
        ${selectField({ name: 'status', label: 'STATUS FILTER', options: ['', ...FILE_STATUSES], value: filter })}
        <button class="btn ghost" type="submit">FILTER</button>
      </div>
    </form>

    ${files.length === 0
      ? html`<div class="archive-pending">
          <p class="eyebrow">NOTHING HERE YET</p>
          <h2>NO FILES</h2>
          <p class="fine"><a href="/admin/files/new">Create the first file</a>.</p>
        </div>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>Order</th><th>№</th><th>File</th><th>Type</th><th>Status</th><th>Reward</th><th>Subs</th><th>Updated</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${files.map(
              (file) => html`<tr>
                <td class="mono">
                  <form method="post" action="/admin/files/${file.id}/move" class="inline-form">
                    ${csrfField({ csrf })}
                    <input type="hidden" name="direction" value="up">
                    <button type="submit" class="nav-button" title="Move up">▲</button>
                  </form>
                  <form method="post" action="/admin/files/${file.id}/move" class="inline-form">
                    ${csrfField({ csrf })}
                    <input type="hidden" name="direction" value="down">
                    <button type="submit" class="nav-button" title="Move down">▼</button>
                  </form>
                </td>
                <td class="mono">${String(file.file_number).padStart(3, '0')}</td>
                <td>
                  <a href="/admin/files/${file.id}"><strong>${file.title}</strong></a>
                  <span class="fine mono">/archive/${file.slug}</span>
                </td>
                <td class="mono">${file.file_type || 'story'}</td>
                <td><span class="status-chip" data-state="${file.status}">${STATUS_COPY[file.status]?.label || file.status}</span></td>
                <td class="mono">${file.rewards_enabled === false ? 'OFF' : `${file.reward} F106`}</td>
                <td class="mono">${file.submissions_total ?? 0}</td>
                <td class="mono">${dateLabel(file.updated_at)}</td>
                <td>
                  <a class="nav-button" href="/admin/files/${file.id}/preview">PREVIEW</a>
                  <form method="post" action="/admin/files/${file.id}/duplicate" class="inline-form">
                    ${csrfField({ csrf })}
                    <button type="submit" class="nav-button">DUPLICATE</button>
                  </form>
                  <form method="post" action="/admin/files/${file.id}/delete" class="inline-form" data-confirm="Delete FILE ${String(file.file_number).padStart(3, '0')}? Files with submissions cannot be deleted.">
                    ${csrfField({ csrf })}
                    <button type="submit" class="nav-button">DELETE</button>
                  </form>
                </td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return page({
    title: 'FILE106 — FILE MANAGER',
    body: adminShell({ admin, active: 'files', body }),
    session: { csrf: admin.csrf },
    scripts: ['/admin.js'],
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

function attachmentPanel({ attachments, csrf, fileId }) {
  return html`<div class="admin-panel" id="attachment-panel" data-csrf="${csrf}" data-file-id="${fileId}">
    <p class="eyebrow">ATTACHMENTS & COVER IMAGE</p>
    <p class="fine">
      Stored outside the public site and served only through this terminal unless marked as the
      file's cover image.
    </p>

    ${attachments.length === 0
      ? html`<p class="fine">No attachments.</p>`
      : html`<table class="admin-table">
          <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Checksum</th><th>Cover</th><th></th></tr></thead>
          <tbody>
            ${attachments.map(
              (item) => html`<tr>
                <td><a href="/admin/attachments/${item.id}">${item.filename}</a></td>
                <td class="mono">${item.mime_type}</td>
                <td class="mono">${sizeLabel(item.byte_size)}</td>
                <td class="mono">${String(item.checksum_sha256 || '').slice(0, 12)}</td>
                <td>
                  ${item.is_cover
                    ? html`<span class="status-chip" data-state="open">COVER</span>`
                    : String(item.mime_type).startsWith('image/')
                      ? html`<form method="post" action="/admin/files/${fileId}/attachments/${item.id}/cover" class="inline-form">
                          ${csrfField({ csrf })}
                          <button type="submit" class="nav-button">SET COVER</button>
                        </form>`
                      : raw('—')}
                </td>
                <td>
                  <form method="post" action="/admin/files/${fileId}/attachments/${item.id}/delete" class="inline-form">
                    ${csrfField({ csrf })}
                    <button type="submit" class="nav-button">REMOVE</button>
                  </form>
                </td>
              </tr>`
            )}
          </tbody>
        </table>`}

    <div class="upload-row">
      <label class="field">
        <span class="field-label">ADD FILE / IMAGE EVIDENCE</span>
        <input class="field-input" type="file" data-upload-input
               accept="image/png,image/jpeg,image/webp,application/pdf,text/plain">
      </label>
      <button class="btn ghost" type="button" data-upload-action="attach">UPLOAD</button>
    </div>
    <p class="wallet-status" data-upload-status role="status"></p>
  </div>`;
}

export function adminFileEditorPage({
  admin,
  file = null,
  challenge = null,
  puzzles = [],
  attachments = [],
  errors = {},
  values = {},
  message = '',
}) {
  const isNew = !file;
  const action = isNew ? '/admin/files' : `/admin/files/${file.id}`;
  const csrf = admin.csrf;
  const puzzleList = puzzles.length > 0 ? puzzles : challenge ? [challenge] : [];
  const primaryChallenge = puzzleList[0] || null;

  const body = html`
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
      <h1 class="archive-title" style="margin:0;">${isNew ? 'CREATE NEW SECRET FILE' : `EDIT FILE ${String(file.file_number).padStart(3, '0')}`}</h1>
      ${isNew
        ? raw('')
        : html`<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a class="btn ghost" href="/admin/files/${file.id}/preview">PREVIEW</a>
            <a class="btn ghost" href="/archive/${file.slug}">VIEW PUBLIC URL</a>
            <form method="post" action="/admin/files/${file.id}/duplicate" class="inline-form">
              ${csrfField({ csrf })}
              <button class="btn ghost" type="submit">DUPLICATE</button>
            </form>
            <form method="post" action="/admin/files/${file.id}/delete" class="inline-form" data-confirm="Delete this file? Files with submissions cannot be deleted.">
              ${csrfField({ csrf })}
              <button class="btn ghost" type="submit">DELETE</button>
            </form>
          </div>`}
    </div>
    ${notice('admin', message)}
    ${errorList(errors)}

    <form method="post" action="${action}" class="admin-form">
      ${csrfField({ csrf })}
      <input type="hidden" name="formControlsPresent" value="1">
      <div class="field-row">
        ${textField({ name: 'fileNumber', label: 'FILE NUMBER / ID', type: 'number', value: values.fileNumber ?? '', hint: 'Unique. Drives the default slug.' })}
        ${textField({ name: 'slug', label: 'SLUG', value: values.slug ?? '', required: false, hint: 'Blank means file-<number>.' })}
        ${textField({ name: 'sortOrder', label: 'DISPLAY ORDER', type: 'number', value: values.sortOrder ?? '', required: false, hint: 'Lower numbers appear first.' })}
      </div>

      <div class="field-row">
        ${textField({ name: 'title', label: 'FILE TITLE', value: values.title ?? '' })}
        ${textField({ name: 'subtitle', label: 'FILE SUBTITLE', value: values.subtitle ?? '', required: false })}
      </div>

      <div class="field-row">
        ${selectField({ name: 'fileType', label: 'FILE TYPE', options: FILE_TYPES, value: values.fileType ?? 'story' })}
        ${textField({ name: 'classification', label: 'CLASSIFICATION LEVEL', value: values.classification ?? 'UNCLASSIFIED', required: false })}
      </div>

      ${textArea({ name: 'teaser', label: 'SHORT DESCRIPTION / PUBLIC TEASER', value: values.teaser ?? '', rows: 2, hint: 'Shown in the archive list. Never put the answer here.' })}
      ${textArea({ name: 'briefing', label: 'STORY CONTENT / BRIEFING', value: values.briefing ?? '', rows: 10, hint: 'Shown on the file page, escaped as text. Line breaks are preserved.' })}

      <div class="field-row">
        ${selectField({ name: 'difficulty', label: 'DIFFICULTY', options: DIFFICULTIES, value: values.difficulty ?? 'medium' })}
        ${selectField({ name: 'winnerMethod', label: 'WINNER METHOD', options: WINNER_METHODS, value: values.winnerMethod ?? 'first_correct' })}
      </div>

      <div class="field-row">
        ${textField({ name: 'reward', label: 'REWARD (F106)', value: values.reward ?? '', step: '0.00000001', hint: 'Paid manually after on-chain verification.' })}
        ${textField({ name: 'minHolding', label: 'MIN HOLDING (F106)', value: values.minHolding ?? '', step: '0.00000001', hint: 'Checked against the chain at submission time.' })}
        ${textField({ name: 'maxWinners', label: 'MAX WINNERS', type: 'number', value: values.maxWinners ?? '', required: false, hint: 'Blank for no cap.' })}
      </div>

      <div class="field-row">
        <label class="field field-check">
          <input type="checkbox" name="rewardsEnabled" value="1" ${values.rewardsEnabled !== false ? raw('checked') : raw('')}>
          <span>Enable F106 rewards on this file</span>
        </label>
        <label class="field field-check">
          <input type="checkbox" name="requiresWallet" value="1" ${values.requiresWallet !== false ? raw('checked') : raw('')}>
          <span>Require connected Solana wallet</span>
        </label>
        <label class="field field-check">
          <input type="checkbox" name="requiresRegistration" value="1" ${values.requiresRegistration !== false ? raw('checked') : raw('')}>
          <span>Require investigator registration</span>
        </label>
      </div>

      <div class="field-row">
        ${textField({ name: 'opensAt', label: 'RELEASE / OPENS DATE (UTC)', type: 'datetime-local', value: values.opensAt ?? '', required: false })}
        ${textField({ name: 'closesAt', label: 'CLOSES DATE (UTC)', type: 'datetime-local', value: values.closesAt ?? '', required: false })}
      </div>

      <div class="admin-panel">
        <p class="eyebrow">MYSTERY LAYER & UNLOCK CONDITIONS</p>
        <p class="fine">Configure unlock status (public, password/access code, clue required, previous file dependency) and interactive document markers.</p>
        <label class="field field-check">
          <input type="checkbox" name="isMystery" value="1" ${values.isMystery ? raw('checked') : raw('')}>
          <span>Enable mystery lock rules and interactive document rendering</span>
        </label>
        <div class="field-row">
          ${textField({ name: 'chapterNo', label: 'CHAPTER', type: 'number', value: values.chapterNo ?? '', required: false })}
          ${textField({ name: 'mysteryOrder', label: 'MYSTERY ORDER', type: 'number', value: values.mysteryOrder ?? '', required: false })}
        </div>
        ${textArea({ name: 'loreBody', label: 'RECOVERED DOCUMENT', value: values.loreBody ?? '', rows: 10, hint: 'Use [[SYMBOL:1]] and [[REDACT:2]] to attach clues. Clue text is only revealed server-side.' })}
        ${textArea({ name: 'unlockHint', label: 'UNLOCK HINT', value: values.unlockHint ?? '', rows: 2, hint: 'Shown to the visitor on a code-locked file. Never include the code.' })}
        <div class="field-row">
          ${textField({ name: 'requiredFileNumber', label: 'PREVIOUS FILE DEPENDENCY (FILE №)', type: 'number', value: values.requiredFileNumber ?? '', required: false, hint: 'On FILE 013, setting 10, 11, or 12 requires all three (010, 011, 012).' })}
          ${textField({ name: 'unlockRequiresClue', label: 'REQUIRES CLUE NUMBER', type: 'number', value: values.unlockRequiresClue ?? '', required: false })}
        </div>
        <div class="field-row">
          ${textField({ name: 'unlockCode', label: values.hasUnlockCode ? 'NEW ACCESS PASSWORD (leave blank to keep)' : 'ACCESS PASSWORD / CODE', type: 'password', value: '', required: false, hint: 'Stored as a scrypt hash, never shown again.' })}
        </div>
        ${values.hasUnlockCode
          ? html`<label class="field field-check">
              <input type="checkbox" name="removeUnlockCode" value="1">
              <span>Remove the existing access code (make public)</span>
            </label>`
          : raw('')}
      </div>

      <button class="btn primary" type="submit">${isNew ? 'SAVE DRAFT' : 'SAVE CHANGES'}</button>
    </form>

    ${isNew
      ? raw('')
      : html`<div class="admin-panel">
          <p class="eyebrow">PUBLICATION & LOCK CONTROLS</p>
          <form method="post" action="/admin/files/${file.id}/status" class="admin-form compact-form">
            ${csrfField({ csrf })}
            <div class="field-row">
              ${selectField({ name: 'status', label: 'PUBLIC STATUS', options: FILE_STATUSES, value: file.status, hint: STATUS_COPY[file.status]?.note || '' })}
              <button class="btn primary" type="submit">APPLY STATUS</button>
            </div>
          </form>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem;">
            <form method="post" action="/admin/files/${file.id}/status" class="inline-form">
              ${csrfField({ csrf })}<input type="hidden" name="status" value="draft">
              <button class="btn ghost" type="submit">SAVE AS DRAFT</button>
            </form>
            <form method="post" action="/admin/files/${file.id}/status" class="inline-form">
              ${csrfField({ csrf })}<input type="hidden" name="status" value="open">
              <button class="btn ghost" type="submit">PUBLISH (OPEN)</button>
            </form>
            <form method="post" action="/admin/files/${file.id}/status" class="inline-form">
              ${csrfField({ csrf })}<input type="hidden" name="status" value="scheduled">
              <button class="btn ghost" type="submit">SCHEDULE</button>
            </form>
            <form method="post" action="/admin/files/${file.id}/status" class="inline-form">
              ${csrfField({ csrf })}<input type="hidden" name="status" value="locked">
              <button class="btn ghost" type="submit">LOCK</button>
            </form>
            <form method="post" action="/admin/files/${file.id}/status" class="inline-form">
              ${csrfField({ csrf })}<input type="hidden" name="status" value="archived">
              <button class="btn ghost" type="submit">ARCHIVE</button>
            </form>
          </div>
        </div>`}

    ${isNew
      ? html`<p class="fine">Create the draft first; puzzles, sealed answers, and attachments appear on the next screen.</p>`
      : html`<div class="admin-panel" id="puzzles">
          <p class="eyebrow">CHALLENGE / PUZZLE EDITOR</p>
          <p class="fine">
            Every answer is hashed with scrypt and compared server-side only. It cannot be read back,
            and it is frozen once an investigator submits against it.
          </p>

          ${primaryChallenge
            ? html`<p class="fine">
                Sealed Step 1: ${primaryChallenge.puzzle_type || primaryChallenge.answer_format} ·
                ${primaryChallenge.case_sensitive ? 'case sensitive' : 'case insensitive'} ·
                ${primaryChallenge.max_attempts} attempt(s)
              </p>`
            : html`<p class="fine">No answer set yet. The file cannot award anything until one is.</p>`}

          <form method="post" action="/admin/files/${file.id}/challenge" class="admin-form">
            ${csrfField({ csrf })}
            ${textArea({ name: 'prompt', label: 'PROMPT (PRIMARY PUZZLE)', value: values.prompt ?? '', rows: 4, hint: 'What the participant is asked. Public.' })}
            ${textField({ name: 'answer', label: 'ANSWER', type: 'password', value: '', hint: 'Never stored in plaintext, never echoed back, never logged.' })}
            <div class="field-row">
              ${selectField({ name: 'answerFormat', label: 'ANSWER FORMAT', options: ['text', 'numeric'], value: values.answerFormat ?? 'text' })}
              ${textField({ name: 'maxAttempts', label: 'MAX ATTEMPTS', type: 'number', value: values.maxAttempts ?? '1' })}
            </div>
            <label class="field field-check">
              <input type="checkbox" name="caseSensitive" value="1">
              <span>Case sensitive (leave off unless the casing is part of the puzzle)</span>
            </label>
            <button class="btn primary" type="submit">${primaryChallenge ? 'REPLACE ANSWER' : 'SEAL ANSWER'}</button>
          </form>

          <hr style="border:0;border-top:1px solid #222;margin:1.5rem 0;">
          <p class="eyebrow">MULTI-STEP / ADVANCED PUZZLE BUILDER</p>
          <p class="fine">
            Add or update puzzle steps (1–6) with puzzle types (text, numeric, password, choice,
            code, riddle, multi_step), hints, multiple-choice options, and up to 3 accepted answers.
          </p>

          ${puzzleList.length > 0
            ? html`<table class="admin-table" style="margin-bottom:1rem;">
                <thead><tr><th>Step</th><th>Type</th><th>Prompt</th><th>Alternates</th><th>Attempts</th><th>Subs</th><th></th></tr></thead>
                <tbody>
                  ${puzzleList.map(
                    (p) => html`<tr>
                      <td class="mono">#${p.position}</td>
                      <td class="mono">${p.puzzle_type || p.answer_format}</td>
                      <td>${p.prompt}</td>
                      <td class="mono">+${p.alternates ?? 0}</td>
                      <td class="mono">${p.max_attempts}</td>
                      <td class="mono">${p.submissions ?? 0}</td>
                      <td>
                        <form method="post" action="/admin/files/${file.id}/puzzles/${p.id}/delete" class="inline-form" data-confirm="Remove step #${p.position}?">
                          ${csrfField({ csrf })}
                          <button type="submit" class="nav-button">DELETE</button>
                        </form>
                      </td>
                    </tr>`
                  )}
                </tbody>
              </table>`
            : raw('')}

          <form method="post" action="/admin/files/${file.id}/puzzles" class="admin-form">
            ${csrfField({ csrf })}
            <div class="field-row">
              ${textField({ name: 'position', label: 'STEP POSITION (1-6)', type: 'number', value: String(puzzleList.length + 1 <= 6 ? puzzleList.length + 1 : 1) })}
              ${selectField({ name: 'puzzleType', label: 'PUZZLE TYPE', options: PUZZLE_TYPES, value: 'text' })}
              ${selectField({ name: 'answerFormat', label: 'FORMAT', options: ['text', 'numeric'], value: 'text' })}
              ${textField({ name: 'maxAttempts', label: 'MAX ATTEMPTS (1-10)', type: 'number', value: '3' })}
            </div>
            ${textArea({ name: 'prompt', label: 'PUZZLE QUESTION / PROMPT', value: '', rows: 3 })}
            ${textArea({ name: 'choices', label: 'MULTIPLE CHOICE OPTIONS (ONE PER LINE, FOR CHOICE TYPE ONLY)', value: '', rows: 3, hint: 'Correct option is never marked in HTML; enter the winning option text in Accepted Answer 1.' })}
            ${textField({ name: 'hint', label: 'OPTIONAL HINT', value: '', required: false })}
            <div class="field-row">
              ${textField({ name: 'answer', label: 'ACCEPTED ANSWER 1 (REQUIRED)', type: 'password', value: '' })}
              ${textField({ name: 'answer2', label: 'ACCEPTED ANSWER 2 (OPTIONAL)', type: 'password', value: '', required: false })}
              ${textField({ name: 'answer3', label: 'ACCEPTED ANSWER 3 (OPTIONAL)', type: 'password', value: '', required: false })}
            </div>
            <label class="field field-check">
              <input type="checkbox" name="caseSensitive" value="1">
              <span>Case sensitive</span>
            </label>
            <button class="btn ghost" type="submit">ADD / UPDATE PUZZLE STEP</button>
          </form>
        </div>

        ${attachmentPanel({ file, attachments, csrf, fileId: file.id })}`}
  `;

  return page({
    title: isNew ? 'FILE106 — NEW FILE' : `FILE106 — ${file.title}`,
    body: adminShell({ admin, active: 'files', body }),
    session: { csrf },
    scripts: ['/admin.js'],
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}
