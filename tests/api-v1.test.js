/**
 * Public developer API (/api/v1) — end-to-end contract test.
 *
 * Every endpoint in the published catalogue is called with a real API key, so the
 * documentation cannot drift from the router. Also proved here: hash-only storage,
 * scope enforcement, revocation, cross-account isolation, rate-limit headers, and
 * the OpenAPI document.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcl-api-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.DEMO_EMAIL = 'api-owner@example.test';
process.env.DEMO_PASSWORD = 'ApiOwner2026!';
process.env.ADMIN_EMAIL = 'api-admin@example.test';
process.env.ADMIN_PASSWORD = 'ApiAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8899';
process.env.APP_URL = 'http://127.0.0.1:8899';
process.env.API_KEY_RATE_LIMIT_PER_MINUTE = '120';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'none';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'REPLICATE_API_TOKEN', 'FAL_API_KEY']) delete process.env[key];

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { ENDPOINTS, SCOPES, API_PREFIX, fullPath } = await import('../server/api/catalog.js');

let server;
let base;
let ownerCookie;
let adminCookie;
let ownerToken;
let ownerKeyId;
let readOnlyToken;
let readOnlyKeyId;

async function request(pathname, { method = 'GET', body, cookie, token, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

const api = (pathname, options = {}) => request(`${API_PREFIX}${pathname}`, { token: ownerToken, ...options });

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const owner = await request('/api/auth/login', { method: 'POST', body: { email: 'api-owner@example.test', password: 'ApiOwner2026!' } });
  assert.equal(owner.status, 200, 'demo account must sign in');
  ownerCookie = owner.headers.get('set-cookie').split(';')[0];
  const admin = await request('/api/auth/login', { method: 'POST', body: { email: 'api-admin@example.test', password: 'ApiAdmin2026!' } });
  assert.equal(admin.status, 200);
  adminCookie = admin.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('the published catalogue and the OpenAPI document describe the same endpoints', async () => {
  const spec = await request('/api/developer/spec');
  assert.equal(spec.status, 200);
  assert.equal(spec.data.prefix, API_PREFIX);
  assert.equal(spec.data.baseUrl, 'http://127.0.0.1:8899');
  assert.equal(spec.data.endpoints.length, ENDPOINTS.length);
  assert.ok(spec.data.authentication.header.includes('Bearer'));
  assert.equal(spec.data.rateLimits.perKey.limit, 120);
  assert.ok(spec.data.errors.length >= 8);
  for (const endpoint of spec.data.endpoints) {
    assert.ok(endpoint.fullPath.startsWith('/api/v1/'), `${endpoint.id} has a versioned path`);
    assert.ok(SCOPES.some((scope) => scope.id === endpoint.scope), `${endpoint.id} uses a known scope`);
    assert.ok(endpoint.exampleResponse, `${endpoint.id} documents a response`);
  }

  const openapi = await request('/api/developer/openapi.json');
  assert.equal(openapi.status, 200);
  assert.equal(openapi.data.openapi, '3.1.0');
  assert.equal(openapi.data.servers[0].url, 'http://127.0.0.1:8899');
  const paths = Object.keys(openapi.data.paths);
  const uniquePaths = new Set(ENDPOINTS.map((endpoint) => fullPath(endpoint.path)));
  assert.equal(paths.length, uniquePaths.size, 'every documented path appears exactly once in the OpenAPI document');
  for (const endpoint of ENDPOINTS) {
    const documented = openapi.data.paths[fullPath(endpoint.path)];
    assert.ok(documented, `${endpoint.id} appears in the OpenAPI document`);
    const operation = documented[endpoint.method.toLowerCase()];
    assert.ok(operation, `${endpoint.id} is documented with ${endpoint.method}`);
    assert.equal(operation['x-required-scope'], endpoint.scope);
    assert.ok(operation.responses[endpoint.successStatus], `${endpoint.id} documents its success status`);
  }
  const groups = new Set(ENDPOINTS.map((endpoint) => endpoint.group));
  assert.equal(openapi.data.tags.length, groups.size);
});

test('API keys are created once, stored as hashes, and never returned again', async () => {
  const created = await request('/api/developer/keys', { method: 'POST', cookie: ownerCookie, body: { name: 'Build pipeline', scopes: ['read', 'write', 'publish'] } });
  assert.equal(created.status, 201);
  ownerToken = created.data.token;
  ownerKeyId = created.data.key.id;
  assert.match(ownerToken, /^fcl_live_[A-Za-z0-9]{40}$/);
  assert.equal(created.data.key.prefix, `fcl_live_${ownerToken.slice(9, 19)}…`);
  assert.deepEqual(created.data.key.scopes, ['read', 'write', 'publish']);
  assert.ok(created.data.warning.includes('Copy this key now'));

  const row = await db('api_keys').where({ id: ownerKeyId }).first();
  assert.ok(row, 'key row persists');
  assert.equal(row.key_hash.length, 64);
  assert.notEqual(row.key_hash, ownerToken);
  assert.ok(!JSON.stringify(row).includes(ownerToken.slice(9)), 'the secret is not stored anywhere in the row');

  const list = await request('/api/developer/keys', { cookie: ownerCookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.keys.length, 1);
  assert.equal(list.data.keys[0].prefix, created.data.key.prefix);
  assert.equal(JSON.stringify(list.data).includes(ownerToken), false, 'listing never leaks the secret');
  assert.equal(list.data.limits.requestsPerMinute, 120);

  const bad = await request('/api/developer/keys', { method: 'POST', cookie: ownerCookie, body: { name: 'x' } });
  assert.equal(bad.status, 400, 'a key without a usable name is rejected');
  assert.equal(bad.data.error.code, 'bad_request');

  const readOnly = await request('/api/developer/keys', { method: 'POST', cookie: ownerCookie, body: { name: 'Read only', scopes: ['read'] } });
  assert.equal(readOnly.status, 201);
  readOnlyToken = readOnly.data.token;
  readOnlyKeyId = readOnly.data.key.id;

  const unknownScope = await request('/api/developer/keys', { method: 'POST', cookie: ownerCookie, body: { name: 'Nope', scopes: ['destroy'] } });
  assert.equal(unknownScope.status, 400);
});

test('authentication rejects missing, malformed and cross-scheme credentials', async () => {
  const missing = await request(`${API_PREFIX}/me`);
  assert.equal(missing.status, 401);
  assert.equal(missing.data.error.code, 'unauthorized');

  const malformed = await request(`${API_PREFIX}/me`, { headers: { authorization: 'Bearer not-a-key' } });
  assert.equal(malformed.status, 401);

  const unknown = await request(`${API_PREFIX}/me`, { token: `fcl_live_${'A'.repeat(40)}` });
  assert.equal(unknown.status, 401);

  const cookieOnly = await request(`${API_PREFIX}/me`, { cookie: ownerCookie });
  assert.equal(cookieOnly.status, 401, 'session cookies are not accepted by /api/v1');
});

test('the documented endpoints work end to end with a real key', async () => {
  const me = await api('/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.account.email, 'api-owner@example.test');
  assert.equal(me.data.account.passwordHash, undefined);
  assert.ok(me.data.plan.id);
  assert.equal(typeof me.data.credits, 'number');
  assert.deepEqual(me.data.apiKey.scopes, ['read', 'write', 'publish']);
  assert.ok(me.headers.get('ratelimit'), 'the RateLimit header advertises the per-key budget');
  assert.match(me.headers.get('ratelimit'), /limit=120/);

  const alt = await request(`${API_PREFIX}/me`, { headers: { 'x-api-key': ownerToken } });
  assert.equal(alt.status, 200, 'X-API-Key is an accepted alternative');

  const emptyList = await api('/projects');
  assert.equal(emptyList.status, 200);
  assert.deepEqual(emptyList.data.pagination, { limit: 25, offset: 0, total: 0 });

  const created = await api('/projects', { method: 'POST', body: { topic: 'Why walking beats caffeine', niche: 'Education', duration: 45 } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const projectId = created.data.project.id;
  assert.equal(created.data.project.status, 'queued');

  const project = await api(`/projects/${projectId}`);
  assert.equal(project.status, 200);
  assert.equal(project.data.project.id, projectId);
  assert.ok(Array.isArray(project.data.posts));

  const post = await api(`/projects/${projectId}/posts`, { method: 'POST', body: { platforms: ['sandbox'] } });
  assert.equal(post.status, 201, JSON.stringify(post.data));
  const postId = post.data.post.id;
  assert.equal(post.data.post.userId, undefined, 'internal user id is not exposed');

  const posts = await api('/posts');
  assert.equal(posts.status, 200);
  assert.equal(posts.data.pagination.total, 1);
  assert.equal(posts.data.posts[0].id, postId);

  const single = await api(`/posts/${postId}`);
  assert.equal(single.status, 200);
  assert.ok(Array.isArray(single.data.post.publications));

  // The review gate is real: approving before the render finishes is refused with
  // an explanation rather than silently publishing.
  const early = await api(`/posts/${postId}/approve`, { method: 'POST' });
  assert.equal(early.status, 400);
  assert.match(early.data.error.message, /finished rendering/i);

  await db('projects').where({ id: projectId }).update({ status: 'completed' });
  const approved = await api(`/posts/${postId}/approve`, { method: 'POST' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.post.reviewRequired, false);

  const scheduled = await api(`/posts/${postId}/schedule`, { method: 'POST', body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.data));
  assert.equal(scheduled.data.post.status, 'scheduled');

  const badSchedule = await api(`/posts/${postId}/schedule`, { method: 'POST', body: { scheduledAt: 'tomorrow-ish' } });
  assert.equal(badSchedule.status, 400);

  const accounts = await api('/accounts');
  assert.equal(accounts.status, 200);
  assert.ok(Array.isArray(accounts.data.accounts));
  assert.equal(JSON.stringify(accounts.data).includes('accessToken'), false, 'channel credentials are never returned');

  const films = await api('/films');
  assert.equal(films.status, 200);
  assert.deepEqual(films.data.films, []);

  const filmCreated = await api('/films', { method: 'POST', body: { title: 'The Last Signal', type: 'short_drama', genre: 'sci-fi', targetDurationSeconds: 120 } });
  assert.equal(filmCreated.status, 201, JSON.stringify(filmCreated.data));
  const filmId = filmCreated.data.film.id;
  assert.equal(filmCreated.data.film.targetDurationSeconds, 120);

  const film = await api(`/films/${filmId}`);
  assert.equal(film.status, 200);
  assert.equal(film.data.film.id, filmId);
  assert.ok(Array.isArray(film.data.film.scenes));

  const noScenes = await api(`/films/${filmId}/generate`, { method: 'POST' });
  assert.equal(noScenes.status, 409, 'generating an empty film is refused honestly');
  assert.equal(noScenes.data.error.code, 'no_scenes');

  // Simulate a written screenplay, then queue generation through the real path.
  const timestamp = new Date().toISOString();
  for (const [ordinal, status] of [[1, 'pending'], [2, 'pending']]) {
    await db('film_scenes').insert({
      id: `scn_test_${ordinal}_${Date.now()}`, film_id: filmId,
      ordinal, heading: `Scene ${ordinal}`, description: 'A test scene', dialogue: '[]', duration_seconds: 10,
      status, stage: status, progress: 0, created_at: timestamp, updated_at: timestamp,
    });
  }
  const generated = await api(`/films/${filmId}/generate`, { method: 'POST' });
  assert.ok([202, 503].includes(generated.status), `generation either queues or reports the missing provider (got ${generated.status}: ${JSON.stringify(generated.data)})`);
  if (generated.status === 202) {
    assert.equal(generated.data.status, 'generating');
    assert.equal(typeof generated.data.queued, 'number');
  } else {
    assert.equal(generated.data.error.code, 'video_provider_unavailable');
    assert.match(generated.data.error.message, /not configured|An administrator must set/i);
  }

  const missingProject = await api('/projects/prj_missing');
  assert.equal(missingProject.status, 404);
  const unknownEndpoint = await api('/nope');
  assert.equal(unknownEndpoint.status, 404);
  assert.match(unknownEndpoint.data.error.message, /documented v1 endpoints/);
});

test('scopes are enforced per endpoint', async () => {
  const readOk = await request(`${API_PREFIX}/projects`, { token: readOnlyToken });
  assert.equal(readOk.status, 200);

  const writeDenied = await request(`${API_PREFIX}/projects`, { method: 'POST', token: readOnlyToken, body: { topic: 'Should not exist at all' } });
  assert.equal(writeDenied.status, 403);
  assert.equal(writeDenied.data.error.code, 'forbidden');
  assert.match(writeDenied.data.error.message, /write/);

  const publishDenied = await request(`${API_PREFIX}/posts/anything/approve`, { method: 'POST', token: readOnlyToken });
  assert.equal(publishDenied.status, 403);
  assert.match(publishDenied.data.error.message, /publish/);
});

test('a key only reaches its own account', async () => {
  const adminKey = await request('/api/developer/keys', { method: 'POST', cookie: adminCookie, body: { name: 'Admin key' } });
  assert.equal(adminKey.status, 201);
  const adminMe = await request(`${API_PREFIX}/me`, { token: adminKey.data.token });
  assert.equal(adminMe.status, 200);
  assert.equal(adminMe.data.account.email, 'api-admin@example.test');
  assert.equal(adminMe.data.account.role, 'admin');

  const projects = await request(`${API_PREFIX}/projects`, { token: adminKey.data.token });
  assert.equal(projects.status, 200);
  assert.equal(projects.data.pagination.total, 0, 'an admin key sees only its own projects');
});

test('revoked keys stop working immediately', async () => {
  const revoked = await request(`/api/developer/keys/${readOnlyKeyId}`, { method: 'DELETE', cookie: ownerCookie });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.revoked, true);
  assert.ok(revoked.data.key.revokedAt);

  const blocked = await request(`${API_PREFIX}/me`, { token: readOnlyToken });
  assert.equal(blocked.status, 401);
  assert.match(blocked.data.error.message, /revoked/i);

  const stillWorks = await api('/me');
  assert.equal(stillWorks.status, 200);

  const foreign = await request(`/api/developer/keys/${ownerKeyId}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(foreign.status, 404, 'another account cannot revoke your key');

  const keys = await request('/api/developer/keys', { cookie: ownerCookie });
  assert.equal(keys.data.keys.filter((key) => key.active).length, 1);
});
