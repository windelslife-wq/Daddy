/**
 * Provider-gated post-production against a local wire-protocol double.
 *
 * The real Replicate/fal APIs are not reachable from this environment and no key
 * exists, so this suite stands up an HTTP double that speaks the same prediction
 * protocol and serves a real H.264 file. That proves the whole gated path —
 * credential check, data-URI upload, create → poll → download, FFmpeg probe,
 * clip replacement, assembly invalidation — without pretending a live provider
 * ran. Live vendor calls remain unverified and are reported as such.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-gated-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-gated@example.test';
process.env.ADMIN_PASSWORD = 'GatedAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8791';
process.env.APP_URL = 'http://127.0.0.1:8791';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'none';
process.env.REPLICATE_API_TOKEN = 'r8_test_token_for_wire_protocol';
process.env.FILM_LIPSYNC_PROVIDER = 'replicate';
process.env.FILM_LIPSYNC_REPLICATE_MODEL = 'sync/lipsync-test';
process.env.FILM_MOTION_PROVIDER = 'replicate';
process.env.FILM_MOTION_REPLICATE_MODEL = 'kwaivgi/motion-test';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'FAL_API_KEY', 'GOOGLE_VEO_API_KEY']) delete process.env[key];

let provider;
let providerBase;
const calls = [];

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { ffmpeg, probeVideo, projectDir } = await import('../server/media/utils.js');
const { processLipSyncJob, lipSyncStatus } = await import('../server/film/lipsync.js');
const { processMotionJob, motionStatus } = await import('../server/film/vfx.js');

let server;
let base;
let cookie;
let filmId;
let sceneId;
const fixture = {};

async function request(pathname, { method = 'GET', body, cookie: c } = {}) {
  const headers = {};
  if (c) headers.cookie = c;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

function startProviderDouble(resultPath) {
  const serverDouble = http.createServer((request_, response) => {
    const chunks = [];
    request_.on('data', (chunk) => chunks.push(chunk));
    request_.on('end', () => {
      const raw = Buffer.concat(chunks);
      calls.push({ method: request_.method, url: request_.url, headers: request_.headers, body: raw.toString('utf8') });
      if (request_.method === 'POST' && request_.url === '/v1/predictions') {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: `pred_${calls.length}`,
          status: 'processing',
          urls: { get: `${providerBase}/v1/predictions/pred_${calls.length}` },
        }));
        return;
      }
      if (request_.method === 'GET' && request_.url.startsWith('/v1/predictions/')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'pred', status: 'succeeded', output: [`${providerBase}/result.mp4`] }));
        return;
      }
      if (request_.method === 'GET' && request_.url === '/result.mp4') {
        const buffer = fs.readFileSync(resultPath);
        response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buffer.length });
        response.end(buffer);
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"detail":"not found"}');
    });
  });
  return new Promise((resolve) => {
    serverDouble.listen(0, '127.0.0.1', () => {
      providerBase = `http://127.0.0.1:${serverDouble.address().port}`;
      resolve(serverDouble);
    });
  });
}

before(async () => {
  // A real, probeable MP4 is what the double returns for every prediction.
  fixture.result = path.join(tempDir, 'provider-result.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=purple:s=320x180:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '3', '-y', fixture.result], { timeoutMs: 120000 });
  provider = await startProviderDouble(fixture.result);
  process.env.REPLICATE_API_ROOT = providerBase;

  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'creator@filmclublens.local', password: 'StudioDemo2026!' }) });
  cookie = (login.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie, 'demo login failed');

  const created = await req('/api/films', { method: 'POST', body: { title: 'Gated', type: 'short_drama', aspectRatio: '16:9', targetDurationSeconds: 6 } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  filmId = created.data.film.id;
  const saved = await req(`/api/films/${filmId}/screenplay`, {
    method: 'PUT',
    body: {
      screenplay: {
        title: 'Gated', logline: '', story_bible: {},
        characters: [{ name: 'Ada', role: 'lead', description: '' }],
        scenes: [{ heading: 'INT. ROOM - NIGHT', location: 'Room', description: 'Lamp.', dialogue: [{ character: 'Ada', line: 'Run.' }], visual_prompt: 'room', duration_seconds: 4 }],
      },
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  sceneId = saved.data.scenes[0].id;

  // Inputs the studio already owns: a provider-style clip, a voice take, a still.
  const dir = projectDir(`film_${filmId}`);
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  fixture.clip = path.join(dir, 'scenes', 'fixture-clip.mp4');
  fixture.voice = path.join(dir, 'audio', 'fixture-voice.wav');
  fixture.poster = path.join(dir, 'frames', 'fixture-poster.png');
  fs.mkdirSync(path.dirname(fixture.voice), { recursive: true });
  fs.mkdirSync(path.dirname(fixture.poster), { recursive: true });
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=navy:s=640x360:r=24:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '4', '-y', fixture.clip], { timeoutMs: 120000 });
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', '-y', fixture.voice], { timeoutMs: 60000 });
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=orange:s=320x180:d=1', '-frames:v', '1', '-y', fixture.poster], { timeoutMs: 60000 });
  await db('film_scenes').where({ id: sceneId }).update({
    clip_path: fixture.clip, voice_path: fixture.voice, poster_path: fixture.poster, duration_seconds: 4,
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (provider) await new Promise((resolve) => provider.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('lip-sync reports the configured provider and executes the full protocol', async () => {
  const status = await lipSyncStatus();
  assert.equal(status.configured, true, status.note);
  assert.equal(status.provider, 'replicate');

  const queued = await req(`/api/films/${filmId}/scenes/${sceneId}/lipsync`, { method: 'POST' });
  assert.equal(queued.status, 202, JSON.stringify(queued.data));
  assert.equal(queued.data.provider, 'replicate');
  const job = await db('jobs').where({ id: queued.data.jobId }).first();
  assert.equal(job.type, 'film_lipsync');

  const result = await processLipSyncJob({ filmId, sceneId, provider: 'replicate' });
  assert.equal(result.provider, 'replicate');
  assert.equal(result.model, 'sync/lipsync-test');
  assert.ok(result.bytes > 1000);

  const scene = await db('film_scenes').where({ id: sceneId }).first();
  assert.match(scene.clip_path, /lipsync-0001\.mp4$/);
  assert.equal(scene.lipsync_provider, 'replicate');
  assert.ok(scene.lipsync_at);
  const probe = await probeVideo(scene.clip_path);
  assert.equal(probe.hasVideo, true);

  const upload = calls.find((call) => call.method === 'POST' && call.url === '/v1/predictions');
  assert.ok(upload, 'the provider was called');
  assert.equal(upload.headers.authorization, 'Bearer r8_test_token_for_wire_protocol');
  const body = JSON.parse(upload.body);
  assert.equal(body.model, 'sync/lipsync-test');
  assert.match(body.input.video, /^data:video\/mp4;base64,/);
  assert.match(body.input.audio, /^data:audio\/wav;base64,/);
  assert.ok(calls.some((call) => call.url === '/result.mp4'), 'the result was downloaded');

  const view = await req(`/api/films/${filmId}/scenes/${sceneId}/lipsync`);
  assert.equal(view.status, 200);
  assert.equal(view.data.provider, 'replicate');
  assert.equal(view.data.hasClip, true);
});

test('motion transfer animates the still through the same protocol and replaces the clip', async () => {
  const status = await motionStatus();
  assert.equal(status.configured, true, status.note);

  const before = (await db('film_scenes').where({ id: sceneId }).first()).clip_path;
  const queued = await req(`/api/films/${filmId}/scenes/${sceneId}/motion`, { method: 'POST', body: { motionPrompt: 'slow dolly forward, rain glistening' } });
  assert.equal(queued.status, 202, JSON.stringify(queued.data));
  assert.equal(queued.data.provider, 'replicate');
  assert.match(queued.data.motionPrompt, /dolly/);
  const job = await db('jobs').where({ id: queued.data.jobId }).first();
  assert.equal(job.type, 'film_motion');

  const result = await processMotionJob({
    filmId, sceneId, provider: 'replicate',
    stillPath: fixture.poster, motionPrompt: 'slow dolly forward, rain glistening', durationSeconds: 4,
  });
  assert.equal(result.provider, 'replicate');
  assert.equal(result.model, 'kwaivgi/motion-test');

  const scene = await db('film_scenes').where({ id: sceneId }).first();
  assert.match(scene.clip_path, /motion-0001\.mp4$/);
  assert.notEqual(scene.clip_path, before);
  const probe = await probeVideo(scene.clip_path);
  assert.equal(probe.hasVideo, true);

  const upload = calls.filter((call) => call.method === 'POST' && call.url === '/v1/predictions').pop();
  const body = JSON.parse(upload.body);
  assert.equal(body.model, 'kwaivgi/motion-test');
  assert.match(body.input.image, /^data:image\/png;base64,/);
  assert.equal(body.input.prompt, 'slow dolly forward, rain glistening');
});

test('an admin disabling the provider stops lip-sync and motion transfer', async () => {
  const forbidden = await req('/api/admin/film/ops');
  assert.equal(forbidden.status, 403, 'the film admin surface is closed to creators');

  const adminLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin-gated@example.test', password: 'GatedAdmin2026!' }) });
  assert.equal(adminLogin.status, 200);
  const adminCookie = (adminLogin.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');

  const disable = await request('/api/admin/film/providers/replicate', { method: 'POST', cookie: adminCookie, body: { enabled: false } });
  assert.equal(disable.status, 200, JSON.stringify(disable.data));

  const status = await req('/api/films/lipsync');
  assert.equal(status.status, 200);
  assert.equal(status.data.configured, false);
  assert.equal(status.data.disabledByAdmin, true);
  const motion = await req('/api/films/motion');
  assert.equal(motion.data.configured, false);

  const blocked = await req(`/api/films/${filmId}/scenes/${sceneId}/lipsync`, { method: 'POST' });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.error.code, 'lip_sync_unavailable');
  assert.match(blocked.data.error.message, /disabled by an administrator/i);

  const reenable = await request('/api/admin/film/providers/replicate', { method: 'POST', cookie: adminCookie, body: { enabled: true } });
  assert.equal(reenable.status, 200);
  const restored = await req('/api/films/lipsync');
  assert.equal(restored.data.configured, true);
  const accepted = await req(`/api/films/${filmId}/scenes/${sceneId}/lipsync`, { method: 'POST' });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.data));
});
