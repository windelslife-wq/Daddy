import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-completion-'));
process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-completion@example.test';
process.env.ADMIN_PASSWORD = 'CompletionAdmin2026!';
process.env.PUBLIC_BASE_URL = 'https://studio.example.com';
process.env.APP_URL = 'https://studio.example.com';
process.env.SMTP_URL = 'smtps://user:password@smtp.example.com:465';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';

for (const key of [
  'META_APP_ID', 'META_APP_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'NOTIFICATION_WEBHOOK_URL', 'NOTIFICATION_WEBHOOK_SECRET', 'DATABASE_URL',
]) delete process.env[key];

const { createApp } = await import('../server/app.js');
const { db, initDb, closeDb, json, now, newId } = await import('../server/db.js');
const { encrypt } = await import('../server/security.js');
const {
  buildCompletionAudit, setModuleConfirmation, recordModuleVerification,
  getConfirmations, getVerifications,
} = await import('../server/services/activation/completion.js');

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
const firstCookie = (r) => (r.headers.getSetCookie?.()[0] || r.headers.get('set-cookie') || '').split(';')[0];

before(async () => {
  await initDb();
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/auth/login', { method: 'POST', body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  adminCookie = firstCookie(login);
  const register = await request('/api/auth/register', { method: 'POST', body: { name: 'Completion User', email: 'completion-user@example.test', password: 'CompletionUser2026!' } });
  userCookie = firstCookie(register);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

const criterion = (audit, id, name) => audit.modules.find((m) => m.id === id).checks.find((c) => c.id === name);

test('audit covers all 15 modules with explicit done criteria', async () => {
  const audit = await buildCompletionAudit({ env: process.env });
  assert.equal(audit.summary.total, 15);
  assert.equal(audit.modules.length, 15);
  assert.deepEqual(audit.modules.map((m) => m.number), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.ok(audit.modules.every((m) => m.total >= 3), 'every module needs at least config + verification + evidence/manual criteria');
  assert.ok(audit.summary.criteriaTotal >= 45);
  assert.equal(audit.nextModule.id, 'facebook-pages');
  for (const m of audit.modules) {
    assert.ok(m.nextAction || m.complete, `${m.id} must state what to do next`);
    for (const c of m.checks) {
      assert.ok(['pass', 'pending'].includes(c.status));
      assert.ok(c.label && c.detail);
      if (c.status === 'pending') assert.ok(c.action, `${m.id}/${c.id} needs an action`);
    }
  }
});

test('module 15 has no impossible criteria and can eventually complete', async () => {
  const audit = await buildCompletionAudit({ env: process.env });
  const appReview = audit.modules.find((m) => m.id === 'app-review');
  for (const id of ['local-config', 'live-verified']) {
    assert.equal(appReview.checks.some((c) => c.id === id), false, `${id} can never pass for an external-only module`);
  }
  assert.ok(appReview.checks.length >= 3);
  assert.ok(appReview.checks.every((c) => c.status === 'pass' || c.action), 'every pending criterion must be actionable');
});

test('SMTP module is locally ready but not complete until verified and confirmed', async () => {
  let audit = await buildCompletionAudit({ env: process.env });
  const smtp = audit.modules.find((m) => m.id === 'smtp');
  assert.equal(criterion(audit, 'smtp', 'local-config').status, 'pass');
  assert.equal(criterion(audit, 'smtp', 'smtp-config').status, 'pass');
  assert.equal(criterion(audit, 'smtp', 'live-verified').status, 'pending');
  assert.equal(criterion(audit, 'smtp', 'manual-steps').status, 'pending');
  assert.equal(smtp.complete, false);

  await recordModuleVerification({
    id: 'smtp', status: 'verified', summary: 'ok', checkedAt: new Date().toISOString(),
    checks: [{ name: 'SMTP connection', status: 'pass', detail: 'accepted' }],
  });
  audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'smtp', 'live-verified').status, 'pass');
  assert.equal(audit.modules.find((m) => m.id === 'smtp').complete, false, 'manual steps still outstanding');

  const confirmation = await setModuleConfirmation('smtp', 'admin-1', { confirmed: true, note: 'SPF/DKIM verified' });
  assert.equal(confirmation.note, 'SPF/DKIM verified');
  audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'smtp', 'manual-steps').status, 'pass');
  assert.equal(audit.modules.find((m) => m.id === 'smtp').complete, true);
  assert.equal(audit.modules.find((m) => m.id === 'smtp').nextAction, null);
});

test('verification records and confirmations are persisted and readable', async () => {
  const verifications = await getVerifications();
  assert.equal(verifications.smtp.status, 'verified');
  assert.equal(verifications.smtp.checks.length, 1);
  const confirmations = await getConfirmations();
  assert.ok(confirmations.smtp.at);
  assert.equal(confirmations.smtp.by, 'admin-1');
});

test('unconfirming a module removes its completion', async () => {
  await setModuleConfirmation('smtp', 'admin-1', { confirmed: false });
  const audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'smtp', 'manual-steps').status, 'pending');
  assert.equal(audit.modules.find((m) => m.id === 'smtp').complete, false);
  await setModuleConfirmation('smtp', 'admin-1', { confirmed: true });
});

test('Stripe Price ID and webhook criteria react to real plan/event data', async () => {
  let audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'stripe', 'price-ids').status, 'pending');
  assert.equal(criterion(audit, 'stripe', 'webhook-events').status, 'pending');

  const paid = await db('plans').where('price_cents', '>', 0).select('id');
  for (const plan of paid) await db('plans').where({ id: plan.id }).update({ stripe_price_id: `price_test_${plan.id}` });
  await db('webhook_events').insert({
    id: newId('whk_'), provider: 'stripe', event_id: 'evt_completion_test',
    payload: json({ type: 'checkout.session.completed' }), processed_at: now(), created_at: now(),
  });

  audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'stripe', 'price-ids').status, 'pass');
  assert.equal(criterion(audit, 'stripe', 'webhook-events').status, 'pass');
});

test('connected accounts, scopes and live posts drive publishing-module criteria', async () => {
  const admin = await db('users').where({ email: process.env.ADMIN_EMAIL.toLowerCase() }).first();
  const accountId = newId('acc_');
  await db('accounts').insert({
    id: accountId, user_id: admin.id, platform: 'facebook', external_id: 'page-completion-1',
    display_name: 'Completion Test Page', status: 'connected', active: true, automation_enabled: true,
    credentials: encrypt({ accessToken: 'completion-token' }),
    scopes: json(['pages_manage_posts', 'pages_read_engagement']),
    permissions: json(['CREATE_CONTENT', 'pages_manage_posts']),
    metadata: json({}), created_at: now(), updated_at: now(),
  });
  let audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'facebook-pages', 'connected-account').status, 'pass');
  assert.equal(criterion(audit, 'facebook-pages', 'granted-scopes').status, 'pass');
  assert.equal(criterion(audit, 'facebook-pages', 'live-post').status, 'pending');

  await db('posts').insert({
    id: 'post_completion_1', user_id: admin.id, project_id: 'prj_completion_1',
    scheduled_at: now(), status: 'published', review_required: false, reviewed_at: now(),
    captions: json({}), hashtags: json({}), metadata: json({}), created_at: now(), updated_at: now(),
  });
  await db('publications').insert({
    id: newId('pub_'), post_id: 'post_completion_1', account_id: accountId, user_id: admin.id,
    status: 'published', attempts: 1, max_attempts: 5,
    idempotency_key: 'completion-idem-1', ref_code: 'Ref:completion1',
    remote_id: 'remote-1', remote_url: 'https://facebook.com/completion-1',
    remote_data: json({}), metadata: json({}), created_at: now(), updated_at: now(), published_at: now(),
  });
  audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'facebook-pages', 'live-post').status, 'pass');
});

test('stored credentials that cannot be decrypted fail the encryption-key criterion', async () => {
  let audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'encryption-key', 'stored-credentials').status, 'pass');

  const admin = await db('users').where({ email: process.env.ADMIN_EMAIL.toLowerCase() }).first();
  await db('accounts').insert({
    id: newId('acc_'), user_id: admin.id, platform: 'x', external_id: 'broken-credentials',
    display_name: 'Broken key account', status: 'expired', active: false, automation_enabled: false,
    credentials: 'v1.corrupt.payload.here', scopes: json([]), permissions: json([]),
    metadata: json({}), created_at: now(), updated_at: now(),
  });
  audit = await buildCompletionAudit({ env: process.env });
  const check = criterion(audit, 'encryption-key', 'stored-credentials');
  assert.equal(check.status, 'pending');
  assert.match(check.detail, /cannot be decrypted|rotated/);
});

test('GET /api/admin/activation/audit is admin-only', async () => {
  assert.equal((await request('/api/admin/activation/audit')).status, 401);
  assert.equal((await request('/api/admin/activation/audit', { cookie: userCookie })).status, 403);
  const response = await request('/api/admin/activation/audit', { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.summary.total, 15);
  assert.ok(response.data.nextModule);
});

test('POST confirm persists and is audit-logged; unknown module returns 404', async () => {
  const response = await request('/api/admin/activation/research/confirm', {
    method: 'POST', cookie: adminCookie, body: { confirmed: true, note: 'billing cap set' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.confirmation.note, 'billing cap set');
  const audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'research', 'manual-steps').status, 'pass');

  const logs = await request('/api/admin/audit-logs', { cookie: adminCookie });
  assert.ok(logs.data.logs.some((l) => l.action === 'admin.activation.confirm' && l.entityId === 'research'));

  assert.equal((await request('/api/admin/activation/nope/confirm', { method: 'POST', cookie: adminCookie, body: {} })).status, 404);
});

test('verifying through the API records the result for the completion audit', async () => {
  const before = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(before, 'app-review', 'live-verified'), undefined, 'module 15 has no live verifier criterion');

  const response = await request('/api/admin/activation/encryption-key/verify', { method: 'POST', cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.data.status, 'verified');
  const audit = await buildCompletionAudit({ env: process.env });
  assert.equal(criterion(audit, 'encryption-key', 'live-verified').status, 'pass');
});
