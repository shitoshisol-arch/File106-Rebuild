// Per-file reward conditions: the green/red check contract.
//
// Run: node app/tests/requirements.test.mjs
//
// The promise under test is the one the schema makes:
//
//   * A participant can submit proof, and only an archivist review can turn it
//     into a green check. No request, and no direct insert lacking a reviewer
//     and a check time, may store 'verified'.
//   * A reward cannot be created while a required condition is unverified —
//     neither through the approval route nor through a raw SQL insert.
//   * Red is the default: a task not done renders red, and a rejected proof
//     renders red again with the reviewer's note.
//
// Real here: HTTP routing, sessions, CSRF, the database constraints and the
// rewards insert trigger. Stubbed: the Solana RPC read.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { createDb } from '../db.js';
import { applyMigrations } from '../migrate.js';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashSecret } from '../../scripts/archive/secret-hash.mjs';

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------
const uploadDir = join(tmpdir(), `file106-uploads-${randomBytes(4).toString('hex')}`);

const pglite = new PGlite();
const db = createDb({
  query: (text, params) => pglite.query(text, params),
  exec: (text) => pglite.exec(text),
});

await applyMigrations({ db, log: { info: () => {} } });

const config = loadConfig({
  NODE_ENV: 'test',
  SITE_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'a'.repeat(64),
  ANSWER_ENC_KEY: 'b'.repeat(64),
  F106_MINT_ADDRESS: 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE',
  F106_DECIMALS: '8',
  SMTP_URL: '',
  ARCHIVE_UPLOAD_DIR: uploadDir,
  ARCHIVE_UPLOAD_MAX_BYTES: '65536',
});

const holding = { amount: '1.50000000', baseUnits: 150000000n, decimals: 8 };
const balanceReader = async () => holding;
const mailer = { async send() { return { delivered: false }; } };

const app = await buildServer({ config, db, balanceReader, mailer, logger: false });
await app.ready();

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function cookieJar(response) {
  const header = response.headers['set-cookie'];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const jar = {};
  for (const entry of list) {
    const [pair] = entry.split(';');
    const index = pair.indexOf('=');
    jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return jar;
}

const mergeCookies = (...jars) => Object.assign({}, ...jars);
const csrfFrom = (body) => /name="csrf" value="([a-f0-9]{64})"/.exec(body)?.[1] ?? null;
const form = (fields) => new URLSearchParams(fields).toString();
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

async function postForm(url, fields, cookies) {
  return app.inject({ method: 'POST', url, payload: form(fields), cookies, headers: FORM_HEADERS });
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
const ADMIN = { email: 'archivist@f106.test', password: 'archivist-pass-106', name: 'Test Archivist' };
const HOLDER = { username: 'holder', email: 'holder@f106.test', password: 'participant-pass-106' };

await db.query(
  `insert into admin_users (email, display_name, password_hash, role)
   values ($1, $2, $3, 'owner')`,
  [ADMIN.email, ADMIN.name, hashSecret(ADMIN.password)]
);

const holder = await db.one(
  `insert into users (username, email, password_hash, status, email_verified_at)
   values ($1, $2, $3, 'active', now())
   returning id`,
  [HOLDER.username, HOLDER.email, hashSecret(HOLDER.password)]
);

let admin = {};
let adminCsrf = '';
let participant = {};
let fileId;
let fileSlug;

console.log('sign-in');

await check('the archivist and the participant each get a session', async () => {
  const adminLogin = await app.inject({ method: 'GET', url: '/admin/login' });
  const adminResult = await postForm(
    '/admin/login',
    { csrf: csrfFrom(adminLogin.body), email: ADMIN.email, password: ADMIN.password },
    cookieJar(adminLogin)
  );
  assert.equal(adminResult.statusCode, 303);
  admin = mergeCookies(cookieJar(adminLogin), cookieJar(adminResult));

  const panel = await app.inject({ method: 'GET', url: '/admin', cookies: admin });
  adminCsrf = csrfFrom(panel.body);
  assert.ok(adminCsrf, 'the panel must carry a CSRF token');

  const login = await app.inject({ method: 'GET', url: '/login' });
  const result = await postForm(
    '/login',
    { csrf: csrfFrom(login.body), email: HOLDER.email, password: HOLDER.password },
    cookieJar(login)
  );
  assert.equal(result.statusCode, 303);
  participant = mergeCookies(cookieJar(login), cookieJar(result));

  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies: participant });
  assert.equal(dashboard.statusCode, 200);
});

console.log('a file with a partner condition');

await check('the archivist creates a file, seals an answer and publishes it', async () => {
  const created = await postForm(
    '/admin/files',
    {
      csrf: adminCsrf,
      fileNumber: '206',
      slug: '',
      title: 'The Partner Ledger',
      teaser: 'A ledger that only opens for those who follow the signal.',
      briefing: 'Follow the partner account, then answer.',
      difficulty: 'medium',
      winnerMethod: 'first_correct',
      reward: '0.5',
      minHolding: '1',
      maxWinners: '',
      opensAt: '',
      closesAt: '',
    },
    admin
  );

  assert.equal(created.statusCode, 303, created.body);
  fileId = created.headers.location.split('/')[3].split('?')[0];
  const row = await db.one('select slug, status from files where id = $1', [fileId]);
  fileSlug = row.slug;

  const sealed = await postForm(
    `/admin/files/${fileId}/challenge`,
    { csrf: adminCsrf, prompt: 'Who signed the ledger?', answer: 'the-partner', answerFormat: 'text', maxAttempts: '2' },
    admin
  );
  assert.equal(sealed.statusCode, 303);

  const published = await postForm(`/admin/files/${fileId}/status`, { csrf: adminCsrf, status: 'open' }, admin);
  assert.equal(published.statusCode, 303);
});

await check('the archivist adds a condition by pasting only the partner link', async () => {
  // One required input: the link. Platform, handle, type and title are all
  // derived from it server-side.
  const added = await postForm(
    `/admin/files/${fileId}/requirements`,
    {
      csrf: adminCsrf,
      targetUrl: 'https://x.com/file106',
      platform: 'auto',
      isRequired: '1',
    },
    admin
  );

  assert.equal(added.statusCode, 303);
  assert.match(added.headers.location, /notice=requirement-created$/);

  const row = await db.one(
    'select position, platform, kind, title, is_required, target_url, target_handle from file_requirements where file_id = $1',
    [fileId]
  );
  assert.equal(row.position, 1, 'a blank position appends after the last one');
  assert.equal(row.platform, 'x', 'the platform is read from the link domain');
  assert.equal(row.kind, 'social_follow', 'a social platform is a follow task');
  assert.equal(row.target_handle, '@file106', 'the handle is read from the link path');
  assert.equal(row.title, 'Follow @file106 on X', 'the title is generated');
  assert.equal(row.is_required, true);
  assert.equal(row.target_url, 'https://x.com/file106');
});

await check('a condition link that is not HTTPS is refused', async () => {
  const refused = await postForm(
    `/admin/files/${fileId}/requirements`,
    { csrf: adminCsrf, targetUrl: 'javascript:alert(1)' },
    admin
  );

  assert.equal(refused.statusCode, 303);
  assert.match(refused.headers.location, /notice=requirement-invalid$/);

  const count = await db.value('select count(*)::int as v from file_requirements where file_id = $1', [fileId]);
  assert.equal(Number(count), 1, 'the invalid condition must not be stored');
});

await check('the editor shows the condition with its review counters', async () => {
  const page = await app.inject({ method: 'GET', url: `/admin/files/${fileId}`, cookies: admin });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /REWARD CONDITIONS \/ PARTNER TASKS/);
  assert.match(page.body, /Follow @file106 on X/);
  assert.match(page.body, /ADD CONDITION/);
});

console.log('the participant view');

await check('a task not done renders a red check, not a green one', async () => {
  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /REWARD CONDITIONS/);
  assert.match(page.body, /data-state="missing"/);
  assert.match(page.body, /NOT DONE/);
  assert.match(page.body, /OPEN X LINK/);
  assert.doesNotMatch(page.body, /data-state="verified"/);
  assert.doesNotMatch(page.body, /0 OF 1 VERIFIED[\s\S]*data-state="verified"/);
});

await check('an anonymous visitor sees the task and a sign-in prompt, no proof form', async () => {
  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /data-state="missing"/);
  assert.ok(!page.body.includes('/proof"'), 'no proof form may render for an anonymous visitor');
});

let requirementId;

await check('the participant submits proof and gets UNDER REVIEW, never green', async () => {
  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  requirementId = /\/archive\/[a-z0-9-]+\/requirements\/([0-9a-f-]{36})\/proof/.exec(page.body)?.[1];
  assert.ok(requirementId, 'the proof form must name its condition');
  const csrf = csrfFrom(page.body);

  const sent = await postForm(
    `/archive/${fileSlug}/requirements/${requirementId}/proof`,
    { csrf, proof: '@holder-f106' },
    participant
  );
  assert.equal(sent.statusCode, 303);
  assert.match(sent.headers.location, /notice=proof-submitted$/);

  const row = await db.one(
    'select status, proof, reviewed_by, checked_at from file_requirement_verifications where requirement_id = $1 and user_id = $2',
    [requirementId, holder.id]
  );
  assert.equal(row.status, 'pending');
  assert.equal(row.proof, '@holder-f106');
  assert.equal(row.reviewed_by, null, 'no reviewer may exist before a review');
  assert.equal(row.checked_at, null, 'no check time may exist before a review');

  const after = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  assert.match(after.body, /data-state="pending"/);
  assert.match(after.body, /UNDER REVIEW/);
  assert.match(after.body, /@holder-f106/);
  assert.ok(!after.body.includes('data-state="verified"'), 'a submitted proof must not render green');
});

await check('the database refuses a verified row without a reviewer and a check time', async () => {
  // This is the no-fake-green rule at the storage layer: even a direct SQL
  // insert that skips every route cannot store a green check.
  await assert.rejects(
    db.query(
      `insert into file_requirement_verifications (requirement_id, file_id, user_id, status, proof)
       values ($1, $2, $3, 'verified', 'fake-proof')`,
      [requirementId, fileId, holder.id]
    ),
    (error) => {
      assert.equal(error.code, '23514');
      assert.match(String(error.message), /green_needs_reviewer|checked_at|reviewed_by/i);
      return true;
    }
  );

  const rows = await db.many('select status from file_requirement_verifications');
  assert.ok(rows.every((r) => r.status !== 'verified'), 'no verified row may exist');
});

console.log('the reward gate');

let submissionId;

await check('a correct submission exists and waits for review', async () => {
  const challenge = await db.one('select id from challenges where file_id = $1', [fileId]);
  const inserted = await db.one(
    `insert into submissions
       (file_id, challenge_id, user_id, attempt_no, wallet_address,
        answer_ciphertext, answer_digest,
        holding_checked_at, holding_snapshot_f106, holding_required_f106, holding_satisfied)
     values ($1, $2, $3, 1, $4, $5, $6, now(), 1.5, 1, true)
     returning id`,
    [fileId, challenge.id, holder.id, 'So11111111111111111111111111111111111111112', Buffer.from('sealed'), Buffer.from('digest')]
  );
  submissionId = inserted.id;

  const page = await app.inject({ method: 'GET', url: `/admin/submissions/${submissionId}`, cookies: admin });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /REWARD CONDITIONS FOR THIS PARTICIPANT/);
  assert.match(page.body, /The reward is blocked until this is verified/);
});

await check('approval is refused while the condition is unverified', async () => {
  const refused = await postForm(
    `/admin/submissions/${submissionId}/approve`,
    { csrf: adminCsrf, note: '' },
    admin
  );
  assert.equal(refused.statusCode, 303);
  assert.match(refused.headers.location, /notice=requirements-incomplete$/);

  const winners = await db.value('select count(*)::int as v from winners');
  const rewards = await db.value('select count(*)::int as v from rewards');
  assert.equal(Number(winners), 0, 'no winner may be created');
  assert.equal(Number(rewards), 0, 'no reward record may exist');
});

await check('the queue lists the proof and the archivist verifies it', async () => {
  const queue = await app.inject({ method: 'GET', url: '/admin/verifications', cookies: admin });
  assert.equal(queue.statusCode, 200);
  assert.match(queue.body, /REWARD CONDITIONS/);
  assert.match(queue.body, /@holder-f106/);
  assert.match(queue.body, /VERIFY ✓/);

  const verificationId = await db.value(
    'select id::text as v from file_requirement_verifications where requirement_id = $1 and user_id = $2',
    [requirementId, holder.id]
  );

  const approved = await postForm(
    `/admin/verifications/${verificationId}/approve`,
    { csrf: adminCsrf, note: 'Checked the follower list.' },
    admin
  );
  assert.equal(approved.statusCode, 303);
  assert.match(approved.headers.location, /notice=verification-approved$/);

  const row = await db.one(
    'select status, reviewed_by, checked_at, reviewer_note from file_requirement_verifications where id = $1',
    [verificationId]
  );
  assert.equal(row.status, 'verified');
  assert.ok(row.reviewed_by, 'the green check names the archivist who set it');
  assert.ok(row.checked_at, 'the green check records when it was checked');
});

await check('the participant now sees a green check on the condition', async () => {
  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /data-state="verified"/);
  assert.match(page.body, /ALL CONDITIONS MET/);
  assert.match(page.body, /✓ Verified by the archive on/);
  assert.ok(!page.body.includes('data-state="missing"'), 'nothing may render red once verified');
});

await check('a verified condition is closed to participant input', async () => {
  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  const csrf = csrfFrom(page.body);
  assert.ok(csrf, 'a signed-in participant page carries a session token');

  const again = await postForm(
    `/archive/${fileSlug}/requirements/${requirementId}/proof`,
    { csrf, proof: '@someone-else' },
    participant
  );
  assert.equal(again.statusCode, 303);
  assert.match(again.headers.location, /notice=proof-locked$/);

  const row = await db.one(
    'select proof from file_requirement_verifications where requirement_id = $1 and user_id = $2',
    [requirementId, holder.id]
  );
  assert.equal(row.proof, '@holder-f106', 'the stored proof must be untouched');
});

await check('approval now creates the winner and the reward record', async () => {
  const approved = await postForm(
    `/admin/submissions/${submissionId}/approve`,
    { csrf: adminCsrf, note: 'Answer and conditions verified.' },
    admin
  );
  assert.equal(approved.statusCode, 303);
  assert.match(approved.headers.location, /notice=submission-approved$/);

  const reward = await db.one(
    `select r.id, r.amount_f106::text as amount, w.status as winner_status
       from rewards r join winners w on w.id = r.winner_id
      where r.file_id = $1 and r.user_id = $2`,
    [fileId, holder.id]
  );
  assert.equal(reward.amount, '0.50000000');
  assert.equal(reward.winner_status, 'approved');
});

console.log('rejection and resubmission');

let secondRequirementId;

await check('a second required condition renders red for the same participant', async () => {
  // Again only the link: Telegram is detected, the verb becomes Join.
  const added = await postForm(
    `/admin/files/${fileId}/requirements`,
    { csrf: adminCsrf, targetUrl: 'https://t.me/file106' },
    admin
  );
  assert.match(added.headers.location, /notice=requirement-created$/);

  const row = await db.one(
    'select id, platform, kind, title, target_handle from file_requirements where file_id = $1 and position = 2',
    [fileId]
  );
  secondRequirementId = row.id;
  assert.equal(row.platform, 'telegram');
  assert.equal(row.kind, 'social_follow');
  assert.equal(row.target_handle, '@file106');
  assert.equal(row.title, 'Join @file106 on Telegram', 'the generated verb fits the platform');

  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  assert.match(page.body, /1 OF 2 VERIFIED/);
  assert.ok(page.body.includes('data-state="verified"'), 'the first condition stays green');
  assert.ok(page.body.includes('data-state="missing"'), 'the new condition renders red');
});

await check('a rejected proof renders red with the reviewer note, and can be resubmitted', async () => {
  const participantCsrf = csrfFrom(
    (await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant })).body
  );

  const sent = await postForm(
    `/archive/${fileSlug}/requirements/${secondRequirementId}/proof`,
    { csrf: participantCsrf, proof: 't.me/wrong-channel' },
    participant
  );
  assert.match(sent.headers.location, /notice=proof-submitted$/);

  const rejected = await postForm(
    `/admin/verifications/${await db.value(
      'select id::text as v from file_requirement_verifications where requirement_id = $1 and user_id = $2',
      [secondRequirementId, holder.id]
    )}/reject`,
    { csrf: adminCsrf, note: 'That channel is not the partner channel.' },
    admin
  );
  assert.match(rejected.headers.location, /notice=verification-rejected$/);

  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: participant });
  assert.match(page.body, /data-state="rejected"/);
  assert.match(page.body, /NOT ACCEPTED/);
  assert.match(page.body, /That channel is not the partner channel\./);
  assert.match(page.body, /SUBMIT PROOF/, 'a rejected condition must offer the form again');

  const resubmitted = await postForm(
    `/archive/${fileSlug}/requirements/${secondRequirementId}/proof`,
    { csrf: participantCsrf, proof: 't.me/file106' },
    participant
  );
  assert.match(resubmitted.headers.location, /notice=proof-submitted$/);

  const row = await db.one(
    'select status, proof, reviewed_by, checked_at from file_requirement_verifications where requirement_id = $1 and user_id = $2',
    [secondRequirementId, holder.id]
  );
  assert.equal(row.status, 'pending', 'resubmission reopens the review');
  assert.equal(row.proof, 't.me/file106');
  assert.equal(row.reviewed_by, null, 'the previous decision is cleared');
  assert.equal(row.checked_at, null);
});

await check('the reward trigger blocks a reward on a second file with an unverified condition', async () => {
  // A second file with the same participant and one unverified condition: a
  // raw insert that bypasses the approval route must still be refused.
  const secondFile = await db.one(
    `insert into files
       (file_number, slug, title, teaser, difficulty, status,
        reward_amount_f106, min_holding_f106, winner_method, created_by)
     values (207, 'file-207', 'Second Ledger', 'Teaser.', 'easy', 'open',
             0.25, 1, 'first_correct', (select id from admin_users limit 1))
     returning id`
  );

  await db.query(
    `insert into file_requirements (file_id, position, title, platform, target_url, is_required)
     values ($1, 1, 'Follow the second partner', 'x', 'https://x.com/file106', true)`,
    [secondFile.id]
  );

  const challenge = await db.one(
    `insert into challenges (file_id, position, prompt, answer_hash, answer_format, max_attempts)
     values ($1, 1, 'Who signed the second ledger?', 'scrypt$stub', 'text', 2)
     returning id`,
    [secondFile.id]
  );
  const submission = await db.one(
    `insert into submissions
       (file_id, challenge_id, user_id, attempt_no, wallet_address,
        answer_ciphertext, answer_digest, status,
        holding_checked_at, holding_snapshot_f106, holding_required_f106, holding_satisfied)
     values ($1, $2, $3, 1, $4, $5, $6, 'correct', now(), 1.5, 1, true)
     returning id`,
    [secondFile.id, challenge.id, holder.id, 'So11111111111111111111111111111111111111112', Buffer.from('sealed'), Buffer.from('digest')]
  );

  const winner = await db.one(
    `insert into winners
       (file_id, submission_id, user_id, wallet_address, reward_amount_f106,
        status, selected_by, approved_by, approved_at)
     values ($1, $2, $3, $4, 0.25, 'approved',
             (select id from admin_users limit 1), (select id from admin_users limit 1), now())
     returning id`,
    [secondFile.id, submission.id, holder.id, 'So11111111111111111111111111111111111111112']
  );

  await assert.rejects(
    db.query(
      `insert into rewards
         (winner_id, user_id, wallet_address, file_id, file_number, amount_f106, approved_by)
       values ($1, $2, $3, $4, 207, 0.25, (select id from admin_users limit 1))`,
      [winner.id, holder.id, 'So11111111111111111111111111111111111111112', secondFile.id]
    ),
    (error) => {
      assert.equal(error.code, '23514');
      assert.match(String(error.message), /reward_conditions_incomplete/);
      return true;
    }
  );

  const rewards = await db.value('select count(*)::int as v from rewards where file_id = $1', [secondFile.id]);
  assert.equal(Number(rewards), 0, 'the backstop must refuse the reward');
});

console.log(`\n${passed.length} checks passed`);

await pglite.close();
process.exit(0);
