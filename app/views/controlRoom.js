// Views for the Control Room screens: puzzle index, investigators, archive
// settings, full audit log, team management, first-run owner setup, and the
// draft file preview.

import { html, raw } from '../lib/html.js';
import { csrfField } from '../lib/csrf.js';
import { dateLabel, dateTimeLabel } from '../lib/format.js';
import { fileLabel, renderDocument } from '../lib/mystery.js';
import { page, notice, errorList } from './layout.js';
import { STATUS_COPY } from './archive.js';
import { adminShell, textField, textArea, selectField, stat } from './admin.js';

const ADMIN_NAV = html`<a href="/archive">VIEW ARCHIVE</a>`;
const fileNumber = (value) => `FILE ${String(value).padStart(3, '0')}`;

// ---------------------------------------------------------------------
// First-run setup (/admin/setup)
// ---------------------------------------------------------------------
export function adminSetupPage({ session, errors = {}, values = {}, message = '' }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TERMINAL / INITIAL BOOTSTRAP</p>
      <h1 class="archive-title">CREATE FIRST OWNER</h1>
      <p class="lede">
        No active archivist account exists yet. Create the first Owner account here to unlock the
        Control Room. Once created, this setup screen permanently closes itself.
      </p>

      ${notice('form', message)}
      ${errorList(errors)}

      <form method="post" action="/admin/setup" class="auth-form" autocomplete="off">
        ${csrfField(session)}
        ${textField({ name: 'name', label: 'DISPLAY NAME', value: values.name || 'The Archivist' })}
        ${textField({ name: 'email', label: 'EMAIL', type: 'email', value: values.email || '' })}
        ${textField({ name: 'password', label: 'PASSWORD (12+ CHARACTERS)', type: 'password', hint: 'Mix letters and numbers. Hashed with scrypt; never stored in plaintext.' })}
        <button class="btn primary" type="submit">INITIALIZE CONTROL ROOM</button>
      </form>
    </section>`;

  return page({ title: 'FILE106 — INITIAL SETUP', body, session, terminalLabel: 'BOOTSTRAP' });
}

// ---------------------------------------------------------------------
// Draft preview (/admin/files/:id/preview)
// ---------------------------------------------------------------------
export function adminFilePreviewPage({ session, file, puzzles = [], csrf = '', message = '' }) {
  const status = STATUS_COPY[file.status] || { label: String(file.status).toUpperCase(), note: '' };

  const body = html`
    <section class="section archive-section">
      <div class="archive-notice" data-kind="admin" role="status">
        <strong>ARCHIVIST PREVIEW MODE</strong> · Status: ${status.label} · Type: ${file.fileType || 'story'} ·
        Visitors ${['open', 'locked', 'closed', 'completed'].includes(file.status) ? 'CAN' : 'CANNOT'} see this record yet.
        <a href="/admin/files" style="margin-left:1rem;">← Back to File Manager</a>
      </div>

      <p class="eyebrow">
        ${fileNumber(file.number)} / ${status.label}
        ${file.classification ? html` / <span class="classification">${file.classification}</span>` : raw('')}
        ${file.chapterNo ? html` / CHAPTER ${String(file.chapterNo).padStart(2, '0')}` : raw('')}
      </p>
      <h1 class="archive-title">${file.title}</h1>
      ${file.subtitle ? html`<p class="eyebrow">${file.subtitle}</p>` : raw('')}
      <p class="lede">${file.teaser}</p>

      ${notice('archive', message)}

      ${file.coverId
        ? html`<div class="admin-panel"><img src="/admin/attachments/${file.coverId}" alt="${file.title}" style="max-width:100%;height:auto;display:block;"></div>`
        : raw('')}

      <div class="stats archive-stats" aria-label="File facts">
        <div class="stat">
          <span class="stat-label">REWARD</span>
          <strong>${file.rewardsEnabled === false ? 'DISABLED' : `${file.reward} F106`}</strong>
          <span class="stat-note">${file.rewardsEnabled === false ? 'No token payout on this file' : 'Paid manually after verification'}</span>
        </div>
        <div class="stat">
          <span class="stat-label">MIN HOLDING</span>
          <strong>${file.minHolding}</strong>
          <span class="stat-note">${file.requiresWallet === false ? 'Wallet optional' : 'F106 read on-chain'}</span>
        </div>
        <div class="stat">
          <span class="stat-label">DIFFICULTY</span>
          <strong>${String(file.difficulty).toUpperCase()}</strong>
          <span class="stat-note">${String(file.winnerMethod).replace(/_/g, ' ')}</span>
        </div>
        <div class="stat">
          <span class="stat-label">WINDOW</span>
          <strong>${file.closesAt ? dateLabel(file.closesAt) : 'OPEN-ENDED'}</strong>
          <span class="stat-note">${file.opensAt ? `opens ${dateLabel(file.opensAt)}` : 'no opening date'}</span>
        </div>
      </div>

      ${file.briefing
        ? html`<div class="briefing">
            <p class="eyebrow">BRIEFING</p>
            <div class="briefing-body">${file.briefing}</div>
          </div>`
        : raw('')}

      ${file.loreBody
        ? html`<div class="document">
            <div class="document-head">
              <span class="mono">RECOVERED DOCUMENT / ${fileNumber(file.number)}</span>
              <span class="stamp-inline mono">${file.classification || 'UNCLASSIFIED'}</span>
            </div>
            ${renderDocument(file.loreBody)}
          </div>`
        : raw('')}

      <div class="wallet-panel">
        <p class="eyebrow">SUBMISSION TERMINAL (PREVIEW)</p>
        ${puzzles.length === 0
          ? html`<p class="fine">No puzzles attached yet.</p>`
          : puzzles.map(
              (p) => html`<div class="puzzle-prompt" style="margin-bottom:1rem;">
                <p class="field-label">STEP ${p.position} · ${String(p.puzzle_type || 'text').toUpperCase()} · ${p.max_attempts} ATTEMPT(S)</p>
                <p class="puzzle-text">${p.prompt}</p>
                ${p.hint ? html`<p class="fine">Hint: ${p.hint}</p>` : raw('')}
                ${Array.isArray(p.choices) && p.choices.length > 0
                  ? html`<ul class="checklist">${p.choices.map((c) => html`<li><span class="mono">○ ${c}</span></li>`)}</ul>`
                  : raw('')}
              </div>`
            )}
      </div>
    </section>`;

  return page({
    title: `PREVIEW — ${file.title}`,
    body,
    session,
    scripts: ['/mystery.js'],
    nav: ADMIN_NAV,
    terminalLabel: 'PREVIEW',
  });
}

// ---------------------------------------------------------------------
// Puzzles index (/admin/puzzles)
// ---------------------------------------------------------------------
export function adminPuzzlesPage({ admin, puzzles = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">PUZZLE MANAGEMENT</h1>
    ${notice('admin', message)}
    <p class="fine">
      Every puzzle is attached to a file and evaluated server-side against scrypt hashes. Answers
      never leave the server. Click any file to edit its puzzles, choices, hints, or sealed answers.
    </p>

    ${puzzles.length === 0
      ? html`<div class="archive-pending">
          <p class="eyebrow">NO PUZZLES</p>
          <h2>NONE SEALED YET</h2>
          <p class="fine">Open a file in the <a href="/admin/files">File Manager</a> to seal a puzzle.</p>
        </div>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>File</th><th>Step</th><th>Type</th><th>Prompt</th><th>Alternates</th><th>Attempts</th><th>Subs</th><th></th></tr>
          </thead>
          <tbody>
            ${puzzles.map(
              (p) => html`<tr>
                <td class="mono"><a href="/admin/files/${p.file_id}">${fileNumber(p.file_number)} · ${p.title}</a></td>
                <td class="mono">#${p.position}</td>
                <td class="mono">${p.puzzle_type || p.answer_format}</td>
                <td>${String(p.prompt).slice(0, 80)}${String(p.prompt).length > 80 ? '…' : ''}</td>
                <td class="mono">+${p.alternates ?? 0}</td>
                <td class="mono">${p.max_attempts}</td>
                <td class="mono">${p.submissions ?? 0}</td>
                <td><a class="btn ghost" href="/admin/files/${p.file_id}#puzzles">EDIT</a></td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return page({
    title: 'FILE106 — PUZZLES',
    body: adminShell({ admin, active: 'puzzles', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

// ---------------------------------------------------------------------
// Investigators (/admin/investigators & /admin/investigators/:id)
// ---------------------------------------------------------------------
export function adminInvestigatorsPage({ admin, users = [], q = '', status = '', message = '' }) {
  const body = html`
    <h1 class="archive-title">INVESTIGATORS</h1>
    ${notice('admin', message)}

    <form method="get" action="/admin/investigators" class="admin-form compact-form">
      <div class="field-row">
        ${textField({ name: 'q', label: 'SEARCH USERNAME / EMAIL / WALLET', value: q, required: false })}
        ${selectField({ name: 'status', label: 'STATUS', options: ['', 'active', 'pending_verification', 'suspended'], value: status })}
        <button class="btn ghost" type="submit">FILTER</button>
      </div>
    </form>

    ${users.length === 0
      ? html`<p class="fine">No matching investigators.</p>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>Account</th><th>Wallet</th><th>Status</th><th>Files</th><th>Clues</th><th>Subs</th><th>Wins</th><th>F106 Paid</th><th>Registered</th><th></th></tr>
          </thead>
          <tbody>
            ${users.map(
              (u) => html`<tr>
                <td>
                  <a href="/admin/investigators/${u.id}"><strong>${u.username}</strong></a>
                  <span class="fine mono">${u.email}</span>
                </td>
                <td class="mono">${u.wallet ? `${u.wallet.slice(0, 6)}…${u.wallet.slice(-4)}` : '—'}</td>
                <td><span class="status-chip" data-state="${u.status}">${u.status}</span></td>
                <td class="mono">${u.unlocks}</td>
                <td class="mono">${u.clues}</td>
                <td class="mono">${u.submissions}</td>
                <td class="mono">${u.wins}</td>
                <td class="mono">${u.confirmed}</td>
                <td class="mono">${dateLabel(u.created_at)}</td>
                <td>
                  ${u.status === 'suspended'
                    ? html`<form method="post" action="/admin/investigators/${u.id}/activate" class="inline-form">
                        ${csrfField({ csrf: admin.csrf })}
                        <button type="submit" class="nav-button">ACTIVATE</button>
                      </form>`
                    : html`<form method="post" action="/admin/investigators/${u.id}/suspend" class="inline-form" data-confirm="Suspend this investigator?">
                        ${csrfField({ csrf: admin.csrf })}
                        <button type="submit" class="nav-button">SUSPEND</button>
                      </form>`}
                </td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return page({
    title: 'FILE106 — INVESTIGATORS',
    body: adminShell({ admin, active: 'investigators', body }),
    session: { csrf: admin.csrf },
    scripts: ['/admin.js'],
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

export function adminInvestigatorDetailPage({
  admin,
  user,
  wallets = [],
  unlocks = [],
  clues = [],
  submissions = [],
  rewards = [],
  tempPassword = '',
  message = '',
}) {
  const body = html`
    <p class="eyebrow"><a href="/admin/investigators">← INVESTIGATORS</a></p>
    <h1 class="archive-title">${user.username}</h1>
    <p class="fine mono">${user.email} · Status: ${user.status} · Registered ${dateTimeLabel(user.created_at)}</p>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('FILES UNLOCKED', unlocks.length)}
      ${stat('CLUES FOUND', clues.length)}
      ${stat('SUBMISSIONS', submissions.length)}
      ${stat('REWARDS', rewards.length)}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">ACCOUNT CONTROL</p>
      ${tempPassword
        ? html`<div class="archive-notice" data-kind="dev">
            <strong>TEMPORARY PASSWORD (shown once):</strong>
            <p><span class="mono break">${tempPassword}</span></p>
            <p class="fine">Hand it to the investigator. They should change it after signing in.</p>
          </div>`
        : raw('')}
      ${notice('admin', message)}
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        ${user.status === 'suspended'
          ? html`<form method="post" action="/admin/investigators/${user.id}/activate" class="inline-form">
              ${csrfField({ csrf: admin.csrf })}
              <button class="btn primary" type="submit">REACTIVATE</button>
            </form>`
          : html`<form method="post" action="/admin/investigators/${user.id}/suspend" class="inline-form" data-confirm="Suspend this investigator?">
              ${csrfField({ csrf: admin.csrf })}
              <button class="btn ghost" type="submit">SUSPEND</button>
            </form>`}
        ${user.status === 'banned'
          ? html`<form method="post" action="/admin/investigators/${user.id}/unban" class="inline-form">
              ${csrfField({ csrf: admin.csrf })}
              <button class="btn primary" type="submit">UNBAN</button>
            </form>`
          : html`<form method="post" action="/admin/investigators/${user.id}/ban" class="inline-form" data-confirm="Ban this investigator permanently?">
              ${csrfField({ csrf: admin.csrf })}
              <button class="btn ghost" type="submit">BAN</button>
            </form>`}
        <form method="post" action="/admin/investigators/${user.id}/delete" class="inline-form" data-confirm="Remove this account (soft delete)? History is kept.">
          ${csrfField({ csrf: admin.csrf })}
          <button class="btn ghost" type="submit">REMOVE</button>
        </form>
        <form method="post" action="/admin/investigators/${user.id}/reset-password" class="inline-form" data-confirm="Reset this investigator's password?">
          ${csrfField({ csrf: admin.csrf })}
          <button class="btn ghost" type="submit">RESET PASSWORD</button>
        </form>
        <form method="post" action="/admin/investigators/${user.id}/promote" class="inline-form" data-confirm="Promote this investigator to an archivist account?">
          ${csrfField({ csrf: admin.csrf })}
          <button class="btn ghost" type="submit">PROMOTE TO ARCHIVIST</button>
        </form>
      </div>
    </div>

    <div class="admin-panel">
      <p class="eyebrow">CONNECTED WALLETS</p>
      ${wallets.length === 0
        ? html`<p class="fine">No wallet linked.</p>`
        : html`<table class="admin-table">
            <thead><tr><th>Address</th><th>Primary</th><th>First Seen F106</th><th>Verified</th></tr></thead>
            <tbody>
              ${wallets.map(
                (w) => html`<tr>
                  <td class="mono">${w.address}</td>
                  <td>${w.is_primary ? 'YES' : 'no'}</td>
                  <td class="mono">${w.first_seen_balance_f106 ?? '—'}</td>
                  <td class="mono">${dateTimeLabel(w.verified_at)}</td>
                </tr>`
              )}
            </tbody>
          </table>`}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">PUZZLE SUBMISSIONS</p>
      ${submissions.length === 0
        ? html`<p class="fine">None.</p>`
        : html`<table class="admin-table">
            <thead><tr><th>When</th><th>File</th><th>Attempt</th><th>Status</th><th>Holding</th><th></th></tr></thead>
            <tbody>
              ${submissions.map(
                (s) => html`<tr>
                  <td class="mono">${dateTimeLabel(s.submitted_at)}</td>
                  <td>${fileNumber(s.file_number)} · ${s.title}</td>
                  <td class="mono">#${s.attempt_no}</td>
                  <td><span class="status-chip" data-state="${s.status}">${s.status}</span></td>
                  <td class="mono">${s.holding_snapshot}</td>
                  <td><a href="/admin/submissions/${s.id}">REVIEW</a></td>
                </tr>`
              )}
            </tbody>
          </table>`}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">REWARD CLAIMS & HISTORY</p>
      ${rewards.length === 0
        ? html`<p class="fine">No rewards.</p>`
        : html`<table class="admin-table">
            <thead><tr><th>#</th><th>File</th><th>Amount</th><th>Status</th><th>Tx Signature</th></tr></thead>
            <tbody>
              ${rewards.map(
                (r) => html`<tr>
                  <td class="mono"><a href="/admin/rewards/${r.id}">#${r.reward_no}</a></td>
                  <td class="mono">${fileNumber(r.file_number)}</td>
                  <td class="mono">${r.amount} F106</td>
                  <td><span class="status-chip" data-state="${r.payment_status}">${r.payment_status}</span></td>
                  <td class="mono">${r.signature ? `${r.signature.slice(0, 12)}…` : '—'}</td>
                </tr>`
              )}
            </tbody>
          </table>`}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">DISCOVERED FILES & CLUES</p>
      <p class="fine">
        Files unlocked (${unlocks.length}):
        ${unlocks.map((u) => `${fileNumber(u.file_number)} (${u.unlock_method})`).join(', ') || 'none'}
      </p>
      <p class="fine">
        Clues decoded (${clues.length}):
        ${clues.map((c) => `CLUE ${String(c.clue_no).padStart(3, '0')} (${c.title})`).join(', ') || 'none'}
      </p>
    </div>`;

  return page({
    title: `FILE106 — ${user.username}`,
    body: adminShell({ admin, active: 'investigators', body }),
    session: { csrf: admin.csrf },
    scripts: ['/admin.js'],
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

// ---------------------------------------------------------------------
// Archive settings (/admin/settings)
// ---------------------------------------------------------------------
export function adminSettingsPage({ admin, settings = {}, errors = {}, message = '' }) {
  const body = html`
    <h1 class="archive-title">ARCHIVE SETTINGS</h1>
    ${notice('admin', message)}
    ${errorList(errors)}
    <p class="fine">
      Global defaults for the Control Room and the public archive. Changes are saved in Postgres
      and audited.
    </p>

    <form method="post" action="/admin/settings" class="admin-form">
      ${csrfField({ csrf: admin.csrf })}
      <div class="field-row">
        ${textField({
          name: 'defaultReward',
          label: 'DEFAULT REWARD (F106)',
          value: settings['archive.default_reward'] ?? '1.00000000',
          step: '0.00000001',
          hint: 'Prefilled when creating a new file (max 106 F106).',
        })}
        ${textField({
          name: 'defaultMinHolding',
          label: 'DEFAULT MIN HOLDING (F106)',
          value: settings['archive.default_min_holding'] ?? '1.00000000',
          step: '0.00000001',
          hint: 'Prefilled minimum F106 balance requirement.',
        })}
      </div>

      ${textField({
        name: 'tagline',
        label: 'ARCHIVE TAGLINE',
        value: settings['archive.tagline'] ?? 'PROJECT105: TERMINATED. FILE106: STILL ACTIVE.',
        required: false,
      })}

      <label class="field field-check">
        <input type="checkbox" name="maintenanceBanner" value="1" ${settings['archive.maintenance_banner'] ? raw('checked') : raw('')}>
        <span>Show maintenance / transmission notice banner on public archive pages</span>
      </label>

      <button class="btn primary" type="submit">SAVE SETTINGS</button>
    </form>`;

  return page({
    title: 'FILE106 — ARCHIVE SETTINGS',
    body: adminShell({ admin, active: 'settings', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

// ---------------------------------------------------------------------
// Full audit log (/admin/audit)
// ---------------------------------------------------------------------
export function adminAuditPage({ admin, logs = [], actionFilter = '', actions = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">AUDIT LOG</h1>
    ${notice('admin', message)}
    <p class="fine">
      Append-only by database trigger: no row here can be edited or deleted, even by an Owner.
    </p>

    <form method="get" action="/admin/audit" class="admin-form compact-form">
      <div class="field-row">
        ${selectField({ name: 'action', label: 'ACTION FILTER', options: ['', ...actions], value: actionFilter })}
        <button class="btn ghost" type="submit">FILTER</button>
      </div>
    </form>

    ${logs.length === 0
      ? html`<p class="fine">No audit entries match.</p>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>When</th><th>Archivist</th><th>Action</th><th>Entity</th><th>Details</th></tr>
          </thead>
          <tbody>
            ${logs.map(
              (row) => html`<tr>
                <td class="mono">${dateTimeLabel(row.created_at)}</td>
                <td class="mono">${row.admin_email || 'CLI / system'}</td>
                <td class="mono"><strong>${row.action}</strong></td>
                <td class="mono">${row.entity}${row.entity_id ? ` · ${String(row.entity_id).slice(0, 12)}` : ''}</td>
                <td class="mono fine">${row.after_state ? JSON.stringify(row.after_state).slice(0, 120) : '—'}</td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return page({
    title: 'FILE106 — AUDIT LOG',
    body: adminShell({ admin, active: 'audit', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

// ---------------------------------------------------------------------
// Team management (/admin/team — owner only)
// ---------------------------------------------------------------------
export function adminTeamPage({ admin, members = [], errors = {}, message = '' }) {
  const body = html`
    <h1 class="archive-title">ARCHIVIST TEAM</h1>
    ${notice('admin', message)}
    ${errorList(errors)}
    <p class="fine">
      Owners can manage staff accounts. Admins can manage files, clues, puzzles and rewards.
      Reviewers have read-only access.
    </p>

    <table class="admin-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last Sign-In</th><th></th></tr></thead>
      <tbody>
        ${members.map(
          (m) => html`<tr>
            <td><strong>${m.display_name}</strong></td>
            <td class="mono">${m.email}</td>
            <td class="mono">${m.role.toUpperCase()}</td>
            <td>${m.is_active ? 'ACTIVE' : 'DISABLED'}</td>
            <td class="mono">${m.last_login_at ? dateTimeLabel(m.last_login_at) : 'never'}</td>
            <td>
              <form method="post" action="/admin/team/${m.id}/toggle" class="inline-form">
                ${csrfField({ csrf: admin.csrf })}
                <button type="submit" class="nav-button">${m.is_active ? 'DISABLE' : 'ENABLE'}</button>
              </form>
            </td>
          </tr>`
        )}
      </tbody>
    </table>

    <div class="admin-panel">
      <p class="eyebrow">ADD ARCHIVIST</p>
      <form method="post" action="/admin/team" class="admin-form" autocomplete="off">
        ${csrfField({ csrf: admin.csrf })}
        <div class="field-row">
          ${textField({ name: 'name', label: 'DISPLAY NAME', value: '' })}
          ${textField({ name: 'email', label: 'EMAIL', type: 'email', value: '' })}
          ${selectField({ name: 'role', label: 'ROLE', options: ['admin', 'reviewer', 'owner'], value: 'admin' })}
        </div>
        ${textField({ name: 'password', label: 'INITIAL PASSWORD (12+ CHARS)', type: 'password' })}
        <button class="btn primary" type="submit">CREATE ARCHIVIST</button>
      </form>
    </div>`;

  return page({
    title: 'FILE106 — ARCHIVIST TEAM',
    body: adminShell({ admin, active: 'team', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}
