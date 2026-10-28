import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-activation-'));
process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-activation@example.test';
process.env.ADMIN_PASSWORD = 'ActivationAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8787';
process.env.APP_URL = 'http://127.0.0.1:8787';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';

// Guarantee the verification endpoint has nothing to contact.
for (const key of [
  'META_APP_ID', 'META_APP_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'SMTP_URL', 'NOTIFICATION_WEBHOOK_URL', 'NOTIFICATION_WEBHOOK_SECRET',
  'DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'SEARCH_API_KEY', 'REPLICATE_API_TOKEN', 'ELEVENLABS_API_KEY',
]) delete process.env[key];

const { createApp } = await import('../server/app.js');
const { closeDb } = await import('../server/db.js');

let server;
let base;
let adminCookie;
let userCookie;

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

function firstCookie(response) {
  const cookies = response.headers.getSetCookie?.() || [];
  const raw = cookies[0] || response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await request('/api/auth/login', {
    method: 'POST', body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.data)}`);
  adminCookie = firstCookie(login);
  assert.ok(adminCookie, 'expected a session cookie');

  const register = await request('/api/auth/register', {
    method: 'POST', body: { name: 'Activation User', email: 'activation-user@example.test', password: 'ActivationUser2026!' },
  });
  assert.equal(register.status, 201, `register failed: ${JSON.stringify(register.data)}`);
  userCookie = firstCookie(register);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('GET /api/admin/activation returns the 15-module offline report', async () => {
  const response = await request('/api/admin/activation', { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.summary.total, 15);
  assert.equal(response.data.modules.length, 15);
  assert.deepEqual(response.data.modules.map((m) => m.number), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.ok(response.data.global.length > 0);
  const fb = response.data.modules.find((m) => m.id === 'facebook-pages');
  assert.ok(fb.callbacks[0].url.includes('/api/oauth/facebook/callback'));
  assert.ok(fb.envSpecs.length > 0);
});

test('activation report contains no secret values', async () => {
  const response = await request('/api/admin/activation', { cookie: adminCookie });
  assert.ok(!JSON.stringify(response.data).includes(process.env.APP_ENCRYPTION_KEY));
  assert.ok(!JSON.stringify(response.data).includes(process.env.ADMIN_PASSWORD));
});

test('non-admin users cannot read the activation report', async () => {
  const response = await request('/api/admin/activation', { cookie: userCookie });
  assert.equal(response.status, 403);
});

test('unauthenticated requests are rejected', async () => {
  assert.equal((await request('/api/admin/activation')).status, 401);
  assert.equal((await request('/api/admin/activation/facebook-pages/verify', { method: 'POST' })).status, 401);
});

test('POST verify returns a real result without contacting a provider', async () => {
  const response = await request('/api/admin/activation/facebook-pages/verify', { method: 'POST', cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.id, 'facebook-pages');
  assert.equal(response.data.status, 'unconfigured');
  assert.match(response.data.action, /META_APP_ID/);
  assert.ok(!JSON.stringify(response.data).includes('graph.facebook.com'));
});

test('POST verify on module 14 succeeds offline when a key is configured', async () => {
  const response = await request('/api/admin/activation/encryption-key/verify', { method: 'POST', cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.status, 'verified');
  assert.match(response.data.checks[0].detail, /encrypts and decrypts/);
});

test('POST verify on module 15 stays manual', async () => {
  const response = await request('/api/admin/activation/app-review/verify', { method: 'POST', cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.status, 'unsupported');
});

test('unknown module id returns 404', async () => {
  const response = await request('/api/admin/activation/not-a-module/verify', { method: 'POST', cookie: adminCookie });
  assert.equal(response.status, 404);
});

test('verification is written to the audit log', async () => {
  const response = await request('/api/admin/audit-logs', { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.ok(response.data.logs.some((log) => log.action === 'admin.activation.verify' && log.entityType === 'activation_module'));
});
