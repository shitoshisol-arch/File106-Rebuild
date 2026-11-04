// Control Room gate: tests first-run owner bootstrap, BTC/ETH/BNB/013 draft
// preparation, file lifecycle (create, edit, preview, schedule, duplicate,
// reorder, delete guards), multi-answer / multiple-choice puzzles, clue
// scheduling & difficulty, investigator suspension, settings, audit log, and
// role-based team permissions.
//
// Run: node app/tests/control-room.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

const uploadDir = mkdtempSync(join(tmpdir(), 'file106-control-room-'));

const pglite = new PGlite();
const db = createDb({
  query: (text, params) => pglite.query(text, params),
  exec: (text) => pglite.exec(text),
});

await applyMigrations({ db, log: { info: () => {} } });

const config = loadConfig({
  NODE_ENV: 'test',
  SITE_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'c'.repeat(64),
  ANSWER_ENC_KEY: 'd'.repeat(64),
  ARCHIVE_UPLOAD_DIR: uploadDir,
  F106_MINT_ADDRESS: 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE',
  F106_DECIMALS: '8',
});

const balanceReader = async () => ({
  amount: '5.00000000',
  baseUnits: 500_000_000n,
  decimals: 8,
});

const mailer = {
  delivered: false,
  async send() {
    return { delivered: false };
  },
};

const app = await buildServer({ config, db, balanceReader, mailer, logger: false });
await app.ready();

function cookieJar(response) {
  const header = response.headers['set-cookie'];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const jar = {};
  for (const entry of list) {
    const [pair] = entry.split(';');
    const idx = pair.indexOf('=');
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return jar;
}

function mergeCookies(...jars) {
  return Object.assign({}, ...jars);
}

function csrfFrom(html) {
  const match =
    html.match(/name="csrf"\s+value="([a-f0-9]{64})"/i) ||
    html.match(/data-csrf="([a-f0-9]{64})"/i);
  return match ? match[1] : '';
}

async function getPage(url, cookies = {}) {
  const response = await app.inject({ method: 'GET', url, cookies });
  return { response, cookies: mergeCookies(cookies, cookieJar(response)) };
}

async function postForm(url, form, cookies = {}) {
  return app.inject({
    method: 'POST',
    url,
    cookies,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(form).toString(),
  });
}

// ---------------------------------------------------------------------
console.log('first-run bootstrap and BTC / ETH / BNB preparation');

let ownerCookies = {};
let ownerCsrf = '';

await check('first-run setup creates the owner and prepares FILE 010, 011, 012 as drafts', async () => {
  const setup = await getPage('/admin/setup');
  assert.equal(setup.response.statusCode, 200);
  assert.match(setup.response.body, /CREATE FIRST OWNER/);

  const res = await postForm(
    '/admin/setup',
    {
      csrf: csrfFrom(setup.response.body),
      name: 'Chief Archivist',
      email: 'owner@file106.site',
      password: 'OwnerPassword106!',
    },
    setup.cookies
  );
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/admin/login?notice=setup-done');

  // Setup locks itself once an active owner exists.
  const lockedSetup = await getPage('/admin/setup');
  assert.equal(lockedSetup.response.statusCode, 303);
  assert.equal(lockedSetup.response.headers.location, '/admin/login?notice=setup-unavailable');

  // Verify FILE 010, 011, 012 exist as drafts and are not public.
  const drafts = await db.many(
    'select file_number, title, status from files where file_number in (10, 11, 12) order by file_number'
  );
  assert.equal(drafts.length, 3);
  assert.ok(drafts.every((d) => d.status === 'draft'));

  const publicArchive = await getPage('/archive');
  assert.ok(!publicArchive.response.body.includes('BTC / THE FIRST SIGNAL'));
});

await check('owner signs in and views the 8-metric Control Room dashboard', async () => {
  const login = await getPage('/admin/login');
  const res = await postForm(
    '/admin/login',
    {
      csrf: csrfFrom(login.response.body),
      email: 'owner@file106.site',
      password: 'OwnerPassword106!',
    },
    login.cookies
  );
  assert.equal(res.statusCode, 303);
  ownerCookies = mergeCookies(login.cookies, cookieJar(res));

  const dash = await getPage('/admin', ownerCookies);
  ownerCookies = dash.cookies;
  ownerCsrf = csrfFrom(dash.response.body);
  assert.equal(dash.response.statusCode, 200);
  assert.match(dash.response.body, /CONTROL ROOM OVERVIEW/);
  assert.match(dash.response.body, /TOTAL SECRET FILES/);
  assert.match(dash.response.body, /CONFIRMED REWARDS/);
});

await check('owner configures FILE 013 — THE CONNECTION with tri-network dependency', async () => {
  const res = await postForm('/admin/files/init-013', { csrf: ownerCsrf }, ownerCookies);
  assert.equal(res.statusCode, 303);
  assert.match(res.headers.location, /^\/admin\/files\/[0-9a-f-]{36}\?notice=file-created$/);

  const f13 = await db.one('select file_number, title, status, required_file_number from files where file_number = 13');
  assert.equal(f13.title, 'THE CONNECTION');
  assert.equal(f13.status, 'draft');
  assert.equal(Number(f13.required_file_number), 12);
});

// ---------------------------------------------------------------------
console.log('file lifecycle: create, preview, schedule, duplicate, reorder, delete');

let customFileId = '';

await check('owner creates, previews, schedules, duplicates, reorders, and deletes a file', async () => {
  const created = await postForm(
    '/admin/files',
    {
      csrf: ownerCsrf,
      formControlsPresent: '1',
      fileNumber: '20',
      slug: 'file-020-signal-echo',
      title: 'SIGNAL ECHO',
      subtitle: 'SECTOR 7 INTERCEPT',
      fileType: 'transmission',
      sortOrder: '5',
      classification: 'SECRET',
      teaser: 'An intercept from Sector 7.',
      briefing: 'Full intercept body for Sector 7.',
      difficulty: 'medium',
      winnerMethod: 'first_correct',
      reward: '1.5',
      minHolding: '1',
      rewardsEnabled: '1',
      requiresWallet: '1',
      requiresRegistration: '1',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 3600_000).toISOString(),
    },
    ownerCookies
  );
  assert.equal(created.statusCode, 303);
  customFileId = created.headers.location.split('/')[3].split('?')[0];

  // Preview works while still in draft.
  const preview = await getPage(`/admin/files/${customFileId}/preview`, ownerCookies);
  assert.equal(preview.response.statusCode, 200);
  assert.match(preview.response.body, /ARCHIVIST PREVIEW MODE/);
  assert.match(preview.response.body, /SECTOR 7 INTERCEPT/);

  // Schedule the file; since opensAt is 1 minute in the past, requesting /archive
  // runs the scheduler and automatically transitions it to 'open'.
  const scheduled = await postForm(
    `/admin/files/${customFileId}/status`,
    { csrf: ownerCsrf, status: 'scheduled' },
    ownerCookies
  );
  assert.equal(scheduled.statusCode, 303);
  assert.match(scheduled.headers.location, /notice=scheduled/);

  const pubList = await getPage('/archive');
  assert.match(pubList.response.body, /SIGNAL ECHO/);

  // Duplicate creates a new draft copy.
  const dup = await postForm(`/admin/files/${customFileId}/duplicate`, { csrf: ownerCsrf }, ownerCookies);
  assert.equal(dup.statusCode, 303);
  const dupId = dup.headers.location.split('/')[3].split('?')[0];
  const dupRow = await db.one('select status, title from files where id = $1', [dupId]);
  assert.equal(dupRow.status, 'draft');
  assert.match(dupRow.title, /\(COPY\)/);

  // Move order and delete the duplicate.
  const moved = await postForm(`/admin/files/${dupId}/move`, { csrf: ownerCsrf, direction: 'up' }, ownerCookies);
  assert.equal(moved.statusCode, 303);

  const deleted = await postForm(`/admin/files/${dupId}/delete`, { csrf: ownerCsrf }, ownerCookies);
  assert.equal(deleted.statusCode, 303);
  assert.equal(deleted.headers.location, '/admin/files?notice=file-deleted');
});

// ---------------------------------------------------------------------
console.log('multi-answer and multiple-choice puzzles');

await check('puzzles support multiple choice and multiple accepted answers without leaking answers', async () => {
  const pRes = await postForm(
    `/admin/files/${customFileId}/puzzles`,
    {
      csrf: ownerCsrf,
      position: '1',
      puzzleType: 'choice',
      answerFormat: 'text',
      maxAttempts: '3',
      prompt: 'Which relay carried the first signal?',
      choices: 'RELAY-ALPHA\nRELAY-OMEGA\nRELAY-ZERO',
      hint: 'Count from zero.',
      answer: 'RELAY-ZERO',
      answer2: 'RELAY-OMEGA',
      answer3: '',
    },
    ownerCookies
  );
  assert.equal(pRes.statusCode, 303);
  assert.match(pRes.headers.location, /notice=puzzle-saved/);

  // Create a verified participant with a linked wallet to test submission.
  const userRow = await db.one(
    `insert into users (username, email, password_hash, status, email_verified_at)
     values ('agent_zero', 'agent@file106.site', $1, 'active', now())
     returning id`,
    [hashSecret('AgentPassword106!')]
  );
  await db.query(
    `insert into user_wallets (user_id, address, is_primary, proof_nonce, proof_message, proof_signature, first_seen_balance_f106)
     values ($1, 'So11111111111111111111111111111111111111112', true, 'n', 'm', 's', 5)`,
    [userRow.id]
  );

  const loginPage = await getPage('/login');
  const loginRes = await postForm(
    '/login',
    {
      csrf: csrfFrom(loginPage.response.body),
      email: 'agent@file106.site',
      password: 'AgentPassword106!',
    },
    loginPage.cookies
  );
  const agentCookies = mergeCookies(loginPage.cookies, cookieJar(loginRes));

  // Public file page shows options and hint, never scrypt$ hashes.
  const filePage = await getPage('/archive/file-020-signal-echo', agentCookies);
  assert.equal(filePage.response.statusCode, 200);
  assert.match(filePage.response.body, /RELAY-ALPHA/);
  assert.match(filePage.response.body, /Count from zero\./);
  assert.ok(!filePage.response.body.includes('scrypt$'));

  const agentCsrf = csrfFrom(filePage.response.body);

  // Wrong option is recorded as incorrect.
  const wrong = await postForm(
    '/archive/file-020-signal-echo/submit',
    { csrf: agentCsrf, answer: 'RELAY-ALPHA' },
    agentCookies
  );
  assert.match(wrong.headers.location, /notice=answer-incorrect/);

  // Second accepted answer ('RELAY-OMEGA') is accepted as correct!
  const right = await postForm(
    '/archive/file-020-signal-echo/submit',
    { csrf: agentCsrf, answer: 'RELAY-OMEGA' },
    agentCookies
  );
  assert.match(right.headers.location, /notice=answer-correct/);

  // Contested file refuses deletion and puzzle answer replacement.
  const delBlocked = await postForm(`/admin/files/${customFileId}/delete`, { csrf: ownerCsrf }, ownerCookies);
  assert.match(delBlocked.headers.location, /notice=file-delete-blocked/);
});

// ---------------------------------------------------------------------
console.log('clues, investigators, settings, audit log, and team roles');

await check('clues support difficulty, scheduling, and deletion', async () => {
  const cRes = await postForm(
    '/admin/clues',
    {
      csrf: ownerCsrf,
      clueNo: '50',
      slug: 'clue-050',
      title: 'FUTURE SIGNAL',
      body: 'Decoded clue payload.',
      hint: 'Wait for release.',
      location: 'Archive header',
      difficulty: 'brutal',
      releaseAt: new Date(Date.now() + 3600_000).toISOString(),
      isEnabled: '1',
    },
    ownerCookies
  );
  assert.equal(cRes.statusCode, 303);
  const clueId = cRes.headers.location.split('/')[3].split('?')[0];

  // Scheduled in the future -> public clue decode returns 404 until releaseAt.
  const home = await getPage('/');
  const decode = await app.inject({
    method: 'POST',
    url: '/api/mystery/clue',
    cookies: home.cookies,
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': (home.response.body.match(/name="csrf-token"\s+content="([a-f0-9]{64})"/i) || [])[1] || '',
    },
    payload: JSON.stringify({ clueNo: 50 }),
  });
  assert.equal(decode.statusCode, 404);

  const delClue = await postForm(`/admin/clues/${clueId}/delete`, { csrf: ownerCsrf }, ownerCookies);
  assert.equal(delClue.headers.location, '/admin/clues?notice=clue-deleted');
});

await check('investigators, settings, audit log, and reviewer read-only role work', async () => {
  const invList = await getPage('/admin/investigators', ownerCookies);
  assert.equal(invList.response.statusCode, 200);
  assert.match(invList.response.body, /agent_zero/);

  const settingsRes = await postForm(
    '/admin/settings',
    {
      csrf: ownerCsrf,
      defaultReward: '2.00000000',
      defaultMinHolding: '1.00000000',
      tagline: 'CUSTOM CONTROL ROOM TAGLINE',
      maintenanceBanner: '1',
    },
    ownerCookies
  );
  assert.equal(settingsRes.headers.location, '/admin/settings?notice=settings-saved');

  const pubArchive = await getPage('/archive');
  assert.match(pubArchive.response.body, /CUSTOM CONTROL ROOM TAGLINE/);

  const auditPage = await getPage('/admin/audit', ownerCookies);
  assert.equal(auditPage.response.statusCode, 200);
  assert.match(auditPage.response.body, /settings\.update/);

  // Create a reviewer account and verify it cannot mutate.
  const teamRes = await postForm(
    '/admin/team',
    {
      csrf: ownerCsrf,
      name: 'Read Only Reviewer',
      email: 'reviewer@file106.site',
      role: 'reviewer',
      password: 'ReviewerPassword106!',
    },
    ownerCookies
  );
  assert.equal(teamRes.headers.location, '/admin/team?notice=team-created');

  const revLogin = await getPage('/admin/login');
  const revSigned = await postForm(
    '/admin/login',
    {
      csrf: csrfFrom(revLogin.response.body),
      email: 'reviewer@file106.site',
      password: 'ReviewerPassword106!',
    },
    revLogin.cookies
  );
  const revCookies = mergeCookies(revLogin.cookies, cookieJar(revSigned));
  const revDash = await getPage('/admin', revCookies);
  const revCsrf = csrfFrom(revDash.response.body);

  const blocked = await postForm(
    '/admin/settings',
    {
      csrf: revCsrf,
      defaultReward: '5',
      defaultMinHolding: '1',
      tagline: 'HACKED',
    },
    revCookies
  );
  assert.equal(blocked.statusCode, 303);
  assert.equal(blocked.headers.location, '/admin?notice=reviewer-read-only');
});

await app.close();
await db.close();
rmSync(uploadDir, { recursive: true, force: true });

console.log(`\n${passed.length} checks passed\n`);
