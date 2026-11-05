// The archivist review queue for reward conditions: every submitted proof in
// one place, with the verify / reject decision attached to the row that asked
// for it.

import { html, raw } from '../lib/html.js';
import { dateTimeLabel } from '../lib/format.js';
import { adminShell, stat } from './admin.js';
import { notice, page } from './layout.js';

const STATUS_LABEL = {
  pending: 'UNDER REVIEW',
  verified: 'VERIFIED',
  rejected: 'REJECTED',
};

export function adminVerificationsPage({ admin, rows = [], counts = {}, message = '' }) {
  const body = html`
    <h1 class="archive-title">REWARD CONDITIONS</h1>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('AWAITING REVIEW', counts.pending ?? 0, 'Proofs no archivist has checked')}
      ${stat('VERIFIED', counts.verified ?? 0, 'Green checks handed out')}
      ${stat('REJECTED', counts.rejected ?? 0, 'Red checks handed out')}
      ${stat('TOTAL', counts.total ?? 0, 'All proof records')}
    </div>

    <p class="fine">
      A green check on a condition is set only here, by an archivist who looked at the proof.
      The database refuses a verified row without a reviewer and a check time, so no click and
      no code path can manufacture one — and a reward cannot be created on a file while one of
      its required conditions is unverified.
    </p>

    ${rows.length === 0
      ? html`<p class="fine">
          No condition proofs yet. They appear here when a participant submits one from a file page.
        </p>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>Submitted</th><th>Condition</th><th>Participant</th><th>Proof</th><th>Status</th><th>Decision</th></tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) => html`<tr>
                <td class="mono">${dateTimeLabel(row.created_at)}</td>
                <td>
                  <a href="/admin/files/${row.file_id}">
                    FILE ${String(row.file_number).padStart(3, '0')} · ${row.requirement_title}
                  </a><br>
                  <span class="fine mono">${row.platform}${row.target_handle ? ` · ${row.target_handle}` : ''}${row.is_required ? '' : ' · OPTIONAL'}</span>
                </td>
                <td>${row.username}</td>
                <td class="mono">${row.proof}</td>
                <td>
                  <span class="status-chip" data-state="${row.status}">${STATUS_LABEL[row.status] || row.status}</span>
                  ${row.checked_at
                    ? html`<br><span class="fine">${dateTimeLabel(row.checked_at)}</span>`
                    : raw('')}
                  ${row.status === 'rejected' && row.reviewer_note
                    ? html`<br><span class="fine">${row.reviewer_note}</span>`
                    : raw('')}
                </td>
                <td>
                  ${row.status === 'pending'
                    ? html`<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-start;">
                        <form method="post" action="/admin/verifications/${row.id}/approve" class="inline-form">
                          <input type="hidden" name="csrf" value="${admin.csrf}">
                          <button class="btn primary" type="submit">VERIFY ✓</button>
                        </form>
                        <form method="post" action="/admin/verifications/${row.id}/reject" class="inline-form">
                          <input type="hidden" name="csrf" value="${admin.csrf}">
                          <input class="field-input" type="text" name="note" maxlength="300" placeholder="reason" style="width:120px;">
                          <button class="nav-button" type="submit">REJECT ✕</button>
                        </form>
                      </div>`
                    : raw('')}
                </td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return page({
    title: 'FILE106 — REWARD CONDITIONS',
    body: adminShell({ admin, active: 'verifications', body }),
    session: { csrf: admin.csrf },
    nav: html`<a href="/archive">VIEW ARCHIVE</a>`,
    terminalLabel: 'ARCHIVIST',
  });
}
