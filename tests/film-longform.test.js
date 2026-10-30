/**
 * Professional long-form production tests.
 *
 * The provider boundary is replaced by a local HTTP double that behaves like the
 * Replicate prediction API and serves a real H.264 clip produced by FFmpeg. This
 * is a TEST STUB: production code cannot invent a clip without a provider.
 *
 * Covered here:
 *  - 60-minute requests plan 360 clips (no truncation) and over-limit requests
 *    fail with exact numbers;
 *  - provider clip-length mapping;
 *  - bounded concurrency, pause/resume/cancel, per-scene cancel and refunds;
 *  - failure handling when a provider returns something that is not a video;
 *  - sound-effect upload + cue mixing and segmented assembly with soft subtitles.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-longform-'));
const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;

function makeMedia(file, args) {
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, file], { stdio: 'ignore' });
  return fs.readFileSync(file);
}

const clipPath = path.join(tempDir, 'provider-clip.mp4');
makeMedia(clipPath, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
const clipBytes = fs.readFileSync(clipPath);

const musicPath = path.join(tempDir, 'music.wav');
makeMedia(musicPath, ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-ac', '1', '-ar', '24000']);
const sfxPath = path.join(tempDir, 'thunder.wav');
makeMedia(sfxPath, ['-f', 'lavfi', '-i', 'sine=frequency=90:duration=1', '-ac', '1', '-ar', '24000']);

let stubBase = '';
let predictionSeq = 0;
let cancelledJobs = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url.includes('/cancel')) {
      cancelledJobs.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'pred_cancelled', status: 'canceled' }));
      return;
    }
    if (req.method === 'POST' && req.url.includes('/predictions')) {
      predictionSeq += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `pred_${predictionSeq}`, status: 'processing' }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/predictions/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'pred', status: 'succeeded', output: `${stubBase}/video.mp4` }));
      return;
    }
    if (req.url.startsWith('/video.mp4')) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(clipBytes.length) });
      res.end(clipBytes);
      return;
    }
    if (req.url.startsWith('/audio.wav')) {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(fs.readFileSync(sfxPath));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
});
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
stubBase = `http://127.0.0.1:${stub.address().port}`;

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-longform@example.test';
process.env.ADMIN_PASSWORD = 'LongFormAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8787';
process.env.APP_URL = 'http://127.0.0.1:8787';
process.env.AI_PROVIDER = 'local';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'replicate';
process.env.REPLICATE_API_TOKEN = 'r8_longform-test-token';
process.env.REPLICATE_API_ROOT = stubBase;
process.env.FILM_POLL_INTERVAL_MS = '10';
process.env.FILM_POLL_TIMEOUT_MS = '60000';
process.env.FILM_SCENE_CONCURRENCY = '2';
process.env.FILM_ASSEMBLY_SEGMENT_SCENES = '2';
process.env.FILM_MAX_RENDER_WIDTH = '320';
process.env.FILM_BURN_IN_MAX_SECONDS = '0';
for (const key of ['FAL_API_KEY', 'GOOGLE_VEO_API_KEY', 'GEMINI_API_KEY', 'DATABASE_URL', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY']) delete process.env[key];

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { config } = await import('../server/config.js');
const {
  processFilmSceneJob, processFilmAssemblyJob, dispatchPlannedScenes,
} = await import('../server/film/scenes.js');
const { applyCredit, getBalance } = await import('../server/film/credits.js');
const { planProject, assertScenePlanFits } = await import('../server/film/screenplay.js');
const { resolveProviderDuration, durationOptionsFor } = await import('../server/film/videoProviders.js');
const { probeVideo } = await import('../server/media/utils.js');
const { assembleFilm } = await import('../server/film/assembly.js');

let server;
let base;
let cookie;
let userId;

async function request(pathname, { method = 'GET', body, cookie: c, raw = false } = {}) {
  const headers = {};
  if (c) headers.cookie = c;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'creator@faceless.local', password: 'StudioDemo2026!' } });
  assert.equal(login.status, 200);
  cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  userId = (await db('users').where({ email: 'creator@faceless.local' }).first()).id;
  // Fund the long-form run: 360 clips × 10s × 10 credits ≈ 36,000 credits.
  await applyCredit(userId, 5_000_000, 'test_grant', { idempotencyKey: `longform-grant:${crypto.randomUUID()}` });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  await new Promise((resolve) => stub.close(resolve));
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test('a 60-minute request plans exactly 360 ten-second clips (never truncated)', () => {
  const saved = config.film.maxScenes;
  try {
    config.film.maxScenes = 720;
    const plan = planProject(3600);
    assert.equal(plan.sceneCount, 360);
    assert.equal(plan.sceneSeconds, 10);
    assert.equal(plan.exceedsSceneLimit, false);
    assert.equal(planProject(60).sceneCount, 6);
    assert.equal(planProject(1200).sceneCount, 120);
  } finally {
    config.film.maxScenes = saved;
  }
});

test('an over-limit length fails with exact numbers instead of a silent truncation', async () => {
  const saved = config.film.maxScenes;
  config.film.maxScenes = 100;
  try {
    assert.throws(() => assertScenePlanFits(3600), (error) => {
      assert.equal(error.code, 'scene_plan_exceeds_limit');
      assert.match(error.message, /360 scenes/);
      assert.match(error.message, /allows 100 scenes/);
      assert.equal(error.details?.sceneCount, 360);
      return true;
    });
    const created = await req('/api/films', { method: 'POST', body: { type: 'movie', title: 'Too Long', targetDurationSeconds: 3600 } });
    assert.equal(created.status, 400);
    assert.equal(created.data.error.code, 'scene_plan_exceeds_limit');
    const estimate = await req('/api/films/estimate', { method: 'POST', body: { targetDurationSeconds: 3600 } });
    assert.equal(estimate.status, 400);
    assert.equal(estimate.data.error.code, 'scene_plan_exceeds_limit');
  } finally {
    config.film.maxScenes = saved;
  }
});

test('a request beyond the deployment ceiling is rejected, never silently shortened', async () => {
  const saved = config.film.maxProjectSeconds;
  config.film.maxProjectSeconds = 1800;
  try {
    const created = await req('/api/films', { method: 'POST', body: { type: 'movie', title: 'Two Hours', targetDurationSeconds: 7200 } });
    assert.equal(created.status, 400);
    assert.equal(created.data.error.code, 'duration_exceeds_limit');
    assert.match(created.data.error.message, /7200s/);
    assert.equal(created.data.error.details?.requestedSeconds, 7200);
    assert.equal(created.data.error.details?.maxProjectSeconds, 1800);

    const estimate = await req('/api/films/estimate', { method: 'POST', body: { targetDurationSeconds: 7200 } });
    assert.equal(estimate.status, 400);
    assert.equal(estimate.data.error.code, 'duration_exceeds_limit');

    // The planner reports the raw request instead of clamping it to the limit.
    const plan = planProject(7200);
    assert.equal(plan.requestedSeconds, 7200);
    assert.equal(plan.plannedForSeconds, 1800);
    assert.equal(plan.exceedsDurationLimit, true);
  } finally {
    config.film.maxProjectSeconds = saved;
  }
});

test('a screenplay written without an explicit runtime inherits the project duration', async () => {
  const created = await req('/api/films', { method: 'POST', body: { type: 'short_drama', title: 'Ten minute drama', targetDurationSeconds: 600 } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const filmId = created.data.film.id;
  const written = await req(`/api/films/${filmId}/screenplay`, {
    method: 'POST', body: { idea: 'A courier must deliver a letter before the city floods.' },
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  const scenes = written.data.film.scenes;
  assert.equal(scenes.length, 60, '600s of 10s clips, not a 60-second default');
  assert.equal(scenes.reduce((n, scene) => n + scene.durationSeconds, 0), 600);
  assert.equal(written.data.screenplay.requestedSceneCount, 60);
  assert.equal(written.data.screenplay.shortfall, 0);
});

test('the estimate endpoint exposes the full plan and cost before generation', async () => {
  const estimate = await req('/api/films/estimate', { method: 'POST', body: { targetDurationSeconds: 3600 } });
  assert.equal(estimate.status, 200);
  assert.equal(estimate.data.sceneCount, 360);
  assert.equal(estimate.data.plan.sceneCount, 360);
  assert.equal(estimate.data.breakdown.video.credits, 360 * 10 * config.film.creditPerVideoSecond);
  assert.ok(estimate.data.total > 0);
  assert.equal(typeof estimate.data.sufficient, 'boolean');
});

test('config advertises duration presets, concurrency and provider capabilities', async () => {
  const res = await req('/api/films/config');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.durationPresets.slice(0, 3), [60, 120, 300]);
  assert.ok(res.data.durationPresets.includes(3600));
  assert.equal(res.data.production.sceneConcurrency, 2);
  assert.equal(res.data.limits.maxScenes, config.film.maxScenes);
  assert.ok(res.data.limits.maxProducibleSeconds >= 3600);
  const replicate = res.data.videoProvider.catalog.find((item) => item.id === 'replicate');
  assert.equal(replicate.configured, true);
  assert.ok(replicate.durations.includes(5));
  assert.ok(!JSON.stringify(res.data).includes('r8_longform-test-token'));
});

test('clip lengths are mapped onto the values each provider actually accepts', () => {
  assert.equal(resolveProviderDuration('replicate', 7), 10);
  assert.equal(resolveProviderDuration('replicate', 3), 5);
  assert.equal(resolveProviderDuration('veo', 5), 6);
  assert.equal(resolveProviderDuration('veo', 9), 8);
  assert.equal(resolveProviderDuration('fal', 1), 5);
  assert.deepEqual(durationOptionsFor('veo'), [4, 6, 8]);
});

test('corrupt provider output is rejected instead of being presented as a clip', async () => {
  const fake = path.join(tempDir, 'not-a-video.mp4');
  fs.writeFileSync(fake, 'this is not a video');
  const probe = await probeVideo(fake);
  assert.equal(probe.hasVideo, false);
  assert.equal(probe.durationSeconds, 0);

  const created = await req('/api/films', { method: 'POST', body: { type: 'short_drama', title: 'Broken Clip', targetDurationSeconds: 10 } });
  const filmId = created.data.film.id;
  await req(`/api/films/${filmId}/screenplay`, { method: 'POST', body: { idea: 'A broken camera', targetDurationSeconds: 10 } });
  const scene = (await db('film_scenes').where({ film_id: filmId }).first());
  await db('film_scenes').where({ id: scene.id }).update({ status: 'ready', clip_path: fake, stage: 'ready' });
  await assert.rejects(() => assembleFilm(filmId, { subtitles: false }), (error) => {
    assert.equal(error.code, 'clip_invalid');
    return true;
  });
  const film = await db('film_projects').where({ id: filmId }).first();
  assert.equal(film.final_video_path, null, 'no final video may be published from a corrupt clip');
});

test('a 60-minute run is queued with bounded concurrency, then paused, resumed and cancelled with refunds', async () => {
  const created = await req('/api/films', {
    method: 'POST',
    body: { type: 'movie', title: 'The Long Road Home', targetDurationSeconds: 3600, aspectRatio: '16:9', targetPlatform: 'youtube' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const filmId = created.data.film.id;
  assert.equal(created.data.film.plan.sceneCount, 360);

  const written = await req(`/api/films/${filmId}/screenplay`, {
    method: 'POST', body: { idea: 'A family crosses a continent to find their missing father', targetDurationSeconds: 3600 },
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  const scenes = await db('film_scenes').where({ film_id: filmId });
  assert.equal(scenes.length, 360, 'a 60-minute film must plan 360 scenes');
  const totalSeconds = scenes.reduce((n, scene) => n + Number(scene.duration_seconds), 0);
  assert.ok(totalSeconds >= 3600 - 360 && totalSeconds <= 3600, `planned runtime should match the request, got ${totalSeconds}`);

  const balanceBefore = await getBalance(userId);
  const started = await req(`/api/films/${filmId}/generation/start`, { method: 'POST', body: {} });
  assert.equal(started.status, 202, JSON.stringify(started.data));
  assert.equal(started.data.queued, 2, 'only the concurrency budget starts immediately');
  assert.equal(started.data.planned, 358);

  let counts = await req(`/api/films/${filmId}/progress`);
  assert.equal(counts.status, 200);
  assert.equal(counts.data.runState, 'running');
  assert.equal(counts.data.counts.active, 2);
  assert.equal(counts.data.counts.planned, 358);
  assert.equal(counts.data.sceneConcurrency, 2);

  const paused = await req(`/api/films/${filmId}/generation/pause`, { method: 'POST' });
  assert.equal(paused.status, 200);
  assert.equal(paused.data.paused, true);
  const afterPause = await req(`/api/films/${filmId}/progress`);
  assert.equal(afterPause.data.runState, 'paused');

  const resumed = await req(`/api/films/${filmId}/generation/resume`, { method: 'POST' });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.resumed, true);
  const afterResume = await req(`/api/films/${filmId}/progress`);
  assert.equal(afterResume.data.runState, 'running');

  const cancelled = await req(`/api/films/${filmId}/generation/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.cancelled, true);
  assert.equal(cancelled.data.scenes, 2);
  assert.ok(cancelled.data.refunded > 0);
  assert.ok(cancelledJobs.length >= 1, 'the provider cancel endpoint must be called');
  assert.equal(await getBalance(userId), balanceBefore, 'cancelling refunds every reserved scene exactly once');

  counts = await req(`/api/films/${filmId}/progress`);
  assert.equal(counts.data.runState, 'cancelled');
  assert.equal(counts.data.counts.active, 0);
  assert.equal(counts.data.counts.cancelled, 2);
  assert.equal(counts.data.counts.planned, 0);
  assert.equal(counts.data.counts.draft, 358);
  assert.equal(cancelled.data.drafted, 358);

  // Cancelled scenes can be retried; that starts a fresh bounded run.
  const retried = await req(`/api/films/${filmId}/scenes/retry-failed`, { method: 'POST' });
  assert.equal(retried.status, 202, JSON.stringify(retried.data));
  assert.equal(retried.data.retried, 2);
  const afterRetry = await req(`/api/films/${filmId}/progress`);
  assert.equal(afterRetry.data.counts.active, 2);
});

test('a segmented render mixes real sound effects, music and soft subtitles into a playable MP4', async () => {
  const created = await req('/api/films', {
    method: 'POST',
    body: { type: 'movie', title: 'Sound & Vision', targetDurationSeconds: 30, aspectRatio: '16:9', targetPlatform: 'youtube' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const filmId = created.data.film.id;
  const written = await req(`/api/films/${filmId}/screenplay`, {
    method: 'POST', body: { idea: 'A storm rolls over a fishing village', targetDurationSeconds: 30 },
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].duration_seconds, 10);

  // Generate every clip through the real worker handler against the stub.
  await req(`/api/films/${filmId}/generation/start`, { method: 'POST', body: {} });
  for (let guard = 0; guard < 6; guard += 1) {
    const pending = await db('film_scenes').where({ film_id: filmId }).whereIn('status', ['queued', 'processing']);
    if (!pending.length) {
      await dispatchPlannedScenes(filmId);
      const planned = await db('film_scenes').where({ film_id: filmId, status: 'planned' });
      if (!planned.length) break;
      continue;
    }
    for (const scene of pending) {
      const result = await processFilmSceneJob({ filmId, sceneId: scene.id, userId, attempt: scene.attempts });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
  }
  const ready = await db('film_scenes').where({ film_id: filmId, status: 'ready' });
  assert.equal(ready.length, 3, 'all three scenes must have real clips');

  // Upload a sound effect and a music bed through the real API.
  const form = new FormData();
  form.append('kind', 'sfx');
  form.append('name', 'Thunder');
  form.append('file', new Blob([fs.readFileSync(sfxPath)], { type: 'audio/wav' }), 'thunder.wav');
  const sfxUpload = await fetch(`${base}/api/films/${filmId}/upload`, { method: 'POST', headers: { cookie }, body: form });
  assert.equal(sfxUpload.status, 201);
  const sfxJson = await sfxUpload.json();
  assert.ok(sfxJson.asset.id);
  assert.ok(sfxJson.asset.durationSeconds >= 0.9);

  const musicForm = new FormData();
  musicForm.append('kind', 'music');
  musicForm.append('file', new Blob([fs.readFileSync(musicPath)], { type: 'audio/wav' }), 'music.wav');
  const musicUpload = await fetch(`${base}/api/films/${filmId}/upload`, { method: 'POST', headers: { cookie }, body: musicForm });
  assert.equal(musicUpload.status, 201);

  const patched = await req(`/api/films/${filmId}/scenes/${scenes[0].id}`, {
    method: 'PATCH', body: { sfx: [{ assetId: sfxJson.asset.id, atSeconds: 1, gain: 1 }] },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.scene.sfx.length, 1);

  const preflight = await req(`/api/films/${filmId}/preflight`);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.data.sfxCount, 1);
  assert.equal(preflight.data.ready, true);
  assert.equal(preflight.data.segments, 2, '3 clips with 2 per segment');
  assert.ok(preflight.data.estimatedRenderBytes > 0);

  const balanceBefore = await getBalance(userId);
  const queued = await req(`/api/films/${filmId}/assemble`, { method: 'POST', body: { subtitles: true } });
  assert.equal(queued.status, 202, JSON.stringify(queued.data));
  assert.equal(queued.data.subtitles, 'soft-track', 'long films get a soft subtitle track');

  const rendered = await processFilmAssemblyJob({ filmId, userId, attempt: 1, subtitles: true });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.ok(fs.existsSync(rendered.videoPath));
  assert.ok(fs.statSync(rendered.videoPath).size > 4096);
  assert.equal(rendered.segments, 2, 'assembly renders in segments');
  assert.equal(rendered.subtitles, 'soft-track');
  assert.equal(rendered.sfxUsed, 1, 'the attached sound effect must be mixed');
  assert.ok(rendered.durationSeconds >= 29 && rendered.durationSeconds <= 31, `expected ~30s, got ${rendered.durationSeconds}`);
  assert.ok(await getBalance(userId) < balanceBefore, 'a successful render is charged once');

  const probe = await probeVideo(rendered.videoPath);
  assert.equal(probe.hasVideo, true);
  assert.ok(probe.hasAudio, 'voice and sound effects must produce an audio stream');
  assert.ok(probe.durationSeconds >= 29);

  const detail = await req(`/api/films/${filmId}`);
  assert.equal(detail.data.status, 'completed');
  assert.equal(detail.data.hasVideo, true);
  assert.equal(detail.data.hasCaptions, true);

  const download = await req(`/api/films/${filmId}/download`, { raw: true });
  assert.equal(download.status, 200);
  assert.equal(download.buffer.subarray(4, 8).toString('ascii'), 'ftyp');
  const captions = await req(`/api/films/${filmId}/media/captions`);
  assert.match(String(captions.data), /\d{2}:\d{2}:\d{2},\d{3} --> /);

  // A cancelled render is refunded and must not destroy the verified cut.
  await db('film_projects').where({ id: filmId }).update({ assembly_cancel_requested: 1, status: 'assembling' });
  const cancelledRender = await processFilmAssemblyJob({ filmId, userId, attempt: 2, subtitles: true });
  assert.equal(cancelledRender.ok, false);
  assert.equal(cancelledRender.cancelled, true);
  const afterCancel = await db('film_projects').where({ id: filmId }).first();
  assert.ok(afterCancel.final_video_path, 'the previous cut is preserved');
  assert.ok(fs.existsSync(afterCancel.final_video_path));
});
