import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  verifyModule, verifyAll, resolveApiRoots, sanitize, VERIFIER_IDS,
} from '../server/services/activation/verifiers.js';
import { ACTIVATION_MODULES } from '../server/services/activation/modules.js';
import { adminRouter } from '../server/routes/admin.js';

const SECRET = 'SUPERSECRET_meta_app_secret_9876543210';

function response(status, data = {}) {
  return { status, text: async () => JSON.stringify(data) };
}
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler ? handler(url, init) : response(200, {});
  };
  fn.calls = calls;
  return fn;
}
function env(overrides = {}) {
  return {
    META_APP_ID: '123456789012345',
    META_APP_SECRET: SECRET,
    GOOGLE_CLIENT_ID: '1234567890-abcdef.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-abcdefghijklmnop',
    X_CONSUMER_KEY: 'xconsumerkey12345',
    X_CONSUMER_SECRET: 'xconsumersecret12345',
    STRIPE_SECRET_KEY: 'sk_test_abcdef123456',
    STRIPE_WEBHOOK_SECRET: 'whsec_abcdef123456',
    PUBLIC_BASE_URL: 'https://studio.example.com',
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    ...overrides,
  };
}

test('every activation module has a verifier', () => {
  assert.equal(VERIFIER_IDS.length, ACTIVATION_MODULES.length);
  for (const m of ACTIVATION_MODULES) assert.ok(VERIFIER_IDS.includes(m.id), `missing verifier for ${m.id}`);
});

test('resolveApiRoots uses official hosts and honours overrides', () => {
  const roots = resolveApiRoots({});
  assert.equal(roots.metaGraph, 'https://graph.facebook.com');
  assert.equal(roots.stripe, 'https://api.stripe.com/v1');
  const overridden = resolveApiRoots({ STRIPE_API_BASE_URL: 'https://stripe.example.test/v1/' });
  assert.equal(overridden.stripe, 'https://stripe.example.test/v1');
});

test('sanitize removes secrets and key-bearing URLs', () => {
  const text = `failed calling https://api.example.com/v1/models?key=${SECRET} with ${SECRET}`;
  const clean = sanitize(text, { SOME_SECRET: SECRET });
  assert.ok(!clean.includes(SECRET), 'secret must not survive sanitisation');
  assert.ok(clean.includes('[provider endpoint]'));
});

test('unconfigured modules never make a network call', async () => {
  const fetchImpl = fakeFetch();
  const result = await verifyModule('facebook-pages', { env: {}, fetchImpl });
  assert.equal(result.status, 'unconfigured');
  assert.equal(fetchImpl.calls.length, 0);
  assert.match(result.action, /META_APP_ID/);
});

test('Meta app credentials verify with client_credentials and never leak the secret', async () => {
  const fetchImpl = fakeFetch((url) => {
    assert.match(url, /grant_type=client_credentials/);
    return response(200, { access_token: 'app-token' });
  });
  const result = await verifyModule('facebook-pages', { env: env(), fetchImpl });
  assert.equal(result.status, 'verified');
  assert.equal(result.number, 1);
  assert.ok(result.checks.some((c) => c.status === 'pass' && /accepted/i.test(c.detail)));
  assert.ok(!JSON.stringify(result).includes(SECRET), 'the app secret leaked into the result');
  // The URL carries the secret in its query string — it must never be echoed.
  assert.ok(!JSON.stringify(result).includes('client_secret='));
});

test('Meta rejection is classified as invalid with an actionable message', async () => {
  const fetchImpl = fakeFetch(() => response(400, { error: { message: 'Invalid app secret' } }));
  const result = await verifyModule('facebook-pages', { env: env(), fetchImpl });
  assert.equal(result.status, 'invalid');
  assert.match(result.summary, /1 of 1/);
  assert.match(result.action, /Advanced Access|re-run|Correct/);
});

test('Instagram additionally requires a public HTTPS media origin', async () => {
  const fetchImpl = fakeFetch(() => response(200, { access_token: 'app-token' }));
  const good = await verifyModule('instagram-reels', { env: env(), fetchImpl });
  assert.equal(good.status, 'verified');
  const bad = await verifyModule('instagram-reels', { env: env({ PUBLIC_BASE_URL: 'http://localhost:8787' }), fetchImpl });
  assert.equal(bad.status, 'invalid');
  assert.ok(bad.checks.some((c) => c.name === 'public HTTPS media origin' && c.status === 'fail'));
});

test('Google distinguishes invalid_grant (valid client) from invalid_client', async () => {
  const ok = await verifyModule('youtube', {
    env: env(), fetchImpl: fakeFetch(() => response(400, { error: 'invalid_grant' })),
  });
  assert.equal(ok.status, 'verified');
  assert.match(ok.checks[0].detail, /recognised the client/i);

  const bad = await verifyModule('youtube', {
    env: env(), fetchImpl: fakeFetch(() => response(400, { error: 'invalid_client' })),
  });
  assert.equal(bad.status, 'invalid');
});

test('X app-only bearer token verifies the consumer credentials', async () => {
  const fetchImpl = fakeFetch((_url, init) => {
    assert.match(init.headers.authorization, /^Basic /);
    return response(200, { token_type: 'bearer', access_token: 'app-bearer' });
  });
  const result = await verifyModule('x', { env: env(), fetchImpl });
  assert.equal(result.status, 'verified');
});

test('Stripe verifies the API key and the webhook signing secret format', async () => {
  const good = await verifyModule('stripe', { env: env(), fetchImpl: fakeFetch(() => response(200, { id: 'acct_123' })) });
  assert.equal(good.status, 'verified');
  assert.equal(good.checks.length, 2);

  const bad = await verifyModule('stripe', {
    env: env({ STRIPE_WEBHOOK_SECRET: 'not-a-whsec' }),
    fetchImpl: fakeFetch(() => response(200, { id: 'acct_123' })),
  });
  assert.equal(bad.status, 'invalid');
  assert.ok(bad.checks.some((c) => c.name === 'webhook signing secret' && c.status === 'fail'));
});

test('signed webhook ping carries a correct HMAC signature', async () => {
  let captured;
  const fetchImpl = fakeFetch((url, init) => {
    captured = { url, init };
    return response(202, {});
  });
  const secret = 'webhook-shared-secret-12345';
  const result = await verifyModule('notification-webhook', {
    env: env({ NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com/faceless', NOTIFICATION_WEBHOOK_SECRET: secret }),
    fetchImpl,
  });
  assert.equal(result.status, 'verified');
  const timestamp = captured.init.headers['x-faceless-timestamp'];
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${captured.init.body}`).digest('hex')}`;
  assert.equal(captured.init.headers['x-faceless-signature'], expected);
  assert.equal(captured.init.headers['x-faceless-event'], 'activation.ping');
});

test('offline-default modules verify without any network access', async () => {
  const fetchImpl = fakeFetch();
  const config = env({ AI_PROVIDER: 'local', SEARCH_PROVIDER: 'none', IMAGE_PROVIDER: 'procedural', TTS_PROVIDER: 'mespeak' });
  for (const id of ['ai-providers', 'research', 'image-providers', 'tts-providers']) {
    const r = await verifyModule(id, { env: config, fetchImpl });
    assert.equal(r.status, 'verified', `${id} should verify offline`);
    assert.match(r.summary, /offline|disabled/i);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test('external AI providers are probed on their own models endpoint', async () => {
  const fetchImpl = fakeFetch((url) => {
    assert.match(url, /api\.openai\.com\/v1\/models/);
    return response(200, { data: [] });
  });
  const r = await verifyModule('ai-providers', { env: env({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz' }), fetchImpl });
  assert.equal(r.status, 'verified');
  assert.equal(fetchImpl.calls.length, 1);
});

test('Gemini key in the query string is never echoed into results', async () => {
  const geminiKey = 'AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY123';
  const fetchImpl = fakeFetch((url) => {
    assert.match(url, /generativelanguage\.googleapis\.com/);
    return response(400, { error: { message: `bad request for ${url}` } });
  });
  const r = await verifyModule('ai-providers', { env: env({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: geminiKey }), fetchImpl });
  assert.equal(r.status, 'invalid');
  assert.ok(!JSON.stringify(r).includes(geminiKey), 'Gemini key leaked');
});

test('public origin probe checks HTTPS shape and the health endpoint', async () => {
  const good = await verifyModule('public-https-origin', { env: env(), fetchImpl: fakeFetch(() => response(200, { ok: true })) });
  assert.equal(good.status, 'verified');
  assert.equal(good.checks.length, 2);

  const local = await verifyModule('public-https-origin', { env: env({ PUBLIC_BASE_URL: 'http://localhost:8787' }), fetchImpl: fakeFetch() });
  assert.equal(local.status, 'invalid');
});

test('encryption key is verified with a real AES-256-GCM round trip, offline', async () => {
  const fetchImpl = fakeFetch();
  const good = await verifyModule('encryption-key', { env: env(), fetchImpl });
  assert.equal(good.status, 'verified');
  assert.match(good.checks[0].detail, /encrypts and decrypts/);
  assert.equal(fetchImpl.calls.length, 0);

  const bad = await verifyModule('encryption-key', { env: env({ APP_ENCRYPTION_KEY: 'not-valid' }), fetchImpl });
  assert.equal(bad.status, 'invalid');
});

test('SMTP and Postgres use injected implementations when available', async () => {
  const smtp = await verifyModule('smtp', { env: env({ SMTP_URL: 'smtps://u:p@smtp.example.com:465' }), fetchImpl: fakeFetch(), smtpVerifyImpl: async () => ({ ok: true }) });
  assert.equal(smtp.status, 'verified');
  const pg = await verifyModule('postgres', { env: env({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/faceless' }), fetchImpl: fakeFetch(), pgCheckImpl: async () => ({ ok: false, message: 'connection refused' }) });
  assert.equal(pg.status, 'invalid');
  assert.match(pg.checks[0].detail, /connection refused/);
});

test('Postgres verification proves TLS, version and schema readiness', async () => {
  const remote = 'postgresql://u:p@db.example.com:5432/faceless';
  const base = { ok: true, version: '16.4', tables: 27, missingCore: [] };

  const secure = await verifyModule('postgres', {
    env: env({ DATABASE_URL: remote }), fetchImpl: fakeFetch(),
    pgCheckImpl: async () => ({ ...base, tls: true }),
  });
  assert.equal(secure.status, 'verified');
  assert.match(secure.checks[0].detail, /PostgreSQL 16\.4/);
  assert.equal(secure.checks.find((c) => c.name === 'TLS in use').status, 'pass');
  assert.equal(secure.checks.find((c) => c.name === 'schema readiness').status, 'pass');

  // A remote database reached without TLS must fail: credentials and queries
  // would cross the network in plaintext.
  const plaintext = await verifyModule('postgres', {
    env: env({ DATABASE_URL: remote }), fetchImpl: fakeFetch(),
    pgCheckImpl: async () => ({ ...base, tls: false }),
  });
  assert.equal(plaintext.status, 'invalid');
  const tls = plaintext.checks.find((c) => c.name === 'TLS in use');
  assert.equal(tls.status, 'fail');
  assert.match(tls.detail, /sslmode=require/);

  // Localhost is allowed to run without TLS for development.
  const local = await verifyModule('postgres', {
    env: env({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/faceless' }), fetchImpl: fakeFetch(),
    pgCheckImpl: async () => ({ ...base, tls: false }),
  });
  assert.equal(local.status, 'verified');
  assert.equal(local.checks.find((c) => c.name === 'TLS in use').status, 'pass');

  // An empty database is not a failure — the app creates the schema on start.
  const empty = await verifyModule('postgres', {
    env: env({ DATABASE_URL: remote }), fetchImpl: fakeFetch(),
    pgCheckImpl: async () => ({ ok: true, version: '16.4', tls: true, tables: 0, missingCore: ['users', 'jobs'] }),
  });
  assert.equal(empty.status, 'verified');
  assert.equal(empty.checks.find((c) => c.name === 'schema readiness').status, 'skip');
  assert.match(empty.action, /db:bootstrap/);
});

test('app review stays manual and cannot be faked as verified', async () => {
  const r = await verifyModule('app-review', { env: env(), fetchImpl: fakeFetch() });
  assert.equal(r.status, 'unsupported');
  assert.match(r.action, /console|checklist/i);
});

test('network failure is reported as unreachable, not as invalid credentials', async () => {
  const fetchImpl = async () => { throw new Error('fetch failed'); };
  const r = await verifyModule('stripe', { env: env(), fetchImpl });
  assert.equal(r.status, 'unreachable');
});

test('verifyAll covers all 15 modules without network when nothing is configured', async () => {
  const fetchImpl = fakeFetch();
  const report = await verifyAll({ env: {}, fetchImpl, concurrency: 4 });
  assert.equal(report.summary.total, 15);
  assert.equal(report.results.length, 15);
  assert.deepEqual(report.results.map((r) => r.number), ACTIVATION_MODULES.map((m) => m.number));
  assert.equal(fetchImpl.calls.length, 0, 'no provider should be contacted without credentials');
  assert.equal(JSON.stringify(report).includes(SECRET), false);
});

test('admin router exposes activation status and verification routes', () => {
  const paths = adminRouter().stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  assert.ok(paths.includes('GET /activation'));
  assert.ok(paths.includes('POST /activation/:id/verify'));
});
