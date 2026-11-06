// Control Room routes: first-run setup, puzzle index, investigators, archive
// settings, full audit log, team management, cover image toggle, and the
// BTC / ETH / BNB / CONNECTION investigation helpers.

import { randomBytes } from 'node:crypto';
import { hashSecret } from '../../scripts/archive/secret-hash.mjs';
import { ipHash } from '../lib/ip.js';
import { redirect, sendPage } from '../lib/reply.js';
import {
  SETTING_KEYS,
  messageText,
  normalizeText,
  validateSettingInput,
} from '../lib/validate.js';
import {
  adminAuditPage,
  adminInvestigatorDetailPage,
  adminInvestigatorsPage,
  adminPuzzlesPage,
  adminSettingsPage,
  adminSetupPage,
  adminTeamPage,
} from '../views/controlRoom.js';

const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Prepares the three fictional network investigations (FILE_010, FILE_011,
// FILE_012) as drafts if they do not already exist. Never publishes them
// automatically, and never overwrites an existing file.
export async function ensureNetworkInvestigations(db, adminId = null) {
  const drafts = [
    {
      number: 10,
      slug: 'file-010-btc-the-first-signal',
      title: 'BTC / THE FIRST SIGNAL',
      subtitle: 'GENESIS TIMESTAMP ANOMALY',
      classification: 'RESTRICTED',
      fileType: 'puzzle',
      teaser:
        'Fictional mystery investigation inspired by the Genesis block timestamp and early relay transmissions. No official affiliation with Bitcoin.',
      briefing:
        'FICTIONAL ARCHIVE INVESTIGATION — NOT AFFILIATED WITH OR ENDORSED BY BITCOIN.\n\n' +
        'After Project105 was terminated, an unindexed relay echoed a 2009 headline fragment alongside the 8_* marker. ' +
        'Inspect the recovered ledger header and identify the Genesis signal coordinate.',
      loreBody:
        'RELAY LOG // NODE-00\nTIMESTAMP: 03/Jan/2009\nSIGNAL MARKER: [[SYMBOL:1]]\nREDACTED HEADER: [[REDACT:2]]\n' +
        'NOTE: Verify the block zero reference before unsealing the next layer.',
    },
    {
      number: 11,
      slug: 'file-011-eth-the-second-layer',
      title: 'ETH / THE SECOND LAYER',
      subtitle: 'STATE TRANSITION ECHO',
      classification: 'CONFIDENTIAL',
      fileType: 'encrypted',
      teaser:
        'Fictional mystery investigation inspired by programmable state machines and contract storage slots. No official affiliation with Ethereum.',
      briefing:
        'FICTIONAL ARCHIVE INVESTIGATION — NOT AFFILIATED WITH OR ENDORSED BY ETHEREUM.\n\n' +
        'A dormant bytecode sequence in the second layer mirrors the termination hash from Project105. ' +
        'Trace the state root transition to recover the execution key.',
      loreBody:
        'STATE DUMP // SLOT 0x106\nCALLDATA FRAGMENT: [[SYMBOL:2]]\nSTORAGE OVERRIDE: [[REDACT:3]]\n' +
        'NOTE: The second layer remembers what the first layer only anchored.',
    },
    {
      number: 12,
      slug: 'file-012-bnb-the-hidden-route',
      title: 'BNB / THE HIDDEN ROUTE',
      subtitle: 'CROSS-RELAY CORRIDOR',
      classification: 'SECRET',
      fileType: 'transmission',
      teaser:
        'Fictional mystery investigation inspired by high-throughput validator corridors and bridge relays. No official affiliation with BNB.',
      briefing:
        'FICTIONAL ARCHIVE INVESTIGATION — NOT AFFILIATED WITH OR ENDORSED BY BNB.\n\n' +
        'The third transmission hopped across validator relays before going dark. ' +
        'Reconstruct the hidden route to prepare for FILE 013 — THE CONNECTION.',
      loreBody:
        'CORRIDOR TRACE // HOP 03\nVALIDATOR RELAY: [[SYMBOL:3]]\nROUTE CHECKSUM: [[REDACT:4]]\n' +
        'NOTE: When 010, 011, and 012 converge, the fourth record unlocks.',
    },
  ];

  for (const item of drafts) {
    await db.query(
      `insert into files
         (file_number, slug, title, subtitle, file_type, sort_order,
          teaser, briefing, lore_body, classification, difficulty,
          status, is_mystery, reward_amount_f106, min_holding_f106,
          winner_method, created_by)
       values ($1, $2, $3, $4, $5, $1, $6, $7, $8, $9, 'hard',
               'draft', true, 1.00000000, 1.00000000, 'first_correct', $10)
       on conflict (file_number) do nothing`,
      [
        item.number,
        item.slug,
        item.title,
        item.subtitle,
        item.fileType,
        item.teaser,
        item.briefing,
        item.loreBody,
        item.classification,
        adminId,
      ]
    );
  }
}

export async function registerControlRoomRoutes(app, { db, config, withCsrf, audit }) {
  // -------------------------------------------------------------------
  // First-run setup (/admin/setup) — only active when zero active admins exist
  // -------------------------------------------------------------------
  async function hasActiveAdmin() {
    const count = await db.value(
      'select count(*)::int as v from admin_users where is_active = true'
    );
    return Number(count) > 0;
  }

  app.get('/admin/setup', async (request, reply) => {
    if (await hasActiveAdmin()) {
      return redirect(reply, '/admin/login?notice=setup-unavailable');
    }
    return sendPage(reply, adminSetupPage({ session: request.session }));
  });

  app.post(
    '/admin/setup',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      if (await hasActiveAdmin()) {
        return redirect(reply, '/admin/login?notice=setup-unavailable');
      }

      const body = request.body || {};
      const name = normalizeText(body.name) || 'The Archivist';
      const email = normalizeText(body.email).toLowerCase();
      const password = String(body.password ?? '');
      const errors = {};

      if (!name || name.length > 80) errors.name = 'Enter a display name under 80 characters.';
      if (!email || !EMAIL.test(email)) errors.email = 'Enter a valid email address.';
      if (password.length < 12) errors.password = 'Use at least 12 characters.';

      if (Object.keys(errors).length > 0) {
        return sendPage(
          reply,
          adminSetupPage({ session: request.session, errors, values: { name, email } }),
          400
        );
      }

      const created = await db.one(
        `insert into admin_users (email, display_name, password_hash, role, is_active)
         values ($1, $2, $3, 'owner', true)
         on conflict (email) do update
            set display_name = excluded.display_name,
                password_hash = excluded.password_hash,
                role = 'owner',
                is_active = true
         returning id, email`,
        [email, name, hashSecret(password)]
      );

      await audit(db, {
        adminId: created.id,
        action: 'admin.bootstrap_setup',
        entity: 'admin_users',
        entityId: created.id,
        after: { email: created.email, role: 'owner' },
        ip: ipHash(request),
      });

      await ensureNetworkInvestigations(db, created.id);
      return redirect(reply, '/admin/login?notice=setup-done');
    }
  );

  // -------------------------------------------------------------------
  // BTC / ETH / BNB & FILE_013 quick-initialize helpers
  // -------------------------------------------------------------------
  app.post('/admin/files/init-network-pack', async (request, reply) => {
    await ensureNetworkInvestigations(db, request.admin.id);
    await audit(db, {
      adminId: request.admin.id,
      action: 'file.init_network_pack',
      entity: 'files',
      after: { files: [10, 11, 12] },
      ip: ipHash(request),
    });
    return redirect(reply, '/admin/files?notice=file-created');
  });

  app.post('/admin/files/init-013', async (request, reply) => {
    const existing = await db.one('select id from files where file_number = 13');
    if (existing) {
      return redirect(reply, `/admin/files/${existing.id}`);
    }

    const file13 = await db.one(
      `insert into files
         (file_number, slug, title, subtitle, file_type, sort_order,
          teaser, briefing, lore_body, classification, difficulty,
          status, is_mystery, required_file_number,
          reward_amount_f106, min_holding_f106, winner_method, created_by)
       values (13, 'file-013-the-connection', 'THE CONNECTION',
               'TRI-NETWORK CONVERGENCE', 'classified', 13,
               'The fourth record. Requires successful completion of FILE 010, FILE 011, and FILE 012.',
               'FICTIONAL ARCHIVE INVESTIGATION — CONVERGENCE RECORD.\n\n' ||
               'The signals from FILE 010 (BTC), FILE 011 (ETH), and FILE 012 (BNB) point to a single origin inside the terminated Project105 vault. Combine all three recovered keys to seal the connection.',
               'CONVERGENCE TERMINAL // 010 + 011 + 012 -> 013\nORIGIN MARKER: [[SYMBOL:4]]\nFINAL SEAL: [[REDACT:5]]',
               'OMEGA // CLASSIFIED', 'brutal', 'draft', true, 12,
               3.00000000, 1.00000000, 'first_correct', $1)
       returning id`,
      [request.admin.id]
    );

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.create_013',
      entity: 'files',
      entityId: file13.id,
      after: { fileNumber: 13, requiredFiles: [10, 11, 12], status: 'draft' },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file13.id}?notice=file-created`);
  });

  // -------------------------------------------------------------------
  // Cover image toggle on a file attachment
  // -------------------------------------------------------------------
  app.post('/admin/files/:id/attachments/:attachmentId/cover', async (request, reply) => {
    if (!UUID.test(request.params.id) || !UUID.test(request.params.attachmentId)) {
      return redirect(reply, '/admin/files?notice=file-unknown');
    }

    const attachment = await db.one(
      `select id, file_id, kind, filename from file_attachments
        where id = $1 and file_id = $2`,
      [request.params.attachmentId, request.params.id]
    );
    if (!attachment || attachment.kind !== 'image') {
      return redirect(reply, `/admin/files/${request.params.id}?notice=form-invalid`);
    }

    await db.transaction(async (tx) => {
      await tx.query('update file_attachments set is_public = true where id = $1', [attachment.id]);
      await tx.query('update files set cover_attachment_id = $2 where id = $1', [
        attachment.file_id,
        attachment.id,
      ]);
    });

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.cover_set',
      entity: 'files',
      entityId: attachment.file_id,
      after: { attachmentId: attachment.id, filename: attachment.filename },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${attachment.file_id}?notice=file-saved`);
  });

  // -------------------------------------------------------------------
  // Puzzles index (/admin/puzzles)
  // -------------------------------------------------------------------
  app.get('/admin/puzzles', async (request, reply) => {
    const puzzles = await db.many(
      `select c.id, c.file_id, c.position, c.prompt, c.answer_format, c.puzzle_type,
              c.case_sensitive, c.max_attempts, c.updated_at,
              f.file_number, f.title, f.slug,
              (select count(*)::int from challenge_answers a where a.challenge_id = c.id) as alternates,
              (select count(*)::int from submissions s where s.challenge_id = c.id) as submissions
         from challenges c
         join files f on f.id = c.file_id
        order by f.file_number asc, c.position asc`
    );

    return sendPage(
      reply,
      adminPuzzlesPage({
        admin: withCsrf(request),
        puzzles,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // Investigators (/admin/investigators & /admin/investigators/:id)
  // -------------------------------------------------------------------
  app.get('/admin/investigators', async (request, reply) => {
    const q = normalizeText(request.query?.q).slice(0, 100);
    const like = q ? `%${q.toLowerCase()}%` : null;
    const statusRaw = normalizeText(request.query?.status);
    const status = ['active', 'pending_verification', 'suspended'].includes(statusRaw)
      ? statusRaw
      : null;

    const users = await db.many(
      `select u.id, u.username, u.email, u.status, u.created_at,
              (select w.address from user_wallets w where w.user_id = u.id and w.is_primary = true limit 1) as wallet,
              (select count(*)::int from user_clue_discoveries d where d.user_id = u.id) as clues,
              (select count(*)::int from file_unlocks f where f.user_id = u.id) as unlocks,
              (select count(*)::int from submissions s where s.user_id = u.id) as submissions,
              (select count(*)::int from winners w where w.user_id = u.id and w.status = 'approved') as wins,
              (select coalesce(sum(r.amount_f106), 0)::text from rewards r
                where r.user_id = u.id and r.payment_status = 'confirmed') as confirmed
         from users u
        where u.status <> 'deleted'
          and ($1::text is null or u.status = $1)
          and ($2::text is null or lower(u.username) like $2 or lower(u.email) like $2
               or exists (select 1 from user_wallets w where w.user_id = u.id and lower(w.address) like $2))
        order by u.created_at desc
        limit 200`,
      [status, like]
    );

    return sendPage(
      reply,
      adminInvestigatorsPage({
        admin: withCsrf(request),
        users,
        q,
        status: status ?? '',
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/investigators/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) {
      return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    }

    const user = await db.one(
      'select id, username, email, status, created_at, email_verified_at, last_login_at from users where id = $1',
      [request.params.id]
    );
    if (!user) return redirect(reply, '/admin/investigators?notice=investigator-unknown');

    const wallets = await db.many(
      'select address, is_primary, first_seen_balance_f106::text as first_seen_balance_f106, verified_at from user_wallets where user_id = $1 order by is_primary desc',
      [user.id]
    );
    const unlocks = await db.many(
      `select fu.unlock_method, fu.unlocked_at, f.file_number, f.title
         from file_unlocks fu join files f on f.id = fu.file_id
        where fu.user_id = $1 order by fu.unlocked_at desc`,
      [user.id]
    );
    const clues = await db.many(
      `select c.clue_no, c.title, d.discovered_at
         from user_clue_discoveries d join clues c on c.id = d.clue_id
        where d.user_id = $1 order by d.discovered_at desc`,
      [user.id]
    );
    const submissions = await db.many(
      `select s.id, s.attempt_no, s.status, s.submitted_at,
              s.holding_snapshot_f106::text as holding_snapshot,
              f.file_number, f.title
         from submissions s join files f on f.id = s.file_id
        where s.user_id = $1 order by s.submitted_at desc limit 100`,
      [user.id]
    );
    const rewards = await db.many(
      `select r.id, r.reward_no, r.file_number, r.amount_f106::text as amount,
              r.payment_status, tx.signature
         from rewards r
         left join transactions tx on tx.id = r.confirmed_transaction_id
        where r.user_id = $1 order by r.approved_at desc`,
      [user.id]
    );

    return sendPage(
      reply,
      adminInvestigatorDetailPage({
        admin: withCsrf(request),
        user,
        wallets,
        unlocks,
        clues,
        submissions,
        rewards,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/investigators/:id/suspend', async (request, reply) => {
    if (!UUID.test(request.params.id)) {
      return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    }
    const before = await db.one('select id, username, status from users where id = $1', [
      request.params.id,
    ]);
    if (!before) return redirect(reply, '/admin/investigators?notice=investigator-unknown');

    await db.query("update users set status = 'suspended' where id = $1", [before.id]);
    await db.query('delete from sessions where user_id = $1', [before.id]);

    await audit(db, {
      adminId: request.admin.id,
      action: 'investigator.suspend',
      entity: 'users',
      entityId: before.id,
      before: { status: before.status },
      after: { status: 'suspended' },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/investigators/${before.id}?notice=investigator-suspended`);
  });

  app.post('/admin/investigators/:id/activate', async (request, reply) => {
    if (!UUID.test(request.params.id)) {
      return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    }
    const before = await db.one('select id, username, status from users where id = $1', [
      request.params.id,
    ]);
    if (!before) return redirect(reply, '/admin/investigators?notice=investigator-unknown');

    await db.query("update users set status = 'active' where id = $1", [before.id]);

    await audit(db, {
      adminId: request.admin.id,
      action: 'investigator.activate',
      entity: 'users',
      entityId: before.id,
      before: { status: before.status },
      after: { status: 'active' },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/investigators/${before.id}?notice=investigator-activated`);
  });

  // -------------------------------------------------------------------
  // Ban / unban / soft-delete: block access without destroying history.
  // -------------------------------------------------------------------
  app.post('/admin/investigators/:id/ban', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    const before = await db.one('select id, username, status from users where id = $1', [request.params.id]);
    if (!before) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    await db.query("update users set status = 'banned' where id = $1", [before.id]);
    await db.query('delete from sessions where user_id = $1', [before.id]);
    await audit(db, { adminId: request.admin.id, action: 'investigator.ban', entity: 'users', entityId: before.id, before: { status: before.status }, after: { status: 'banned' }, ip: ipHash(request) });
    return redirect(reply, `/admin/investigators/${before.id}?notice=investigator-banned`);
  });

  app.post('/admin/investigators/:id/unban', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    const before = await db.one('select id, username, status from users where id = $1', [request.params.id]);
    if (!before) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    await db.query("update users set status = 'active' where id = $1", [before.id]);
    await audit(db, { adminId: request.admin.id, action: 'investigator.unban', entity: 'users', entityId: before.id, before: { status: before.status }, after: { status: 'active' }, ip: ipHash(request) });
    return redirect(reply, `/admin/investigators/${before.id}?notice=investigator-unbanned`);
  });

  app.post('/admin/investigators/:id/delete', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    const before = await db.one('select id, username, status from users where id = $1', [request.params.id]);
    if (!before) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    // Soft delete: keep the row so submissions/rewards stay auditable.
    await db.query("update users set status = 'deleted' where id = $1", [before.id]);
    await db.query('delete from sessions where user_id = $1', [before.id]);
    await audit(db, { adminId: request.admin.id, action: 'investigator.delete', entity: 'users', entityId: before.id, before: { status: before.status }, after: { status: 'deleted' }, ip: ipHash(request) });
    return redirect(reply, `/admin/investigators/${before.id}?notice=investigator-deleted`);
  });

  // -------------------------------------------------------------------
  // Promote a participant to an archivist: create an admin_users row with a
  // temporary password and show it once. Promote and reset-password render the
  // detail page directly so the temporary password can be displayed safely.
  // -------------------------------------------------------------------
  function tempPassword() {
    return 'Rst' + randomBytes(6).toString('hex');
  }

  app.post('/admin/investigators/:id/promote', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    const user = await db.one(
      'select id, username, email from users where id = $1',
      [request.params.id]
    );
    if (!user) return redirect(reply, '/admin/investigators?notice=investigator-unknown');

    const existing = await db.one('select id from admin_users where email = $1', [user.email]);
    if (existing) {
      return redirect(reply, `/admin/investigators/${user.id}?notice=investigator-already-archivist`);
    }

    const password = tempPassword();
    await db.query(
      `insert into admin_users (email, display_name, password_hash, role)
       values ($1, $2, $3, 'admin')`,
      [user.email, user.username, hashSecret(password)]
    );
    await audit(db, {
      adminId: request.admin.id,
      action: 'investigator.promote',
      entity: 'users',
      entityId: user.id,
      after: { role: 'admin', email: user.email },
      ip: ipHash(request),
    });

    // Render the detail page with the temporary password shown once.
    const u = await db.one(
      'select id, username, email, status, created_at, email_verified_at, last_login_at from users where id = $1',
      [user.id]
    );
    const wallets = await db.many('select address, is_primary, first_seen_balance_f106::text as first_seen_balance_f106, verified_at from user_wallets where user_id = $1 order by is_primary desc', [user.id]);
    const unlocks = await db.many(`select fu.unlock_method, fu.unlocked_at, f.file_number, f.title from file_unlocks fu join files f on f.id = fu.file_id where fu.user_id = $1 order by fu.unlocked_at desc`, [user.id]);
    const clues = await db.many(`select c.clue_no, c.title, d.discovered_at from user_clue_discoveries d join clues c on c.id = d.clue_id where d.user_id = $1 order by d.discovered_at desc`, [user.id]);
    const submissions = await db.many(`select s.id, s.attempt_no, s.status, s.submitted_at, s.holding_snapshot_f106::text as holding_snapshot, f.file_number, f.title from submissions s join files f on f.id = s.file_id where s.user_id = $1 order by s.submitted_at desc limit 100`, [user.id]);
    const rewards = await db.many(`select r.id, r.reward_no, r.file_number, r.amount_f106::text as amount, r.payment_status, tx.signature from rewards r left join transactions tx on tx.id = r.confirmed_transaction_id where r.user_id = $1 order by r.approved_at desc`, [user.id]);

    return sendPage(
      reply,
      adminInvestigatorDetailPage({
        admin: withCsrf(request),
        user: u,
        wallets,
        unlocks,
        clues,
        submissions,
        rewards,
        tempPassword: password,
        message: messageText('investigator-promoted'),
      })
    );
  });

  app.post('/admin/investigators/:id/reset-password', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/investigators?notice=investigator-unknown');
    const user = await db.one('select id, username, email from users where id = $1', [request.params.id]);
    if (!user) return redirect(reply, '/admin/investigators?notice=investigator-unknown');

    const password = tempPassword();
    await db.query('update users set password_hash = $2 where id = $1', [user.id, hashSecret(password)]);
    await db.query('delete from sessions where user_id = $1', [user.id]);
    await audit(db, { adminId: request.admin.id, action: 'investigator.reset_password', entity: 'users', entityId: user.id, after: { reset: true }, ip: ipHash(request) });

    const u = await db.one('select id, username, email, status, created_at, email_verified_at, last_login_at from users where id = $1', [user.id]);
    const wallets = await db.many('select address, is_primary, first_seen_balance_f106::text as first_seen_balance_f106, verified_at from user_wallets where user_id = $1 order by is_primary desc', [user.id]);
    const unlocks = await db.many(`select fu.unlock_method, fu.unlocked_at, f.file_number, f.title from file_unlocks fu join files f on f.id = fu.file_id where fu.user_id = $1 order by fu.unlocked_at desc`, [user.id]);
    const clues = await db.many(`select c.clue_no, c.title, d.discovered_at from user_clue_discoveries d join clues c on c.id = d.clue_id where d.user_id = $1 order by d.discovered_at desc`, [user.id]);
    const submissions = await db.many(`select s.id, s.attempt_no, s.status, s.submitted_at, s.holding_snapshot_f106::text as holding_snapshot, f.file_number, f.title from submissions s join files f on f.id = s.file_id where s.user_id = $1 order by s.submitted_at desc limit 100`, [user.id]);
    const rewards = await db.many(`select r.id, r.reward_no, r.file_number, r.amount_f106::text as amount, r.payment_status, tx.signature from rewards r left join transactions tx on tx.id = r.confirmed_transaction_id where r.user_id = $1 order by r.approved_at desc`, [user.id]);

    return sendPage(
      reply,
      adminInvestigatorDetailPage({
        admin: withCsrf(request),
        user: u,
        wallets,
        unlocks,
        clues,
        submissions,
        rewards,
        tempPassword: password,
        message: messageText('investigator-password-reset'),
      })
    );
  });

  // -------------------------------------------------------------------
  // Archive settings (/admin/settings)
  // -------------------------------------------------------------------
  async function loadSettingsMap() {
    const rows = await db.many(
      'select key, value from settings where key = any($1::text[])',
      [Object.keys(SETTING_KEYS)]
    );
    const map = {};
    for (const row of rows) map[row.key] = row.value;
    return map;
  }

  app.get('/admin/settings', async (request, reply) => {
    const settings = await loadSettingsMap();
    return sendPage(
      reply,
      adminSettingsPage({
        admin: withCsrf(request),
        settings,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/settings', async (request, reply) => {
    const body = request.body || {};
    const pairs = [
      ['archive.default_reward', body.defaultReward],
      ['archive.default_min_holding', body.defaultMinHolding],
      ['archive.tagline', body.tagline],
      ['archive.maintenance_banner', body.maintenanceBanner ? 'true' : ''],
    ];

    const errors = {};
    const validated = {};
    for (const [key, rawValue] of pairs) {
      const res = validateSettingInput(key, rawValue);
      if (res.error) errors[key] = res.error;
      else validated[key] = res.value;
    }

    if (Object.keys(errors).length > 0) {
      const settings = await loadSettingsMap();
      return sendPage(
        reply,
        adminSettingsPage({
          admin: withCsrf(request),
          settings,
          errors,
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    for (const [key, val] of Object.entries(validated)) {
      await db.query(
        `insert into settings (key, value, updated_by, updated_at)
         values ($1, $2::jsonb, $3, now())
         on conflict (key) do update
            set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, JSON.stringify(val), request.admin.id]
      );
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'settings.update',
      entity: 'settings',
      after: validated,
      ip: ipHash(request),
    });

    return redirect(reply, '/admin/settings?notice=settings-saved');
  });

  // -------------------------------------------------------------------
  // Full Audit Log (/admin/audit)
  // -------------------------------------------------------------------
  app.get('/admin/audit', async (request, reply) => {
    const actionFilter = normalizeText(request.query?.action).slice(0, 80);
    const actionsRows = await db.many(
      'select distinct action from admin_audit_logs order by action asc'
    );
    const actions = actionsRows.map((r) => r.action);

    const logs = await db.many(
      `select l.id, l.action, l.entity, l.entity_id, l.before_state, l.after_state,
              l.created_at, a.email as admin_email
         from admin_audit_logs l
         left join admin_users a on a.id = l.admin_id
        where ($1::text = '' or l.action = $1)
        order by l.created_at desc, l.id desc
        limit 250`,
      [actionFilter]
    );

    return sendPage(
      reply,
      adminAuditPage({
        admin: withCsrf(request),
        logs,
        actionFilter,
        actions,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // Team management (/admin/team — owner role required for mutations)
  // -------------------------------------------------------------------
  app.get('/admin/team', async (request, reply) => {
    const members = await db.many(
      'select id, email, display_name, role, is_active, last_login_at, created_at from admin_users order by created_at asc'
    );
    return sendPage(
      reply,
      adminTeamPage({
        admin: withCsrf(request),
        members,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/team', async (request, reply) => {
    if (request.admin.role !== 'owner') {
      return redirect(reply, '/admin/team?notice=team-owner-required');
    }

    const body = request.body || {};
    const name = normalizeText(body.name);
    const email = normalizeText(body.email).toLowerCase();
    const role = ['owner', 'admin', 'reviewer'].includes(body.role) ? body.role : 'admin';
    const password = String(body.password ?? '');
    const errors = {};

    if (!name || name.length > 80) errors.name = 'Enter a display name.';
    if (!email || !EMAIL.test(email)) errors.email = 'Enter a valid email address.';
    if (password.length < 12) errors.password = 'Use at least 12 characters.';

    if (Object.keys(errors).length > 0) {
      const members = await db.many(
        'select id, email, display_name, role, is_active, last_login_at, created_at from admin_users order by created_at asc'
      );
      return sendPage(
        reply,
        adminTeamPage({
          admin: withCsrf(request),
          members,
          errors,
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    const member = await db.one(
      `insert into admin_users (email, display_name, password_hash, role, is_active)
       values ($1, $2, $3, $4, true)
       on conflict (email) do update
          set display_name = excluded.display_name,
              password_hash = excluded.password_hash,
              role = excluded.role,
              is_active = true
       returning id, email, role`,
      [email, name, hashSecret(password), role]
    );

    await audit(db, {
      adminId: request.admin.id,
      action: 'admin.team_upsert',
      entity: 'admin_users',
      entityId: member.id,
      after: { email: member.email, role: member.role },
      ip: ipHash(request),
    });

    return redirect(reply, '/admin/team?notice=team-created');
  });

  app.post('/admin/team/:id/toggle', async (request, reply) => {
    if (request.admin.role !== 'owner') {
      return redirect(reply, '/admin/team?notice=team-owner-required');
    }
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/team');

    const target = await db.one(
      'select id, email, role, is_active from admin_users where id = $1',
      [request.params.id]
    );
    if (!target) return redirect(reply, '/admin/team');

    if (target.is_active && target.role === 'owner') {
      const activeOwners = await db.value(
        "select count(*)::int as v from admin_users where role = 'owner' and is_active = true"
      );
      if (Number(activeOwners) <= 1) {
        return redirect(reply, '/admin/team?notice=team-blocked');
      }
    }

    const nextActive = !target.is_active;
    await db.query('update admin_users set is_active = $2 where id = $1', [target.id, nextActive]);
    if (!nextActive) {
      await db.query('delete from sessions where admin_id = $1', [target.id]);
    }

    await audit(db, {
      adminId: request.admin.id,
      action: nextActive ? 'admin.enable' : 'admin.disable',
      entity: 'admin_users',
      entityId: target.id,
      before: { isActive: target.is_active },
      after: { isActive: nextActive },
      ip: ipHash(request),
    });

    return redirect(reply, '/admin/team?notice=team-updated');
  });
}
