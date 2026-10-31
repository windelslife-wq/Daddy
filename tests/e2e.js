import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const port = 8900 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'film-club-lens-e2e-'));
const dataDir = path.join(tempDir, 'data');
const storageDir = path.join(tempDir, 'storage');
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(storageDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  SKIP_FRONTEND: 'true',
  SEED_DEMO: 'false',
  EXPOSE_DEMO_CREDENTIALS: 'false',
  ADMIN_EMAIL: 'admin@e2e.local',
  ADMIN_PASSWORD: 'AdminE2E2026!',
  PORT: String(port),
  HOST: '127.0.0.1',
  PUBLIC_BASE_URL: base,
  DATA_DIR: dataDir,
  STORAGE_DIR: storageDir,
  SQLITE_PATH: path.join(tempDir, 'app.sqlite3'),
  APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  AI_PROVIDER: 'local',
  SEARCH_PROVIDER: 'none',
  IMAGE_PROVIDER: 'procedural',
  TTS_PROVIDER: 'mespeak',
  WORKER_ENABLED: 'true',
  WORKER_POLL_MS: '300',
  WORKER_CONCURRENCY: '3',
  WORKER_MAX_ATTEMPTS: '2',
  API_RATE_LIMIT_PER_MINUTE: '5000',
  TRUST_PROXY: 'false',
  SECURE_COOKIES: 'false',
};

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
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
      const response = await fetch(base + routePath, {
        ...options, body, headers,
        redirect: options.redirect || 'follow',
      });
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
      for (const item of setCookies) {
        const pair = item.split(';')[0];
        if (pair.startsWith('fs_session=')) cookie = pair;
      }
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
      const redirectAllowed = options.redirect === 'manual' && response.status >= 300 && response.status < 400;
      if (!response.ok && !redirectAllowed && options.allowFailure !== true) {
        throw new Error(`${options.method || 'GET'} ${routePath} failed (${response.status}): ${JSON.stringify(data)}`);
      }
      return { response, data };
    },
  };
}

async function poll(label, fn, timeoutMs = 180000, intervalMs = 1000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await wait(intervalMs);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
}

function assertIsoFuture(value) {
  assert.ok(value, 'expected an ISO timestamp');
  assert.ok(new Date(value).getTime() > Date.now(), `expected ${value} to be in the future`);
}

let server;
let serverLogs = '';
let exitCode = null;
try {
  server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
  server.on('exit', (code) => { exitCode = code; });

  await poll('server health', async () => {
    if (exitCode !== null) throw new Error(`Server exited early with code ${exitCode}:\n${serverLogs}`);
    try { return (await fetch(`${base}/api/meta/health`)).ok; } catch { return false; }
  }, 30000, 300);

  const user = makeClient();
  const admin = makeClient();
  const email = `creator-${Date.now()}@example.com`;
  const password = 'E2ETestPassword2026!';

  const health = await user.request('/api/meta/health');
  assert.equal(health.data.ok, true);
  const options = await user.request('/api/meta/options');
  assert.ok(options.data.niches.length >= 5);
  assert.ok(options.data.styles.length >= 4);
  assert.equal(options.data.providerStatus.integrations.facebook.configured, false);
  assert.equal(options.data.providerStatus.tts.configured, true);

  const register = await user.request('/api/auth/register', { method: 'POST', body: { name: 'E2E Creator', email, password } });
  assert.equal(register.data.user.email, email);
  assert.ok(user.cookie.includes('fs_session='));

  const unsupported = await user.request('/api/oauth/facebook/connect', { redirect: 'manual' });
  assert.equal(unsupported.response.status, 302);
  assert.match(unsupported.response.headers.get('location') || '', /oauth=error/);

  const connect = await user.request('/api/oauth/sandbox/connect', { redirect: 'manual' });
  assert.equal(connect.response.status, 302);
  const state = new URL(connect.response.headers.get('location'), base).searchParams.get('state');
  assert.ok(state);
  const authorize = await user.request('/api/oauth/sandbox/authorize', { method: 'POST', body: { state, displayName: 'E2E Sandbox Channel' } });
  assert.ok(authorize.data.redirectUrl.startsWith('/api/oauth/sandbox/callback'));
  const callback = await user.request(authorize.data.redirectUrl, { redirect: 'manual' });
  assert.match(callback.response.headers.get('location') || '', /oauth=success/);
  const accounts = await user.request('/api/accounts');
  const sandboxAccount = accounts.data.accounts.find((account) => account.platform === 'sandbox');
  assert.ok(sandboxAccount);
  assert.equal(sandboxAccount.status, 'connected');
  const testConnection = await user.request(`/api/accounts/${sandboxAccount.id}/test`, { method: 'POST', body: {} });
  assert.equal(testConnection.data.ok, true);

  const nicheResult = await user.request('/api/niches', { method: 'POST', body: {
    name: 'E2E Lighthouse Mysteries',
    description: 'Short original stories about forgotten coastal landmarks.',
    defaultTopic: 'A lighthouse with an unexplained history',
    style: 'cinematic', language: 'en', voice: 'nova', aspectRatio: '9:16', duration: 15,
    platforms: ['sandbox'], autopilot: true, reviewRequired: false, postingLimitPerDay: 2,
    schedule: { frequency: 'daily', timeOfDay: '09:00', timezone: 'UTC', weekdays: [1, 2, 3, 4, 5] },
  } });
  assert.ok(nicheResult.data.niche.id);
  assertIsoFuture(nicheResult.data.niche.schedule.nextRunAt);
  const schedules = await user.request('/api/schedules');
  assert.ok(schedules.data.schedules.length >= 1);
  const scheduleId = schedules.data.schedules[0].id;
  const patchedSchedule = await user.request(`/api/schedules/${scheduleId}`, { method: 'PATCH', body: { timeOfDay: '10:30', active: true } });
  assert.equal(patchedSchedule.data.schedule.timeOfDay, '10:30');
  assertIsoFuture(patchedSchedule.data.schedule.nextRunAt);

  async function createAndRender({ title, topic, reviewRequired, scheduledAt }) {
    const created = await user.request('/api/projects', { method: 'POST', body: {
      niche: 'Education & interesting facts', topic, title,
      style: 'cinematic', language: 'en', voice: 'nova', aspectRatio: '9:16', duration: 15,
      captions: true, music: true, research: false, autoPublish: true, reviewRequired,
      platforms: ['sandbox'], scheduledAt, tone: 'documentary',
    } });
    assert.equal(created.response.status, 202);
    const projectId = created.data.project.id;
    const project = await poll(`project ${projectId}`, async () => {
      const detail = await user.request(`/api/projects/${projectId}`);
      if (detail.data.project.status === 'failed') throw new Error(`Project failed: ${detail.data.project.error}`);
      return detail.data.project.status === 'completed' ? detail.data : false;
    }, 180000, 1200);
    assert.ok(project.project.hasVideo);
    assert.ok(project.project.script.length > 30);
    assert.ok(project.project.scenes.length >= 3);
    assert.ok(project.project.durationSeconds >= 14);
    const video = await user.request(`/api/media/projects/${projectId}/video`, { headers: { range: 'bytes=0-1023' } });
    assert.equal(video.response.status, 206);
    assert.match(video.response.headers.get('content-type') || '', /video\/mp4/);
    const captions = await user.request(`/api/media/projects/${projectId}/captions`);
    assert.match(String(captions.data), /-->/);
    return { projectId, project: project.project, post: project.post };
  }

  const first = await createAndRender({
    title: 'E2E direct autopilot story',
    topic: 'The forgotten lighthouse that guided ships for a century',
    reviewRequired: false,
    scheduledAt: new Date().toISOString(),
  });

  const publishedFirst = await poll('first sandbox publication', async () => {
    const posts = await user.request('/api/posts?limit=50');
    const post = posts.data.posts.find((item) => item.projectId === first.projectId);
    return post?.publications?.some((publication) => publication.status === 'published') ? post : false;
  }, 90000, 1000);
  const firstPublication = publishedFirst.publications.find((publication) => publication.status === 'published');
  assert.ok(firstPublication.remoteId);
  assert.ok(firstPublication.remoteUrl);
  assert.match(firstPublication.remoteUrl, /token=/);
  assert.equal(firstPublication.account.platform, 'sandbox');
  const remote = new URL(firstPublication.remoteUrl, base);
  const remoteId = remote.pathname.split('/').pop();
  const token = remote.searchParams.get('token');
  const publicPost = await user.request(`/api/sandbox/v1/posts/${encodeURIComponent(remoteId)}/public?token=${encodeURIComponent(token)}`);
  assert.equal(publicPost.data.id, firstPublication.remoteId);
  assert.equal(publicPost.data.simulated, true);
  assert.match(publicPost.data.caption, new RegExp(firstPublication.refCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(publicPost.data.videoUrl, /\/api\/sandbox\/v1\/posts\//);

  // Import server modules against the same isolated DB to verify data-level duplicate protection.
  Object.assign(process.env, env);
  const { db, closeDb } = await import('../server/db.js');
  const { safeParseCredentials } = await import('../server/security.js');
  const { signedMediaUrl } = await import('../server/media/urls.js');
  const accountRow = await db('accounts').where({ id: sandboxAccount.id }).first();
  const credentials = safeParseCredentials(accountRow.credentials);
  const duplicateForm = new FormData();
  duplicateForm.append('refCode', firstPublication.refCode);
  duplicateForm.append('title', 'Duplicate attempt');
  duplicateForm.append('caption', 'Duplicate attempt');
  duplicateForm.append('video', new Blob([Buffer.from('not-a-real-video')], { type: 'video/mp4' }), 'duplicate.mp4');
  const duplicateResponse = await fetch(`${base}/api/sandbox/v1/posts`, {
    method: 'POST', headers: { authorization: `Bearer ${credentials.accessToken}` }, body: duplicateForm,
  });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.remoteId, firstPublication.remoteId);
  const duplicateCount = await db('sandbox_posts').where({ ref_code: firstPublication.refCode }).count({ count: '*' }).first();
  assert.equal(Number(duplicateCount.count), 1);

  const signedUrl = signedMediaUrl(first.projectId, first.project.videoPath, { ttlSeconds: 3600 });
  const signedResponse = await fetch(signedUrl, { headers: { range: 'bytes=0-1023' } });
  assert.equal(signedResponse.status, 206);
  assert.match(signedResponse.headers.get('content-type') || '', /video\/mp4/);
  await signedResponse.arrayBuffer();
  await closeDb();

  const second = await createAndRender({
    title: 'E2E reviewed scheduled story',
    topic: 'A clock tower that stopped at the same moment every year',
    reviewRequired: true,
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const reviewedPost = await poll(`review post ${second.projectId}`, async () => {
    const posts = await user.request('/api/posts?limit=50');
    const post = posts.data.posts.find((item) => item.projectId === second.projectId);
    return post && post.status === 'needs_review' ? post : false;
  }, 30000, 800);
  assert.ok(reviewedPost.publications.length >= 1);
  assert.ok(reviewedPost.publications.every((publication) => publication.status === 'pending_review'));
  const future = new Date(Date.now() + 3000).toISOString();
  const scheduled = await user.request(`/api/posts/${reviewedPost.id}/schedule`, { method: 'POST', body: { scheduledAt: future } });
  assert.equal(scheduled.data.ok, true);
  const approved = await user.request(`/api/posts/${reviewedPost.id}/approve`, { method: 'POST', body: {} });
  assert.ok(approved.data.jobs.length >= 1);
  const publishedSecond = await poll('reviewed sandbox publication', async () => {
    const posts = await user.request('/api/posts?limit=50');
    const post = posts.data.posts.find((item) => item.projectId === second.projectId);
    return post?.publications?.some((publication) => publication.status === 'published') ? post : false;
  }, 90000, 1000);
  assert.equal(publishedSecond.status, 'published');

  const sync = await user.request('/api/analytics/sync', { method: 'POST', body: {} });
  assert.ok(sync.data.queued >= 1);
  const analytics = await poll('sandbox metrics sync', async () => {
    const result = await user.request('/api/analytics');
    return result.data.dataQuality.simulatedMetricsCount >= 1 ? result.data : false;
  }, 60000, 1500);
  assert.ok(analytics.totals.views >= 0);
  assert.ok(analytics.topPosts.length >= 1);
  assert.equal(analytics.dataQuality.realMetricsCount, 0);

  await user.request('/api/analytics/recommendations/generate', { method: 'POST', body: {} });
  const recommended = await poll('baseline recommendations', async () => {
    const result = await user.request('/api/analytics');
    return result.data.recommendations.length > 0 ? result.data.recommendations : false;
  }, 60000, 1500);
  assert.ok(recommended[0].body.length > 10);

  const calendarFrom = new Date(Date.now() - 86400000).toISOString();
  const calendarTo = new Date(Date.now() + 2 * 86400000).toISOString();
  const calendar = await user.request(`/api/posts?from=${encodeURIComponent(calendarFrom)}&to=${encodeURIComponent(calendarTo)}&limit=100`);
  assert.ok(calendar.data.posts.length >= 1);

  const settings = await user.request('/api/settings');
  assert.equal(settings.data.user.email, email);
  const preferences = await user.request('/api/settings', { method: 'PATCH', body: { preferences: { defaultNiche: 'E2E Lighthouse Mysteries', timezone: 'UTC' } } });
  assert.equal(preferences.data.preferences.defaultNiche, 'E2E Lighthouse Mysteries');
  const notificationTest = await user.request('/api/settings/test-notification', { method: 'POST', body: {} });
  assert.equal(notificationTest.data.ok, true);
  const notifications = await user.request('/api/notifications');
  assert.ok(notifications.data.notifications.length >= 1);
  const freeCheckout = await user.request('/api/billing/checkout', { method: 'POST', body: { planId: 'free' } });
  assert.equal(freeCheckout.data.updated, true);
  const paidCheckout = await user.request('/api/billing/checkout', { method: 'POST', body: { planId: 'creator' }, allowFailure: true });
  assert.equal(paidCheckout.response.status, 400);
  assert.equal(paidCheckout.data.error.code, 'stripe_price_missing');

  const adminLogin = await admin.request('/api/auth/login', { method: 'POST', body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  assert.equal(adminLogin.data.user.role, 'admin');
  const overview = await admin.request('/api/admin/overview');
  assert.ok(overview.data.counts.users >= 2);
  assert.ok(overview.data.counts.published >= 2);
  const adminJobs = await admin.request('/api/admin/jobs?limit=100');
  assert.ok(adminJobs.data.jobs.some((job) => job.type === 'generate_video'));
  assert.ok(adminJobs.data.jobs.some((job) => job.type === 'publish_post'));
  const adminSettings = await admin.request('/api/admin/settings');
  assert.equal(adminSettings.data.providerStatus.ai.active, 'local');
  const integrations = await admin.request('/api/admin/integrations');
  assert.ok(integrations.data.requiredEnvironment.youtube.length >= 2);
  const audit = await admin.request('/api/admin/audit-logs?limit=50');
  assert.ok(audit.data.logs.length >= 1);

  const contactClient = makeClient();
  const contact = await contactClient.request('/api/contact', {
    method: 'POST',
    body: {
      name: 'E2E Contact', email: 'contact@e2e.local', topic: 'support',
      message: 'Verify that a public website message is stored, listed, and can be reviewed by an administrator.',
    },
  });
  assert.equal(contact.response.status, 201);
  assert.ok(contact.data.reference);
  const contactMessages = await admin.request('/api/admin/contact-messages');
  assert.ok(contactMessages.data.messages.some((message) => message.id === contact.data.reference));
  const reviewedMessage = await admin.request(`/api/admin/contact-messages/${contact.data.reference}`, { method: 'PATCH', body: { status: 'reviewed' } });
  assert.equal(reviewedMessage.data.message.status, 'reviewed');
  const invalidContact = await contactClient.request('/api/contact', {
    method: 'POST', allowFailure: true,
    body: { name: 'E2E', email: 'invalid', topic: 'support', message: 'short' },
  });
  assert.equal(invalidContact.response.status, 400);

  const accountToggle = await user.request(`/api/accounts/${sandboxAccount.id}`, { method: 'PATCH', body: { automationEnabled: false } });
  assert.equal(accountToggle.data.account.automationEnabled, false);
  await user.request(`/api/accounts/${sandboxAccount.id}`, { method: 'PATCH', body: { automationEnabled: true } });
  const disconnected = await user.request(`/api/accounts/${sandboxAccount.id}`, { method: 'DELETE' });
  assert.equal(disconnected.data.ok, true);

  console.log(JSON.stringify({
    ok: true,
    port,
    checks: [
      'auth + provider status', 'sandbox OAuth connection', 'daily schedule calculation',
      'AI script + scenes + procedural images + local TTS + SRT + MP4 rendering',
      'automatic publishing', 'review + schedule + approval publishing', 'public media URLs',
      'duplicate prevention', 'metrics sync', 'recommendations', 'calendar',
      'settings + billing config errors', 'admin endpoints', 'public contact form + admin messages', 'OAuth error handling',
    ],
  }, null, 2));
} catch (error) {
  console.error('E2E_FAILED:', error.stack || error.message);
  console.error('--- server logs ---\n' + serverLogs.slice(-20000));
  process.exitCode = 1;
} finally {
  if (server && exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), wait(5000)]);
    if (exitCode === null) server.kill('SIGKILL');
  }
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
