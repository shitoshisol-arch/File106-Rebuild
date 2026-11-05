// Public archive: the file list, one file page, access-code unlocking, public
// cover image delivery, and the answer terminal.
//
// Rules that hold on every path here:
//
//   * Drafts, scheduled, and archived files are invisible, so a URL cannot leak
//     something an archivist has not published.
//   * No query in this file selects `challenges.answer_hash`,
//     `challenge_answers.answer_hash`, or `files.unlock_code_hash` outside the
//     two POST handlers that compare them, and those hashes never reach a view
//     or a redirect.
//   * A file's sealed section is rendered only after the server has decided the
//     visitor is allowed to see it.

import { challengeAnswerMatches } from '../lib/answers.js';
import { csrfToken } from '../lib/csrf.js';
import { answerDigest, sealAnswer, verifySecret } from '../../scripts/archive/secret-hash.mjs';
import { loadUserContext, recordFileUnlock } from '../lib/investigation.js';
import { fileLabel, fileLockState } from '../lib/mystery.js';
import { ipHash } from '../lib/ip.js';
import { parseUnits } from '../lib/solana.js';
import {
  messageText,
  validateAnswerSubmission,
  validateProofInput,
  validateUnlockCode,
} from '../lib/validate.js';
import { redirect, sendPage } from '../lib/reply.js';
import { archiveFilePage, archiveListPage } from '../views/archive.js';

// Anything not listed here is not public. 'draft', 'scheduled' and 'archived'
// are absent on purpose.
const PUBLIC_STATUSES = ['open', 'locked', 'closed', 'completed'];

const GROUPS = [
  { key: 'open', label: 'OPEN', note: 'Accepting answers', statuses: ['open'] },
  { key: 'locked', label: 'LOCKED', note: 'An answer is under review', statuses: ['locked'] },
  { key: 'closed', label: 'CLOSED', note: 'The window has ended', statuses: ['closed'] },
  { key: 'completed', label: 'COMPLETED', note: 'Solved and rewarded', statuses: ['completed'] },
];

const SLUG = /^[a-z0-9-]{1,80}$/;
const UUID = /^[0-9a-f-]{36}$/i;

// Transitions 'scheduled' files whose opens_at has arrived to 'open', and
// 'open' files whose closes_at has passed to 'closed'.
export async function runArchiveScheduler(db) {
  await db.query(
    `update files
        set status = 'open'
      where status = 'scheduled'
        and opens_at is not null
        and opens_at <= now()`
  );
  await db.query(
    `update files
        set status = 'closed'
      where status = 'open'
        and closes_at is not null
        and closes_at <= now()`
  );
}

function summarise(row, context) {
  const lock = fileLockState({
    file: row,
    discoveredClues: context.discoveredClues,
    unlockedNumbers: context.unlockedNumbers,
  });

  return {
    number: row.file_number,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || '',
    fileType: row.file_type || 'story',
    rewardsEnabled: row.rewards_enabled !== false,
    hasCover: Boolean(row.cover_attachment_id),
    teaser: row.teaser,
    difficulty: row.difficulty,
    status: row.status,
    reward: row.reward,
    classification: row.classification || '',
    isMystery: Boolean(row.is_mystery),
    locked: Boolean(row.is_mystery) && lock.locked,
    lockReason: lock.reason,
  };
}

// `unlock_code_hash` itself is never selected; the boolean is the only thing a
// page needs to know.
const FILE_COLUMNS = `id, file_number, slug, title, subtitle, file_type,
  requires_registration, requires_wallet, rewards_enabled, cover_attachment_id,
  teaser, briefing, difficulty, status,
  reward_amount_f106::text as reward,
  min_holding_f106::text  as min_holding,
  winner_method, max_winners, opens_at, closes_at,
  classification, lore_body, chapter_no, mystery_order,
  required_file_number, unlock_requires_clue, unlock_hint,
  is_mystery, (unlock_code_hash is not null) as has_unlock_code`;

function unlockMethodFor(file) {
  if (file.required_file_number) return 'prerequisite';
  if (file.unlock_requires_clue) return 'clue';
  return 'open';
}

async function loadChallenges(db, fileId) {
  if (!fileId) return [];
  return db.many(
    `select id, position, prompt, answer_format, puzzle_type, max_attempts, hint, choices
       from challenges
      where file_id = $1
      order by position asc`,
    [fileId]
  );
}

async function loadFileRequirements(db, fileId, userId) {
  const rows = await db.many(
    `select r.id, r.position, r.kind, r.platform, r.title, r.description,
            r.target_url, r.target_handle, r.is_required,
            v.status as verification_status, v.proof, v.reviewer_note, v.checked_at
       from file_requirements r
       left join file_requirement_verifications v
         on v.requirement_id = r.id and v.user_id = $2::uuid
      where r.file_id = $1
      order by r.position asc, r.created_at asc`,
    [fileId, userId ?? null]
  );

  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    kind: row.kind,
    platform: row.platform,
    title: row.title,
    description: row.description || '',
    targetUrl: row.target_url,
    targetHandle: row.target_handle || '',
    required: row.is_required !== false,
    status: row.verification_status || 'missing',
    proof: row.proof || '',
    reviewerNote: row.reviewer_note || '',
    checkedAt: row.checked_at,
  }));
}

async function submissionState(db, userId, challenge) {
  if (!userId || !challenge) return { attempts: 0, remaining: 0, hasCorrect: false };

  const row = await db.one(
    `select
       count(*)::int as attempts,
       count(*) filter (where status in ('correct','approved','rewarded'))::int as correct
     from submissions
     where user_id = $1 and challenge_id = $2`,
    [userId, challenge.id]
  );

  const attempts = Number(row?.attempts ?? 0);
  return {
    attempts,
    remaining: Math.max(0, Number(challenge.max_attempts) - attempts),
    hasCorrect: Number(row?.correct ?? 0) > 0,
  };
}

async function loadArchiveBannerSettings(db) {
  const rows = await db.many(
    `select key, value from settings where key in ('archive.maintenance_banner', 'archive.tagline')`
  );
  const out = { maintenanceBanner: false, tagline: '' };
  for (const r of rows) {
    if (r.key === 'archive.maintenance_banner') out.maintenanceBanner = Boolean(r.value);
    if (r.key === 'archive.tagline' && typeof r.value === 'string') out.tagline = r.value;
  }
  return out;
}

export async function archiveRoutes(app, { db, config, uploads, balanceReader }) {
  app.get('/archive', async (request, reply) => {
    await runArchiveScheduler(db);
    const context = await loadUserContext(db, request.user?.id);
    const banner = await loadArchiveBannerSettings(db);

    const rows = await db.many(
      `select file_number, slug, title, subtitle, file_type, rewards_enabled,
              cover_attachment_id, teaser, difficulty, status,
              reward_amount_f106::text as reward, classification,
              is_mystery, required_file_number, unlock_requires_clue,
              (unlock_code_hash is not null) as has_unlock_code
         from files
        where is_enabled and status = any($1::text[])
        order by sort_order asc, file_number asc`,
      [PUBLIC_STATUSES]
    );

    const total = await db.value('select count(*)::int as v from files');

    const groups = GROUPS.map((group) => ({
      ...group,
      files: rows
        .filter((row) => group.statuses.includes(row.status))
        .map((row) => summarise(row, context)),
    }));

    return sendPage(
      reply,
      archiveListPage({
        session: request.session,
        groups,
        total,
        signedIn: Boolean(request.user),
        maintenanceBanner: banner.maintenanceBanner,
        tagline: banner.tagline,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // Public cover image delivery — only serves an attachment that the archivist
  // explicitly marked as the file's public cover on a published file.
  app.get('/archive/:slug/cover', async (request, reply) => {
    const slug = String(request.params.slug ?? '');
    if (!SLUG.test(slug) || !uploads) return reply.callNotFound();

    const row = await db.one(
      `select a.storage_key, a.mime_type, a.filename
         from files f
         join file_attachments a on a.id = f.cover_attachment_id and a.file_id = f.id
        where f.slug = $1 and f.is_enabled and f.status = any($2::text[])
          and a.is_public = true and a.kind = 'image'`,
      [slug, PUBLIC_STATUSES]
    );
    if (!row) return reply.callNotFound();

    try {
      const buffer = await uploads.read(row.storage_key);
      return reply
        .type(row.mime_type)
        .header('cache-control', 'public, max-age=300')
        .send(buffer);
    } catch {
      return reply.callNotFound();
    }
  });

  app.get('/archive/:slug', async (request, reply) => {
    const slug = String(request.params.slug ?? '');
    if (!SLUG.test(slug)) return reply.callNotFound();

    await runArchiveScheduler(db);

    const file = await db.one(
      `select ${FILE_COLUMNS}
         from files
        where slug = $1 and is_enabled and status = any($2::text[])`,
      [slug, PUBLIC_STATUSES]
    );

    if (!file) return reply.callNotFound();

    const user = request.user;
    const context = await loadUserContext(db, user?.id);
    const lock = fileLockState({
      file,
      discoveredClues: context.discoveredClues,
      unlockedNumbers: context.unlockedNumbers,
    });

    if (user && !lock.locked && !context.unlockedNumbers.has(Number(file.file_number))) {
      await recordFileUnlock(db, {
        userId: user.id,
        file,
        method: unlockMethodFor(file),
      });
      context.unlockedNumbers.add(Number(file.file_number));
    }

    const challenges = await loadChallenges(db, file.id);
    const challenge = challenges[0] || null;
    const state = await submissionState(db, user?.id, challenge);
    const puzzleStates = [];
    for (const c of challenges) {
      puzzleStates.push({
        challenge: c,
        state: await submissionState(db, user?.id, c),
      });
    }

    const requirements = await loadFileRequirements(db, file.id, user?.id);

    const view = {
      number: file.file_number,
      slug: file.slug,
      title: file.title,
      subtitle: file.subtitle || '',
      fileType: file.file_type || 'story',
      requiresRegistration: file.requires_registration !== false,
      requiresWallet: file.requires_wallet !== false,
      rewardsEnabled: file.rewards_enabled !== false,
      hasCover: Boolean(file.cover_attachment_id),
      teaser: file.teaser,
      briefing: file.briefing ?? '',
      difficulty: file.difficulty,
      status: file.status,
      reward: file.reward,
      minHolding: file.min_holding,
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
      locked: Boolean(file.is_mystery) && lock.locked,
      lockReason: lock.reason,
      requiredFile: lock.requiredFile ?? null,
      requiredClue: lock.requiredClue ?? null,
    };

    const eligibility = {
      signedIn: Boolean(user),
      wallet: '',
      balance: '',
      balanceError: '',
      satisfied: file.requires_wallet === false && Number(file.min_holding) === 0,
    };

    if (user) {
      const wallet = await db.one(
        'select address from user_wallets where user_id = $1 and is_primary = true',
        [user.id]
      );

      if (wallet) {
        eligibility.wallet = wallet.address;
        try {
          const balance = await balanceReader(wallet.address);
          eligibility.balance = balance.amount;
          eligibility.satisfied =
            balance.baseUnits >= parseUnits(file.min_holding, config.solana.decimals);
        } catch (error) {
          request.log.warn({ err: error.message }, 'balance read failed on file page');
          eligibility.balanceError = 'unavailable';
        }
      }
    }

    return sendPage(
      reply,
      archiveFilePage({
        session: request.session,
        file: view,
        eligibility,
        challenge: view.locked ? null : challenge,
        puzzles: view.locked ? [] : puzzleStates,
        requirements,
        submission: state,
        csrf: csrfToken(request.session),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // Access code
  // -------------------------------------------------------------------
  app.post(
    '/archive/:slug/unlock',
    { config: { rateLimit: { max: 12, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const slug = String(request.params.slug ?? '');
      if (!SLUG.test(slug)) return reply.callNotFound();

      if (!request.user) return redirect(reply, '/login?notice=login-required');

      const file = await db.one(
        `select id, file_number, slug, title, required_file_number,
                unlock_requires_clue, (unlock_code_hash is not null) as has_unlock_code
           from files
          where slug = $1 and is_enabled and status = any($2::text[])`,
        [slug, PUBLIC_STATUSES]
      );

      if (!file) return reply.callNotFound();

      const context = await loadUserContext(db, request.user.id);

      if (context.unlockedNumbers.has(Number(file.file_number))) {
        return redirect(reply, `/archive/${slug}?notice=file-unlocked`);
      }

      if (file.required_file_number && !context.unlockedNumbers.has(Number(file.required_file_number))) {
        return redirect(reply, `/archive/${slug}?notice=prerequisite-missing`);
      }

      if (file.unlock_requires_clue && !context.discoveredClues.has(Number(file.unlock_requires_clue))) {
        return redirect(reply, `/archive/${slug}?notice=clue-required`);
      }

      if (!file.has_unlock_code) {
        return redirect(reply, `/archive/${slug}?notice=file-sealed`);
      }

      // The hash is fetched only now, in the handler that compares it.
      const secret = await db.one('select unlock_code_hash from files where id = $1', [file.id]);
      const parsed = validateUnlockCode(request.body?.code);

      if (parsed.error) return redirect(reply, `/archive/${slug}?notice=code-invalid`);

      if (!verifySecret(parsed.value.normalize('NFKC'), secret?.unlock_code_hash ?? '')) {
        request.log.warn(
          { fileId: file.id, userId: request.user.id, ip: ipHash(request) },
          'file unlock code refused'
        );
        return redirect(reply, `/archive/${slug}?notice=code-invalid`);
      }

      await recordFileUnlock(db, {
        userId: request.user.id,
        file,
        method: 'code',
      });

      return redirect(reply, `/archive/${slug}?notice=file-unlocked`);
    }
  );

  // -------------------------------------------------------------------
  // Reward conditions: the participant submits proof for one condition
  // -------------------------------------------------------------------
  app.post(
    '/archive/:slug/requirements/:requirementId/proof',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const slug = String(request.params.slug ?? '');
      if (!SLUG.test(slug)) return reply.callNotFound();

      if (!request.user) return redirect(reply, '/login?notice=login-required');

      const file = await db.one(
        `select id, slug, file_number, title from files
          where slug = $1 and is_enabled and status = any($2::text[])`,
        [slug, PUBLIC_STATUSES]
      );
      if (!file) return reply.callNotFound();

      const requirementId = String(request.params.requirementId ?? '');
      if (!UUID.test(requirementId)) {
        return redirect(reply, `/archive/${slug}?notice=requirement-unknown`);
      }

      const requirement = await db.one(
        'select id, title from file_requirements where id = $1 and file_id = $2',
        [requirementId, file.id]
      );
      if (!requirement) return redirect(reply, `/archive/${slug}?notice=requirement-unknown`);

      // A verified condition is closed: no participant input can reopen or
      // rewrite it. Only an archivist decision changes it again.
      const existing = await db.one(
        `select id, status from file_requirement_verifications
          where requirement_id = $1 and user_id = $2`,
        [requirement.id, request.user.id]
      );
      if (existing?.status === 'verified') {
        return redirect(reply, `/archive/${slug}?notice=proof-locked`);
      }

      const parsed = validateProofInput(request.body?.proof);
      if (parsed.error) return redirect(reply, `/archive/${slug}?notice=proof-required`);

      // The row is born 'pending' with the proof. Nothing in this handler can
      // produce 'verified': that transition lives with the archivist review
      // route and the database check that demands checked_at and reviewed_by.
      if (existing) {
        await db.query(
          `update file_requirement_verifications
              set status = 'pending', proof = $2, method = 'manual_review',
                  reviewed_by = null, checked_at = null, reviewer_note = '',
                  updated_at = now()
            where id = $1`,
          [existing.id, parsed.value]
        );
      } else {
        await db.query(
          `insert into file_requirement_verifications
             (requirement_id, file_id, user_id, status, proof, method)
           values ($1, $2, $3, 'pending', $4, 'manual_review')`,
          [requirement.id, file.id, request.user.id, parsed.value]
        );
      }

      await db.query(
        `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
         values ($1, 'requirement', $2, $3, $4::jsonb)`,
        [
          request.user.id,
          file.id,
          `Submitted proof for the reward condition: ${requirement.title}`,
          JSON.stringify({ requirementId: requirement.id, proof: parsed.value }),
        ]
      );

      return redirect(reply, `/archive/${slug}?notice=proof-submitted`);
    }
  );

  // -------------------------------------------------------------------
  // Answer terminal
  // -------------------------------------------------------------------
  app.post(
    '/archive/:slug/submit',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const slug = String(request.params.slug ?? '');
      if (!SLUG.test(slug)) return reply.callNotFound();

      if (!request.user) return redirect(reply, '/login?notice=login-required');

      await runArchiveScheduler(db);

      const file = await db.one(
        `select id, file_number, slug, title, status, reward_amount_f106::text as reward,
                min_holding_f106::text as min_holding, max_winners, opens_at, closes_at,
                requires_wallet, rewards_enabled,
                is_mystery, required_file_number, unlock_requires_clue,
                (unlock_code_hash is not null) as has_unlock_code
           from files
          where slug = $1 and is_enabled and status = any($2::text[])`,
        [slug, PUBLIC_STATUSES]
      );

      if (!file) return reply.callNotFound();

      if (file.status !== 'open') {
        return redirect(reply, `/archive/${slug}?notice=file-sealed`);
      }

      if (file.opens_at && new Date(file.opens_at) > new Date()) {
        return redirect(reply, `/archive/${slug}?notice=window-not-open`);
      }
      if (file.closes_at && new Date(file.closes_at) <= new Date()) {
        return redirect(reply, `/archive/${slug}?notice=window-closed`);
      }

      const context = await loadUserContext(db, request.user.id);
      const lock = fileLockState({
        file,
        discoveredClues: context.discoveredClues,
        unlockedNumbers: context.unlockedNumbers,
      });

      if (lock.locked) {
        const notice =
          lock.reason === 'code'
            ? 'file-sealed'
            : lock.reason === 'prerequisite'
              ? 'prerequisite-missing'
              : 'clue-required';
        return redirect(reply, `/archive/${slug}?notice=${notice}`);
      }

      const challenges = await loadChallenges(db, file.id);
      if (challenges.length === 0) return redirect(reply, `/archive/${slug}?notice=file-sealed`);

      const requestedId = String(request.body?.challengeId ?? '');
      let challenge = UUID.test(requestedId)
        ? challenges.find((c) => c.id === requestedId)
        : null;
      if (!challenge) challenge = challenges[0];

      const state = await submissionState(db, request.user.id, challenge);
      if (state.hasCorrect) return redirect(reply, `/archive/${slug}?notice=already-submitted`);
      if (state.remaining <= 0) return redirect(reply, `/archive/${slug}?notice=attempts-exhausted`);

      const parsedAnswer = validateAnswerSubmission(request.body?.answer);
      if (parsedAnswer.error) return redirect(reply, `/archive/${slug}?notice=answer-required`);

      const wallet = await db.one(
        'select address from user_wallets where user_id = $1 and is_primary = true',
        [request.user.id]
      );

      const walletNeeded = file.requires_wallet !== false || Number(file.min_holding) > 0;
      if (walletNeeded && !wallet) {
        return redirect(reply, `/archive/${slug}?notice=wallet-required`);
      }

      let balance = { amount: '0.00000000', baseUnits: 0n };
      if (wallet) {
        try {
          balance = await balanceReader(wallet.address);
        } catch (error) {
          request.log.warn({ err: error.message }, 'balance read failed on submit');
          return redirect(reply, `/archive/${slug}?notice=balance-unavailable`);
        }

        const required = parseUnits(file.min_holding, config.solana.decimals);
        if (balance.baseUnits < required) {
          return redirect(reply, `/archive/${slug}?notice=submission-holding`);
        }
      }

      // The hashes are fetched only here, in the handler that compares them.
      const sealed = await db.one(
        'select answer_hash, case_sensitive from challenges where id = $1',
        [challenge.id]
      );
      const alternates = await db.many(
        'select answer_hash from challenge_answers where challenge_id = $1 order by position asc',
        [challenge.id]
      );

      const correct = challengeAnswerMatches(parsedAnswer.value, sealed?.answer_hash ?? '', {
        caseSensitive: Boolean(sealed?.case_sensitive),
        extraHashes: alternates.map((a) => a.answer_hash),
      });

      let ciphertext;
      let digest;
      try {
        ciphertext = sealAnswer(parsedAnswer.value, config.answerEncKey);
        digest = answerDigest(parsedAnswer.value, config.answerEncKey);
      } catch (error) {
        request.log.error({ err: error.message }, 'could not seal a submission');
        return redirect(reply, `/archive/${slug}?notice=verifier-unavailable`);
      }

      await db.query(
        `insert into submissions
           (file_id, challenge_id, user_id, attempt_no, wallet_address,
            answer_ciphertext, answer_digest, status,
            holding_checked_at, holding_snapshot_f106, holding_required_f106,
            holding_satisfied, ip_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12)`,
        [
          file.id,
          challenge.id,
          request.user.id,
          state.attempts + 1,
          wallet?.address ?? 'no-wallet-required',
          ciphertext,
          digest,
          correct ? 'correct' : 'incorrect',
          balance.amount,
          file.min_holding,
          true,
          ipHash(request),
        ]
      );

      if (correct) {
        await db.query(
          `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
           values ($1, 'puzzle', $2, $3, $4::jsonb)`,
          [
            request.user.id,
            file.id,
            `Submitted a correct answer for ${fileLabel(file.file_number)} — ${file.title}`,
            JSON.stringify({ fileNumber: Number(file.file_number), step: challenge.position }),
          ]
        );
      }

      return redirect(
        reply,
        `/archive/${slug}?notice=${correct ? 'answer-correct' : 'answer-incorrect'}`
      );
    }
  );
}
