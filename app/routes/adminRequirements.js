// The archivist review queue for per-file reward conditions.
//
// Registered from inside adminRoutes, so the /admin auth hook and the CSRF
// guard already apply. The single rule this file exists for: a green check is
// handed out only here, by a named archivist, at a recorded time. The
// database check constraint backs that up by refusing a 'verified' row that
// lacks either.

import { messageText, validateAdminNote } from '../lib/validate.js';
import { redirect, sendPage } from '../lib/reply.js';
import { adminVerificationsPage } from '../views/adminRequirements.js';

const UUID = /^[0-9a-f-]{36}$/i;

export async function registerRequirementAdminRoutes(app, { db, withCsrf, audit }) {
  app.get('/admin/verifications', async (request, reply) => {
    const rows = await db.many(
      `select v.id, v.status, v.proof, v.reviewer_note, v.created_at, v.updated_at, v.checked_at,
              r.id as requirement_id, r.position, r.title as requirement_title,
              r.platform, r.kind, r.target_url, r.target_handle, r.is_required,
              f.id as file_id, f.file_number, f.title as file_title, f.slug,
              u.username, u.email
         from file_requirement_verifications v
         join file_requirements r on r.id = v.requirement_id
         join files f on f.id = v.file_id
         join users u on u.id = v.user_id
        order by (case when v.status = 'pending' then 0 else 1 end), v.created_at desc
        limit 200`
    );

    const counts = await db.one(
      `select count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where status = 'verified')::int as verified,
              count(*) filter (where status = 'rejected')::int as rejected,
              count(*)::int as total
         from file_requirement_verifications`
    );

    return sendPage(
      reply,
      adminVerificationsPage({
        admin: withCsrf(request),
        rows,
        counts,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // One decision path for both outcomes so the locking and logging cannot drift.
  async function decide(request, reply, decision) {
    if (!UUID.test(request.params.id)) {
      return redirect(reply, '/admin/verifications?notice=verification-unknown');
    }

    const note = validateAdminNote(request.body?.note);
    if (note.error) return redirect(reply, '/admin/verifications?notice=form-invalid');

    const result = await db.transaction(async (tx) => {
      const row = await tx.one(
        `select id, requirement_id, user_id, file_id, status
           from file_requirement_verifications
          where id = $1 for update`,
        [request.params.id]
      );
      if (!row) return { error: 'verification-unknown' };
      if (row.status !== 'pending') return { error: 'verification-not-pending' };

      // checked_at and reviewed_by are written with the decision; the
      // constraint green_needs_reviewer would reject anything less.
      const updated = await tx.one(
        `update file_requirement_verifications
            set status = $2, reviewed_by = $3, checked_at = now(),
                reviewer_note = $4, updated_at = now()
          where id = $1
          returning id, checked_at`,
        [row.id, decision, request.admin.id, note.value || '']
      );

      const requirement = await tx.one(
        'select title from file_requirements where id = $1',
        [row.requirement_id]
      );

      await tx.query(
        `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
         values ($1, 'requirement', $2, $3, $4::jsonb)`,
        [
          row.user_id,
          row.file_id,
          decision === 'verified'
            ? `Reward condition verified by the archive: ${requirement?.title ?? 'condition'}`
            : `Reward condition proof was not accepted: ${requirement?.title ?? 'condition'}`,
          JSON.stringify({
            requirementId: row.requirement_id,
            verificationId: row.id,
            decision,
          }),
        ]
      );

      return { id: updated.id, checkedAt: updated.checked_at };
    });

    if (result?.error) return redirect(reply, `/admin/verifications?notice=${result.error}`);

    await audit(db, {
      adminId: request.admin.id,
      action: `verification.${decision === 'verified' ? 'approve' : 'reject'}`,
      entity: 'file_requirement_verifications',
      entityId: result.id,
      after: { status: decision, checkedAt: result.checkedAt, note: note.value || null },
    });

    return redirect(
      reply,
      `/admin/verifications?notice=${decision === 'verified' ? 'verification-approved' : 'verification-rejected'}`
    );
  }

  app.post('/admin/verifications/:id/approve', async (request, reply) =>
    decide(request, reply, 'verified'));

  app.post('/admin/verifications/:id/reject', async (request, reply) =>
    decide(request, reply, 'rejected'));
}
