import { html, raw } from '../lib/html.js';
import { dateLabel, dateTimeLabel, relativeLabel } from '../lib/format.js';
import { fileLabel, renderDocument } from '../lib/mystery.js';
import { page, notice } from './layout.js';

export const STATUS_COPY = {
  draft: { label: 'DRAFT', note: 'Not published. Visible to archivists only.' },
  scheduled: { label: 'SCHEDULED', note: 'Scheduled for automatic release at its opening time.' },
  open: { label: 'OPEN', note: 'Briefing available; submissions are accepted.' },
  locked: { label: 'LOCKED', note: 'A correct answer is in review. No further submissions.' },
  closed: { label: 'CLOSED', note: 'The window has ended. No further submissions.' },
  completed: { label: 'COMPLETED', note: 'Solved, rewarded and archived on-chain.' },
  archived: { label: 'ARCHIVED', note: 'Withdrawn from the public archive.' },
};

const fileNumber = (value) => `FILE ${String(value).padStart(3, '0')}`;

const LOCK_COPY = {
  code: {
    title: 'SEALED SECTION',
    note: 'This record has a recovered document behind an access code. Enter the code from the investigation log.',
  },
  prerequisite: {
    title: 'CHAIN INCOMPLETE',
    note: 'This record cannot be read until the record it follows has been recovered.',
  },
  clue: {
    title: 'CLUE REQUIRED',
    note: 'A recovered fragment is required before this record decrypts.',
  },
  missing: { title: 'SEALED', note: 'This record is not available.' },
};

function fileCard(file) {
  return html`<article class="file-card ${file.locked ? 'is-locked' : ''}">
    <p class="file-index mono">
      ${fileNumber(file.number)}
      ${file.classification ? html`<span class="classification">${file.classification}</span>` : raw('')}
    </p>
    <h3><a href="/archive/${file.slug}">${file.title}</a></h3>
    ${file.subtitle ? html`<p class="fine mono">${file.subtitle}</p>` : raw('')}
    <p class="file-teaser">${file.teaser}</p>
    <p class="file-meta">
      ${file.locked
        ? html`<span class="status-chip" data-state="locked">SEALED</span>`
        : html`<span class="status-chip" data-state="${file.status}">${STATUS_COPY[file.status]?.label || file.status}</span>`}
      <span class="mono">${file.difficulty}</span>
      ${file.rewardsEnabled === false ? raw('') : html`<span class="mono">${file.reward} F106</span>`}
    </p>
  </article>`;
}

export function archiveListPage({
  session,
  groups = [],
  total = 0,
  signedIn = false,
  maintenanceBanner = false,
  tagline = '',
  message = '',
}) {
  const published = groups.filter((group) => group.files.length > 0);

  const body = html`
    <section class="section archive-section">
      ${maintenanceBanner
        ? html`<p class="archive-notice" data-kind="archive" role="status">
            ARCHIVE TRANSMISSION NOTICE // ${tagline || 'MAINTENANCE WINDOW ACTIVE'}
          </p>`
        : raw('')}
      <p class="eyebrow">TERMINAL / THE ARCHIVE</p>
      <h1 class="archive-title">FILES IN CUSTODY</h1>
      <p class="lede">
        Each file is a sealed briefing. Some are ordinary challenges; others are fragments of the
        Project105 incident and open only when their requirement is met. The answer exists only as
        a hash on the server — never in this page, the page source, or any API response.
      </p>

      ${notice('archive', message)}

      <p class="archive-cta">
        <a class="btn ghost" href="/investigate">OPEN THE INVESTIGATION</a>
        ${signedIn ? html`<a class="btn ghost" href="/dashboard">MY ARCHIVE</a>` : raw('')}
      </p>

      ${published.length === 0
        ? html`<div class="archive-pending">
            <p class="eyebrow">NO FILES PUBLISHED YET</p>
            <h2>THE VAULT IS SEALED</h2>
            <p class="fine">
              ${total === 0
                ? 'No file has been published. When an archivist opens one it appears here first.'
                : 'Every file is still in draft. Nothing is shown until an archivist publishes it.'}
            </p>
          </div>`
        : published.map(
            (group) => html`<div class="archive-group">
              <div class="archive-group-head">
                <h2 class="archive-group-title">${group.label}</h2>
                <span class="fine">${group.note}</span>
              </div>
              <div class="file-grid">${group.files.map(fileCard)}</div>
            </div>`
          )}

      <p class="fine">
        One wallet per account. Holding the minimum F106 is checked on-chain by the server at
        submission time and again before a reward is approved, never by the browser.
      </p>
    </section>`;

  return page({ title: 'FILE106 — THE ARCHIVE', body, session });
}

function checkRow(ok, label, detail) {
  return html`<li class="check-item" data-ok="${ok ? 'yes' : 'no'}">
    <span class="check-mark" aria-hidden="true">${ok ? '✓' : '×'}</span>
    <span><strong>${label}</strong> <span class="fine">${detail}</span></span>
  </li>`;
}

// The four states a reward condition can be in for the viewer. A green check
// exists only for status 'verified', which the database refuses to store
// without an archivist and a check time. 'missing' and 'rejected' both render
// red: the task is not done as far as the archive is concerned.
const REQUIREMENT_STATE = {
  verified: { mark: '✓', label: 'VERIFIED' },
  pending: { mark: '…', label: 'UNDER REVIEW' },
  rejected: { mark: '×', label: 'NOT ACCEPTED' },
  missing: { mark: '×', label: 'NOT DONE' },
};

function requirementRow({ file, item, csrf, signedIn }) {
  const state = REQUIREMENT_STATE[item.status] ?? REQUIREMENT_STATE.missing;
  const platform = String(item.platform).toUpperCase();

  let status;
  if (item.status === 'verified') {
    status = html`<p class="requirement-note ok">
      ✓ Verified by the archive${item.checkedAt ? ` on ${dateLabel(item.checkedAt)}` : ''}.
      This task is complete.
    </p>`;
  } else if (item.status === 'pending') {
    status = html`<p class="requirement-note wait">
      Proof on file: <span class="mono">${item.proof}</span> — an archivist is reviewing it.
    </p>`;
  } else if (!signedIn) {
    status = html`<p class="fine">
      <a href="/login">Sign in</a> to complete this condition and submit proof.
    </p>`;
  } else {
    status = html`
      ${item.status === 'rejected' && item.reviewerNote
        ? html`<p class="requirement-note bad">Reviewer note: ${item.reviewerNote}</p>`
        : raw('')}
      <form method="post" action="/archive/${file.slug}/requirements/${item.id}/proof" class="requirement-proof">
        <input type="hidden" name="csrf" value="${csrf}">
        <label class="field">
          <span class="field-label">${platform} HANDLE OR PROOF LINK</span>
          <input class="field-input" type="text" name="proof" maxlength="300" autocomplete="off" spellcheck="false" required>
          <span class="field-hint">The account that completed the task, or a link showing it.</span>
        </label>
        <button class="btn primary" type="submit">SUBMIT PROOF</button>
      </form>`;
  }

  return html`<li class="requirement-item" data-state="${item.status}">
    <span class="requirement-mark" aria-hidden="true">${state.mark}</span>
    <div class="requirement-body">
      <p class="requirement-title">
        <strong>${item.title}</strong>
        <span class="requirement-state">${state.label}</span>
        ${item.required ? raw('') : html`<span class="fine">OPTIONAL</span>`}
      </p>
      ${item.description ? html`<p class="fine">${item.description}</p>` : raw('')}
      <p class="requirement-target">
        <a class="btn ghost" href="${item.targetUrl}" target="_blank" rel="noopener noreferrer">OPEN ${platform} LINK ↗</a>
        ${item.targetHandle ? html`<span class="mono fine">${item.targetHandle}</span>` : raw('')}
      </p>
      ${status}
    </div>
  </li>`;
}

function requirementsPanel({ file, eligibility, requirements, csrf }) {
  if (!requirements || requirements.length === 0) return raw('');

  const verified = requirements.filter((item) => item.status === 'verified').length;
  const allDone = requirements.every((item) => item.status === 'verified');

  return html`<div class="requirements-panel">
    <p class="eyebrow">REWARD CONDITIONS</p>
    <h2>${allDone ? 'ALL CONDITIONS MET' : `${verified} OF ${requirements.length} VERIFIED`}</h2>
    <p class="fine">
      ${file.rewardsEnabled === false
        ? 'This file carries partner conditions even though its F106 reward is off.'
        : `The ${file.reward} F106 reward for this file is released only after every required
           condition below carries a green check and the archivist approves the answer.`}
      A green check is set by the archive after your proof is reviewed — never by clicking.
    </p>
    <ul class="requirements">
      ${requirements.map((item) => requirementRow({ file, item, csrf, signedIn: eligibility.signedIn }))}
    </ul>
  </div>`;
}

function sealedPanel({ file, csrf }) {
  const copy = LOCK_COPY[file.lockReason] || LOCK_COPY.missing;

  let requirement = '';
  if (file.lockReason === 'prerequisite' && file.requiredFile) {
    requirement = `Recover ${fileLabel(file.requiredFile)} first, then return here.`;
  } else if (file.lockReason === 'clue' && file.requiredClue) {
    requirement = `Recover clue ${String(file.requiredClue).padStart(3, '0')} first, then return here.`;
  } else if (file.lockReason === 'code') {
    requirement = 'The access code is recovered from a fragment in the investigation log.';
  }

  return html`<div class="archive-pending sealed-panel">
    <p class="eyebrow">SEALED RECORD</p>
    <h2>${copy.title}</h2>
    <p class="fine">${copy.note}</p>
    ${requirement ? html`<p class="fine"><strong>${requirement}</strong></p>` : raw('')}

    ${file.lockReason === 'code'
      ? html`<form method="post" action="/archive/${file.slug}/unlock" class="auth-form compact-form">
          <input type="hidden" name="csrf" value="${csrf}">
          <label class="field">
            <span class="field-label">ACCESS CODE</span>
            <input class="field-input" type="text" name="code" autocomplete="off" spellcheck="false" required>
            ${file.unlockHint ? html`<span class="field-hint">${file.unlockHint}</span>` : raw('')}
          </label>
          <button class="btn primary" type="submit">UNLOCK RECORD</button>
        </form>`
      : html`<p class="archive-cta">
          <a class="btn primary" href="/investigate">OPEN THE INVESTIGATION</a>
          <a class="btn ghost" href="/archive">BACK TO THE ARCHIVE</a>
        </p>`}
  </div>`;
}

function renderChallengeForm({ file, challenge, submission, csrf }) {
  const choices = Array.isArray(challenge.choices) ? challenge.choices : [];
  const isChoice = challenge.puzzle_type === 'choice' && choices.length > 0;
  const inputType = challenge.puzzle_type === 'password' ? 'password' : 'text';

  return html`<form method="post" action="/archive/${file.slug}/submit" class="auth-form">
    <input type="hidden" name="csrf" value="${csrf}">
    <input type="hidden" name="challengeId" value="${challenge.id}">
    ${isChoice
      ? html`<fieldset class="field" style="border:0;padding:0;margin:0 0 1rem 0;">
          <legend class="field-label">SELECT ONE OPTION</legend>
          ${choices.map(
            (opt) => html`<label class="field field-check" style="margin:0.35rem 0;">
              <input type="radio" name="answer" value="${opt}" required>
              <span>${opt}</span>
            </label>`
          )}
        </fieldset>`
      : html`<label class="field">
          <span class="field-label">ANSWER</span>
          <input class="field-input" type="${inputType}" name="answer" autocomplete="off" spellcheck="false" required>
        </label>`}
    <p class="field-hint">
      ${String(submission?.remaining ?? challenge.max_attempts)} attempt(s) remain.
      The attempt is encrypted before it is stored and is compared on the server.
    </p>
    <button class="btn primary" type="submit">SUBMIT ANSWER</button>
  </form>`;
}

function answerPanel({ file, eligibility, challenge, puzzles = [], submission, csrf }) {
  if (file.status !== 'open') {
    return html`<div class="archive-pending">
      <p class="eyebrow">SUBMISSION TERMINAL</p>
      <h2>CLOSED FOR THIS FILE</h2>
      <p class="fine">${STATUS_COPY[file.status]?.note || 'This file is not accepting submissions.'}</p>
    </div>`;
  }

  if (!eligibility.signedIn) {
    return html`<div class="archive-pending">
      <p class="eyebrow">SUBMISSION TERMINAL</p>
      <h2>ACCOUNT REQUIRED</h2>
      <p class="fine">
        A verified account and a linked wallet are required to answer. Nothing is charged to
        register, and linking a wallet signs a message only.
      </p>
      <p class="archive-cta">
        <a class="btn primary" href="/login">SIGN IN</a>
        <a class="btn ghost" href="/register">REGISTER</a>
      </p>
    </div>`;
  }

  const walletRequired = file.requiresWallet !== false || Number(file.minHolding) > 0;

  const rows = [
    checkRow(true, 'Account verified', 'Signed in with a verified address.'),
    checkRow(
      !walletRequired || Boolean(eligibility.wallet),
      walletRequired ? 'Wallet linked' : 'Wallet optional',
      eligibility.wallet
        ? eligibility.wallet
        : walletRequired
          ? 'Link a wallet from MY ARCHIVE to prove ownership.'
          : 'No wallet required for this file.'
    ),
  ];

  if (eligibility.wallet) {
    rows.push(
      checkRow(
        eligibility.satisfied,
        `Minimum holding ${file.minHolding} F106`,
        eligibility.balanceError
          ? 'Balance unavailable right now; the holding check is repeated when you submit.'
          : `Balance read from chain: ${eligibility.balance} F106.`
      )
    );
  }

  const eligible = (!walletRequired || Boolean(eligibility.wallet)) && eligibility.satisfied;
  const list = puzzles.length > 0 ? puzzles : challenge ? [{ challenge, state: submission }] : [];

  let terminal;
  if (list.length === 0) {
    terminal = html`<p class="fine">
      No answer is attached to this file yet. Nothing can be submitted until an archivist seals one.
    </p>`;
  } else if (list.length === 1) {
    const item = list[0];
    if (item.state?.hasCorrect) {
      terminal = html`<p class="fine">
        A correct answer is already on file and is awaiting archivist review. A reward is created
        only after that review and the manual on-chain payment.
      </p>`;
    } else if (item.state?.remaining <= 0) {
      terminal = html`<p class="fine">
        No attempts remain for this file. The recorded attempts are on file for the archivist.
      </p>`;
    } else if (eligible) {
      terminal = renderChallengeForm({ file, challenge: item.challenge, submission: item.state, csrf });
    } else {
      terminal = html`<p class="fine">Meet the holding requirement before the answer box opens.</p>`;
    }
  } else {
    terminal = html`${list.map((item) => html`<div class="admin-panel" style="margin-top:1rem;">
      <p class="field-label">STEP ${item.challenge.position} · ${String(item.challenge.puzzle_type || 'text').toUpperCase()}</p>
      <p class="puzzle-text">${item.challenge.prompt}</p>
      ${item.challenge.hint ? html`<p class="fine">Hint: ${item.challenge.hint}</p>` : raw('')}
      ${item.state?.hasCorrect
        ? html`<p class="fine"><strong>✓ STEP ${item.challenge.position} SOLVED</strong> — recorded for review.</p>`
        : item.state?.remaining <= 0
          ? html`<p class="fine">No attempts remain for this step.</p>`
          : eligible
            ? renderChallengeForm({ file, challenge: item.challenge, submission: item.state, csrf })
            : html`<p class="fine">Meet the holding requirement before the answer box opens.</p>`}
    </div>`)}`;
  }

  return html`<div class="wallet-panel">
    <p class="eyebrow">SUBMISSION TERMINAL</p>
    <h2>${submission?.hasCorrect ? 'AWAITING REVIEW' : eligible ? 'ELIGIBLE' : 'NOT YET ELIGIBLE'}</h2>
    <ul class="checklist">${rows}</ul>
    ${list.length === 1 && challenge && !submission?.hasCorrect
      ? html`<div class="puzzle-prompt">
          <p class="field-label">PUZZLE</p>
          <p class="puzzle-text">${challenge.prompt}</p>
          ${challenge.hint ? html`<p class="fine">Hint: ${challenge.hint}</p>` : raw('')}
        </div>`
      : raw('')}
    ${terminal}
    <p class="fine">
      ${eligibility.wallet
        ? ''
        : html`<a href="/dashboard">Open MY ARCHIVE</a> to link a wallet.`}
    </p>
  </div>`;
}

export function archiveFilePage({
  session,
  file,
  eligibility,
  challenge = null,
  puzzles = [],
  requirements = [],
  submission = { attempts: 0, remaining: 0, hasCorrect: false },
  csrf = '',
  message = '',
}) {
  const status = STATUS_COPY[file.status] || { label: file.status, note: '' };
  const locked = Boolean(file.locked);

  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">
        ${fileNumber(file.number)} / ${status.label}
        ${file.classification ? html` / <span class="classification">${file.classification}</span>` : raw('')}
        ${file.chapterNo ? html` / CHAPTER ${String(file.chapterNo).padStart(2, '0')}` : raw('')}
      </p>
      <h1 class="archive-title">${file.title}</h1>
      ${file.subtitle ? html`<p class="eyebrow">${file.subtitle}</p>` : raw('')}
      <p class="lede">${file.teaser}</p>

      ${notice('archive', message)}

      ${file.hasCover
        ? html`<div class="admin-panel"><img src="/archive/${file.slug}/cover" alt="${file.title}" style="max-width:100%;height:auto;display:block;"></div>`
        : raw('')}

      <div class="stats archive-stats" aria-label="File facts">
        <div class="stat">
          <span class="stat-label">REWARD</span>
          <strong>${file.rewardsEnabled === false ? 'NONE' : file.reward}</strong>
          <span class="stat-note">${file.rewardsEnabled === false ? 'Unrewarded investigation' : 'F106, paid manually after verification'}</span>
        </div>
        <div class="stat">
          <span class="stat-label">MIN HOLDING</span>
          <strong>${file.minHolding}</strong>
          <span class="stat-note">F106, read on-chain by the server</span>
        </div>
        <div class="stat">
          <span class="stat-label">DIFFICULTY</span>
          <strong>${file.difficulty.toUpperCase()}</strong>
          <span class="stat-note">${file.winnerMethod.replace(/_/g, ' ')}</span>
        </div>
        <div class="stat">
          <span class="stat-label">WINDOW</span>
          <strong>${file.closesAt ? dateLabel(file.closesAt) : 'OPEN-ENDED'}</strong>
          <span class="stat-note">
            ${file.opensAt ? `opened ${dateLabel(file.opensAt)}` : 'no opening date set'}
            ${file.closesAt ? ` — closes ${relativeLabel(file.closesAt)}` : ''}
          </span>
        </div>
      </div>

      ${file.briefing
        ? html`<div class="briefing">
            <p class="eyebrow">BRIEFING</p>
            <div class="briefing-body">${file.briefing}</div>
          </div>`
        : raw('')}

      ${requirementsPanel({ file, eligibility, requirements, csrf })}

      ${locked
        ? sealedPanel({ file, csrf })
        : html`
            ${file.loreBody
              ? html`<div class="document">
                  <div class="document-head">
                    <span class="mono">RECOVERED DOCUMENT / ${fileNumber(file.number)}</span>
                    <span class="stamp-inline mono">${file.classification || 'UNCLASSIFIED'}</span>
                  </div>
                  ${renderDocument(file.loreBody)}
                </div>`
              : raw('')}
            ${answerPanel({ file, eligibility, challenge, puzzles, submission, csrf })}
          `}

      <p class="fine">
        ${status.note}
        ${file.opensAt && file.closesAt
          ? ` Window: ${dateTimeLabel(file.opensAt)} — ${dateTimeLabel(file.closesAt)}.`
          : ''}
      </p>

      <p class="archive-cta">
        <a class="btn ghost" href="/archive">FILES IN CUSTODY</a>
        <a class="btn ghost" href="/investigate">INVESTIGATION</a>
        ${file.chapterNo
          ? html`<a class="btn ghost" href="/investigate/chapter/${file.chapterNo}">CHAPTER ${String(file.chapterNo).padStart(2, '0')}</a>`
          : raw('')}
      </p>
    </section>`;

  return page({
    title: `FILE106 — ${file.title}`,
    body,
    session,
    signedIn: eligibility.signedIn,
    scripts: ['/mystery.js'],
  });
}
