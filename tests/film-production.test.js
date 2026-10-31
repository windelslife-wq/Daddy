/**
 * AI Production Agent.
 *
 * These tests drive the real HTTP API and the real database. No AI or video
 * provider is configured, which is exactly the point: the agent must stop at
 * the paid gate, keep every free stage's output, and never claim a finished
 * film when no clip exists.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-agent-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-agent@example.test';
process.env.ADMIN_PASSWORD = 'AgentAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8788';
process.env.APP_URL = 'http://127.0.0.1:8788';
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
const { parseBrief } = await import('../server/film/production.js');

let server;
let base;
let cookie;
let otherCookie;
let run;

async function request(pathname, { method = 'GET', body, cookie: c } = {}) {
  const headers = {};
  if (c) headers.cookie = c;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

function cookieFrom(response) {
  return (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');
}

const BRIEF = 'A 3-minute Nigerian family drama with three main characters, set in a warm Abuja apartment and a rooftop at dusk.';

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await request('/api/auth/login', {
    method: 'POST', body: { email: 'creator@faceless.local', password: 'StudioDemo2026!' },
  });
  assert.equal(login.status, 200, `demo login failed: ${JSON.stringify(login.data)}`);
  cookie = cookieFrom(login);

  const signup = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Outsider', email: `outsider-${crypto.randomUUID().slice(0, 8)}@example.test`, password: 'Outsider2026!' },
  });
  assert.ok([200, 201].includes(signup.status), `signup failed: ${JSON.stringify(signup.data)}`);
  otherCookie = cookieFrom(signup);

  const started = await request('/api/films/production/start', { method: 'POST', cookie, body: { brief: BRIEF } });
  assert.equal(started.status, 201, `start failed: ${JSON.stringify(started.data)}`);
  run = started.data;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

test('the brief parser extracts runtime, format, cast size and language without any AI call', () => {
  const plan = parseBrief('A 22-minute Yoruba feature film with five main characters, set in Lagos.');
  assert.equal(plan.durationSeconds, 1320);
  assert.equal(plan.type, 'movie');
  assert.equal(plan.language, 'yo');
  assert.equal(plan.castCount, 5);
  assert.equal(plan.aiGenerated, false);
  assert.equal(plan.scenes, 132);
  const short = parseBrief('A 30-second vertical advert for a skincare brand.');
  assert.equal(short.durationSeconds, 30);
  assert.equal(short.type, 'advertisement');
});

test('starting a production writes the screenplay, casts, locates and directs every scene', async () => {
  assert.equal(run.production.status, 'awaiting_approval', JSON.stringify(run.production.status));
  assert.equal(run.production.currentStage, 'generate');
  assert.equal(run.production.plan.durationSeconds, 180);
  assert.equal(run.production.plan.castCount, 3);

  const byId = Object.fromEntries(run.production.stages.map((stage) => [stage.id, stage]));
  for (const id of ['analyze', 'screenplay', 'cast', 'locations', 'direct']) {
    assert.equal(byId[id].status, 'done', `${id}: ${byId[id].detail}`);
  }
  assert.equal(byId.generate.status, 'pending');
  assert.equal(byId.generate.approval, true);
  assert.equal(byId.generate.spendsCredits, true);
  assert.equal(byId.assemble.status, 'pending');
  assert.equal(byId.export.status, 'pending');

  const detail = await req(`/api/films/${run.film.id}`);
  assert.equal(detail.status, 200);
  const scenes = detail.data.scenes;
  assert.equal(scenes.length, run.production.plan.scenes);
  assert.ok(scenes.every((scene) => scene.shotSize && scene.cameraAngle), 'the agent directs every shot');
  assert.ok(scenes.every((scene) => scene.locationId), 'every setting becomes a saved location');

  const characters = await req(`/api/films/characters?filmId=${run.film.id}`);
  assert.equal(characters.status, 200);
  assert.ok(characters.data.characters.length >= 1);
});

test('locations made by the agent are real rows that scenes point at', async () => {
  const locations = await req(`/api/films/${run.film.id}/locations`);
  assert.equal(locations.status, 200);
  assert.ok(locations.data.locations.length >= 1);
  const detail = await req(`/api/films/${run.film.id}`);
  const ids = new Set(locations.data.locations.map((location) => location.id));
  assert.ok(detail.data.scenes.every((scene) => ids.has(scene.locationId)), 'every scene points at a saved location');

  const qc = await req(`/api/films/${run.film.id}/qc`);
  const check = qc.data.checks.find((item) => item.id === 'locations');
  assert.equal(check.status, 'pass', check.detail);
});

test('the paid gate cannot be skipped implicitly and a missing provider fails honestly', async () => {
  // Nothing can be assembled while no scene has a clip.
  const early = await req(`/api/films/${run.film.id}/production/advance`, {
    method: 'POST', body: { action: 'assemble' },
  });
  assert.equal(early.status, 409);
  assert.equal(early.data.error.code, 'scenes_incomplete');

  const approved = await req(`/api/films/${run.film.id}/production/advance`, {
    method: 'POST', body: { action: 'generate' },
  });
  assert.equal(approved.status, 503, JSON.stringify(approved.data));
  assert.equal(approved.data.error.code, 'video_provider_unavailable');
  assert.match(approved.data.error.message, /will not fabricate/i);

  const snapshot = await req(`/api/films/${run.film.id}/production`);
  assert.equal(snapshot.data.production.status, 'blocked');
  assert.match(snapshot.data.production.error, /not configured/i);
  assert.equal(snapshot.data.film.hasVideo, false);
  assert.equal(snapshot.data.production.counts.ready, 0, 'no clip may be invented without a provider');
  const clips = snapshot.data.production.qc.checks.find((item) => item.id === 'clips');
  assert.equal(clips.status, 'fail');
});

test('a production is only complete when a real rendered file exists', async () => {
  const filmId = run.film.id;
  const renderedPath = path.join(process.env.STORAGE_DIR, `final-${filmId}.mp4`);
  fs.mkdirSync(path.dirname(renderedPath), { recursive: true });
  fs.writeFileSync(renderedPath, 'not-a-real-video');

  await db('film_projects').where({ id: filmId }).update({
    final_video_path: renderedPath,
    status: 'ready',
    updated_at: new Date().toISOString(),
  });

  const synced = await req(`/api/films/${filmId}/production/advance`, { method: 'POST', body: { action: 'sync' } });
  assert.equal(synced.status, 200);
  const stages = Object.fromEntries(synced.data.production.stages.map((stage) => [stage.id, stage]));
  assert.equal(stages.assemble.status, 'done');
  assert.equal(stages.export.status, 'done');
  assert.equal(synced.data.production.status, 'completed');

  const persisted = await db('film_productions').where({ film_id: filmId }).first();
  assert.equal(persisted.status, 'completed');
  assert.ok(persisted.completed_at);
});

test('failed scenes are reported with numbers and can be retried, not hidden', async () => {
  const scenes = await db('film_scenes').where({ film_id: run.film.id }).orderBy('ordinal', 'asc');
  await db('film_scenes').where({ id: scenes[0].id }).update({ status: 'failed', error: 'Provider timed out', updated_at: new Date().toISOString() });
  await db('film_projects').where({ id: run.film.id }).update({ final_video_path: null, status: 'ready' });

  const snapshot = await req(`/api/films/${run.film.id}/production`);
  assert.equal(snapshot.data.production.canRetry, true);
  assert.deepEqual(snapshot.data.production.failedScenes, [scenes[0].ordinal]);
  const generate = snapshot.data.production.stages.find((stage) => stage.id === 'generate');
  assert.equal(generate.status, 'blocked');
  assert.match(generate.detail, new RegExp(String(scenes[0].ordinal)));

  const retried = await req(`/api/films/${run.film.id}/production/advance`, { method: 'POST', body: { action: 'retry' } });
  assert.equal(retried.status, 503, JSON.stringify(retried.data));
  assert.equal(retried.data.error.code, 'video_provider_unavailable');
  const after = await req(`/api/films/${run.film.id}/production`);
  assert.equal(after.data.production.status, 'blocked');
  assert.equal(after.data.production.canRetry, true);
});

test('cancelling stops the run and blocks further paid work', async () => {
  const cancelled = await req(`/api/films/${run.film.id}/production/cancel`, { method: 'POST', body: {} });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.production.status, 'cancelled');

  const after = await req(`/api/films/${run.film.id}/production/advance`, { method: 'POST', body: { action: 'generate' } });
  assert.equal(after.status, 409);
  assert.equal(after.data.error.code, 'production_cancelled');
});

test('productions are private and listed for their owner', async () => {
  const foreign = await request(`/api/films/${run.film.id}/production`, { cookie: otherCookie });
  assert.equal(foreign.status, 403);

  const list = await req('/api/films/production');
  assert.equal(list.status, 200);
  assert.ok(list.data.productions.some((item) => item.filmId === run.film.id));
  assert.ok(list.data.stages.some((stage) => stage.id === 'generate' && stage.approval));
});
