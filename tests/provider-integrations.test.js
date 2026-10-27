import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startProviderSimulator } from './helpers/providerSimulator.js';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-provider-e2e-'));
let simulator;
let serverProcess;
let serverLogs = '';
let exitCode = null;
let base;
let env;
let client;
let db;
let closeDb;
let addJob;
let json;
let now;
let newId;
let userId;
const accounts = {};
const publications = {};

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function poll(label, fn, timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) { lastError = error; }
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function makeClient() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(routePath, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.cookie = cookie;
      let body = options.body;
      if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string' && !Buffer.isBuffer(body)) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(body);
      }
      const response = await fetch(base + routePath, { ...options, body, headers, redirect: options.redirect || 'follow' });
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
      for (const item of setCookies) {
        const pair = item.split(';')[0];
        if (pair.startsWith('fs_session=')) cookie = pair;
      }
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
      const redirectAllowed = options.redirect === 'manual' && response.status >= 300 && response.status < 400;
      if (!response.ok && !redirectAllowed && options.allowFailure !== true) throw new Error(`${options.method || 'GET'} ${routePath} failed (${response.status}): ${JSON.stringify(data)}`);
      return { response, data };
    },
  };
}

async function createProjectFiles(projectId, aspectRatio) {
  const dir = path.join(tempDir, 'storage', 'projects', projectId);
  await fs.mkdir(dir, { recursive: true });
  const videoPath = path.join(dir, 'video.mp4');
  const thumbnailPath = path.join(dir, 'thumbnail.png');
  const captionPath = path.join(dir, 'captions.srt');
  await fs.writeFile(videoPath, Buffer.from('simulated-mp4-binary'));
  await fs.writeFile(thumbnailPath, Buffer.from('simulated-png-binary'));
  await fs.writeFile(captionPath, '1\n00:00:00,000 --> 00:00:02,000\nSimulated caption\n');
  return { videoPath, thumbnailPath, captionPath, aspectRatio };
}

async function createCompletedPost(label, aspectRatio, platformNames) {
  const timestamp = now();
  const projectId = newId('prj_');
  const postId = newId('pst_');
  const files = await createProjectFiles(projectId, aspectRatio);
  await db('projects').insert({
    id: projectId, user_id: userId, title: `${label} official integration`, topic: 'Simulated provider verification',
    status: 'completed', stage: 'completed', progress: 100,
    config: json({ aspectRatio, platforms: platformNames, language: 'en', duration: 15, niche: 'education', style: 'cinematic' }),
    script: 'Simulated script for official provider integration verification.',
    scenes: json([]), metadata: json({}), sources: json([]), provider_summary: json({ simulated: true }),
    video_path: files.videoPath, thumbnail_path: files.thumbnailPath, caption_path: files.captionPath,
    duration_seconds: 15, created_at: timestamp, updated_at: timestamp, completed_at: timestamp,
  });
  const captions = Object.fromEntries(platformNames.map((platform) => [platform, {
    title: `${label} ${platform}`, description: `Official integration test for ${platform}.`, hashtags: ['#Simulated'],
  }]));
  await db('posts').insert({
    id: postId, user_id: userId, project_id: projectId, scheduled_at: new Date(Date.now() - 60000).toISOString(),
    status: 'queued', review_required: false, captions: json(captions), hashtags: json({}), metadata: json({ platforms: platformNames }),
    created_at: timestamp, updated_at: timestamp,
  });
  const created = [];
  for (const platform of platformNames) {
    const publicationId = newId('pub_');
    publications[platform] = publicationId;
    await db('publications').insert({
      id: publicationId, post_id: postId, account_id: accounts[platform].id, user_id: userId,
      status: 'queued', attempts: 0, max_attempts: 1, idempotency_key: `idem_${publicationId}`,
      ref_code: `ref-${platform}-${publicationId.slice(-6)}`, remote_data: json({}), metadata: json({}),
      created_at: timestamp, updated_at: timestamp,
    });
    await addJob('publish_post', { publicationId, userId }, { dedupeKey: `provider-test:publish:${publicationId}`, priority: 8, maxAttempts: 1 });
    created.push(publicationId);
  }
  return { projectId, postId, publicationIds: created, files };
}

async function connectOAuth(provider, callbackPath, extraQuery = {}) {
  const start = await client.request(`/api/oauth/${provider}/connect`, { redirect: 'manual' });
  assert.equal(start.response.status, 302);
  const location = new URL(start.response.headers.get('location'), base);
  const state = location.searchParams.get('state');
  assert.ok(state, `${provider} OAuth state missing`);
  const query = new URLSearchParams({ state, ...extraQuery });
  const callback = await client.request(`${callbackPath}?${query.toString()}`, { redirect: 'manual' });
  assert.equal(callback.response.status, 302);
  assert.match(callback.response.headers.get('location') || '', /oauth=success/);
}

before(async () => {
  simulator = await startProviderSimulator();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  env = {
    ...process.env,
    ...simulator.envOverrides,
    NODE_ENV: 'test',
    SKIP_FRONTEND: 'true',
    SEED_DEMO: 'false',
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: path.join(tempDir, 'data'),
    STORAGE_DIR: path.join(tempDir, 'storage'),
    SQLITE_PATH: path.join(tempDir, 'app.sqlite3'),
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    AI_PROVIDER: 'local',
    SEARCH_PROVIDER: 'none',
    IMAGE_PROVIDER: 'procedural',
    TTS_PROVIDER: 'mespeak',
    WORKER_ENABLED: 'true',
    WORKER_POLL_MS: '200',
    WORKER_CONCURRENCY: '4',
    WORKER_MAX_ATTEMPTS: '1',
    API_RATE_LIMIT_PER_MINUTE: '5000',
    TRUST_PROXY: 'false',
    SECURE_COOKIES: 'false',
    SMTP_URL: simulator.envOverrides.SMTP_URL,
    NOTIFICATION_WEBHOOK_URL: simulator.envOverrides.NOTIFICATION_WEBHOOK_URL,
    NOTIFICATION_WEBHOOK_SECRET: simulator.envOverrides.NOTIFICATION_WEBHOOK_SECRET,
  };
  await fs.mkdir(env.DATA_DIR, { recursive: true });
  await fs.mkdir(env.STORAGE_DIR, { recursive: true });

  serverProcess = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.on('exit', (code) => { exitCode = code; });
  await poll('provider integration server health', async () => {
    if (exitCode !== null) throw new Error(`Server exited early with ${exitCode}: ${serverLogs.slice(-4000)}`);
    try { return (await fetch(`${base}/api/meta/health`)).ok; } catch { return false; }
  }, 30000, 200);

  client = makeClient();
  const email = `provider-${Date.now()}@example.com`;
  const register = await client.request('/api/auth/register', { method: 'POST', body: { name: 'Provider Tester', email, password: 'ProviderE2E2026!' } });
  userId = register.data.user.id;

  const status = await client.request('/api/accounts/status');
  for (const platform of ['facebook', 'instagram', 'youtube', 'x']) assert.equal(status.data.integrations[platform].configured, true);

  Object.assign(process.env, env);
  const dbModule = await import('../server/db.js');
  ({ db, closeDb, addJob, json, now, newId } = dbModule);
});

after(async () => {
  if (serverProcess && exitCode === null) {
    serverProcess.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), wait(5000)]);
    if (exitCode === null) serverProcess.kill('SIGKILL');
  }
  if (closeDb) await closeDb();
  if (simulator) await simulator.close();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test('official integrations connect, publish, sync metrics, and revoke through simulated provider APIs', async (t) => {
  await t.test('OAuth connection flows create encrypted official accounts', async () => {
    await connectOAuth('facebook', '/api/oauth/facebook/callback', { code: 'meta-code' });
    await connectOAuth('youtube', '/api/oauth/google/callback', { code: 'google-code' });
    await connectOAuth('x', '/api/oauth/x/callback', { oauth_token: 'request-token', oauth_verifier: 'verifier' });
    const list = await client.request('/api/accounts');
    for (const platform of ['facebook', 'instagram', 'youtube', 'x']) {
      const account = list.data.accounts.find((item) => item.platform === platform);
      assert.ok(account, `${platform} account missing`);
      assert.equal(account.status, 'connected');
      accounts[platform] = account;
    }
    for (const platform of ['facebook', 'instagram', 'youtube', 'x']) {
      const verification = await client.request(`/api/accounts/${accounts[platform].id}/test`, { method: 'POST', body: {} });
      assert.equal(verification.data.ok, true, `${platform} verification failed`);
    }
  });

  await t.test('Facebook, Instagram, YouTube, and X publishing adapters complete official upload flows', async () => {
    await createCompletedPost('landscape', '16:9', ['facebook', 'youtube', 'x']);
    await createCompletedPost('vertical', '9:16', ['instagram']);
    await poll('official publications', async () => {
      const rows = await db('publications').whereIn('id', Object.values(publications));
      const published = rows.filter((row) => row.status === 'published');
      const failed = rows.filter((row) => row.status === 'failed');
      if (failed.length) throw new Error(`Publications failed: ${failed.map((row) => `${row.id}: ${row.last_error}`).join('; ')}`);
      return published.length === 4 ? rows : false;
    }, 60000, 500);
    for (const platform of ['facebook', 'instagram', 'youtube', 'x']) {
      const row = await db('publications').where({ id: publications[platform] }).first();
      assert.equal(row.status, 'published');
      assert.ok(row.remote_id);
      assert.ok(row.remote_url);
    }
    assert.equal(simulator.state.publishCalls, 1);
    assert.equal(simulator.state.instagramPublishCalls, 1);
    assert.equal(simulator.state.youtubeUploadCalls, 1);
    assert.equal(simulator.state.xPostCalls, 1);
    assert.ok(simulator.requests.some((request) => request.path.endsWith('/google/upload/youtube/v3/captions')));
    assert.ok(simulator.requests.some((request) => request.path.includes('/ig-container-1') && request.method === 'GET'));
    assert.ok(simulator.requests.some((request) => request.body?.command === 'INIT' || request.query?.command === 'INIT'));
  });

  await t.test('retrying a published job does not create a duplicate provider post', async () => {
    const before = {
      facebook: simulator.state.publishCalls,
      instagram: simulator.state.instagramPublishCalls,
      youtube: simulator.state.youtubeUploadCalls,
      x: simulator.state.xPostCalls,
    };
    for (const [platform, publicationId] of Object.entries(publications)) {
      await addJob('publish_post', { publicationId, userId }, { dedupeKey: `provider-test:duplicate:${platform}`, priority: 8, maxAttempts: 1 });
    }
    await wait(1200);
    assert.deepEqual({
      facebook: simulator.state.publishCalls,
      instagram: simulator.state.instagramPublishCalls,
      youtube: simulator.state.youtubeUploadCalls,
      x: simulator.state.xPostCalls,
    }, before);
  });

  await t.test('official metrics sync stores watch time and impressions from provider APIs', async () => {
    // Publishing schedules an initial metrics sync one minute later. Remove those
    // delayed jobs so this test controls exactly four metrics syncs.
    await db('jobs').where({ type: 'sync_metrics', status: 'queued' }).del();
    for (const [platform, publicationId] of Object.entries(publications)) {
      await addJob('sync_metrics', { publicationId, userId }, { dedupeKey: `provider-test:metrics:${platform}`, priority: 6, maxAttempts: 1 });
    }
    const rows = await poll('official metrics rows', async () => {
      const found = await db('post_metrics').whereIn('publication_id', Object.values(publications));
      const failed = await db('jobs').where({ type: 'sync_metrics', status: 'failed' });
      if (failed.length) throw new Error(`Metrics jobs failed: ${failed.map((job) => job.last_error).join('; ')}`);
      return found.length >= 4 ? found : false;
    }, 60000, 500);
    assert.equal(rows.length, 4);
    for (const platform of ['facebook', 'instagram', 'youtube', 'x']) {
      const row = rows.find((item) => item.publication_id === publications[platform]);
      assert.ok(row, `${platform} metrics missing`);
      assert.ok(Number(row.impressions) > 0, `${platform} impressions missing`);
    }
    const youtube = rows.find((item) => item.publication_id === publications.youtube);
    const x = rows.find((item) => item.publication_id === publications.x);
    assert.ok(Number(youtube.watch_seconds) > 0);
    assert.ok(Number(x.watch_seconds) > 0);
  });

  await t.test('account disconnect revokes provider-side authorization', async () => {
    for (const platform of ['youtube', 'facebook', 'x']) {
      const response = await client.request(`/api/accounts/${accounts[platform].id}`, { method: 'DELETE' });
      assert.equal(response.data.ok, true);
      assert.equal(response.data.revoke.revoked, true, `${platform} revoke failed`);
    }
    assert.ok(simulator.state.revoked.includes('google'));
    assert.ok(simulator.state.revoked.includes('meta'));
    assert.ok(simulator.state.revoked.includes('x'));
  });
});
