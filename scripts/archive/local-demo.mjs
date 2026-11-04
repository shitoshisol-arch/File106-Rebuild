// Local machine server for FILE106 + the Admin Control Room.
//
// Runs the exact Fastify application and PostgreSQL migrations on an embedded
// file-backed PostgreSQL engine (PGlite at var/local-pgdata), so no external
// Postgres or Docker process is required on Windows.

import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { loadConfig } from '../../app/config.js';
import { createDb } from '../../app/db.js';
import { applyMigrations } from '../../app/migrate.js';
import { createMailer } from '../../app/lib/mailer.js';
import { createRpcBalanceReader, createRpcTransactionVerifier } from '../../app/lib/solana.js';
import { runArchiveScheduler } from '../../app/routes/archive.js';
import { ensureNetworkInvestigations } from '../../app/routes/controlRoom.js';
import { buildServer } from '../../app/server.js';

mkdirSync('var/local-pgdata', { recursive: true });
mkdirSync('var/uploads', { recursive: true });

const pglite = new PGlite('var/local-pgdata');
const db = createDb({
  query: (text, params) => pglite.query(text, params),
  exec: (text) => pglite.exec(text),
  close: () => pglite.close(),
});

await applyMigrations({ db, log: console });
await ensureNetworkInvestigations(db);
await runArchiveScheduler(db);

const config = loadConfig({
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3000',
  SITE_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_SECRET: 'local-dev-session-secret-file106-control-room-64-chars-minimum!!',
  ANSWER_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  F106_MINT_ADDRESS: 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE',
  F106_DECIMALS: '8',
  ALLOW_PREVIEW_FRAMING: 'true',
});

const balanceReader = createRpcBalanceReader(config.solana);
const transactionVerifier = createRpcTransactionVerifier(config.solana);
const mailer = createMailer(config);

const app = await buildServer({
  config,
  db,
  balanceReader,
  transactionVerifier,
  mailer,
  logger: { level: 'info' },
});

await app.listen({ port: config.port, host: config.host });
console.log(`\nFILE106 Local Control Room running at: http://127.0.0.1:${config.port}`);
console.log(`  First-run Owner Setup : http://127.0.0.1:${config.port}/admin/setup`);
console.log(`  Admin Sign-In         : http://127.0.0.1:${config.port}/admin/login`);
console.log(`  Control Room          : http://127.0.0.1:${config.port}/admin`);
console.log(`  Public Archive        : http://127.0.0.1:${config.port}/archive\n`);
