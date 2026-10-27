import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-revoke-'));
const requests = [];
const webhookSecret = 'webhook-test-secret';

function respond(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const providerServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk.toString('utf8'); });
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/webhook') return respond(res, 200, { received: true });
    if (req.url?.startsWith('/v26.0/me/permissions')) return respond(res, 200, { success: true });
    if (req.url?.startsWith('/revoke')) return respond(res, 200, {});
    if (req.url?.startsWith('/1.1/oauth/invalidate_token.json')) return respond(res, 200, { access_token: 'revoked-token' });
    return respond(res, 404, { error: 'not_found' });
  });
});
await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
const providerBase = `http://127.0.0.1:${providerServer.address().port}`;

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.SEED_DEMO = 'false';
process.env.ADMIN_EMAIL = '';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.META_GRAPH_BASE_URL = providerBase;
process.env.GOOGLE_OAUTH_BASE_URL = providerBase;
process.env.X_OAUTH_BASE_URL = providerBase;
process.env.X_CONSUMER_KEY = 'consumer-key';
process.env.X_CONSUMER_SECRET = 'consumer-secret';
process.env.NOTIFICATION_WEBHOOK_URL = `${providerBase}/webhook`;
process.env.NOTIFICATION_WEBHOOK_SECRET = webhookSecret;
process.env.NOTIFICATION_WEBHOOK_TIMEOUT_MS = '3000';

const { attemptRemoteRevoke } = await import('../server/routes/accounts.js');
const { encrypt } = await import('../server/security.js');
const { initDb, notify, closeDb } = await import('../server/db.js');
const { deliverNotificationWebhook } = await import('../server/services/notificationWebhook.js');

await initDb();

function account(platform, credentials) {
  return { id: `acc_${platform}`, platform, credentials: encrypt(credentials), metadata: '{}' };
}

test('Google, Meta, and X connections revoke provider-side tokens', async () => {
  const google = await attemptRemoteRevoke(account('youtube', { accessToken: 'google-access', refreshToken: 'google-refresh' }));
  assert.equal(google.revoked, true);
  assert.equal(google.provider, 'google');

  const meta = await attemptRemoteRevoke(account('facebook', { userAccessToken: 'meta-user', accessToken: 'meta-page' }));
  assert.equal(meta.revoked, true);
  assert.equal(meta.provider, 'meta');

  const x = await attemptRemoteRevoke(account('x', { oauthToken: 'x-access', oauthTokenSecret: 'x-secret' }));
  assert.equal(x.revoked, true);
  assert.equal(x.provider, 'x');

  assert.ok(requests.some((request) => request.url.startsWith('/revoke?token=google-refresh')));
  assert.ok(requests.some((request) => request.method === 'DELETE' && request.url.startsWith('/v26.0/me/permissions')));
  const invalidate = requests.find((request) => request.url.startsWith('/1.1/oauth/invalidate_token.json'));
  assert.ok(invalidate);
  assert.match(String(invalidate.headers.authorization || ''), /^OAuth /);
});

test('X revoke fails cleanly when stored user tokens are missing', async () => {
  const result = await attemptRemoteRevoke(account('x', { disconnected: true }));
  assert.equal(result.revoked, false);
  assert.match(result.reason, /credentials/i);
});

test('notification webhook payloads are HMAC signed and delivered', async () => {
  const result = await deliverNotificationWebhook({ id: 'ntf_direct', userId: 'usr_1', type: 'success', title: 'Direct', body: 'Webhook test' });
  assert.equal(result.delivered, true);
  const received = requests.filter((request) => request.url === '/webhook').at(-1);
  assert.ok(received);
  const timestamp = String(received.headers['x-faceless-timestamp']);
  const expected = `sha256=${crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${received.body}`).digest('hex')}`;
  assert.equal(received.headers['x-faceless-signature'], expected);
  assert.equal(received.headers['x-faceless-event'], 'notification.created');
  assert.equal(JSON.parse(received.body).id, 'ntf_direct');
});

test('notify() persists the notification and triggers the signed webhook', async () => {
  const before = requests.filter((request) => request.url === '/webhook').length;
  const id = await notify('usr_notify', { type: 'info', title: 'Persisted', body: 'Notification pipeline test', actionUrl: '/app' });
  assert.match(id, /^ntf_/);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && requests.filter((request) => request.url === '/webhook').length <= before) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const received = requests.filter((request) => request.url === '/webhook').at(-1);
  assert.ok(received);
  assert.equal(JSON.parse(received.body).id, id);
});

after(async () => {
  await closeDb();
  await new Promise((resolve) => providerServer.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
});
