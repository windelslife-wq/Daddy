import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-postgres-worker-'));
let env;
let db;
let closeDb;
let addJob;
let initDb;
let tableDefinitions;
let initializeDatabase;
let pgKnex;
const workers = [];
const jobIds = [];

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function poll(label, fn, timeoutMs = 30000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

before(async () => {
  env = {
    ...process.env,
    NODE_ENV: 'test',
    SKIP_FRONTEND: 'true',
    SEED_DEMO: 'false',
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
    DATABASE_URL: '',
    DATA_DIR: path.join(tempDir, 'data'),
    STORAGE_DIR: path.join(tempDir, 'storage'),
    SQLITE_PATH: path.join(tempDir, 'app.sqlite3'),
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
    TRUST_PROXY: 'false',
    SECURE_COOKIES: 'false',
    WORKER_ENABLED: 'false',
    LOG_LEVEL: 'info',
  };
  await fs.mkdir(env.DATA_DIR, { recursive: true });
  await fs.mkdir(env.STORAGE_DIR, { recursive: true });
  Object.assign(process.env, env);
  const dbModule = await import('../server/db.js');
  ({ db, closeDb, addJob, initDb, tableDefinitions, initializeDatabase } = dbModule);
  await initDb();

  const { newDb } = await import('pg-mem');
  const mem = newDb({ noAstCoverageCheck: true, autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({ name: 'current_database', implementation: () => 'faceless_test' });
  pgKnex = mem.adapters.createKnex();
  await initializeDatabase(pgKnex, { seedDemo: false, adminEmail: '', adminPassword: '', log: { info() {}, warn() {} } });

  for (let index = 0; index < 2; index += 1) {
    const port = await freePort();
    const workerEnv = {
      ...env,
      PORT: String(port),
      HOST: '127.0.0.1',
      WORKER_ENABLED: 'true',
      WORKER_POLL_MS: '100',
      WORKER_CONCURRENCY: '3',
      WORKER_MAX_ATTEMPTS: '1',
      API_RATE_LIMIT_PER_MINUTE: '5000',
    };
    const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: workerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    let exited = null;
    child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
    child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
    child.on('exit', (code) => { exited = code; });
    workers.push({ child, logs: () => logs, exited: () => exited, port, base: `http://127.0.0.1:${port}` });
  }
  for (const worker of workers) {
    await poll(`worker ${worker.port} health`, async () => {
      if (worker.exited() !== null) throw new Error(`Worker exited early: ${worker.logs().slice(-2000)}`);
      try { return (await fetch(`${worker.base}/api/meta/health`)).ok; } catch { return false; }
    }, 30000, 150);
  }
});

after(async () => {
  for (const worker of workers) {
    if (worker.exited() === null) {
      worker.child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => worker.child.once('exit', resolve)), wait(5000)]);
      if (worker.exited() === null) worker.child.kill('SIGKILL');
    }
  }
  if (pgKnex) await pgKnex.destroy();
  if (closeDb) await closeDb();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test('PostgreSQL schema and critical job SQL are compatible with the pg dialect', async () => {
  const expectedTables = Object.keys(tableDefinitions);
  for (const table of expectedTables) {
    assert.equal(await pgKnex.schema.hasTable(table), true, `${table} missing from PostgreSQL schema`);
  }
  const plans = await pgKnex('plans').count({ count: '*' }).first();
  const settings = await pgKnex('settings').count({ count: '*' }).first();
  assert.equal(Number(plans.count), 4);
  assert.equal(Number(settings.count), 11);

  const timestamp = new Date().toISOString();
  await pgKnex('post_metrics').insert({
    id: 'met_pg_1', publication_id: 'pub_pg_1', views: 100, likes: 8, comments: 3, shares: 2,
    impressions: 500, watch_seconds: 240, engagement_rate: 0.13, raw: '{}', fetched_at: timestamp,
  });
  const metric = await pgKnex('post_metrics').where({ id: 'met_pg_1' }).first();
  assert.equal(Number(metric.watch_seconds), 240);

  await pgKnex('jobs').insert({
    id: 'job_pg_1', type: 'cleanup', payload: '{}', status: 'queued', run_at: timestamp,
    attempts: 0, max_attempts: 1, priority: 9, created_at: timestamp, updated_at: timestamp,
  });
  const firstClaim = await pgKnex('jobs').where({ id: 'job_pg_1', status: 'queued' }).update({ status: 'running', attempts: 1 });
  const secondClaim = await pgKnex('jobs').where({ id: 'job_pg_1', status: 'queued' }).update({ status: 'running', attempts: 1 });
  assert.equal(firstClaim, 1);
  assert.equal(secondClaim, 0);
});

test('two worker processes share the SQLite database without double-claiming jobs', async () => {
  for (let index = 0; index < 30; index += 1) {
    const id = await addJob('cleanup', { index }, { dedupeKey: `multi-worker:${index}`, priority: 9, maxAttempts: 1 });
    jobIds.push(id);
  }
  const rows = await poll('all multi-worker jobs completed once', async () => {
    const found = await db('jobs').whereIn('id', jobIds);
    const failed = found.filter((job) => job.status === 'failed');
    if (failed.length) throw new Error(`Jobs failed: ${failed.map((job) => job.last_error).join('; ')}`);
    const completed = found.filter((job) => job.status === 'completed' && Number(job.attempts) === 1);
    return completed.length === jobIds.length ? found : false;
  }, 60000, 300);
  assert.equal(rows.length, jobIds.length);
  assert.ok(rows.every((job) => Number(job.attempts) === 1));
  assert.ok(rows.every((job) => job.status === 'completed'));
  for (const worker of workers) {
    assert.ok(jobIds.some((id) => worker.logs().includes(id)), 'expected both worker processes to claim at least one job');
  }
});
