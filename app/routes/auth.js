// Registration, email verification, sign-in and sign-out.
//
// Rate limits are attached per route, failures are deliberately generic so an
// attacker cannot enumerate accounts, and the session id is regenerated on
// sign-in so a pre-set cookie cannot be promoted into an authenticated session.

import { hashSecret, verifySecret } from '../../scripts/archive/secret-hash.mjs';
import { hashToken, randomToken } from '../lib/tokens.js';
import { destroySession, regenerateSession, saveSession } from '../lib/session.js';
import { messageText, normalizeText, validateLogin, validatePasswordChange, validateRegistration } from '../lib/validate.js';
import { redirect, sendPage } from '../lib/reply.js';
import { registerPage, loginPage, verificationSentPage, linkProblemPage, forgotPasswordPage, forgotPasswordSentPage, resetPasswordPage } from '../views/auth.js';

// A real hash is compared even when the account does not exist, so response
// timing does not reveal whether an email is registered.
const DUMMY_HASH = hashSecret('archive-timing-equaliser');

const REGISTRATION_LIMIT = { max: 10, timeWindow: '10 minutes' };
const LOGIN_LIMIT = { max: 8, timeWindow: '5 minutes' };

function uniqueViolation(error) {
  if (!error || error.code !== '23505') return null;
  if (String(error.constraint || '').includes('email')) return 'email-taken';
  if (String(error.constraint || '').includes('username')) return 'username-taken';
  return 'form-invalid';
}

export async function authRoutes(app, { db, config, mailer }) {
  app.get('/register', async (request, reply) => {
    if (request.admin) return redirect(reply, '/admin');
    return sendPage(reply, registerPage({ session: request.session }));
  });

  app.post('/register', { config: { rateLimit: REGISTRATION_LIMIT } }, async (request, reply) => {
    if (request.admin) return redirect(reply, '/admin');
    const body = request.body || {};
    const { errors, value } = validateRegistration(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        registerPage({ session: request.session, errors, values: body, message: messageText('form-invalid') }),
        400
      );
    }

    const passwordHash = hashSecret(value.password);

    let user;
    try {
      user = await db.one(
        `insert into users (username, email, password_hash, status, terms_accepted_at)
         values ($1, $2, $3, 'pending_verification', now())
         returning id, username, email, status`,
        [value.username, value.email, passwordHash]
      );
    } catch (error) {
      const key = uniqueViolation(error);
      if (!key) throw error;
      return sendPage(
        reply,
        registerPage({
          session: request.session,
          errors: { submit: messageText(key) },
          values: { username: value.username, email: value.email },
          message: messageText(key),
        }),
        409
      );
    }

    const token = randomToken();
    await db.query(
      `insert into verification_tokens (user_id, purpose, token_hash, expires_at)
       values ($1, 'email_verify', $2, now() + interval '24 hours')`,
      [user.id, hashToken(token)]
    );

    const link = `${config.siteOrigin}/verify?token=${token}`;
    await mailer.send({
      to: user.email,
      subject: 'FILE106 ARCHIVE — verify your access request',
      text: [
        `Custodian: ${user.username}`,
        '',
        'Open this link within 24 hours to activate your archive account:',
        link,
        '',
        'If you did not request access, ignore this message. No wallet was linked and no funds moved.',
      ].join('\n'),
    });

    request.log.info({ userId: user.id }, 'registration created');
    return sendPage(
      reply,
      verificationSentPage({
        session: request.session,
        devLink: config.mail.exposeLinks ? link : '',
      }),
      201
    );
  });

  app.get('/verify', async (request, reply) => {
    const token = String(request.query?.token ?? '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return sendPage(reply, linkProblemPage({ session: request.session, message: messageText('verify-failed') }), 400);
    }

    const record = await db.one(
      `select vt.id, vt.user_id
         from verification_tokens vt
        where vt.token_hash = $1
          and vt.purpose = 'email_verify'
          and vt.consumed_at is null
          and vt.expires_at > now()`,
      [hashToken(token)]
    );

    if (!record) {
      return sendPage(reply, linkProblemPage({ session: request.session, message: messageText('verify-failed') }), 400);
    }

    await db.transaction(async (tx) => {
      await tx.query('update verification_tokens set consumed_at = now() where id = $1', [record.id]);
      await tx.query(
        `update users
            set email_verified_at = coalesce(email_verified_at, now()),
                status = case when status = 'pending_verification' then 'active' else status end
          where id = $1`,
        [record.user_id]
      );
    });

    return redirect(reply, '/login?notice=verified');
  });

  // -------------------------------------------------------------------
  // Password reset (self-service). Reuses verification_tokens with purpose
  // 'password_reset'. When no SMTP transport is configured the reset link is
  // echoed on the page, matching the registration flow.
  // -------------------------------------------------------------------
  const RESET_LIMIT = { max: 5, timeWindow: '10 minutes' };

  app.get('/forgot-password', async (request, reply) =>
    sendPage(reply, forgotPasswordPage({ session: request.session, message: messageText(String(request.query?.notice ?? '')) }))
  );

  app.post('/forgot-password', { config: { rateLimit: RESET_LIMIT } }, async (request, reply) => {
    const email = normalizeText(request.body?.email).toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return sendPage(
        reply,
        forgotPasswordPage({ session: request.session, values: { email }, message: messageText('form-invalid') }),
        400
      );
    }

    // Always respond the same way so an attacker cannot enumerate accounts.
    const user = await db.one('select id, username, email from users where email = $1', [email]);

    let devLink = '';
    if (user) {
      const token = randomToken();
      await db.query(
        `insert into verification_tokens (user_id, purpose, token_hash, expires_at)
         values ($1, 'password_reset', $2, now() + interval '1 hour')`,
        [user.id, hashToken(token)]
      );
      const link = `${config.siteOrigin}/reset-password?token=${token}`;
      await mailer.send({
        to: user.email,
        subject: 'FILE106 ARCHIVE — reset your password',
        text: [
          `Custodian: ${user.username}`,
          '',
          'Open this link within 1 hour to set a new password:',
          link,
          '',
          'If you did not request this, ignore this message.',
        ].join('\n'),
      });
      if (config.mail.exposeLinks) devLink = link;
      request.log.info({ userId: user.id }, 'password reset requested');
    }

    return sendPage(
      reply,
      forgotPasswordSentPage({ session: request.session, devLink, message: messageText('password-reset-sent') })
    );
  });

  app.get('/reset-password', async (request, reply) => {
    const token = String(request.query?.token ?? '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return sendPage(reply, linkProblemPage({ session: request.session, message: messageText('password-reset-expired') }), 400);
    }
    const record = await db.one(
      `select vt.id, vt.user_id
         from verification_tokens vt
        where vt.token_hash = $1
          and vt.purpose = 'password_reset'
          and vt.consumed_at is null
          and vt.expires_at > now()`,
      [hashToken(token)]
    );
    if (!record) {
      return sendPage(reply, linkProblemPage({ session: request.session, message: messageText('password-reset-expired') }), 400);
    }
    return sendPage(reply, resetPasswordPage({ session: request.session, token, message: '' }));
  });

  app.post('/reset-password', { config: { rateLimit: RESET_LIMIT } }, async (request, reply) => {
    const token = String(request.body?.token ?? '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return redirect(reply, '/forgot-password?notice=password-reset-expired');
    }
    const record = await db.one(
      `select vt.id, vt.user_id
         from verification_tokens vt
        where vt.token_hash = $1
          and vt.purpose = 'password_reset'
          and vt.consumed_at is null
          and vt.expires_at > now()`,
      [hashToken(token)]
    );
    if (!record) {
      return redirect(reply, '/forgot-password?notice=password-reset-expired');
    }

    const { errors, value } = validatePasswordChange(request.body || {});
    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        resetPasswordPage({ session: request.session, token, errors, values: request.body, message: messageText('form-invalid') }),
        400
      );
    }

    await db.transaction(async (tx) => {
      await tx.query('update verification_tokens set consumed_at = now() where id = $1', [record.id]);
      await tx.query('update users set password_hash = $2 where id = $1', [record.user_id, hashSecret(value.password)]);
      await tx.query('delete from sessions where user_id = $1', [record.user_id]);
    });

    request.log.info({ userId: record.user_id }, 'password reset completed');
    return redirect(reply, '/login?notice=password-reset-done');
  });

  app.get('/login', async (request, reply) => {
    if (request.admin) return redirect(reply, '/admin');
    return sendPage(
      reply,
      loginPage({ session: request.session, message: messageText(String(request.query?.notice ?? '')) })
    );
  });

  app.post('/login', { config: { rateLimit: LOGIN_LIMIT } }, async (request, reply) => {
    if (request.admin) return redirect(reply, '/admin');
    const body = request.body || {};
    const { errors, value } = validateLogin(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(reply, loginPage({ session: request.session, errors, values: body }), 400);
    }

    const user = await db.one(
      'select id, username, password_hash, status from users where email = $1',
      [value.email]
    );

    const matches = verifySecret(value.password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !matches) {
      request.log.warn({ email: value.email }, 'failed sign-in');
      return sendPage(
        reply,
        loginPage({
          session: request.session,
          values: { email: value.email },
          message: messageText('invalid-credentials'),
        }),
        401
      );
    }

    if (user.status === 'pending_verification') {
      return sendPage(
        reply,
        loginPage({ session: request.session, values: { email: value.email }, message: messageText('verify-required') }),
        403
      );
    }

    if (user.status !== 'active') {
      return sendPage(
        reply,
        loginPage({
          session: request.session,
          values: { email: value.email },
          message: messageText('invalid-credentials'),
        }),
        403
      );
    }

    await regenerateSession(request.session);
    request.session.userId = user.id;
    await saveSession(request.session);

    await db.query('update users set last_login_at = now() where id = $1', [user.id]);
    request.log.info({ userId: user.id }, 'sign-in');

    return redirect(reply, '/dashboard');
  });

  app.post('/logout', async (request, reply) => {
    await destroySession(request.session);
    return redirect(reply, '/login?notice=signed-out');
  });
}
