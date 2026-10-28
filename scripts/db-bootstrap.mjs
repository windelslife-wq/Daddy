#!/usr/bin/env node
/**
 * Real PostgreSQL bootstrap + two-worker safety check for activation module 13.
 *
 * Connects to DATABASE_URL with the real `pg` driver, creates/verifies every
 * table via the application's own schema definition, then proves that two
 * concurrent processes cannot claim the same job (the conditional UPDATE used
 * by server/worker.js). It only creates a temporary probe job and removes it.
 *
 *   DATABASE_URL=postgresql://… npm run db:bootstrap
 *   docker compose run --rm db-bootstrap
 */
import { Client } from 'pg';
import crypto from 'node:crypto';

const url = process.env.DATABASE_URL || '';
const json = process.argv.includes('--json');
const out = [];
function note(name, ok, detail) {
  out.push({ name, ok, detail });
}
function safeUrl(value) {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}:${u.port || 5432}${u.pathname}`; }
  catch { return '(invalid URL)'; }
}

if (!/^postgres(?:ql)?:\/\//.test(url)) {
  if (json) console.log(JSON.stringify({ ok: false, error: 'DATABASE_URL must be a postgresql:// URL.' }, null, 2));
  else console.error('DATABASE_URL is not set to a PostgreSQL URL. Module 13 needs a real instance.\n');
  process.exit(1);
}

const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
let probeId = null;

try {
  await client.connect();
  const who = await client.query('SELECT current_database() AS db, current_user AS usr, version() AS version');
  note('connection', true, `Connected to ${who.rows[0].db} as ${who.rows[0].usr} (${String(who.rows[0].version).split(' ').slice(0, 2).join(' ')}).`);

  // Use the application's own schema so the check can never drift from the app.
  const { initializeDatabase, tableDefinitions, db, closeDb } = await import('../server/db.js');
  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  await initializeDatabase(db, {
    seedDemo: false, adminEmail: '', adminPassword: '', log: silent,
  });
  await closeDb();
  note('schema', true, `All ${Object.keys(tableDefinitions).length} application tables exist (created if missing).`);

  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.tablename);
  const missing = Object.keys(tableDefinitions).filter((name) => !tables.includes(name));
  note('tables present', missing.length === 0,
    missing.length ? `Missing: ${missing.join(', ')}` : `${tables.length} public tables verified in the real database.`);

  // Conditional claim: two "workers" race for the same probe job. Exactly one UPDATE must win.
  probeId = `probe_${crypto.randomUUID()}`;
  // The app stores timestamps as ISO strings, not SQL timestamps — match that.
  const stamp = new Date().toISOString();
  await client.query(
    `INSERT INTO jobs (id, type, payload, status, attempts, run_at, created_at, updated_at)
     VALUES ($1, 'deploy_probe', '{}', 'queued', 0, $2, $2, $2)`,
    [probeId, stamp],
  );
  const other = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await other.connect();
  const tokenA = `bootstrap-a-${crypto.randomUUID().slice(0, 8)}`;
  const tokenB = `bootstrap-b-${crypto.randomUUID().slice(0, 8)}`;
  const claim = (c, token) => c.query(
    "UPDATE jobs SET status = 'running', locked_at = $3, locked_by = $2, attempts = attempts + 1 WHERE id = $1 AND status = 'queued'",
    [probeId, token, new Date().toISOString()],
  );
  const [a, b] = await Promise.all([claim(client, tokenA), claim(other, tokenB)]);
  const winners = [a, b].filter((r) => r.rowCount === 1).length;
  note('two-worker claim', winners === 1,
    winners === 1
      ? 'Exactly one of two concurrent workers claimed the probe job — no double processing.'
      : `Expected 1 winner, got ${winners}. Conditional job claims are not safe on this database.`);
  const row = (await client.query('SELECT locked_by, attempts FROM jobs WHERE id = $1', [probeId])).rows[0];
  note('single execution', row?.attempts === 1,
    `Probe job attempts=${row?.attempts}, locked_by=${row?.locked_by || 'none'}.`);
  await other.end();

  const ok = out.every((r) => r.ok);
  if (json) {
    console.log(JSON.stringify({ ok, generatedAt: new Date().toISOString(), database: safeUrl(url), checks: out }, null, 2));
  } else {
    console.log(`\nPostgreSQL bootstrap — ${safeUrl(url)}\n`);
    for (const r of out) console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`);
    console.log(`\n  ${ok ? 'OK — database is ready for multiple worker processes.' : 'NOT READY — fix the failures above.'}\n`);
  }
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  const message = String(error?.message || error);
  // Never echo a connection string that may contain a password.
  const scrubbed = message.replace(url, safeUrl(url));
  if (json) console.log(JSON.stringify({ ok: false, error: scrubbed, checks: out }, null, 2));
  else console.error(`\nDatabase bootstrap failed: ${scrubbed}\n`);
  process.exitCode = 1;
} finally {
  if (probeId) {
    try { await client.query('DELETE FROM jobs WHERE id = $1 AND type = $2', [probeId, 'deploy_probe']); } catch { /* best effort */ }
  }
  try { await client.end(); } catch { /* already closed */ }
}
