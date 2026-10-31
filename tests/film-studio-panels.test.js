/**
 * Storyboard stills, voice takes, timeline edits, the creative canvas and the
 * model registry — the Phase 2/3/4 modules.
 *
 * Everything is exercised through the real HTTP API with the local providers:
 * IMAGE_PROVIDER=procedural renders genuine PNGs and the meSpeak engine renders
 * genuine WAVs, so these tests prove files exist on disk and can be streamed.
 * No video provider is configured, so the video paths must fail honestly.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-panels-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-panels@example.test';
process.env.ADMIN_PASSWORD = 'PanelsAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8791';
process.env.APP_URL = 'http://127.0.0.1:8791';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'none';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'REPLICATE_API_TOKEN', 'FAL_API_KEY', 'GOOGLE_VEO_API_KEY', 'ELEVENLABS_API_KEY']) {
  delete process.env[key];
}

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');

let server;
let base;
let cookie;
let otherCookie;
let filmId;
let sceneIds = [];

async function request(pathname, { method = 'GET', body, cookie: c, raw = false } = {}) {
  const headers = {};
  if (c) headers.cookie = c;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

function cookieFrom(response) {
  return (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await request('/api/auth/login', {
    method: 'POST', body: { email: 'creator@faceless.local', password: 'StudioDemo2026!' },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  cookie = cookieFrom(login);

  const signup = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Panel Outsider', email: `panel-outsider-${crypto.randomUUID().slice(0, 8)}@example.test`, password: 'Outsider2026!' },
  });
  assert.ok([200, 201].includes(signup.status));
  otherCookie = cookieFrom(signup);

  const created = await request('/api/films', {
    method: 'POST', cookie,
    body: {
      type: 'short_drama', title: 'Storyboard Probe', genre: 'family_drama', style: 'cinematic',
      aspectRatio: '9:16', targetPlatform: 'tiktok', targetDurationSeconds: 30,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  filmId = created.data.film.id;

  const written = await request(`/api/films/${filmId}/screenplay`, {
    method: 'POST', cookie,
    body: { idea: 'A sister finds a letter on a rooftop and decides what to do', allowTemplate: true },
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));

  const detail = await request(`/api/films/${filmId}`, { cookie });
  sceneIds = detail.data.scenes.map((scene) => scene.id);
  assert.ok(sceneIds.length >= 3, 'the template screenplay must produce scenes');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

test('storyboard stills are real PNG files rendered from the scene prompt', async () => {
  const result = await req(`/api/films/${filmId}/storyboard`, { method: 'POST', body: { limit: 2 } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.generated, 2);
  assert.equal(result.data.failed, 0);
  assert.equal(result.data.provider.active, 'procedural-svg');
  assert.equal(result.data.provider.ai, false, 'procedural output must never be labelled AI');

  const frames = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.ok(fs.existsSync(frame.path), 'the still must exist on disk');
    assert.ok(fs.statSync(frame.path).size > 1000, 'the still must have real content');
    assert.match(fs.readFileSync(frame.path).subarray(1, 4).toString(), /PNG/);
  }

  const overview = await req(`/api/films/${filmId}/storyboard`);
  assert.equal(overview.status, 200);
  assert.equal(overview.data.scenes.filter((scene) => scene.frame?.hasImage).length, 2);
  const frame = overview.data.scenes.find((scene) => scene.frame?.hasImage).frame;
  const image = await req(frame.imageUrl, { raw: true });
  assert.equal(image.status, 200);
  assert.match(String(image.headers.get('content-type')), /image\/png/);
  assert.ok(image.buffer.length > 1000);
});

test('the storyboard can be topped up and re-rendered without duplicating rows', async () => {
  const topped = await req(`/api/films/${filmId}/storyboard`, { method: 'POST', body: {} });
  assert.equal(topped.status, 200);
  assert.ok(topped.data.generated >= 1);
  const all = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  assert.equal(all.length, sceneIds.length, 'one frame per scene, no duplicates');

  const forced = await req(`/api/films/${filmId}/storyboard`, { method: 'POST', body: { force: true, limit: 1 } });
  assert.equal(forced.status, 200);
  const after = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  assert.equal(after.length, sceneIds.length, 're-rendering must update, never duplicate');
});

test('poster and character concept art are stored and served', async () => {
  const poster = await req(`/api/films/${filmId}/poster`, { method: 'POST', body: {} });
  assert.equal(poster.status, 200, JSON.stringify(poster.data));
  assert.equal(poster.data.poster.hasImage, true);
  const image = await req(`/api/films/${filmId}/poster/image`, { raw: true });
  assert.equal(image.status, 200);
  assert.match(String(image.headers.get('content-type')), /image\/png/);

  const characters = await req(`/api/films/characters?filmId=${filmId}`);
  const character = characters.data.characters[0];
  assert.ok(character, 'the screenplay must cast at least one character');
  const concept = await req(`/api/films/${filmId}/characters/${character.id}/concept`, { method: 'POST', body: {} });
  assert.equal(concept.status, 200, JSON.stringify(concept.data));
  assert.equal(concept.data.ai, false);
  assert.equal(concept.data.usedAsReference, false, 'procedural art must never become a face reference');
  const stored = await db('film_characters').where({ id: character.id }).first();
  assert.equal(stored.reference_image_path, null);
});

test('voice takes are real WAV audio and stream with the right content type', async () => {
  const result = await req(`/api/films/${filmId}/voice`, { method: 'POST', body: { limit: 2 } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.generated >= 1, 'scenes with dialogue must produce a take');
  assert.equal(result.data.provider, 'mespeak-local');

  const scenes = await db('film_scenes').where({ film_id: filmId }).whereNotNull('voice_path');
  assert.ok(scenes.length >= 1);
  for (const scene of scenes) {
    assert.ok(fs.existsSync(scene.voice_path));
    assert.ok(Number(scene.voice_duration) > 0.2, 'duration must come from the real file');
  }

  const overview = await req(`/api/films/${filmId}/voice`);
  assert.equal(overview.status, 200);
  assert.equal(overview.data.tts.configured, true);
  assert.ok(overview.data.totals.withTake >= 1);

  const take = await req(`/api/films/${filmId}/scenes/${scenes[0].id}/voice`, { raw: true });
  assert.equal(take.status, 200);
  assert.match(String(take.headers.get('content-type')), /audio\/wav/);
  assert.ok(take.buffer.length > 1000);
});

test('timeline edits persist, reach the film payload and reject invalid values', async () => {
  const updated = await req(`/api/films/${filmId}/scenes/${sceneIds[0]}`, {
    method: 'PATCH',
    body: { transition: 'fade_black', trim_start: 0.6, trim_end: 0.4 },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.scene.transition, 'fade_black');
  assert.equal(updated.data.scene.trimStart, 0.6);
  assert.equal(updated.data.scene.trimEnd, 0.4);

  const detail = await req(`/api/films/${filmId}`);
  const scene = detail.data.scenes.find((item) => item.id === sceneIds[0]);
  assert.equal(scene.transition, 'fade_black');

  const invalid = await req(`/api/films/${filmId}/scenes/${sceneIds[0]}`, { method: 'PATCH', body: { transition: 'spin' } });
  assert.equal(invalid.status, 400);
});

test('a canvas flow runs real nodes and records per-node output', async () => {
  const created = await req('/api/films/flows', {
    method: 'POST',
    body: {
      name: 'Rooftop pipeline', filmId,
      graph: {
        nodes: [
          { id: 'brief', type: 'text', config: { text: 'A rooftop at dawn, a sister holding a letter.' } },
          { id: 'frame', type: 'image', config: { aspectRatio: '9:16' } },
          { id: 'line', type: 'voice', config: { voice: 'nova' } },
        ],
        edges: [{ from: 'brief', to: 'frame' }, { from: 'frame', to: 'line' }],
      },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const flowId = created.data.flow.id;

  const run = await req(`/api/films/flows/${flowId}/run`, { method: 'POST', body: {} });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.lastRun.status, 'succeeded');
  const nodes = Object.fromEntries(run.data.lastRun.nodes.map((node) => [node.nodeId, node]));
  assert.equal(nodes.brief.status, 'done');
  assert.equal(nodes.frame.status, 'done');
  assert.equal(nodes.frame.output.provider, 'procedural-svg');
  assert.equal(nodes.line.status, 'done');
  assert.equal(nodes.line.output.provider, 'mespeak-local');

  const artifact = await req(`/api/films/flows/${flowId}/artifact/${path.basename(nodes.frame.output.path)}`, { raw: true });
  assert.equal(artifact.status, 200);
  assert.match(String(artifact.headers.get('content-type')), /image\/png/);

  const persisted = await db('film_flows').where({ id: flowId }).first();
  assert.equal(persisted.status, 'succeeded');
});

test('a video node without a provider fails the flow honestly and skips downstream work', async () => {
  const created = await req('/api/films/flows', {
    method: 'POST',
    body: {
      name: 'Clip probe', filmId,
      graph: {
        nodes: [
          { id: 'clip', type: 'scene', config: { sceneId: sceneIds[0] } },
          { id: 'after', type: 'voice', config: { text: 'This must never run.' } },
        ],
        edges: [{ from: 'clip', to: 'after' }],
      },
    },
  });
  const flowId = created.data.flow.id;
  const run = await req(`/api/films/flows/${flowId}/run`, { method: 'POST', body: {} });
  assert.equal(run.status, 200);
  assert.equal(run.data.lastRun.status, 'failed');
  const nodes = Object.fromEntries(run.data.lastRun.nodes.map((node) => [node.nodeId, node]));
  assert.equal(nodes.clip.status, 'failed');
  assert.match(nodes.clip.error, /not configured/i);
  assert.equal(nodes.after.status, 'skipped');

  const scene = await db('film_scenes').where({ id: sceneIds[0] }).first();
  assert.notEqual(scene.status, 'ready', 'no clip may be invented without a provider');

  const cyclic = await req(`/api/films/flows/${flowId}`, {
    method: 'PATCH',
    body: { graph: { nodes: [{ id: 'a', type: 'text', config: { text: 'x' } }, { id: 'b', type: 'voice', config: {} }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] } },
  });
  assert.equal(cyclic.status, 400);
  assert.match(JSON.stringify(cyclic.data), /cycle/i);
});

test('the model registry reports live readiness, prices and no secrets', async () => {
  const models = await req('/api/films/models');
  assert.equal(models.status, 200);
  assert.equal(models.data.video.realGeneration, false);
  assert.ok(models.data.video.items.length >= 3);
  const replicate = models.data.video.items.find((item) => item.id === 'replicate');
  assert.equal(replicate.configured, false);
  assert.equal(replicate.env, 'REPLICATE_API_TOKEN');
  assert.ok(replicate.creditsPerSixSecondScene > 0);
  assert.equal(models.data.image.configured, true);
  assert.equal(models.data.image.ai, false);
  assert.equal(models.data.tts.active, 'mespeak-local');
  assert.ok(models.data.assembly.capabilities.includes('fade_black') || models.data.assembly.capabilities.some((item) => /fade/i.test(item)));

  const serialized = JSON.stringify(models.data);
  assert.ok(!/sk-[A-Za-z0-9]/.test(serialized), 'no API key may be echoed');
  assert.ok(!/r8_[A-Za-z0-9]/.test(serialized), 'no provider token may be echoed');
});

test('storyboards, voice, canvas flows and posters stay private', async () => {
  const flow = await req('/api/films/flows', { method: 'POST', body: { name: 'Private flow' } });
  const flowId = flow.data.flow.id;
  for (const pathname of [
    `/api/films/${filmId}/storyboard`,
    `/api/films/${filmId}/voice`,
    `/api/films/flows/${flowId}`,
  ]) {
    const foreign = await request(pathname, { cookie: otherCookie });
    assert.equal(foreign.status, 403, `${pathname} must reject a foreign user`);
  }
  const posted = await request(`/api/films/${filmId}/storyboard`, { method: 'POST', cookie: otherCookie, body: {} });
  assert.equal(posted.status, 403);
});
