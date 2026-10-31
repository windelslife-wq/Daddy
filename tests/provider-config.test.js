/**
 * Super Admin provider configuration.
 *
 * Proves the whole contract end to end: admin-only access, encrypted storage,
 * environment fallback, immediate effect on the live config, refusal to activate a
 * provider whose credential is missing, and audit entries that name credentials
 * without ever recording their values.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcl-providers-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.DEMO_EMAIL = 'provider-owner@example.test';
process.env.DEMO_PASSWORD = 'ProviderOwner2026!';
process.env.ADMIN_EMAIL = 'provider-admin@example.test';
process.env.ADMIN_PASSWORD = 'ProviderAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8898';
process.env.APP_URL = 'http://127.0.0.1:8898';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'none';
process.env.ANTHROPIC_API_KEY = 'sk-ant-environment-key-0001';
for (const key of ['OPENAI_API_KEY', 'REPLICATE_API_TOKEN', 'FAL_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_VEO_API_KEY', 'ELEVENLABS_API_KEY', 'SEARCH_API_KEY', 'DATABASE_URL']) {
  delete process.env[key];
}

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { decrypt } = await import('../server/security.js');
const { config } = await import('../server/config.js');

const OPENAI_KEY = 'sk-dashboard-test-abcdefghijklmnop';
const ANTHROPIC_DASHBOARD_KEY = 'sk-ant-dashboard-test-0001';
let server;
let base;
let adminCookie;
let ownerCookie;

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, raw: text, headers: response.headers };
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const admin = await request('/api/auth/login', { method: 'POST', body: { email: 'provider-admin@example.test', password: 'ProviderAdmin2026!' } });
  assert.equal(admin.status, 200);
  adminCookie = admin.headers.get('set-cookie').split(';')[0];
  const owner = await request('/api/auth/login', { method: 'POST', body: { email: 'provider-owner@example.test', password: 'ProviderOwner2026!' } });
  assert.equal(owner.status, 200);
  ownerCookie = owner.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('provider configuration is Super Admin only', async () => {
  assert.equal((await request('/api/admin/providers')).status, 401);
  assert.equal((await request('/api/admin/providers', { cookie: ownerCookie })).status, 403);
  assert.equal((await request('/api/admin/providers', { method: 'PUT', cookie: ownerCookie, body: { active: { ai: 'local' } } })).status, 403);
  assert.equal((await request('/api/admin/providers/test', { method: 'POST', cookie: ownerCookie, body: { target: 'openaiKey' } })).status, 403);
});

test('the dashboard lists every modality, credential and model with its provenance', async () => {
  const response = await request('/api/admin/providers', { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.modalities.length, 5);
  assert.deepEqual(response.data.modalities.map((item) => item.id), ['ai', 'research', 'images', 'tts', 'film']);
  assert.equal(response.data.secrets.length, 8);
  assert.equal(response.data.models.length, 10);
  assert.equal(response.data.encryptionActive, true);
  assert.equal(response.data.status.ai.active, 'local');

  const mod = Object.fromEntries(response.data.modalities.map((item) => [item.id, item]));
  assert.equal(mod.ai.active, 'local');
  assert.equal(mod.ai.inherited, 'local');
  assert.equal(mod.ai.source, 'environment');
  assert.deepEqual(mod.ai.options.map((option) => option.id), ['local', 'openai', 'anthropic', 'gemini']);
  assert.equal(mod.ai.options.find((option) => option.id === 'anthropic').ready, true, 'environment key counts as ready');
  assert.equal(mod.ai.options.find((option) => option.id === 'openai').ready, false);

  const secrets = Object.fromEntries(response.data.secrets.map((item) => [item.id, item]));
  assert.equal(secrets.anthropicKey.source, 'environment');
  assert.equal(secrets.anthropicKey.configured, true);
  assert.equal(secrets.anthropicKey.last4, null, 'environment keys are never mirrored into the dashboard');
  assert.equal(secrets.openaiKey.configured, false);
  assert.equal(secrets.openaiKey.source, null);

  // Nothing in the payload may resemble a credential value.
  assert.ok(!response.raw.includes('sk-ant-environment-key-0001'));
});

test('a credential saved in the dashboard is encrypted at rest and never returned', async () => {
  const saved = await request('/api/admin/providers', {
    method: 'PUT',
    cookie: adminCookie,
    body: { secrets: { openaiKey: OPENAI_KEY }, active: { ai: 'openai' } },
  });
  assert.equal(saved.status, 200, saved.raw);

  const row = await db('provider_config').where({ id: 'default' }).first();
  assert.ok(row, 'the configuration row is persisted');
  const stored = JSON.parse(row.secrets);
  assert.ok(stored.openaiKey.ct.startsWith('v1.'), 'the ciphertext envelope is versioned');
  assert.equal(stored.openaiKey.last4, OPENAI_KEY.slice(-4));
  assert.ok(!row.secrets.includes(OPENAI_KEY), 'the plaintext key is not in the table');
  assert.equal(decrypt(stored.openaiKey.ct), OPENAI_KEY);

  const openai = saved.data.secrets.find((item) => item.id === 'openaiKey');
  assert.equal(openai.source, 'dashboard');
  assert.equal(openai.last4, OPENAI_KEY.slice(-4));
  assert.ok(!saved.raw.includes(OPENAI_KEY), 'the API never echoes the key back');

  // The change is live: status and the shared config object both follow.
  assert.equal(saved.data.status.ai.active, 'openai');
  assert.equal(saved.data.status.ai.configured, true);
  assert.equal(config.ai.provider, 'openai');
  assert.equal(config.ai.openaiKey, OPENAI_KEY);
  assert.equal(saved.data.modalities.find((item) => item.id === 'ai').source, 'dashboard');
  assert.equal(saved.data.modalities.find((item) => item.id === 'ai').options.find((option) => option.id === 'openai').ready, true);

  const publicStatus = await request('/api/meta/status');
  assert.equal(publicStatus.data.ai.active, 'openai');
  assert.equal(publicStatus.data.ai.configured, true);
  assert.ok(!publicStatus.raw.includes(OPENAI_KEY), 'public status never carries a credential');
});

test('a provider cannot be activated without its credential', async () => {
  const response = await request('/api/admin/providers', {
    method: 'PUT',
    cookie: adminCookie,
    body: { active: { film: 'replicate' } },
  });
  assert.equal(response.status, 400);
  assert.equal(response.data.error.code, 'provider_credential_missing');
  assert.match(response.data.error.message, /Replicate API token/);
  assert.equal(config.film.videoProvider, 'none', 'a rejected change leaves the live config untouched');
});

test('a credential that an active provider depends on cannot be removed', async () => {
  const response = await request('/api/admin/providers', {
    method: 'PUT',
    cookie: adminCookie,
    body: { secrets: { openaiKey: null } },
  });
  assert.equal(response.status, 400);
  assert.equal(response.data.error.code, 'provider_credential_missing');
  assert.equal(config.ai.openaiKey, OPENAI_KEY);
});

test('clearing a dashboard value falls back to the environment', async () => {
  const cleared = await request('/api/admin/providers', {
    method: 'PUT',
    cookie: adminCookie,
    body: { active: { ai: 'local' }, secrets: { openaiKey: null } },
  });
  assert.equal(cleared.status, 200, cleared.raw);
  const openai = cleared.data.secrets.find((item) => item.id === 'openaiKey');
  assert.equal(openai.configured, false);
  assert.equal(openai.source, null);
  assert.equal(config.ai.openaiKey, '', 'the live config returns to the environment value');

  const overridden = await request('/api/admin/providers', {
    method: 'PUT',
    cookie: adminCookie,
    body: { active: { ai: 'anthropic' }, secrets: { anthropicKey: ANTHROPIC_DASHBOARD_KEY } },
  });
  assert.equal(overridden.status, 200, overridden.raw);
  assert.equal(config.ai.anthropicKey, ANTHROPIC_DASHBOARD_KEY);

  const restored = await request('/api/admin/providers', {
    method: 'PUT',
    cookie: adminCookie,
    body: { active: { ai: 'local' }, secrets: { anthropicKey: null } },
  });
  assert.equal(restored.status, 200, restored.raw);
  const anthropic = restored.data.secrets.find((item) => item.id === 'anthropicKey');
  assert.equal(anthropic.source, 'environment');
  assert.equal(config.ai.anthropicKey, 'sk-ant-environment-key-0001');
});

test('model overrides apply and can be handed back to the environment', async () => {
  const set = await request('/api/admin/providers', {
    method: 'PUT', cookie: adminCookie, body: { models: { openaiModel: 'gpt-4o-2024-11-20' } },
  });
  assert.equal(set.status, 200, set.raw);
  assert.equal(config.ai.openaiModel, 'gpt-4o-2024-11-20');
  const field = set.data.models.find((item) => item.id === 'openaiModel');
  assert.equal(field.source, 'dashboard');
  assert.equal(field.value, 'gpt-4o-2024-11-20');

  const reset = await request('/api/admin/providers', {
    method: 'PUT', cookie: adminCookie, body: { models: { openaiModel: '' } },
  });
  assert.equal(reset.status, 200, reset.raw);
  assert.equal(config.ai.openaiModel, reset.data.models.find((item) => item.id === 'openaiModel').inherited);
  assert.equal(reset.data.models.find((item) => item.id === 'openaiModel').source, 'environment');
});

test('invalid selections, model text and credentials are rejected with a reason', async () => {
  const badProvider = await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: { active: { ai: 'skynet' } } });
  assert.equal(badProvider.status, 400);

  const badModality = await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: { active: { quantum: 'local' } } });
  assert.equal(badModality.status, 400);

  const shortKey = await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: { secrets: { openaiKey: 'abc' } } });
  assert.equal(shortKey.status, 400);

  const spaces = await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: { secrets: { openaiKey: 'sk-abcdefgh ijklmnop' } } });
  assert.equal(spaces.status, 400);
  assert.match(spaces.data.error.message, /spaces/);

  const badModel = await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: { models: { openaiModel: 'bad model name; drop table' } } });
  assert.equal(badModel.status, 400);

  const empty = await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: {} });
  assert.equal(empty.status, 400);
});

test('credential tests are real probes and never leak the key', async () => {
  const unknown = await request('/api/admin/providers/test', { method: 'POST', cookie: adminCookie, body: { target: 'nope' } });
  assert.equal(unknown.status, 400);

  const missing = await request('/api/admin/providers/test', { method: 'POST', cookie: adminCookie, body: { target: 'replicateToken' } });
  assert.equal(missing.status, 200);
  assert.equal(missing.data.checked, false);
  assert.equal(missing.data.code, 'missing_credential');
  assert.ok(!missing.raw.includes('r8_'));

  // fal.ai has no credential endpoint; the honest answer is "not checkable",
  // never a fabricated success.
  await request('/api/admin/providers', { method: 'PUT', cookie: adminCookie, body: { secrets: { falKey: 'fal-key-id:fal-key-secret' } } });
  const fal = await request('/api/admin/providers/test', { method: 'POST', cookie: adminCookie, body: { target: 'falKey' } });
  assert.equal(fal.status, 200);
  assert.equal(fal.data.checked, false);
  assert.equal(fal.data.code, 'no_status_endpoint');
  assert.ok(!fal.raw.includes('fal-key-secret'));
});

test('the audit log records which credentials changed, never their values', async () => {
  const rows = await db('audit_logs').where({ action: 'admin.providers.update' }).orderBy('created_at', 'desc');
  assert.ok(rows.length >= 1);
  const all = JSON.stringify(rows);
  assert.ok(!all.includes(OPENAI_KEY), 'no audit entry contains a plaintext key');
  assert.ok(!all.includes(ANTHROPIC_DASHBOARD_KEY));
  assert.ok(rows.some((row) => String(row.details).includes('openaiKey')));

  const testRows = await db('audit_logs').where({ action: 'admin.providers.test' });
  assert.ok(testRows.length >= 1);
});

test('saved configuration survives a restart and reloads from the database', async () => {
  await request('/api/admin/providers', {
    method: 'PUT', cookie: adminCookie, body: { secrets: { replicateToken: 'r8_dashboard_token_123456' }, active: { images: 'replicate' } },
  });
  const { loadProviderConfig } = await import('../server/providerConfig.js');

  // Simulate a fresh boot: reset the shared config to environment values first.
  config.ai.provider = 'local';
  config.media.replicateToken = '';
  await loadProviderConfig();
  assert.equal(config.media.imageProvider, 'replicate');
  assert.equal(config.media.replicateToken, 'r8_dashboard_token_123456');
  assert.equal(config.film.replicateToken, 'r8_dashboard_token_123456', 'one token feeds both image and film providers');
});
