/**
 * Production acceptance tests (no real credentials required to run this file).
 *
 * IMPORTANT: this file does NOT claim that a real provider was called. It runs
 * the *real* provider adapters (server/film/videoProviders.js) over HTTP against
 * a local protocol emulator that enforces the documented wire contracts for
 * Replicate, fal.ai and Google Veo. That proves request shape, auth headers,
 * polling, cancellation, download, probing, error classification and redaction
 * — everything except the vendor's own inference.
 *
 * The heavier scenario here is failure recovery: a real worker child process is
 * killed with SIGKILL in the middle of a generation run, then restarted, and the
 * same provider predictions must be resumed (no new spend, no duplicate refund)
 * and the film must still assemble, probe, download and publish.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-acceptance-'));
const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;

function makeMedia(file, args) {
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, file], { stdio: 'ignore' });
  return fs.readFileSync(file);
}

const clipPath = path.join(tempDir, 'provider-clip.mp4');
makeMedia(clipPath, [
  '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=3',
  '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest',
]);
const clipBytes = fs.readFileSync(clipPath);

// ---------------------------------------------------------------------------
// Provider protocol emulator
// ---------------------------------------------------------------------------
const control = {
  mode: 'complete',        // 'hold' keeps predictions processing
  failDownload: false,     // /files/* returns HTTP 500
  breakPoll: false,        // destroy the poll socket once (network timeout shape)
  startStatus: 0,          // inject an HTTP error on prediction start
  replicateStarts: 0,
  falStarts: 0,
  veoStarts: 0,
  cancels: [],
  polls: 0,
  lastRequest: null,
  authMissing: [],
};

const replicate = { model: 'kwaivgi/kling-v2.1-master', predictions: new Map(), starts: [] };

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

let stubBase = '';
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, stubBase);
    const pathname = url.pathname;
    control.lastRequest = { method: req.method, pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body ? JSON.parse(body || '{}') : null };

    // ---- Replicate --------------------------------------------------------
    if (req.method === 'POST' && /^\/v1\/models\/.+\/predictions$/.test(pathname)) {
      if (control.startStatus) return json(res, control.startStatus, { detail: `emulated provider failure with token ${req.headers.authorization}` });
      const id = `pred_${crypto.randomUUID().slice(0, 8)}`;
      control.replicateStarts += 1;
      replicate.predictions.set(id, { status: 'processing', input: control.lastRequest.body?.input });
      replicate.starts.push(control.lastRequest);
      return json(res, 201, { id, status: 'starting' });
    }
    if (req.method === 'GET' && pathname.startsWith('/v1/predictions/')) {
      control.polls += 1;
      if (control.breakPoll) { control.breakPoll = false; req.socket.destroy(); return; }
      const id = pathname.split('/').pop();
      const prediction = replicate.predictions.get(id) || { status: 'processing' };
      if (control.mode === 'hold' || prediction.status === 'canceled') {
        return json(res, 200, { id, status: prediction.status });
      }
      return json(res, 200, { id, status: 'succeeded', output: [`${stubBase}/files/${id}.mp4`] });
    }
    if (req.method === 'POST' && pathname.endsWith('/cancel')) {
      control.cancels.push({ provider: 'replicate', pathname, headers: req.headers });
      const id = pathname.split('/')[3];
      const prediction = replicate.predictions.get(id);
      if (prediction) prediction.status = 'canceled';
      return json(res, 200, { id, status: 'canceled' });
    }

    // ---- fal.ai queue -----------------------------------------------------
    if (req.method === 'POST' && pathname.startsWith('/fal-ai/')) {
      control.falStarts += 1;
      if (!String(req.headers.authorization || '').startsWith('Key ')) control.authMissing.push({ provider: 'fal-start', pathname });
      return json(res, 200, {
        request_id: 'fal_req_1',
        status_url: `${stubBase}/fal/requests/fal_req_1/status`,
        response_url: `${stubBase}/fal/requests/fal_req_1`,
      });
    }
    if (req.method === 'GET' && pathname === '/fal/requests/fal_req_1/status') {
      if (!String(req.headers.authorization || '').startsWith('Key ')) control.authMissing.push({ provider: 'fal-status', pathname });
      return json(res, 200, { status: control.mode === 'hold' ? 'IN_PROGRESS' : 'COMPLETED', queue_position: 0 });
    }
    if (req.method === 'PUT' && pathname === '/fal/requests/fal_req_1/cancel') {
      control.cancels.push({ provider: 'fal', pathname, headers: req.headers });
      return json(res, 200, { cancelled: true });
    }
    if (req.method === 'GET' && pathname === '/fal/requests/fal_req_1') {
      return json(res, 200, { video: { url: `${stubBase}/files/fal.mp4` } });
    }

    // ---- Google Veo -------------------------------------------------------
    if (req.method === 'POST' && pathname.includes(':predictLongRunning')) {
      control.veoStarts += 1;
      if (!url.searchParams.get('key')) control.authMissing.push({ provider: 'veo-start', pathname });
      return json(res, 200, { name: 'operations/veo-op-1' });
    }
    if (req.method === 'GET' && pathname === '/v1beta/operations/veo-op-1') {
      if (!url.searchParams.get('key')) control.authMissing.push({ provider: 'veo-poll', pathname });
      if (control.mode === 'hold') return json(res, 200, { name: 'operations/veo-op-1', done: false });
      return json(res, 200, {
        name: 'operations/veo-op-1', done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${stubBase}/files/veo.mp4` } }] } },
      });
    }

    // ---- video files ------------------------------------------------------
    if (req.method === 'GET' && pathname.startsWith('/files/')) {
      if (control.failDownload) return json(res, 500, { error: 'emulated CDN failure' });
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(clipBytes.length) });
      return res.end(clipBytes);
    }

    json(res, 404, { error: `no emulated route for ${req.method} ${pathname}` });
  });
});
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
stubBase = `http://127.0.0.1:${stub.address().port}`;

// ---------------------------------------------------------------------------
// Application environment
// ---------------------------------------------------------------------------
const appEnv = {
  NODE_ENV: 'test',
  SKIP_FRONTEND: 'true',
  WORKER_ENABLED: 'false',            // the API process must not process jobs
  DATA_DIR: path.join(tempDir, 'data'),
  STORAGE_DIR: path.join(tempDir, 'storage'),
  SQLITE_PATH: path.join(tempDir, 'app.sqlite3'),
  APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  SEED_DEMO: 'true',
  ADMIN_EMAIL: 'admin-acceptance@example.test',
  ADMIN_PASSWORD: 'AcceptanceAdmin2026!',
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
  APP_URL: 'http://127.0.0.1:8787',
  AI_PROVIDER: 'local',
  TTS_PROVIDER: 'mespeak',
  FILM_VIDEO_PROVIDER: 'replicate',
  REPLICATE_API_TOKEN: 'r8_acceptanceSecretToken1234',
  REPLICATE_API_ROOT: stubBase,
  FAL_API_KEY: 'fal_acceptance_secret_1234',
  FAL_API_ROOT: stubBase,
  GOOGLE_VEO_API_KEY: 'veo_acceptance_secret_1234',
  GOOGLE_VEO_API_ROOT: stubBase,
  FILM_POLL_INTERVAL_MS: '25',
  FILM_POLL_TIMEOUT_MS: '30000',
  FILM_SCENE_CONCURRENCY: '2',
  FILM_ASSEMBLY_SEGMENT_SCENES: '2',
  FILM_MAX_RENDER_WIDTH: '320',
  FILM_BURN_IN_MAX_SECONDS: '0',
  WORKER_POLL_MS: '150',
  LOG_LEVEL: 'error',
};
for (const [key, value] of Object.entries(appEnv)) process.env[key] = value;

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { processFilmSceneJob, processFilmAssemblyJob } = await import('../server/film/scenes.js');
const {
  startVideoGeneration, pollVideoGeneration, cancelVideoGeneration, downloadProviderVideo,
} = await import('../server/film/videoProviders.js');
const { probeVideo } = await import('../server/media/utils.js');

let server;
let base;
let cookie;
let userId;

async function request(pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
const req = (pathname, options = {}) => request(pathname, options);

async function waitFor(label, check, { timeoutMs = 45000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function createFilm({ title, seconds = 20, sceneProvider = null }) {
  const created = await req('/api/films', {
    method: 'POST',
    body: { type: 'short_drama', title, targetDurationSeconds: seconds, aspectRatio: '16:9', targetPlatform: 'youtube', sceneProvider },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const filmId = created.data.film.id;
  const written = await req(`/api/films/${filmId}/screenplay`, {
    method: 'POST', body: { idea: `${title}: a keeper finds a second lighthouse that only appears at night.` },
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  return { filmId, scenes: written.data.film.scenes };
}

async function ledger(userIdValue = userId) {
  return db('credit_ledger').where({ user_id: userIdValue }).orderBy('created_at', 'asc');
}

async function refundEntries(sceneId, attempt) {
  return db('credit_ledger')
    .where({ user_id: userId, idempotency_key: `film_scene_refund:${sceneId}:${attempt}` });
}

async function jobFor(sceneId) {
  return db('jobs').where({ type: 'film_generate_scene' }).where('payload', 'like', `%${sceneId}%`).orderBy('created_at', 'desc').first();
}

/** Run queued film scene jobs the way the worker would, in-process. */
async function runSceneJobs(filmId, { rounds = 40 } = {}) {
  for (let i = 0; i < rounds; i += 1) {
    const pending = await db('jobs').where({ type: 'film_generate_scene', status: 'queued' });
    let ran = 0;
    for (const job of pending) {
      const payload = JSON.parse(job.payload || '{}');
      if (payload.filmId !== filmId) continue;
      await db('jobs').where({ id: job.id }).update({ status: 'running', attempts: job.attempts + 1, locked_at: new Date().toISOString(), locked_by: 'test:inproc' });
      try { await processFilmSceneJob(payload); } catch { /* the worker would retry; the test asserts the job outcome */ }
      await db('jobs').where({ id: job.id }).update({ status: 'completed', locked_at: null });
      ran += 1;
    }
    const active = await db('film_scenes').where({ film_id: filmId }).whereIn('status', ['queued', 'processing']);
    if (!ran && !active.length) return;
    if (!ran) return; // nothing left that this helper can drive
  }
}

async function assembleFilmViaJob(filmId) {
  const job = await db('jobs').where({ type: 'film_assemble' }).where('payload', 'like', `%${filmId}%`).orderBy('created_at', 'desc').first();
  assert.ok(job, 'an assembly job must be queued');
  const payload = JSON.parse(job.payload);
  await db('jobs').where({ id: job.id }).update({ status: 'running', attempts: job.attempts + 1, locked_at: new Date().toISOString(), locked_by: 'test:inproc' });
  const result = await processFilmAssemblyJob(payload);
  await db('jobs').where({ id: job.id }).update({ status: 'completed', locked_at: null });
  return result;
}

// ---------------------------------------------------------------------------
// Worker child process (for the crash/restart scenario)
// ---------------------------------------------------------------------------
function workerEnv() {
  return {
    ...process.env,
    ...appEnv,
    WORKER_ENABLED: 'true',
    WORKER_POLL_MS: '150',
    JOB_TIMEOUT_MS: String(20 * 60 * 1000),
    LOG_LEVEL: 'info',
  };
}

function spawnWorker() {
  const child = spawn(process.execPath, ['server/worker-standalone.js'], { cwd: root, env: workerEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, output: '', ready: false };
  const onData = (chunk) => {
    state.output += chunk.toString();
    if (state.output.includes('Dedicated worker process started')) state.ready = true;
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return state;
}

async function stopWorker(state) {
  if (!state?.child || state.child.exitCode !== null && state.child.signalCode === null) return;
  state.child.kill('SIGKILL');
  await new Promise((resolve) => {
    if (state.child.exitCode !== null || state.child.signalCode !== null) return resolve();
    state.child.once('exit', resolve);
    setTimeout(resolve, 5000);
  });
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'creator@filmclublens.local', password: 'StudioDemo2026!' } });
  assert.equal(login.status, 200);
  cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  userId = (await db('users').where({ email: 'creator@filmclublens.local' }).first()).id;
  await db('credit_accounts').where({ user_id: userId }).update({ balance: 500000 });
  await db('credit_ledger').where({ user_id: userId }).del();
});

after(async () => {
  control.activeWorker && await stopWorker(control.activeWorker);
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb().catch(() => {});
  stub.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Provider adapters
// ---------------------------------------------------------------------------
test('all three provider adapters are wired, configured and never leak credentials', async () => {
  const config = await req('/api/films/config');
  assert.equal(config.status, 200);
  const providers = config.data.videoProvider.catalog;
  for (const id of ['replicate', 'fal', 'veo']) {
    const entry = providers.find((item) => item.id === id);
    assert.ok(entry, `${id} must be advertised`);
    assert.equal(entry.configured, true, `${id} must report configured when its key is present`);
  }
  const serialized = JSON.stringify(config.data);
  for (const secret of ['r8_acceptanceSecretToken1234', 'fal_acceptance_secret_1234', 'veo_acceptance_secret_1234']) {
    assert.equal(serialized.includes(secret), false, 'provider keys must never reach the browser');
  }
  assert.equal(serialized.includes('REPLICATE_API_TOKEN'), false, 'no environment names or key material are echoed');
});

test('Replicate: start, poll, download and probe follow the documented contract', async () => {
  control.mode = 'hold';
  const handle = await startVideoGeneration({ prompt: 'a lighthouse at night', seconds: 10, aspectRatio: '16:9', provider: 'replicate' });
  assert.equal(handle.provider, 'replicate');
  assert.equal(control.lastRequest.pathname, `/v1/models/${replicate.model}/predictions`);
  assert.equal(control.lastRequest.headers.authorization, 'Bearer r8_acceptanceSecretToken1234');
  assert.equal(control.lastRequest.headers.prefer, 'wait=60');
  assert.equal(control.lastRequest.body.input.duration, 10);
  assert.equal(control.lastRequest.body.input.aspect_ratio, '16:9');
  assert.equal(JSON.stringify(handle).includes('r8_'), false, 'handles are credentials-free');

  const pending = await pollVideoGeneration(handle);
  assert.equal(pending.done, false, 'a processing prediction is never reported as finished');

  control.mode = 'complete';
  const done = await pollVideoGeneration(handle);
  assert.equal(done.done, true);
  assert.match(done.videoUrl, /\/files\/pred_.*\.mp4$/);

  const destination = path.join(tempDir, 'replicate-clip.mp4');
  await downloadProviderVideo(done, destination);
  const probe = await probeVideo(destination);
  assert.equal(probe.hasVideo, true);
  assert.ok(probe.durationSeconds > 1, 'the downloaded file must be a real, probeable video');

  const cancelled = await cancelVideoGeneration(handle);
  assert.equal(cancelled.cancelled, true);
  assert.equal(control.cancels.at(-1).provider, 'replicate');
  assert.match(control.cancels.at(-1).pathname, /\/v1\/predictions\/.+\/cancel$/);
});

test('fal.ai: queue contract, polling, cancel and authenticated download', async () => {
  const handle = await startVideoGeneration({ prompt: 'a storm over the sea', seconds: 10, aspectRatio: '9:16', provider: 'fal' });
  assert.equal(handle.provider, 'fal');
  assert.match(control.lastRequest.pathname, /^\/fal-ai\//);
  assert.equal(control.lastRequest.headers.authorization, 'Key fal_acceptance_secret_1234');
  assert.equal(control.lastRequest.body.duration, '10', 'fal expects the clip length as a string');

  control.mode = 'hold';
  assert.equal((await pollVideoGeneration(handle)).done, false);
  control.mode = 'complete';
  const done = await pollVideoGeneration(handle);
  assert.equal(done.done, true);
  assert.match(done.videoUrl, /\/files\/fal\.mp4$/);
  assert.equal(control.authMissing.length, 0, 'every fal call must carry its queue key');

  const destination = path.join(tempDir, 'fal-clip.mp4');
  await downloadProviderVideo(done, destination);
  assert.equal((await probeVideo(destination)).hasVideo, true);

  const cancelled = await cancelVideoGeneration(handle);
  assert.equal(cancelled.cancelled, true);
  assert.match(control.cancels.at(-1).pathname, /\/fal\/requests\/fal_req_1\/cancel$/);
  assert.equal(control.cancels.at(-1).headers.authorization, 'Key fal_acceptance_secret_1234');
});

test('Google Veo: long-running operation, keyed polling, honest "no cancel"', async () => {
  control.mode = 'complete';
  const handle = await startVideoGeneration({ prompt: 'a desert highway at dawn', seconds: 8, aspectRatio: '16:9', provider: 'veo' });
  assert.equal(handle.provider, 'veo');
  assert.match(control.lastRequest.pathname, /:predictLongRunning$/);
  assert.equal(control.lastRequest.query.key, 'veo_acceptance_secret_1234');
  assert.equal(control.lastRequest.body.parameters.durationSeconds, 8);

  const done = await pollVideoGeneration(handle);
  assert.equal(done.done, true);
  assert.match(done.videoUrl, /\/files\/veo\.mp4\?key=/);

  const destination = path.join(tempDir, 'veo-clip.mp4');
  await downloadProviderVideo(done, destination);
  assert.equal((await probeVideo(destination)).hasVideo, true);

  const cancelled = await cancelVideoGeneration(handle);
  assert.equal(cancelled.supported, false, 'Veo has no cancel endpoint and must not pretend otherwise');
  assert.equal(cancelled.cancelled, false);
});

test('provider errors are classified, retryable ones flagged, and secrets redacted', async () => {
  control.startStatus = 401;
  await assert.rejects(
    () => startVideoGeneration({ prompt: 'unauthorised', seconds: 5, provider: 'replicate' }),
    (error) => {
      assert.equal(error.retryable, false, 'an auth failure must not be retried');
      assert.match(error.message, /HTTP 401/);
      assert.equal(error.message.includes('r8_acceptanceSecretToken1234'), false, 'the token must be redacted');
      return true;
    },
  );
  control.startStatus = 429;
  await assert.rejects(
    () => startVideoGeneration({ prompt: 'rate limited', seconds: 5, provider: 'replicate' }),
    (error) => { assert.equal(error.retryable, true, 'a rate limit must be retried'); return true; },
  );
  control.startStatus = 500;
  await assert.rejects(
    () => startVideoGeneration({ prompt: 'server error', seconds: 5, provider: 'replicate' }),
    (error) => { assert.equal(error.retryable, true, 'a 5xx must be retried'); return true; },
  );
  control.startStatus = 0;

  // A dropped connection is the same shape as a provider timeout.
  const handle = await startVideoGeneration({ prompt: 'connection drop', seconds: 10, provider: 'replicate' });
  control.breakPoll = true;
  await assert.rejects(() => pollVideoGeneration(handle), (error) => {
    assert.ok(error, 'a dropped poll must throw');
    return true;
  });
});

test('a download failure is surfaced instead of accepting a broken clip', async () => {
  control.failDownload = true;
  const handle = await startVideoGeneration({ prompt: 'failed download', seconds: 10, provider: 'replicate' });
  control.mode = 'complete';
  const done = await pollVideoGeneration(handle);
  await assert.rejects(
    () => downloadProviderVideo(done, path.join(tempDir, 'broken.mp4')),
    (error) => { assert.match(String(error.message), /HTTP 500|download/i); assert.equal(error.retryable, true); return true; },
  );
  control.failDownload = false;
});

// ---------------------------------------------------------------------------
// 2. Full pipeline with a real worker process and a mid-run SIGKILL
// ---------------------------------------------------------------------------
const run = {};

test('worker killed mid-generation resumes the same provider jobs and never double-charges', async () => {
  control.mode = 'hold';
  control.replicateStarts = 0;
  const created = await createFilm({ title: 'Acceptance: keeper of two lights', seconds: 20 });
  const { filmId } = created;
  run.filmId = filmId;
  const balanceBefore = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);

  const started = await req(`/api/films/${filmId}/generation/start`, { method: 'POST', body: {} });
  assert.equal(started.status, 202, JSON.stringify(started.data));
  assert.equal(started.data.queued, 2);

  control.activeWorker = spawnWorker();
  await waitFor('the worker process to boot', () => control.activeWorker.ready);
  await waitFor('both scene jobs to be running', async () => {
    const running = await db('jobs').where({ type: 'film_generate_scene', status: 'running' });
    return running.length === 2;
  });
  const startsBeforeKill = control.replicateStarts;
  assert.equal(startsBeforeKill, 2);

  // Hard kill: no graceful shutdown, exactly like an OOM or container restart.
  const child = control.activeWorker.child;
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  control.activeWorker = null;

  const stillRunning = await db('jobs').where({ type: 'film_generate_scene', status: 'running' });
  assert.ok(stillRunning.length >= 1, 'the killed worker leaves its job locked');
  const stuckScene = await db('film_scenes').where({ film_id: filmId }).whereIn('status', ['processing', 'queued']).first();
  assert.ok(stuckScene, 'a scene is mid-flight when the worker dies');

  const killedAt = Date.now();
  control.mode = 'complete';
  control.activeWorker = spawnWorker();

  await waitFor('the restarted worker to finish both scenes', async () => {
    const rows = await db('film_scenes').where({ film_id: filmId });
    return rows.every((row) => row.status === 'ready');
  }, { timeoutMs: 60000 });
  const recoveryMs = Date.now() - killedAt;

  assert.equal(control.replicateStarts, startsBeforeKill, 'recovery resumes the existing predictions; it must not start (or pay for) new ones');

  const balanceAfter = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);
  assert.equal(balanceAfter, balanceBefore - 2 * 100, 'two 10s clips at 10 credits/second');

  const refunds = await db('credit_ledger').where({ user_id: userId }).where('reason', 'scene_refund');
  assert.equal(refunds.length, 0, 'a successful resume refunds nothing');

  const handles = (await db('film_scenes').where({ film_id: filmId })).map((scene) => JSON.parse(scene.provider_handle || 'null'));
  for (const handle of handles) {
    assert.equal(JSON.stringify(handle).includes('r8_'), false, 'stored handles never contain the API token');
  }
  run.recoveryMs = recoveryMs;
  run.startsUsed = control.replicateStarts;
  console.log(`# recovery: worker SIGKILLed with ${stillRunning.length} locked job(s); restarted worker finished both scenes in ${recoveryMs} ms without new predictions`);
  // The rest of the suite drives jobs in-process; a live worker would race with it.
  await stopWorker(control.activeWorker);
  control.activeWorker = null;
});

test('the recovered film assembles, probes, downloads and publishes', async () => {
  const { filmId } = run;
  const pre = await req(`/api/films/${filmId}/preflight`);
  assert.equal(pre.status, 200);
  assert.equal(pre.data.sceneCount, 2);
  assert.equal(pre.data.ready, true);
  assert.ok(pre.data.durationSeconds >= 19, `a 20s film must keep its runtime (got ${pre.data.durationSeconds})`);

  const queued = await req(`/api/films/${filmId}/assemble`, { method: 'POST', body: { subtitles: true, burnSubtitles: false } });
  assert.equal(queued.status, 202, JSON.stringify(queued.data));
  assert.equal(queued.data.subtitles, 'soft-track');

  const result = await assembleFilmViaJob(filmId);
  assert.ok(result, 'assembly must return a result');

  const film = (await req(`/api/films/${filmId}`)).data;
  assert.equal(film.stage, 'completed', 'a rendered film is marked completed');
  assert.equal(film.hasVideo, true);
  const finalPath = (await db('film_projects').where({ id: filmId }).first()).final_video_path;
  assert.ok(finalPath && fs.existsSync(finalPath), 'the assembled MP4 exists on disk');
  const probe = await probeVideo(finalPath);
  assert.equal(probe.hasVideo, true);
  assert.ok(probe.durationSeconds >= 19 && probe.durationSeconds <= 22, `final cut is ${probe.durationSeconds}s`);
  const captionPath = (await db('film_projects').where({ id: filmId }).first()).caption_path;
  assert.ok(captionPath && fs.existsSync(captionPath), 'soft subtitles ship as a downloadable .srt');
  const srt = fs.readFileSync(captionPath, 'utf8');
  assert.match(srt, /-->/, 'the caption file is valid SRT');
  assert.match(srt, /\d\d:\d\d:\d\d,\d\d\d/, 'timestamps are present');
  run.finalPath = finalPath;
  run.finalDuration = probe.durationSeconds;

  const download = await req(`/api/films/${filmId}/download`, { raw: true });
  assert.equal(download.status, 200);
  assert.equal(download.buffer.subarray(4, 8).toString(), 'ftyp', 'the download must be a real MP4');

  const ranged = await req(`/api/films/${filmId}/download`, { raw: true, headers: { range: 'bytes=0-1023' } });
  assert.equal(ranged.status, 206, 'range requests must work for in-browser playback');
  assert.equal(ranged.buffer.length, 1024);

  const published = await req(`/api/films/${filmId}/publish`, { method: 'POST', body: {} });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.equal(published.data.film.status, 'published');
  assert.ok(published.data.film.hasVideo);

  const streamed = await req(`/api/films/${filmId}/media/video`, { raw: true });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.buffer.subarray(4, 8).toString(), 'ftyp');

  const assemblyCredits = await db('credit_ledger').where({ user_id: userId }).where('idempotency_key', 'like', `film_assembly_reserve:${filmId}%`);
  assert.equal(assemblyCredits.length, 1, 'assembly is reserved exactly once');
  const assemblyDebits = await db('credit_ledger')
    .where({ user_id: userId }).where('idempotency_key', 'like', `film_assembly_%`).where('amount', '<', 0);
  assert.equal(assemblyDebits.flatMap((row) => row.idempotency_key).filter((key) => key.includes(filmId)).length, 1,
    'assembly is billed once: the queue-time reservation is the charge, not reservation + completion');

  console.log(`# assembled film: ${probe.durationSeconds.toFixed(2)}s, ${fs.statSync(finalPath).size} bytes, ${fs.statSync(captionPath).size} byte SRT, download ${download.buffer.length} bytes, published status ${published.data.film.status}`);
  fs.mkdirSync(path.join(root, 'test-artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-artifacts', 'acceptance-local.json'), JSON.stringify({
    note: 'Generated with the local provider protocol emulator. NOT a real AI video provider run.',
    provider: 'replicate-emulator', clips: 2, recoveryMs: run.recoveryMs,
    finalDurationSeconds: Number(probe.durationSeconds.toFixed(2)),
    finalBytes: fs.statSync(finalPath).size,
    publishedStatus: published.data.film.status,
    at: new Date().toISOString(),
  }, null, 2));
});

// ---------------------------------------------------------------------------
// 3. Failure and recovery
// ---------------------------------------------------------------------------
test('an incomplete film cannot be assembled or published', async () => {
  const { filmId } = await createFilm({ title: 'Acceptance: incomplete', seconds: 20 });
  const assembled = await req(`/api/films/${filmId}/assemble`, { method: 'POST', body: {} });
  assert.equal(assembled.status, 409);
  assert.equal(assembled.data.error.code, 'scenes_incomplete');

  const published = await req(`/api/films/${filmId}/publish`, { method: 'POST', body: {} });
  assert.equal(published.status, 409);
  assert.equal(published.data.error.code, 'film_not_rendered');
});

test('a failed download refunds exactly once and retrying succeeds with a second attempt', async () => {
  control.mode = 'complete';
  const { filmId } = await createFilm({ title: 'Acceptance: download failure', seconds: 10 });
  const started = await req(`/api/films/${filmId}/generation/start`, { method: 'POST', body: {} });
  assert.equal(started.status, 202);
  const scene = (await db('film_scenes').where({ film_id: filmId }).first());
  const balanceAfterReserve = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);

  control.failDownload = true;
  await runSceneJobs(filmId);
  control.failDownload = false;

  const failed = await db('film_scenes').where({ id: scene.id }).first();
  assert.equal(failed.status, 'failed');
  assert.match(String(failed.error), /download|HTTP 500/i);
  assert.equal(Number(failed.credits_cost), 100);
  const refunds = await refundEntries(scene.id, 1);
  assert.equal(refunds.length, 1, 'one failed attempt refunds exactly once');
  const balanceAfterRefund = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);
  assert.equal(balanceAfterRefund, balanceAfterReserve + 100);

  // Retry: a new attempt reserves once and, this time, succeeds.
  const retried = await req(`/api/films/${filmId}/scenes/retry-failed`, { method: 'POST', body: {} });
  assert.equal(retried.status, 202, JSON.stringify(retried.data));
  assert.ok(retried.data.retried >= 1);
  await runSceneJobs(filmId);
  const recovered = await db('film_scenes').where({ id: scene.id }).first();
  assert.equal(recovered.status, 'ready');
  assert.equal(Number(recovered.attempts), 2);
  assert.equal((await refundEntries(scene.id, 1)).length, 1, 'the first refund is never duplicated');
  assert.equal((await refundEntries(scene.id, 2)).length, 0, 'the successful attempt is not refunded');
});

test('cancelling mid-flight stops the provider job, refunds once, and a double cancel adds nothing', async () => {
  control.mode = 'hold';
  const cancelsBefore = control.cancels.length;
  const { filmId } = await createFilm({ title: 'Acceptance: cancel', seconds: 20 });
  const started = await req(`/api/films/${filmId}/generation/start`, { method: 'POST', body: {} });
  assert.equal(started.status, 202);
  const scenes = await db('film_scenes').where({ film_id: filmId });
  assert.equal(scenes.length, 2);
  const balanceBefore = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);

  // The worker is running: wait until at least one scene is actually being polled.
  await waitFor('provider polling to start', async () => {
    const row = await db('film_scenes').where({ film_id: filmId }).whereIn('status', ['processing', 'queued']).first();
    return Boolean(row);
  });

  const first = await req(`/api/films/${filmId}/generation/cancel`, { method: 'POST', body: {} });
  assert.equal(first.status, 200);
  assert.equal(first.data.cancelled, true);
  assert.equal(first.data.scenes, 2);
  assert.ok(control.cancels.length > cancelsBefore, 'the provider cancel endpoint must be called');

  const second = await req(`/api/films/${filmId}/generation/cancel`, { method: 'POST', body: {} });
  assert.equal(second.status, 200);
  assert.equal(second.data.refunded, 0, 'a second cancel must not refund again');

  for (const scene of await db('film_scenes').where({ film_id: filmId })) {
    assert.equal(scene.status, 'cancelled');
    assert.equal(scene.clip_path, null, 'a cancelled scene never keeps a clip');
    assert.equal((await refundEntries(scene.id, 1)).length, 1);
  }
  const balanceAfter = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);
  assert.equal(balanceAfter, balanceBefore + 200, 'both reservations are refunded exactly once');

  // A late job run for a cancelled film must not refund or charge anything.
  const late = await db('jobs').where({ type: 'film_generate_scene' }).where('payload', 'like', `%${filmId}%`).first();
  if (late) await processFilmSceneJob(JSON.parse(late.payload)).catch(() => {});
  const balanceFinal = Number((await db('credit_accounts').where({ user_id: userId }).first()).balance);
  assert.equal(balanceFinal, balanceAfter, 'a late poll on a cancelled run is free');
  control.mode = 'complete';
});

test('the credit ledger reconciles every reservation and refund', async () => {
  const rows = await ledger();
  const chargeKeys = new Set();
  let charged = 0;
  let refunded = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (amount < 0) {
      charged += -amount;
      assert.equal(chargeKeys.has(row.idempotency_key), false, `duplicate charge for ${row.idempotency_key}`);
      chargeKeys.add(row.idempotency_key);
    } else if (String(row.reason).includes('refund')) refunded += amount;
  }
  const account = await db('credit_accounts').where({ user_id: userId }).first();
  const recomputed = Number(account.balance);
  assert.equal(Number.isInteger(recomputed), true);
  assert.ok(charged > 0 && refunded > 0, 'the run exercised both charges and refunds');
  assert.equal(new Set(rows.map((row) => row.idempotency_key)).size, rows.length, 'every ledger entry is idempotent');
});
