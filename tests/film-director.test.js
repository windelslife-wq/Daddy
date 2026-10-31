/**
 * Director controls, the locations library and the continuity/QC engine.
 *
 * These tests exercise the real HTTP API and the real database. No video
 * provider is configured, so the QC checks are asserted against genuinely
 * missing clips rather than a simulated success.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-director-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-director@example.test';
process.env.ADMIN_PASSWORD = 'DirectorAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8787';
process.env.APP_URL = 'http://127.0.0.1:8787';
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
const { scenePrompt } = await import('../server/film/scenes.js');

let server;
let base;
let cookie;
let otherCookie;
let filmId;

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

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await request('/api/auth/login', {
    method: 'POST', body: { email: 'creator@filmclublens.local', password: 'StudioDemo2026!' },
  });
  assert.equal(login.status, 200, `demo login failed: ${JSON.stringify(login.data)}`);
  cookie = cookieFrom(login);

  const signup = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Other Director', email: `other-director-${crypto.randomUUID().slice(0, 8)}@example.test`, password: 'OtherDirector2026!' },
  });
  assert.ok([200, 201].includes(signup.status), `signup failed: ${JSON.stringify(signup.data)}`);
  otherCookie = cookieFrom(signup);

  const created = await request('/api/films', {
    method: 'POST', cookie,
    body: {
      type: 'cinematic_scene', title: 'The Last Message',
      genre: 'family_drama', style: 'cinematic', aspectRatio: '16:9',
      targetDurationSeconds: 120, targetPlatform: 'youtube',
    },
  });
  assert.equal(created.status, 201, `film creation failed: ${JSON.stringify(created.data)}`);
  filmId = created.data.film.id;

  const written = await request(`/api/films/${filmId}/screenplay`, {
    method: 'POST', cookie,
    body: { idea: 'A family in Abuja discovers a letter that changes everything', allowTemplate: true },
  });
  assert.equal(written.status, 200, `screenplay failed: ${JSON.stringify(written.data)}`);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

test('config exposes the cinematography vocabulary and the new film formats', async () => {
  const res = await req('/api/films/config');
  assert.equal(res.status, 200);
  assert.ok(res.data.types.includes('cinematic_scene'));
  assert.ok(res.data.types.includes('advertisement'));
  assert.ok(res.data.types.includes('music_video'));
  const cine = res.data.cinematography;
  assert.ok(cine.shotSizes.length >= 8);
  assert.ok(cine.cameraAngles.some((item) => item.id === 'low_angle'));
  assert.ok(cine.lenses.some((item) => item.id === '85mm'));
  assert.ok(cine.lighting.some((item) => item.id === 'golden_hour'));
  assert.ok(cine.colorGrades.some((item) => item.id === 'teal_orange'));
});

test('the offline screenplay draft ships real directorial choices', async () => {
  const res = await req(`/api/films/${filmId}`);
  assert.equal(res.status, 200);
  assert.ok(res.data.scenes.length > 0);
  assert.ok(res.data.scenes.every((scene) => scene.shotSize && scene.cameraAngle), 'every template scene is directed');
});

test('a scene can be directed and the choices reach the provider prompt', async () => {
  const detail = await req(`/api/films/${filmId}`);
  const scene = detail.data.scenes[0];

  const patched = await req(`/api/films/${filmId}/scenes/${scene.id}`, {
    method: 'PATCH',
    body: {
      shot_size: 'close_up', camera_angle: 'low_angle', lens: '85mm',
      lighting: 'rim_light', color_grade: 'teal_orange',
      composition: 'subject on the left third, negative space right',
      camera_movement: 'dolly_in',
    },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.scene.shotSize, 'close_up');
  assert.equal(patched.data.scene.lens, '85mm');
  assert.equal(patched.data.scene.colorGrade, 'teal_orange');

  const film = await db('film_projects').where({ id: filmId }).first();
  const row = await db('film_scenes').where({ id: scene.id }).first();
  const prompt = scenePrompt(film, row, []);
  assert.match(prompt, /close-up/);
  assert.match(prompt, /low angle/);
  assert.match(prompt, /85mm lens/);
  assert.match(prompt, /shallow depth of field/);
  assert.match(prompt, /rim lighting/);
  assert.match(prompt, /teal and orange/);
  assert.match(prompt, /dolly pushing in/);
  assert.match(prompt, /subject on the left third/);
});

test('unknown cinematography values are rejected instead of silently stored', async () => {
  const detail = await req(`/api/films/${filmId}`);
  const scene = detail.data.scenes[0];
  const res = await req(`/api/films/${filmId}/scenes/${scene.id}`, {
    method: 'PATCH', body: { shot_size: 'impossible_shot', camera_angle: 'sideways' },
  });
  assert.equal(res.status, 400);
});

test('locations are created, reused by scenes and survive project isolation', async () => {
  const created = await req(`/api/films/${filmId}/locations`, {
    method: 'POST',
    body: {
      name: "Amara's apartment", description: 'Small Abuja apartment, worn sofa, lace curtains',
      timeOfDay: 'dusk', weather: 'humid', palette: 'warm amber and deep green',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const locationId = created.data.location.id;
  assert.equal(created.data.location.hasReferenceImage, false);

  const list = await req(`/api/films/${filmId}/locations`);
  assert.equal(list.status, 200);
  assert.ok(list.data.locations.some((location) => location.id === locationId));

  const detail = await req(`/api/films/${filmId}`);
  const scene = detail.data.scenes[1];
  const linked = await req(`/api/films/${filmId}/scenes/${scene.id}`, {
    method: 'PATCH', body: { location_id: locationId },
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.scene.locationId, locationId);
  assert.equal(linked.data.scene.location, "Amara's apartment", 'linking names the location on the slate');

  const film = await db('film_projects').where({ id: filmId }).first();
  const row = await db('film_scenes').where({ id: scene.id }).first();
  const location = await db('film_locations').where({ id: locationId }).first();
  const prompt = scenePrompt(film, row, [], location);
  assert.match(prompt, /Amara's apartment/);
  assert.match(prompt, /worn sofa/);
  assert.match(prompt, /weather: humid/);
  assert.match(prompt, /Production palette: warm amber/);

  // Another user cannot see or mutate this project's locations.
  const foreignList = await request(`/api/films/${filmId}/locations`, { cookie: otherCookie });
  assert.ok([403, 404].includes(foreignList.status), `foreign user must not read the locations (got ${foreignList.status})`);
  const foreignDelete = await request(`/api/films/${filmId}/locations/${locationId}`, { method: 'DELETE', cookie: otherCookie });
  assert.ok([403, 404].includes(foreignDelete.status), `foreign user must not delete the location (got ${foreignDelete.status})`);

  const deleted = await req(`/api/films/${filmId}/locations/${locationId}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.detachedScenes, 1, 'deleting a location detaches its scenes instead of leaving a dangling link');
  const after = await db('film_scenes').where({ id: scene.id }).first();
  assert.equal(after.location_id, null);
});

test('quality control reports real gaps, never a false pass', async () => {
  const res = await req(`/api/films/${filmId}/qc`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const checks = Object.fromEntries(res.data.checks.map((item) => [item.id, item]));

  assert.equal(checks.scenes.status, 'pass');
  assert.equal(checks.clips.status, 'fail', 'no provider is configured, so no scene can have a clip');
  assert.ok(checks.clips.evidence.missing.length > 0);
  assert.equal(checks['shot-direction'].status, 'pass', 'the template draft directs every scene');
  assert.equal(checks['failed-scenes'].status, 'pass');
  assert.equal(checks.runtime.status, 'pass');
  assert.match(checks.runtime.detail, /\d+s planned against a 120s target/);
  assert.equal(res.data.status, 'fail');
  assert.ok(res.data.score < 100);
  assert.equal(res.data.sceneCount, res.data.scenes.length);

  // Linking a location clears the "free-text location" warning.
  const location = await req(`/api/films/${filmId}/locations`, {
    method: 'POST', body: { name: 'Rooftop at dusk' },
  });
  assert.equal(location.status, 201);
  const detail = await req(`/api/films/${filmId}`);
  for (const scene of detail.data.scenes) {
    await req(`/api/films/${filmId}/scenes/${scene.id}`, { method: 'PATCH', body: { location_id: location.data.location.id } });
  }
  const qc = await req(`/api/films/${filmId}/qc`);
  const locations = qc.data.checks.find((item) => item.id === 'locations');
  assert.equal(locations.status, 'pass', locations.detail);
});

test('QC flags cast names that have no character profile', async () => {
  const detail = await req(`/api/films/${filmId}`);
  const scene = detail.data.scenes[0];
  await req(`/api/films/${filmId}/scenes/${scene.id}`, {
    method: 'PATCH',
    body: { dialogue: [{ character: 'Ghost Character', line: 'I was never cast.' }] },
  });
  const qc = await req(`/api/films/${filmId}/qc`);
  const membership = qc.data.checks.find((item) => item.id === 'cast-membership');
  assert.equal(membership.status, 'warn');
  assert.ok(membership.evidence.unknown.includes('Ghost Character'));
});
