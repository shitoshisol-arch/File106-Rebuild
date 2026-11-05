// The archivist terminal: staff sign-in, the file manager, sealed answers, and
// private attachments.
//
// Three properties are enforced here rather than trusted:
//
//   * A participant session is not an admin session. The guard below rejects
//     anything under /admin or /api/admin before a handler runs, and it runs at
//     onRequest so an expired session is sent to the sign-in page rather than
//     being reported as a CSRF failure.
//   * An answer reaches the database as a scrypt hash and leaves this file only
//     as a hash. It is not logged, not audited, and not returned to any view.
//   * Every mutation writes an audit row, including the state before the change.
//     The audit table is append-only by trigger, so that record cannot be tidied
//     up afterwards.

import { hashSecret, verifySecret } from '../../scripts/archive/secret-hash.mjs';
import { hashChallengeAnswer } from '../lib/answers.js';
import { csrfToken } from '../lib/csrf.js';
import { dateTimeInput } from '../lib/format.js';
import { ipHash } from '../lib/ip.js';
import { redirect, sendPage } from '../lib/reply.js';
import { destroySession, regenerateSession, saveSession } from '../lib/session.js';
import {
  FILE_STATUSES,
  messageText,
  validateChallengeInput,
  validateFileInput,
  validateLogin,
  validateRequirementInput,
} from '../lib/validate.js';
import {
  adminFileEditorPage,
  adminFilesPage,
  adminLoginPage,
  adminOverviewPage,
} from '../views/admin.js';
import { adminFilePreviewPage } from '../views/controlRoom.js';
import { registerControlRoomRoutes } from './controlRoom.js';
import { registerMysteryAdminRoutes } from './adminMystery.js';
import { registerRequirementAdminRoutes } from './adminRequirements.js';

// A hash is always compared, even for an address that does not exist, so the
// response time cannot be used to enumerate archivists.
const DUMMY_HASH = hashSecret('archivist-timing-equaliser');

const LOGIN_LIMIT = { max: 6, timeWindow: '5 minutes' };

const STATUS_SQL = `case when $2::text = 'archived' then now() else archived_at end`;

function audit(db, { adminId, action, entity, entityId = null, before = null, after = null, ip }) {
  return db.query(
    `insert into admin_audit_logs (admin_id, action, entity, entity_id, before_state, after_state, ip_hash)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      adminId,
      action,
      entity,
      entityId === null ? null : String(entityId),
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      ip ?? null,
    ]
  );
}

// Only the fields worth reviewing later; never the answer, never a storage key.
const fileSnapshot = (row) => ({
  fileNumber: row.file_number,
  slug: row.slug,
  title: row.title,
  difficulty: row.difficulty,
  status: row.status,
  reward: row.reward_amount_f106,
  minHolding: row.min_holding_f106,
  winnerMethod: row.winner_method,
  opensAt: row.opens_at,
  closesAt: row.closes_at,
  classification: row.classification,
  chapterNo: row.chapter_no,
  mysteryOrder: row.mystery_order,
  isMystery: row.is_mystery,
  hasUnlockCode: row.has_unlock_code,
  fileType: row.file_type,
  sortOrder: row.sort_order,
});

function editorValues(file, overrides = {}) {
  if (!file) {
    return {
      difficulty: 'medium',
      winnerMethod: 'first_correct',
      reward: '',
      minHolding: '',
      classification: 'UNCLASSIFIED',
      fileType: 'story',
      ...overrides,
    };
  }

  return {
    fileNumber: file.file_number,
    slug: file.slug,
    title: file.title,
    subtitle: file.subtitle ?? '',
    teaser: file.teaser,
    briefing: file.briefing ?? '',
    difficulty: file.difficulty,
    winnerMethod: file.winner_method,
    reward: file.reward_amount_f106,
    minHolding: file.min_holding_f106,
    maxWinners: file.max_winners ?? '',
    opensAt: dateTimeInput(file.opens_at),
    closesAt: dateTimeInput(file.closes_at),
    classification: file.classification ?? '',
    loreBody: file.lore_body ?? '',
    chapterNo: file.chapter_no ?? '',
    mysteryOrder: file.mystery_order ?? '',
    unlockHint: file.unlock_hint ?? '',
    requiredFileNumber: file.required_file_number ?? '',
    unlockRequiresClue: file.unlock_requires_clue ?? '',
    hasUnlockCode: Boolean(file.has_unlock_code),
    isMystery: Boolean(file.is_mystery),
    fileType: file.file_type ?? 'story',
    sortOrder: file.sort_order ?? '',
    requiresRegistration: file.requires_registration ?? true,
    requiresWallet: file.requires_wallet ?? true,
    rewardsEnabled: file.rewards_enabled ?? true,
    ...overrides,
  };
}

function safeFilename(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f"]/g, '').trim().slice(0, 180);
  return cleaned || 'attachment';
}

async function loadFile(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  // Explicit columns: unlock_code_hash is never fetched into a page. The
  // boolean tells the editor whether a code is already set.
  return db.one(
    `select id, file_number, slug, title, subtitle, teaser, briefing, difficulty, status,
            is_enabled, reward_amount_f106, min_holding_f106, winner_method,
            max_winners, opens_at, closes_at, archived_at, created_by,
            created_at, updated_at, chapter_no, classification, lore_body,
            unlock_hint, required_file_number, unlock_requires_clue,
            is_mystery, mystery_order, file_type, sort_order,
            requires_registration, requires_wallet, rewards_enabled,
            cover_attachment_id,
            (unlock_code_hash is not null) as has_unlock_code
       from files
      where id = $1`,
    [id]
  );
}

export async function adminRoutes(app, { db, config, uploads, balanceReader, transactionVerifier = null }) {
  // Scoped to this plugin: only the upload route accepts a raw body, and it
  // accepts only the types an exhibit may have.
  app.addContentTypeParser(
    config.uploads.allowedMime,
    { parseAs: 'buffer', bodyLimit: config.uploads.maxBytes },
    (request, payload, done) => done(null, payload)
  );

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];
    if (!url.startsWith('/admin') && !url.startsWith('/api/admin/')) return;
    if (url === '/admin/login') return;
    // The first-run screen is itself the guard: it only operates when no
    // active owner exists, and it locks itself permanently afterwards.
    if (url === '/admin/setup') return;
    if (request.admin) {
      // Reviewers read but do not write: every mutating verb is refused for
      // them, in HTML and API shapes alike. Sign-out stays reachable so a
      // reviewer is never trapped in a session.
      const mutating = request.method !== 'GET' && request.method !== 'HEAD' && url !== '/admin/logout';
      if (mutating && request.admin.role === 'reviewer') {
        if (url.startsWith('/api/')) {
          return reply.code(403).send({ error: 'read_only', message: 'Reviewer accounts cannot change the archive.' });
        }
        return redirect(reply, '/admin?notice=reviewer-read-only');
      }
      return;
    }

    if (url.startsWith('/api/')) {
      return reply.code(401).send({ error: 'admin_required', message: 'Archivist sign-in required.' });
    }
    return redirect(reply, '/admin/login?notice=admin-required');
  });

  const withCsrf = (request) => ({ ...request.admin, csrf: csrfToken(request.session) });

  // -------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------
  app.get('/admin/login', async (request, reply) => {
    if (request.admin) return redirect(reply, '/admin');
    return sendPage(
      reply,
      adminLoginPage({
        session: request.session,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/login', { config: { rateLimit: LOGIN_LIMIT } }, async (request, reply) => {
    const body = request.body || {};
    const { errors, value } = validateLogin(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(reply, adminLoginPage({ session: request.session, errors, values: body }), 400);
    }

    const admin = await db.one(
      'select id, email, display_name, role, is_active, password_hash from admin_users where email = $1',
      [value.email]
    );

    const matches = verifySecret(value.password, admin?.password_hash ?? DUMMY_HASH);

    if (!admin || !matches || !admin.is_active) {
      request.log.warn({ email: value.email }, 'failed archivist sign-in');
      return sendPage(
        reply,
        adminLoginPage({
          session: request.session,
          values: { email: value.email },
          message: messageText('invalid-credentials'),
        }),
        401
      );
    }

    await regenerateSession(request.session);
    // The archivist cookie expires sooner than a participant one: this terminal
    // can seal answers and change what the public sees.
    request.session.cookie.maxAge = config.adminSessionTtlHours * 3600 * 1000;
    // A session belongs to one principal: signing in here clears any participant
    // identity rather than stacking two on one cookie.
    delete request.session.userId;
    request.session.adminId = admin.id;
    await saveSession(request.session);

    await db.query('update admin_users set last_login_at = now() where id = $1', [admin.id]);
    await audit(db, {
      adminId: admin.id,
      action: 'admin.sign_in',
      entity: 'admin_users',
      entityId: admin.id,
      ip: ipHash(request),
    });

    request.log.info({ adminId: admin.id, role: admin.role }, 'archivist sign-in');
    return redirect(reply, '/admin');
  });

  app.post('/admin/logout', async (request, reply) => {
    const adminId = request.admin?.id ?? null;
    if (adminId) {
      await audit(db, {
        adminId,
        action: 'admin.sign_out',
        entity: 'admin_users',
        entityId: adminId,
        ip: ipHash(request),
      });
    }
    await destroySession(request.session);
    return redirect(reply, '/admin/login?notice=signed-out');
  });

  // -------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------
  app.get('/admin', async (request, reply) => {
    const stats = await db.one(
      `select
         (select count(*)::int from files)                                   as files,
         (select count(*)::int from files where status = 'open')             as open,
         (select count(*)::int from files where status = 'draft')            as draft,
         (select count(*)::int from files where status = 'scheduled')        as scheduled,
         (select count(*)::int from files where status = 'locked')           as locked,
         (select count(*)::int from submissions)                             as submissions,
         (select count(*)::int from submissions where status in ('pending_review','correct')) as pending,
         (select count(*)::int from files where is_mystery)                   as mystery_files,
         (select count(*)::int from story_chapters where status = 'published') as chapters,
         (select count(*)::int from clues where is_enabled)                  as clues,
         (select count(*)::int from user_clue_discoveries)                   as discoveries,
         (select count(*)::int from users where status = 'active')           as investigators,
         (select count(*)::int from rewards where payment_status = 'awaiting_payment') as awaiting_payment,
         (select count(*)::int from rewards where payment_status = 'confirmed') as confirmed_rewards,
         (select coalesce(sum(amount_f106), 0)::text from rewards where payment_status = 'confirmed') as confirmed_total`
    );

    // FILE_013 becomes configurable only once the three network files are
    // completed. Until then the overview shows the chain state instead.
    const chainFiles = await db.many(
      `select file_number, status, title from files where file_number in (10, 11, 12) order by file_number`
    );
    const chainReady =
      chainFiles.length === 3 && chainFiles.every((row) => row.status === 'completed');
    const file13 = await db.one('select id from files where file_number = 13');

    const recent = await db.many(
      `select action, entity, entity_id, created_at
         from admin_audit_logs
        order by created_at desc, id desc
        limit 10`
    );

    return sendPage(
      reply,
      adminOverviewPage({
        admin: withCsrf(request),
        stats,
        recent,
        chainFiles,
        chainReady,
        file13,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // File manager
  // -------------------------------------------------------------------
  app.get('/admin/files', async (request, reply) => {
    const allowedStatuses = new Set(FILE_STATUSES);
    const filter = allowedStatuses.has(String(request.query?.status ?? ''))
      ? String(request.query.status)
      : null;
    // Search is matched against shaped identifiers only: never reflected raw
    // into the page, always parameterised.
    const q = String(request.query?.q ?? '').trim().slice(0, 120);
    const like = q ? `%${Number.isFinite(Number(q)) ? String(parseInt(q, 10)) : q.toLowerCase()}%` : null;

    const PAGE_SIZE = 50;
    const pageParsed = Number.parseInt(String(request.query?.page ?? '1'), 10);
    const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

    const files = await db.many(
      `select f.id, f.file_number, f.slug, f.title, f.status, f.file_type,
              f.sort_order, f.requires_registration, f.requires_wallet,
              f.rewards_enabled,
              f.reward_amount_f106::text as reward, f.updated_at,
              s.submissions_total
         from files f
         left join v_file_stats s on s.id = f.id
        where ($1::text is null or f.status = $1)
          and ($2::text is null or f.title ilike $2 or f.slug ilike $2)
        order by f.sort_order asc, f.file_number asc
        limit $3 offset $4`,
      [filter, like, PAGE_SIZE, (page - 1) * PAGE_SIZE]
    );

    const counted = await db.one(
      `select count(*)::int as total
         from files f
        where ($1::text is null or f.status = $1)
          and ($2::text is null or f.title ilike $2 or f.slug ilike $2)`,
      [filter, like]
    );

    return sendPage(
      reply,
      adminFilesPage({
        admin: withCsrf(request),
        files,
        counts: counted,
        page,
        pageSize: PAGE_SIZE,
        filter: filter ?? '',
        q,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/files/new', async (request, reply) => {
    // Owner-chosen defaults from Archive Settings become the blank form's
    // starting values; an explicitly typed value always wins.
    const defaults = await db.many(
      `select key, value from settings
        where key in ('archive.default_min_holding', 'archive.default_reward')`
    );
    const prefill = {};
    for (const row of defaults) prefill[row.key] = row.value;

    return sendPage(
      reply,
      adminFileEditorPage({
        admin: withCsrf(request),
        values: editorValues(null, {
          minHolding:
            typeof prefill['archive.default_min_holding'] === 'string'
              ? prefill['archive.default_min_holding']
              : '1',
          reward:
            typeof prefill['archive.default_reward'] === 'string'
              ? prefill['archive.default_reward']
              : '',
        }),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/files', async (request, reply) => {
    const body = request.body || {};
    const { errors, value } = validateFileInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminFileEditorPage({
          admin: withCsrf(request),
          errors,
          values: editorValues(null, body),
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    let file;
    try {
      file = await db.one(
        `insert into files
           (file_number, slug, title, subtitle, file_type, sort_order,
            requires_registration, requires_wallet, rewards_enabled,
            teaser, briefing, difficulty, status,
            reward_amount_f106, min_holding_f106, winner_method, max_winners,
            opens_at, closes_at, classification, lore_body, chapter_no,
            mystery_order, unlock_hint, required_file_number, unlock_requires_clue,
            is_mystery, unlock_code_hash, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 $10, $11, $12, 'draft', $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
         returning id, file_number, slug`,
        [
          value.fileNumber,
          value.slug,
          value.title,
          value.subtitle || '',
          value.fileType,
          value.sortOrder ?? value.fileNumber,
          value.requiresRegistration,
          value.requiresWallet,
          value.rewardsEnabled,
          value.teaser,
          value.briefing || null,
          value.difficulty,
          value.reward,
          value.minHolding,
          value.winnerMethod,
          value.maxWinners,
          value.opensAt,
          value.closesAt,
          value.classification,
          value.loreBody || null,
          value.chapterNo,
          value.mysteryOrder,
          value.unlockHint || null,
          value.requiredFileNumber,
          value.unlockRequiresClue,
          value.isMystery,
          value.unlockCode ? hashSecret(value.unlockCode.normalize('NFKC')) : null,
          request.admin.id,
        ]
      );
    } catch (error) {
      // 23505 is a unique violation: either the number or the slug is taken.
      if (error.code === '23505') {
        return sendPage(
          reply,
          adminFileEditorPage({
            admin: withCsrf(request),
            errors: { submit: 'That file number or slug is already in use.' },
            values: editorValues(null, body),
            message: messageText('form-invalid'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.create',
      entity: 'files',
      entityId: file.id,
      after: { fileNumber: file.file_number, slug: file.slug, title: value.title, status: 'draft' },
      ip: ipHash(request),
    });

    request.log.info({ fileId: file.id }, 'file created');
    return redirect(reply, `/admin/files/${file.id}?notice=file-created`);
  });

  app.get('/admin/files/:id', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    // answer_hash is deliberately absent from this select. The editor can set an
    // answer; nothing in the panel can read one back.
    const puzzles = await db.many(
      `select c.id, c.position, c.prompt, c.answer_format, c.puzzle_type,
              c.case_sensitive, c.max_attempts, c.hint,
              c.choices,
              (select count(*)::int from submissions s where s.challenge_id = c.id) as submissions,
              (select count(*)::int from challenge_answers a where a.challenge_id = c.id) as alternates
         from challenges c
        where c.file_id = $1
        order by c.position asc`,
      [file.id]
    );

    const attachments = await db.many(
      `select id, filename, mime_type, byte_size, checksum_sha256, position,
              is_public, (id = $2) as is_cover, created_at
         from file_attachments
        where file_id = $1
        order by position asc, created_at asc`,
      [file.id, file.cover_attachment_id]
    );

    // Reward conditions with review counters, so the editor shows what is
    // queued without leaving the file.
    const requirements = await db.many(
      `select r.id, r.position, r.kind, r.platform, r.title, r.description,
              r.target_url, r.target_handle, r.is_required, r.created_at,
              count(v.id)::int as verifications,
              count(v.id) filter (where v.status = 'pending')::int as pending,
              count(v.id) filter (where v.status = 'verified')::int as verified,
              count(v.id) filter (where v.status = 'rejected')::int as rejected
         from file_requirements r
         left join file_requirement_verifications v on v.requirement_id = r.id
        where r.file_id = $1
        group by r.id
        order by r.position asc, r.created_at asc`,
      [file.id]
    );

    // Owner-set defaults teach blank answer fields; typed values always win.
    const defaults = await db.many(
      "select key, value from settings where key = 'archive.default_min_holding'"
    );
    const defaultHolding =
      typeof defaults[0]?.value === 'string' ? defaults[0].value : '1';

    return sendPage(
      reply,
      adminFileEditorPage({
        admin: withCsrf(request),
        file: {
          ...file,
          reward_amount_f106: String(file.reward_amount_f106),
          min_holding_f106: String(file.min_holding_f106),
        },
        puzzles,
        attachments,
        requirements,
        values: {
          ...editorValues({
            ...file,
            reward_amount_f106: String(file.reward_amount_f106),
            min_holding_f106: String(file.min_holding_f106),
          }),
          prompt: puzzles[0]?.prompt ?? '',
          answerFormat: puzzles[0]?.answer_format ?? 'text',
          maxAttempts: puzzles[0]?.max_attempts ?? 1,
        },
        defaultHolding,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/files/:id', async (request, reply) => {
    const before = await loadFile(db, request.params.id);
    if (!before) return redirect(reply, '/admin/files?notice=file-unknown');

    const body = request.body || {};
    const { errors, value } = validateFileInput(body);

    const rerender = (code, errorMap, message) =>
      sendPage(
        reply,
        adminFileEditorPage({
          admin: withCsrf(request),
          file: before,
          errors: errorMap,
          values: editorValues(before, body),
          message,
        }),
        code
      );

    if (Object.keys(errors).length > 0) return rerender(400, errors, messageText('form-invalid'));

    try {
      await db.query(
        `update files
            set file_number = $2, slug = $3, title = $4, subtitle = $5,
                file_type = $6, sort_order = $7,
                requires_registration = $8, requires_wallet = $9, rewards_enabled = $10,
                teaser = $11, briefing = $12,
                difficulty = $13, reward_amount_f106 = $14, min_holding_f106 = $15,
                winner_method = $16, max_winners = $17, opens_at = $18, closes_at = $19,
                classification = $20, lore_body = $21, chapter_no = $22,
                mystery_order = $23, unlock_hint = $24, required_file_number = $25,
                unlock_requires_clue = $26, is_mystery = $27,
                unlock_code_hash = case
                  when $28::boolean then null
                  when $29::text is not null then $29
                  else unlock_code_hash
                end
          where id = $1`,
        [
          before.id,
          value.fileNumber,
          value.slug,
          value.title,
          value.subtitle || '',
          value.fileType,
          value.sortOrder ?? before.sort_order ?? before.file_number,
          value.requiresRegistration,
          value.requiresWallet,
          value.rewardsEnabled,
          value.teaser,
          value.briefing || null,
          value.difficulty,
          value.reward,
          value.minHolding,
          value.winnerMethod,
          value.maxWinners,
          value.opensAt,
          value.closesAt,
          value.classification,
          value.loreBody || null,
          value.chapterNo,
          value.mysteryOrder,
          value.unlockHint || null,
          value.requiredFileNumber,
          value.unlockRequiresClue,
          value.isMystery,
          value.removeUnlockCode,
          value.unlockCode ? hashSecret(value.unlockCode.normalize('NFKC')) : null,
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        return rerender(409, { submit: 'That file number or slug is already in use.' }, messageText('form-invalid'));
      }
      throw error;
    }

    const after = await loadFile(db, before.id);
    await audit(db, {
      adminId: request.admin.id,
      action: 'file.update',
      entity: 'files',
      entityId: before.id,
      before: fileSnapshot(before),
      after: fileSnapshot(after),
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${before.id}?notice=file-saved`);
  });

  app.post('/admin/files/:id/status', async (request, reply) => {
    const before = await loadFile(db, request.params.id);
    if (!before) return redirect(reply, '/admin/files?notice=file-unknown');

    const status = String(request.body?.status ?? '');
    if (!FILE_STATUSES.includes(status)) return redirect(reply, `/admin/files/${before.id}?notice=form-invalid`);

    await db.query(`update files set status = $2, archived_at = ${STATUS_SQL} where id = $1`, [before.id, status]);

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.status',
      entity: 'files',
      entityId: before.id,
      before: { status: before.status },
      after: { status },
      ip: ipHash(request),
    });

    request.log.info({ fileId: before.id, from: before.status, to: status }, 'file status changed');
    return redirect(reply, `/admin/files/${before.id}?notice=${status === 'scheduled' ? 'scheduled' : 'file-saved'}`);
  });

  app.post('/admin/files/:id/challenge', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const body = request.body || {};
    const { errors, value } = validateChallengeInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminFileEditorPage({
          admin: withCsrf(request),
          file,
          errors,
          values: { ...editorValues(file), prompt: body.prompt ?? '', answerFormat: body.answerFormat ?? 'text' },
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    // The plaintext stops here. Only hashChallengeAnswer's return value is
    // written, and it is never read back into a response.
    const answerHash = hashChallengeAnswer(value.answer, { caseSensitive: value.caseSensitive });

    const existing = await db.one(
      'select id from challenges where file_id = $1 and position = 1',
      [file.id]
    );

    try {
      await db.query(
        `insert into challenges (file_id, position, prompt, answer_hash, answer_format, case_sensitive, max_attempts)
         values ($1, 1, $2, $3, $4, $5, $6)
         on conflict (file_id, position) do update
            set prompt         = excluded.prompt,
                answer_hash    = excluded.answer_hash,
                answer_format  = excluded.answer_format,
                case_sensitive = excluded.case_sensitive,
                max_attempts   = excluded.max_attempts`,
        [file.id, value.prompt, answerHash, value.answerFormat, value.caseSensitive, value.maxAttempts]
      );
    } catch (error) {
      // restrict_violation from challenges_guard: submissions already exist, so
      // the answer is frozen. Letting the admin think a change applied would be
      // worse than refusing it.
      if (error.code === '23001') {
        return sendPage(
          reply,
          adminFileEditorPage({
            admin: withCsrf(request),
            file,
            errors: { answer: messageText('answer-locked') },
            values: { ...editorValues(file), prompt: body.prompt ?? '' },
            message: messageText('answer-locked'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: existing ? 'challenge.answer_replaced' : 'challenge.answer_set',
      entity: 'challenges',
      entityId: file.id,
      after: {
        fileNumber: file.file_number,
        answerFormat: value.answerFormat,
        caseSensitive: value.caseSensitive,
        maxAttempts: value.maxAttempts,
      },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file.id}?notice=answer-saved`);
  });

  // -------------------------------------------------------------------
  // Puzzles: the multi-puzzle editor. Each file may carry up to six puzzles
  // (steps of a multi-step investigation, or one). The sealed-answer rules are
  // identical to the single-puzzle route above: a plaintext answer becomes a
  // scrypt hash here and is never persisted, logged or echoed otherwise.
  // -------------------------------------------------------------------

  async function loadPuzzle(db, fileId, puzzleId) {
    if (!UUID.test(puzzleId)) return null;
    return db.one('select * from challenges where id = $1 and file_id = $2', [puzzleId, fileId]);
  }

  // Writes one puzzle's answers: the primary hash into challenges.answer_hash,
  // alternates into challenge_answers. Blank alternates mean "remove". The
  // seal trigger refuses everything once submissions exist.
  async function writePuzzleAnswers(db, { fileId, puzzleId, value, isCreate }) {
    const answerHash = value.answer
      ? hashChallengeAnswer(value.answer, { caseSensitive: value.caseSensitive })
      : null;

    if (isCreate || answerHash) {
      await db.query(
        `insert into challenges (file_id, position, prompt, answer_hash, answer_format,
                                 puzzle_type, choices, hint, case_sensitive, max_attempts)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         on conflict (file_id, position) do update
            set prompt        = excluded.prompt,
                answer_hash   = coalesce(excluded.answer_hash, challenges.answer_hash),
                answer_format = excluded.answer_format,
                puzzle_type   = excluded.puzzle_type,
                choices       = excluded.choices,
                hint          = excluded.hint,
                case_sensitive= excluded.case_sensitive,
                max_attempts  = excluded.max_attempts
         returning id`,
        [
          fileId,
          value.position,
          value.prompt,
          answerHash,
          value.answerFormat,
          value.puzzleType,
          JSON.stringify(value.choices),
          value.hint,
          value.caseSensitive,
          value.maxAttempts,
        ]
      );

      if (puzzleId === null) {
        const created = await db.one(
          'select id from challenges where file_id = $1 and position = $2',
          [fileId, value.position]
        );
        puzzleId = created?.id ?? null;
      }
    } else {
      // Surface-only edit; the sealed answer stays untouched.
      await db.query(
        `update challenges
            set prompt = $2, answer_format = $3, puzzle_type = $4, choices = $5::jsonb,
                hint = $6, case_sensitive = $7, max_attempts = $8
          where id = $1`,
        [puzzleId, value.prompt, value.answerFormat, value.puzzleType, JSON.stringify(value.choices), value.hint, value.caseSensitive, value.maxAttempts]
      );
    }

    // Alternates: rebuild only when the admin posted any (blank lines = none).
    const postingAlternates = value.hasAnswer2 || value.hasAnswer3;
    if (postingAlternates && puzzleId) {
      await db.query('delete from challenge_answers where challenge_id = $1', [puzzleId]);
      const hashes = [value.answer2, value.answer3]
        .filter((entry) => entry !== '')
        .map((entry, index) => [puzzleId, index + 1, hashChallengeAnswer(entry, { caseSensitive: value.caseSensitive })]);
      for (const params of hashes) {
        await db.query(
          'insert into challenge_answers (challenge_id, position, answer_hash) values ($1, $2, $3)',
          params
        );
      }
    }

    return puzzleId;
  }

  function puzzleAudit(value, existing) {
    return {
      action: existing ? 'puzzle.update' : 'puzzle.create',
      after: {
        position: value.position,
        puzzleType: value.puzzleType,
        answerFormat: value.answerFormat,
        choices: value.choices.length,
        alternates: (value.hasAnswer2 ? 1 : 0) + (value.hasAnswer3 ? 1 : 0),
        maxAttempts: value.maxAttempts,
        caseSensitive: value.caseSensitive,
      },
    };
  }

  app.post('/admin/files/:id/puzzles', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const body = request.body || {};
    const { errors, value } = validateChallengeInput(body);
    if (Object.keys(errors).length > 0) {
      return redirect(reply, `/admin/files/${file.id}?notice=puzzle-invalid`);
    }

    const taken = await db.one(
      'select id from challenges where file_id = $1 and position = $2',
      [file.id, value.position]
    );
    let puzzleId = taken?.id ?? null;

    try {
      puzzleId = await writePuzzleAnswers(db, { fileId: file.id, puzzleId, value, isCreate: !taken });
    } catch (error) {
      if (error.code === '23001') return redirect(reply, `/admin/files/${file.id}?notice=puzzle-locked`);
      throw error;
    }

    const entry = puzzleAudit(value, taken);
    await audit(db, {
      adminId: request.admin.id,
      entity: 'challenges',
      entityId: puzzleId,
      ...entry,
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file.id}?notice=puzzle-saved`);
  });

  app.post('/admin/files/:id/puzzles/:puzzleId', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const before = await loadPuzzle(db, file.id, request.params.puzzleId);
    if (!before) return redirect(reply, `/admin/files/${file.id}?notice=puzzle-unknown`);

    const body = { ...request.body, position: String(before.position) };
    const { errors, value } = validateChallengeInput(body);
    if (Object.keys(errors).length > 0) {
      return redirect(reply, `/admin/files/${file.id}?notice=puzzle-invalid`);
    }

    try {
      await writePuzzleAnswers(db, { fileId: file.id, puzzleId: before.id, value, isCreate: false });
    } catch (error) {
      if (error.code === '23001') return redirect(reply, `/admin/files/${file.id}?notice=puzzle-locked`);
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      entity: 'challenges',
      entityId: before.id,
      ...puzzleAudit(value, before),
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file.id}?notice=puzzle-saved`);
  });

  app.post('/admin/files/:id/puzzles/:puzzleId/delete', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const puzzle = await loadPuzzle(db, file.id, request.params.puzzleId);
    if (!puzzle) return redirect(reply, `/admin/files/${file.id}?notice=puzzle-unknown`);

    try {
      await db.query('delete from challenges where id = $1', [puzzle.id]);
    } catch (error) {
      // restrict_violation: submissions reference this puzzle, so removing it
      // would erase the record of a past attempt. Refuse, never truncate.
      if (error.code === '23503') return redirect(reply, `/admin/files/${file.id}?notice=puzzle-locked`);
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'puzzle.delete',
      entity: 'challenges',
      entityId: puzzle.id,
      before: { position: puzzle.position, puzzleType: puzzle.puzzle_type },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file.id}?notice=puzzle-deleted`);
  });

  // -------------------------------------------------------------------
  // Reward conditions: the per-file partner tasks a participant must finish
  // before a reward can be approved. The condition itself is public surface:
  // title, link and handle only. Verification state lives in the review queue.
  // -------------------------------------------------------------------

  app.post('/admin/files/:id/requirements', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const { errors, value } = validateRequirementInput(request.body || {});
    if (Object.keys(errors).length > 0) {
      return redirect(reply, `/admin/files/${file.id}?notice=requirement-invalid`);
    }

    // Blank position means "append after the last one".
    const position = value.position ?? Number(
      (await db.value(
        'select coalesce(max(position), 0) + 1 as v from file_requirements where file_id = $1',
        [file.id]
      )) ?? 1
    );

    let created;
    try {
      created = await db.one(
        `insert into file_requirements
           (file_id, position, kind, platform, title, description,
            target_url, target_handle, is_required, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id, position`,
        [
          file.id,
          position,
          value.kind,
          value.platform,
          value.title,
          value.description,
          value.targetUrl,
          value.targetHandle,
          value.isRequired,
          request.admin.id,
        ]
      );
    } catch (error) {
      // 23505: the position is taken by another condition on this file.
      if (error.code === '23505') {
        return redirect(reply, `/admin/files/${file.id}?notice=requirement-position-taken`);
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'requirement.create',
      entity: 'file_requirements',
      entityId: created.id,
      after: {
        fileNumber: file.file_number,
        position,
        kind: value.kind,
        platform: value.platform,
        title: value.title,
        targetUrl: value.targetUrl,
        targetHandle: value.targetHandle,
        isRequired: value.isRequired,
      },
      ip: ipHash(request),
    });

    request.log.info({ fileId: file.id, position }, 'reward condition added');
    return redirect(reply, `/admin/files/${file.id}?notice=requirement-created`);
  });

  app.post('/admin/files/:id/requirements/:requirementId/delete', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    if (!UUID.test(String(request.params.requirementId))) {
      return redirect(reply, `/admin/files/${file.id}?notice=requirement-unknown`);
    }

    const before = await db.one(
      'select id, position, title, platform from file_requirements where id = $1 and file_id = $2',
      [request.params.requirementId, file.id]
    );
    if (!before) return redirect(reply, `/admin/files/${file.id}?notice=requirement-unknown`);

    // Deleting a condition removes its pending proofs with it (cascade), and
    // the audit row keeps the record of what existed.
    await db.query('delete from file_requirements where id = $1', [before.id]);

    await audit(db, {
      adminId: request.admin.id,
      action: 'requirement.delete',
      entity: 'file_requirements',
      entityId: before.id,
      before: { position: before.position, title: before.title, platform: before.platform },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file.id}?notice=requirement-deleted`);
  });

  // -------------------------------------------------------------------
  // Lifecycle: duplicate, delete, reorder
  // -------------------------------------------------------------------

  app.post('/admin/files/:id/duplicate', async (request, reply) => {
    const source = await loadFile(db, request.params.id);
    if (!source) return redirect(reply, '/admin/files?notice=file-unknown');

    const next = await db.one('select coalesce(max(file_number), 0) + 1 as v from files');
    const number = Number(next.v);

    const copy = await db.one(
      `insert into files
         (file_number, slug, title, subtitle, file_type, sort_order,
          requires_registration, requires_wallet, rewards_enabled,
          teaser, briefing, difficulty, status, reward_amount_f106,
          min_holding_f106, winner_method, max_winners, opens_at, closes_at,
          classification, lore_body, chapter_no, mystery_order, unlock_hint,
          required_file_number, unlock_requires_clue, is_mystery,
          unlock_code_hash, created_by)
       select $1, $2, title || ' (COPY)', subtitle, file_type,
              sort_order, requires_registration, requires_wallet, rewards_enabled,
              teaser, briefing, difficulty, 'draft', reward_amount_f106,
              min_holding_f106, winner_method, max_winners, opens_at, closes_at,
              classification, lore_body, chapter_no, mystery_order, unlock_hint,
              required_file_number, unlock_requires_clue, is_mystery,
              unlock_code_hash, $3
         from files where id = $4
       returning id, file_number, slug`,
      [number, `file-${number}-copy`, request.admin.id, source.id]
    );

    // Puzzles plus their alternates and attachments are duplicated. Attachments
    // point at the same stored bytes; the storage itself is shared and remains
    // the property of both rows until either is removed.
    await db.query(
      `insert into challenges (file_id, position, prompt, answer_hash, answer_format,
                               puzzle_type, choices, hint, case_sensitive, max_attempts)
       select $1, position, prompt, answer_hash, answer_format,
              puzzle_type, choices, hint, case_sensitive, max_attempts
         from challenges where file_id = $2`,
      [copy.id, source.id]
    );

    await db.query(
      `insert into challenge_answers (challenge_id, position, answer_hash)
       select nc.id, ca.position, ca.answer_hash
         from challenge_answers ca
         join challenges oc on oc.id = ca.challenge_id
         join challenges nc on nc.file_id = $1 and nc.position = oc.position
        where oc.file_id = $2`,
      [copy.id, source.id]
    );

    // Reward conditions are part of the file's deal, so the copy carries them
    // too. Participant proofs are not copied: they belong to the original file.
    await db.query(
      `insert into file_requirements
         (file_id, position, kind, platform, title, description,
          target_url, target_handle, is_required, created_by)
       select $1, position, kind, platform, title, description,
              target_url, target_handle, is_required, $2
         from file_requirements where file_id = $3`,
      [copy.id, request.admin.id, source.id]
    );

    await db.query(
      `insert into file_attachments
         (file_id, kind, storage_key, filename, mime_type, byte_size,
          checksum_sha256, position, is_public)
       select $1, kind, storage_key, filename, mime_type, byte_size,
              checksum_sha256, position, is_public
         from file_attachments where file_id = $2`,
      [copy.id, source.id]
    );

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.duplicate',
      entity: 'files',
      entityId: copy.id,
      after: { from: source.file_number, to: copy.file_number, slug: copy.slug },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${copy.id}?notice=file-duplicated`);
  });

  app.post('/admin/files/:id/delete', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    // Anything that references the file with a restrict FK blocks deletion:
    // the audit trail and reward evidence must never be orphaned by a mistake.
    const referenced = await db.one(
      `select
         (exists (select 1 from submissions where file_id = $1)) as has_submissions,
         (exists (select 1 from winners where file_id = $1))    as has_winners,
         (exists (select 1 from rewards where file_id = $1))    as has_rewards`,
      [file.id]
    );

    if (referenced?.has_submissions || referenced?.has_winners || referenced?.has_rewards) {
      return redirect(reply, `/admin/files/${file.id}?notice=file-delete-blocked`);
    }

    const storage = await db.many(
      'select storage_key from file_attachments where file_id = $1',
      [file.id]
    );

    await db.transaction(async (tx) => {
      await tx.query('delete from challenges where file_id = $1', [file.id]);
      await tx.query('delete from file_attachments where file_id = $1', [file.id]);
      await tx.query('delete from file_unlocks where file_id = $1', [file.id]);
      await tx.query('delete from files where id = $1', [file.id]);
    });

    for (const key of storage) await uploads.remove(key.storage_key);

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.delete',
      entity: 'files',
      entityId: file.id,
      before: fileSnapshot(file),
      ip: ipHash(request),
    });

    return redirect(reply, '/admin/files?notice=file-deleted');
  });

  // Reorder: neighbours swap sort_order values on this list's ordering, so a
  // click moves a file exactly one position in the manager and in the archive.
  app.post('/admin/files/:id/move', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const direction = String(request.body?.direction ?? '') === 'down' ? 'down' : 'up';
    const neighbour = await db.one(
      direction === 'up'
        ? `select id, sort_order from files
            where (sort_order, file_number) < ($1, $2)
            order by sort_order desc, file_number desc limit 1`
        : `select id, sort_order from files
            where (sort_order, file_number) > ($1, $2)
            order by sort_order asc, file_number asc limit 1`,
      [file.sort_order, file.file_number]
    );

    if (neighbour) {
      await db.transaction(async (tx) => {
        await tx.query('update files set sort_order = $2 where id = $1', [file.id, neighbour.sort_order]);
        await tx.query('update files set sort_order = $2 where id = $1', [neighbour.id, file.sort_order]);
      });

      await audit(db, {
        adminId: request.admin.id,
        action: 'file.reorder',
        entity: 'files',
        entityId: file.id,
        before: { sortOrder: file.sort_order },
        after: { sortOrder: neighbour.sort_order },
        ip: ipHash(request),
      });
    }

    return redirect(reply, `/admin/files?notice=file-reordered`);
  });

  // -------------------------------------------------------------------
  // Preview: the public file page rendered from the draft, without any of the
  // public routes being reachable.
  // -------------------------------------------------------------------

  const UUID = /^[0-9a-f-]{36}$/i;

  app.get('/admin/files/:id/preview', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return reply.callNotFound();

    const puzzles = await db.many(
      `select id, position, prompt, answer_format, puzzle_type, max_attempts, hint, choices
         from challenges where file_id = $1 order by position asc`,
      [file.id]
    );

    const view = {
      number: file.file_number,
      slug: file.slug,
      title: file.title,
      subtitle: file.subtitle ?? '',
      fileType: file.file_type,
      rewardsEnabled: file.rewards_enabled,
      requiresRegistration: file.requires_registration,
      requiresWallet: file.requires_wallet,
      teaser: file.teaser,
      briefing: file.briefing ?? '',
      difficulty: file.difficulty,
      status: file.status,
      reward: file.reward_amount_f106,
      minHolding: file.min_holding_f106,
      winnerMethod: file.winner_method,
      maxWinners: file.max_winners,
      opensAt: file.opens_at,
      closesAt: file.closes_at,
      classification: file.classification || '',
      loreBody: file.lore_body ?? '',
      chapterNo: file.chapter_no,
      mysteryOrder: file.mystery_order,
      unlockHint: file.unlock_hint ?? '',
      requiredFileNumber: file.required_file_number,
      unlockRequiresClue: file.unlock_requires_clue,
      hasUnlockCode: Boolean(file.has_unlock_code),
      isMystery: Boolean(file.is_mystery),
      locked: false,
      lockReason: null,
      requiredFile: null,
      requiredClue: null,
      coverId: file.cover_attachment_id,
    };

    return sendPage(
      reply,
      adminFilePreviewPage({
        session: request.session,
        file: view,
        puzzles,
        csrf: csrfToken(request.session),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // Attachments: raw PUT, no multipart dependency, no public URL
  // -------------------------------------------------------------------
  app.put('/api/admin/files/:id/attachments', { bodyLimit: config.uploads.maxBytes }, async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return reply.code(404).send({ error: 'file_unknown', message: 'No such file.' });

    const mimeType = String(request.headers['content-type'] ?? '').split(';')[0].trim();
    const filename = safeFilename(request.query?.filename);
    const kind = mimeType.startsWith('image/') ? 'image' : 'document';

    let stored;
    try {
      stored = await uploads.save({ buffer: request.body, mimeType });
    } catch (error) {
      request.log.warn({ err: error.message }, 'attachment rejected');
      return reply.code(error.statusCode ?? 400).send({ error: error.code ?? 'upload_failed', message: error.message });
    }

    const row = await db.one(
      `insert into file_attachments
         (file_id, kind, storage_key, filename, mime_type, byte_size, checksum_sha256, position)
       values ($1, $2, $3, $4, $5, $6, $7,
               coalesce((select max(position) + 1 from file_attachments where file_id = $1), 0))
       returning id, filename, mime_type, byte_size`,
      [file.id, kind, stored.storageKey, filename, mimeType, stored.byteSize, stored.checksumSha256]
    );

    await audit(db, {
      adminId: request.admin.id,
      action: 'attachment.add',
      entity: 'file_attachments',
      entityId: row.id,
      after: { fileId: file.id, filename, mimeType, byteSize: stored.byteSize },
      ip: ipHash(request),
    });

    return reply.code(201).send({ id: row.id, filename: row.filename, byteSize: row.byte_size });
  });

  app.get('/admin/attachments/:id', async (request, reply) => {
    const attachment = await db.one(
      'select id, storage_key, filename, mime_type from file_attachments where id = $1',
      [request.params.id]
    );
    if (!attachment) return reply.callNotFound();

    let buffer;
    try {
      buffer = await uploads.read(attachment.storage_key);
    } catch (error) {
      request.log.warn({ attachmentId: attachment.id, err: error.message }, 'attachment unreadable');
      return reply.code(404).send({ error: 'attachment_missing' });
    }

    // filename* avoids a quoted header a filename could break out of.
    return reply
      .type(attachment.mime_type)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
      .header('cache-control', 'private, no-store')
      .send(buffer);
  });

  app.post('/admin/files/:id/attachments/:attachmentId/delete', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const removed = await db.one(
      `delete from file_attachments
        where id = $1 and file_id = $2
        returning id, storage_key, filename`,
      [request.params.attachmentId, file.id]
    );

    if (removed) {
      await uploads.remove(removed.storage_key);
      await audit(db, {
        adminId: request.admin.id,
        action: 'attachment.remove',
        entity: 'file_attachments',
        entityId: removed.id,
        before: { fileId: file.id, filename: removed.filename },
        ip: ipHash(request),
      });
    }

    return redirect(reply, `/admin/files/${file.id}?notice=attachment-removed`);
  });

  // -------------------------------------------------------------------
  // The mystery layer's screens live in their own module but are registered
  // inside this plugin, after the auth hook above, so they cannot be reached
  // without an archivist session. The control-room screens (team, settings,
  // audit, investigators, puzzle index) behave the same way.
  // -------------------------------------------------------------------
  await registerControlRoomRoutes(app, { db, config, withCsrf, audit });
  await registerRequirementAdminRoutes(app, { db, withCsrf, audit });
  await registerMysteryAdminRoutes(app, {
    db,
    config,
    balanceReader,
    transactionVerifier,
    withCsrf,
    audit,
  });
}
