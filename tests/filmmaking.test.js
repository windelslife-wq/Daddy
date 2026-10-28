/**
 * End-to-end AI filmmaking tests.
 *
 * The provider boundary is replaced by a local HTTP test double that behaves
 * like Replicate's prediction API and serves a real H.264 clip produced by
 * FFmpeg. This is a TEST STUB, not a production fallback: production code has
 * no way to invent a clip when FILM_VIDEO_PROVIDER is missing.
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-film-'));
const clipSource = path.join(tempDir, 'provider-clip.mp4');

// Build a genuine, playable video file for the stub provider to return.
const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=3',
  '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', clipSource,
], { stdio: 'ignore' });
const clipBytes = fs.readFileSync(clipSource);

let pollCount = 0;
let lastAuthHeader = '';
let stubBase = '';
const stub = http.createServer((req, res) => {
  lastAuthHeader = req.headers.authorization || '';
  if (req.method === 'POST' && req.url.includes('/predictions')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      assert.ok(parsed.input?.prompt, 'provider must receive a real prompt');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'pred_test', status: 'processing', urls: { get: `${stubBase}/v1/predictions/pred_test` } }));
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/predictions/')) {
    pollCount += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (pollCount < 2) res.end(JSON.stringify({ id: 'pred_test', status: 'processing' }));
    else res.end(JSON.stringify({ id: 'pred_test', status: 'succeeded', output: `${stubBase}/video.mp4` }));
    return;
  }
  if (req.url.startsWith('/video.mp4')) {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(clipBytes.length) });
    res.end(clipBytes);
    return;
  }
  res.writeHead(404); res.end('not found');
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
process.env.ADMIN_EMAIL = 'admin-film@example.test';
process.env.ADMIN_PASSWORD = 'FilmAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8787';
process.env.APP_URL = 'http://127.0.0.1:8787';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'replicate';
process.env.REPLICATE_API_TOKEN = 'r8_test-token-for-local-stub';
process.env.REPLICATE_API_ROOT = stubBase;
process.env.FILM_POLL_INTERVAL_MS = '10';
process.env.FILM_POLL_TIMEOUT_MS = '60000';
for (const key of ['FAL_API_KEY', 'GOOGLE_VEO_API_KEY', 'GEMINI_API_KEY', 'DATABASE_URL', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY']) delete process.env[key];

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { config } = await import('../server/config.js');
const { processFilmSceneJob, processFilmAssemblyJob } = await import('../server/film/scenes.js');
const { estimateFilm, applyCredit, getBalance } = await import('../server/film/credits.js');
const { providerStatus } = await import('../server/film/videoProviders.js');

let server;
let base;
let cookie;
let userId;

async function request(pathname, { method = 'GET', body, cookie: c, raw = false } = {}) {
  const headers = {};
  if (c) headers.cookie = c;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/auth/login', {
    method: 'POST', body: { email: 'creator@faceless.local', password: 'StudioDemo2026!' },
  });
  assert.equal(login.status, 200, `demo login failed: ${JSON.stringify(login.data)}`);
  cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const user = await db('users').where({ email: 'creator@faceless.local' }).first();
  userId = user.id;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  await new Promise((resolve) => stub.close(resolve));
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

test('config reports real provider readiness, limits, and starting balance', async () => {
  const res = await req('/api/films/config');
  assert.equal(res.status, 200);
  assert.equal(res.data.videoProvider.provider, 'replicate');
  assert.equal(res.data.videoProvider.realGeneration, true);
  assert.equal(res.data.videoProvider.configured, true);
  assert.equal(res.data.aiScreenplayConfigured, false);
  assert.ok(res.data.credits.balance > 0, 'signup grant must be applied');
  assert.ok(res.data.limits.maxScenes >= 8);
  assert.match(res.data.limits.note, /scene-by-scene/i);
  assert.ok(res.data.types.includes('short_drama'));
  assert.ok(res.data.types.includes('long_drama'));
  assert.ok(res.data.types.includes('movie'));
  assert.ok(res.data.types.includes('episode'));
});

test('no API key ever appears in a public config response', async () => {
  const res = await req('/api/films/config');
  assert.ok(!JSON.stringify(res.data).includes('r8_test-token'));
  assert.ok(!JSON.stringify(res.data).includes('REPLICATE_API_TOKEN'));
});

test('credit estimates are exact and reservations are idempotent', async () => {
  const estimate = estimateFilm([
    { duration_seconds: 10, dialogue: [{ line: 'hello world' }] },
    { duration_seconds: 5, dialogue: [] },
  ]);
  assert.equal(estimate.breakdown.video.credits, 15 * config.film.creditPerVideoSecond);
  assert.equal(estimate.sceneCount, 2);
  assert.equal(estimate.sceneSeconds, 15);
  assert.equal(estimate.dialogueCharacters, 11);

  const beforeBalance = await getBalance(userId);
  const key = `test-idempotent:${crypto.randomUUID()}`;
  const first = await applyCredit(userId, -7, 'test', { idempotencyKey: key });
  const second = await applyCredit(userId, -7, 'test', { idempotencyKey: key });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(await getBalance(userId), beforeBalance - 7);

  const post = await req('/api/films/estimate', {
    method: 'POST', body: { scenes: [{ duration_seconds: 10, dialogue: [] }] },
  });
  assert.equal(post.status, 200);
  assert.equal(post.data.breakdown.video.credits, 10 * config.film.creditPerVideoSecond);
  assert.equal(post.data.balance, beforeBalance - 7);
});

test('credit mutations roll back rejected reservations and preserve idempotent replays', async () => {
  const balance = await getBalance(userId);
  const key = `test-rejected:${crypto.randomUUID()}`;
  await assert.rejects(applyCredit(userId, -(balance + 1), 'test', { idempotencyKey: key }),
    (error) => error.code === 'insufficient_credits');
  assert.equal(await getBalance(userId), balance);
  assert.equal(await db('credit_ledger').where({ idempotency_key: key }).first(), undefined);
  const accepted = await applyCredit(userId, 1, 'test', { idempotencyKey: key });
  const replay = await applyCredit(userId, 1, 'test', { idempotencyKey: key });
  assert.equal(accepted.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(replay.amount, 0);
  assert.equal(await getBalance(userId), balance + 1);
});

test('insufficient credits are rejected before any provider call', async () => {
  const before = await getBalance(userId);
  const huge = await req('/api/films/estimate', {
    method: 'POST',
    body: { scenes: Array.from({ length: 100 }, () => ({ duration_seconds: 10, dialogue: [] })) },
  });
  assert.equal(huge.status, 200);
  assert.equal(huge.data.sufficient, false);
  assert.ok(huge.data.shortfall > 0);
  assert.equal(await getBalance(userId), before, 'estimate must not charge credits');
});

let filmId;
let sceneIds;

test('a short drama project can be created with a local template screenplay', async () => {
  const created = await req('/api/films', {
    method: 'POST',
    body: {
      type: 'short_drama', title: 'The Last Message',
      logline: 'A phone call changes everything.',
      genre: 'family_drama', language: 'en', style: 'cinematic',
      aspectRatio: '9:16', targetPlatform: 'tiktok', targetDurationSeconds: 20,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  filmId = created.data.film.id;
  assert.equal(created.data.film.type, 'short_drama');

  const written = await req(`/api/films/${filmId}/screenplay`, {
    method: 'POST',
    body: { idea: 'Two siblings discover a secret in their late father workshop', targetDurationSeconds: 20 },
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  assert.equal(written.data.aiGenerated, false, 'local template must be honestly labelled');
  assert.equal(written.data.provider, 'local-template');
  assert.ok(written.data.screenplay.scenes.length >= 2);
  assert.equal(written.data.film.sceneCount, written.data.screenplay.scenes.length);
  assert.ok(written.data.film.characters.length >= 2, 'recurring cast must be saved');
  assert.ok(written.data.film.estimate.total > 0);
  sceneIds = written.data.film.scenes.map((s) => s.id);
});

test('unauthenticated film requests are rejected', async () => {
  const res = await request(`/api/films/${filmId}`, { method: 'GET' });
  assert.equal(res.status, 401);
});

test('generation is impossible when no real video provider is configured', async () => {
  const original = config.film.videoProvider;
  config.film.videoProvider = 'none';
  try {
    const res = await req(`/api/films/${filmId}/scenes/${sceneIds[0]}/generate`, { method: 'POST' });
    assert.equal(res.status, 503);
    assert.equal(res.data.error.code, 'video_provider_unavailable');
    const balance = await getBalance(userId);
    assert.equal(providerStatus().configured, false);
    assert.ok(balance > 0);
  } finally {
    config.film.videoProvider = original;
  }
  const status = providerStatus();
  assert.equal(status.configured, true);
});

test('scene generation calls a real provider, charges credits, and stores a playable clip', async () => {
  const balanceBefore = await getBalance(userId);
  const queued = await req(`/api/films/${filmId}/scenes/${sceneIds[0]}/generate`, { method: 'POST' });
  assert.equal(queued.status, 202, JSON.stringify(queued.data));
  assert.equal(queued.data.scene.status, 'queued');
  assert.ok(queued.data.scene.provider === 'replicate');
  assert.match(lastAuthHeader, /^Bearer r8_test-token/);

  const row = await db('film_scenes').where({ id: sceneIds[0] }).first();
  const handle = JSON.parse(row.provider_handle);
  assert.ok(!JSON.stringify(handle).includes('r8_test-token'), 'API key must never be persisted');

  const result = await processFilmSceneJob({ filmId, sceneId: sceneIds[0], userId, attempt: 1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(fs.existsSync(result.clipPath));
  assert.ok(fs.statSync(result.clipPath).size > 1024);
  assert.ok(pollCount >= 2);

  const detail = await req(`/api/films/${filmId}`);
  assert.equal(detail.data.scenes[0].status, 'ready');
  assert.equal(detail.data.scenes[0].hasClip, true);
  assert.equal(detail.data.readyScenes, 1);
  assert.equal(await getBalance(userId), balanceBefore - detail.data.scenes[0].creditsCost);

  const clip = await req(`/api/films/${filmId}/scenes/${sceneIds[0]}/clip`, { raw: true });
  assert.equal(clip.status, 200);
  assert.match(clip.headers.get('content-type'), /video\/mp4/);
  assert.equal(clip.buffer.length, clipBytes.length);
});

test('a failed provider start refunds credits exactly once and can be retried', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/predictions') && options.method === 'POST') {
      return new Response(JSON.stringify({ error: 'quota exceeded' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(url, options);
  };
  let balanceBefore;
  try {
    balanceBefore = await getBalance(userId);
    const failed = await req(`/api/films/${filmId}/scenes/${sceneIds[1]}/generate`, { method: 'POST' });
    assert.equal(failed.status, 502, JSON.stringify(failed.data));
    assert.equal(await getBalance(userId), balanceBefore, 'failed start must refund immediately');
  } finally {
    globalThis.fetch = originalFetch;
  }
  const row = await db('film_scenes').where({ id: sceneIds[1] }).first();
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1, 'a failed start consumes its attempt number');

  // A retry uses a fresh attempt: no free credits, no duplicate refund.
  const retry = await req(`/api/films/${filmId}/scenes/${sceneIds[1]}/generate`, { method: 'POST' });
  assert.equal(retry.status, 202, JSON.stringify(retry.data));
  assert.equal(retry.data.scene.attempts, 2);
  const result = await processFilmSceneJob({ filmId, sceneId: sceneIds[1], userId, attempt: 2 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(await getBalance(userId), balanceBefore - retry.data.scene.creditsCost, 'only the successful retry should be charged');
});

test('regenerating one scene does not rebuild other scenes', async () => {
  const firstClip = (await db('film_scenes').where({ id: sceneIds[0] }).first()).clip_path;
  const otherClip = (await db('film_scenes').where({ id: sceneIds[1] }).first()).clip_path;
  const regenerate = await req(`/api/films/${filmId}/scenes/${sceneIds[0]}/generate`, { method: 'POST' });
  assert.equal(regenerate.status, 202);
  assert.equal(regenerate.data.scene.attempts, 2);
  const result = await processFilmSceneJob({ filmId, sceneId: sceneIds[0], userId, attempt: 2 });
  assert.equal(result.ok, true);
  const detail = await req(`/api/films/${filmId}`);
  assert.equal(detail.data.sceneCount, sceneIds.length);
  assert.notEqual((await db('film_scenes').where({ id: sceneIds[0] }).first()).clip_path, firstClip);
  assert.equal((await db('film_scenes').where({ id: sceneIds[1] }).first()).clip_path, otherClip, 'untouched scene must keep its clip');
});

test('scene edits, reordering, and screenplay persistence work together', async () => {
  const patched = await req(`/api/films/${filmId}/scenes/${sceneIds[1]}`, {
    method: 'PATCH', body: { visual_prompt: 'Rain-soaked rooftop, neon reflections, slow dolly in.' },
  });
  assert.equal(patched.status, 200);
  assert.match(patched.data.scene.visualPrompt, /Rain-soaked rooftop/);
  const detail = await req(`/api/films/${filmId}`);
  assert.match(detail.data.screenplay.scenes[1].visual_prompt, /Rain-soaked rooftop/);

  const reordered = await req(`/api/films/${filmId}/scenes/reorder`, {
    method: 'POST', body: { orderedIds: [...sceneIds].reverse() },
  });
  assert.equal(reordered.status, 200);
  assert.equal(reordered.data.scenes[0].id, sceneIds[sceneIds.length - 1]);
  await req(`/api/films/${filmId}/scenes/reorder`, { method: 'POST', body: { orderedIds: sceneIds } });
});

test('assembly refuses to fabricate missing clips', async () => {
  const created = await req('/api/films', {
    method: 'POST', body: { type: 'short_drama', title: 'No Clips Yet', targetDurationSeconds: 20 },
  });
  assert.equal(created.status, 201);
  const id = created.data.film.id;
  await req(`/api/films/${id}/screenplay`, {
    method: 'POST', body: { idea: 'A storm approaches the harbour', targetDurationSeconds: 20 },
  });
  const res = await req(`/api/films/${id}/assemble`, { method: 'POST' });
  assert.equal(res.status, 409);
  assert.equal(res.data.error.code, 'scenes_incomplete');
  assert.ok(res.data.error.details.missing.length >= 1);
  const detail = await req(`/api/films/${id}`);
  assert.equal(detail.data.hasVideo, false, 'no fake final video may be created');
});

test('a completed scene-by-scene film assembles into a playable MP4 with subtitles', async () => {
  const all = await req(`/api/films/${filmId}/scenes/generate-all`, { method: 'POST' });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  for (const scene of await db('film_scenes').where({ film_id: filmId }).whereNot({ status: 'ready' })) {
    const result = await processFilmSceneJob({ filmId, sceneId: scene.id, userId, attempt: scene.attempts });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const preflight = await req(`/api/films/${filmId}/preflight`);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.data.ready, true);
  assert.equal(preflight.data.missing.length, 0);

  const balanceBefore = await getBalance(userId);
  const queued = await req(`/api/films/${filmId}/assemble`, { method: 'POST', body: { subtitles: true } });
  assert.equal(queued.status, 202, JSON.stringify(queued.data));
  const rendered = await processFilmAssemblyJob({ filmId, userId, attempt: 1, subtitles: true });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.ok(fs.existsSync(rendered.videoPath));
  assert.ok(fs.statSync(rendered.videoPath).size > 4096);
  assert.ok(rendered.durationSeconds >= 2 * 4);

  const detail = await req(`/api/films/${filmId}`);
  assert.equal(detail.data.status, 'completed');
  assert.equal(detail.data.hasVideo, true);
  assert.equal(detail.data.hasThumbnail, true);
  assert.equal(detail.data.hasCaptions, true);
  assert.ok((await getBalance(userId)) < balanceBefore);

  const download = await req(`/api/films/${filmId}/download`, { raw: true });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /video\/mp4/);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.ok(download.buffer.length > 4096);
  assert.equal(download.buffer.subarray(4, 8).toString('ascii'), 'ftyp', 'MP4 must have an ftyp box');

  const range = await req(`/api/films/${filmId}/media/video`, { raw: true });
  assert.equal(range.status, 200);
  assert.equal(range.headers.get('accept-ranges'), 'bytes');

  const captions = await req(`/api/films/${filmId}/media/captions`);
  assert.equal(captions.status, 200);
  assert.match(String(captions.data), /\d{2}:\d{2}:\d{2},\d{3} --> /);
});

test('publishing a rendered film marks it and its episode (if any) complete', async () => {
  const res = await req(`/api/films/${filmId}/publish`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.data.film.status, 'published');
});

let seriesId;
let episodeIds;

test('episodic series keeps seasons, story bible, episodes, and continuity', async () => {
  const created = await req('/api/films/series', {
    method: 'POST',
    body: {
      title: 'Lagos Nights', description: 'A family saga across three seasons.',
      genre: 'african_stories', language: 'en', style: 'cinematic',
      storyBible: { premise: 'Two rival families run a waterfront market.', world: 'Modern Lagos', themes: ['loyalty'], continuity_notes: 'Amara always wears an amber jacket.' },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  seriesId = created.data.series.id;

  const e1 = await req(`/api/films/series/${seriesId}/episodes`, {
    method: 'POST', body: { seasonNumber: 1, episodeNumber: 1, title: 'The Return', synopsis: 'Amara comes home.', idea: 'Amara returns to the market after ten years', status: 'draft', targetDurationSeconds: 20 },
  });
  const e2 = await req(`/api/films/series/${seriesId}/episodes`, {
    method: 'POST', body: { seasonNumber: 1, episodeNumber: 2, title: 'The Debt', synopsis: 'An old debt resurfaces.', status: 'upcoming', targetDurationSeconds: 20 },
  });
  assert.equal(e1.status, 201, JSON.stringify(e1.data));
  assert.equal(e2.status, 201, JSON.stringify(e2.data));
  episodeIds = [e1.data.episode.id, e2.data.episode.id];
  assert.ok(e1.data.episode.filmId);
  assert.ok(e2.data.episode.filmId);

  const screenplay = await req(`/api/films/series/${seriesId}/episodes/${episodeIds[0]}/screenplay`, {
    method: 'POST', body: { allowTemplate: true },
  });
  assert.equal(screenplay.status, 200, JSON.stringify(screenplay.data));
  assert.ok(screenplay.data.film.scenes.length >= 2);
  assert.equal(screenplay.data.aiGenerated, false);

  const second = await req(`/api/films/series/${seriesId}/episodes/${episodeIds[1]}/screenplay`, {
    method: 'POST', body: { allowTemplate: true },
  });
  assert.equal(second.status, 200);

  const detail = await req(`/api/films/series/${seriesId}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data.seasons, [1]);
  assert.equal(detail.data.episodeCount, 2);
  assert.equal(detail.data.storyBible.premise, 'Two rival families run a waterfront market.');
  assert.equal(detail.data.episodes[0].status, 'draft');
  assert.equal(detail.data.episodes[1].status, 'upcoming');
  assert.ok(detail.data.episodes[0].film.sceneCount >= 2);

  const updated = await req(`/api/films/series/${seriesId}/episodes/${episodeIds[1]}`, {
    method: 'PATCH', body: { status: 'completed', continuityNotes: 'Kofi now owes the market association.', credits: [{ name: 'Ada Okafor', role: 'Writer' }] },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.episode.status, 'completed');
  assert.equal(updated.data.episode.continuityNotes, 'Kofi now owes the market association.');

  // Resuming an existing project must not lose progress.
  const resume = await req(`/api/films/${e1.data.episode.filmId}`);
  assert.equal(resume.status, 200);
  assert.ok(resume.data.scenes.length >= 2);
  assert.equal(resume.data.seriesId, seriesId);
});

test('character studio is scoped per user and reusable across episodes', async () => {
  const created = await req('/api/films/characters', {
    method: 'POST',
    body: { name: 'Uncle Tunde', role: 'supporting', description: 'Market elder.', appearancePrompt: 'Older man, grey beard, blue agbada', voicePreset: 'echo', seriesId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.character.name, 'Uncle Tunde');
  const list = await req('/api/films/characters?seriesId=' + seriesId);
  assert.equal(list.status, 200);
  assert.ok(list.data.characters.some((c) => c.name === 'Uncle Tunde'));

  const otherLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'admin-film@example.test', password: 'FilmAdmin2026!' } });
  const otherCookie = (otherLogin.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const otherList = await request('/api/films/characters', { cookie: otherCookie });
  assert.equal(otherList.status, 200);
  assert.ok(!otherList.data.characters.some((c) => c.name === 'Uncle Tunde'), 'characters must be private to their owner');
});

test('credit ledger records every reservation, charge and refund', async () => {
  const res = await req('/api/films/credits');
  assert.equal(res.status, 200);
  const reasons = new Set(res.data.history.map((h) => h.reason));
  assert.ok(reasons.has('signup_grant'));
  assert.ok(reasons.has('scene_reserve'));
  assert.ok(reasons.has('scene_refund'));
  assert.equal(res.data.balance, (await getBalance(userId)));
});

test('movie-length projects are planned as many short scenes, never one request', async () => {
  const created = await req('/api/films', {
    method: 'POST',
    body: { type: 'movie', title: 'The Long Road', targetDurationSeconds: 1200, aspectRatio: '16:9', targetPlatform: 'youtube' },
  });
  assert.equal(created.status, 201);
  const estimate = await req('/api/films/estimate', { method: 'POST', body: { targetDurationSeconds: 1200 } });
  assert.equal(estimate.status, 200);
  assert.ok(estimate.data.sceneCount >= 100, `expected 120+ short scenes, got ${estimate.data.sceneCount}`);
  assert.ok(estimate.data.breakdown.video.credits > 0);
  const detail = await req(`/api/films/${created.data.film.id}`);
  assert.ok(detail.data.scenePlan >= 100);
});
