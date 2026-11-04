// The home page: serves the File106-Rebuild story experience at / and injects
// both the per-session CSRF token and any published Secret Files from Postgres
// into Section 03 (#fileList).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { csrfToken } from '../lib/csrf.js';
import { escape } from '../lib/html.js';
import { HTML } from '../lib/reply.js';
import { runArchiveScheduler } from './archive.js';

const here = dirname(fileURLToPath(import.meta.url));
const CSRF_MARKER = '<!-- F106_CSRF -->';
const FILES_MARKER = '<!-- F106_DYNAMIC_FILES -->';

function renderPublishedRow(file) {
  const num = String(file.file_number).padStart(3, '0');
  const subtitle = file.subtitle ? `${file.subtitle} — ${file.teaser}` : file.teaser;
  const rewardBadge =
    file.rewards_enabled === false ? '' : ` · ${escape(String(file.reward))} F106`;
  const isLocked = file.status === 'locked' || file.status === 'closed';
  const statusLabel =
    file.status === 'open'
      ? 'OPEN <b>↗</b>'
      : file.status === 'completed'
        ? 'COMPLETED <b>✓</b>'
        : `${escape(String(file.status).toUpperCase())} <b>⌑</b>`;

  return `<a class="file-row ${isLocked ? 'locked' : 'available'}" href="/archive/${escape(file.slug)}">` +
    `<span class="file-id">FILE_${escape(num)}</span>` +
    `<span class="file-title">${escape(file.title)}<small>${escape(subtitle)}${rewardBadge}</small></span>` +
    `<span class="file-status">${statusLabel}</span>` +
    `</a>`;
}

export async function homeRoutes(app, { db, config }) {
  const pagePath = resolve(here, '..', '..', config.trustPageRoot, 'index.html');
  const template = readFileSync(pagePath, 'utf8');

  app.get('/index.html', async (request, reply) => reply.code(301).header('location', '/').send());

  app.get('/', async (request, reply) => {
    const token = csrfToken(request.session);
    let body = template.includes(CSRF_MARKER)
      ? template.replace(CSRF_MARKER, `<meta name="csrf-token" content="${token}">`)
      : template;

    if (db && body.includes(FILES_MARKER)) {
      try {
        await runArchiveScheduler(db);
        const published = await db.many(
          `select file_number, slug, title, subtitle, teaser, status,
                  reward_amount_f106::text as reward, rewards_enabled
             from files
            where is_enabled and status in ('open', 'locked', 'closed', 'completed')
            order by sort_order asc, file_number asc`
        );
        const rendered = published.map(renderPublishedRow).join('\n    ');
        body = body.replace(FILES_MARKER, rendered);
      } catch (error) {
        request.log.warn({ err: error.message }, 'could not load dynamic files for home page');
      }
    }

    return reply
      .code(200)
      .header('cache-control', 'no-store')
      .header('vary', 'cookie')
      .type(HTML)
      .send(body);
  });
}
