/**
 * Delivery features: picture-in-picture overlay tracks, brand-logo compositing,
 * audio stem export, natural-language production revision and unattended
 * scheduled runs.
 *
 * These drive the real HTTP API, the real database and real FFmpeg renders. No
 * video provider is configured, so clips are fixture files written by FFmpeg —
 * the same shape a provider download produces — and the render proves that the
 * overlay, logo, stems and edit pipeline work on real media.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-delivery-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-delivery@example.test';
process.env.ADMIN_PASSWORD = 'DeliveryAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8790';
process.env.APP_URL = 'http://127.0.0.1:8790';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'none';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'REPLICATE_API_TOKEN', 'FAL_API_KEY']) {
  delete process.env[key];
}

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { ffmpeg, probeVideo, projectDir } = await import('../server/media/utils.js');
const { processFilmAssemblyJob } = await import('../server/film/scenes.js');

let server;
let base;
let cookie;
let film;
let sceneIds = [];
let overlayAsset;

async function request(pathname, { method = 'GET', body, cookie: c, raw = false } = {}) {
  const headers = {};
  if (c) headers.cookie = c;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method, headers, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
  });
  if (raw) return response;
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

function cookieFrom(response) {
  return (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');
}

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

async function makePng(filePath, { width = 160, height = 90, color = 'red' } = {}) {
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}:d=1`, '-frames:v', '1', '-y', filePath], { timeoutMs: 60000 });
  return filePath;
}

async function uploadFile(url, filePath, filename, extra = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'image/png' }), filename);
  return req(url, { method: 'POST', body: form });
}

async function createFilm(body) {
  const created = await req('/api/films', { method: 'POST', body });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.film;
}

async function screenplay(filmId, title) {
  const body = {
    screenplay: {
      title,
      logline: 'Delivery test.',
      story_bible: { premise: 'p', world: 'w', themes: [], continuity_notes: '' },
      characters: [{ name: 'Ada', role: 'lead', description: 'Lead.' }],
      scenes: [
        { heading: 'INT. ROOM - NIGHT', location: 'Room', description: 'A lamp.', dialogue: [{ character: 'Ada', line: 'We should go.' }], camera_movement: 'push in', visual_prompt: 'dark room', duration_seconds: 4 },
        { heading: 'EXT. STREET - DAY', location: 'Street', description: 'Rain.', dialogue: [], camera_movement: 'track', visual_prompt: 'wet street', duration_seconds: 4 },
      ],
    },
  };
  const saved = await req(`/api/films/${filmId}/screenplay`, { method: 'PUT', body });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  return saved.data.scenes;
}

async function attachFixtureClips(filmId, scenes, seconds = 4) {
  const dir = projectDir(`film_${filmId}`);
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  for (const [index, scene] of scenes.entries()) {
    const clip = path.join(dir, 'scenes', `fixture-${index + 1}.mp4`);
    await ffmpeg(['-f', 'lavfi', '-i', `color=c=${index ? 'darkgreen' : 'navy'}:s=640x360:r=24:d=${seconds}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(seconds), '-y', clip], { timeoutMs: 120000 });
    await db('film_scenes').where({ id: scene.id }).update({ clip_path: clip, duration_seconds: seconds });
  }
}

/** Read one RGB pixel from a video frame with FFmpeg (real pixels, not metadata). */
async function pixelAt(filePath, seconds, x, y) {
  const out = path.join(tempDir, `pixel-${crypto.randomUUID()}.rgb`);
  await ffmpeg(['-ss', String(seconds), '-i', filePath, '-frames:v', '1',
    '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-y', out], { timeoutMs: 60000 });
  const buffer = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return { r: buffer[0], g: buffer[1], b: buffer[2] };
}

async function render(filmId) {
  const assemble = await req(`/api/films/${filmId}/assemble`, { method: 'POST', body: { subtitles: false } });
  assert.ok([200, 202].includes(assemble.status), JSON.stringify(assemble.data));
  const filmRow = await db('film_projects').where({ id: filmId }).first();
  const result = await processFilmAssemblyJob({ filmId, userId: filmRow.user_id, attempt: 1, subtitles: false, burnSubtitles: false });
  assert.equal(result.ok, true, result.error);
  return result;
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'creator@filmclublens.local', password: 'StudioDemo2026!' } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  cookie = cookieFrom(login);

  film = await createFilm({ title: 'Delivery', type: 'short_drama', aspectRatio: '16:9', targetDurationSeconds: 8 });
  const scenes = await screenplay(film.id, 'Delivery');
  sceneIds = scenes.map((scene) => scene.id);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('an overlay image uploads, lists, and is rejected before it exists', async () => {
  const missing = await makePng(path.join(tempDir, 'overlay.png'), { color: 'orange' });
  const unknown = await req(`/api/films/${film.id}/scenes/${sceneIds[0]}/track`, {
    method: 'POST', body: { overlay: { overlayId: 'ovl_notreal' } },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.error.code, 'overlay_asset_unknown');

  const uploaded = await uploadFile(`/api/films/${film.id}/upload`, missing, 'overlay.png', { kind: 'overlay', name: 'Preview card' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.asset.name, 'Preview card');
  overlayAsset = uploaded.data.asset;
  assert.ok(fs.existsSync(overlayAsset.path), 'the file exists on disk');

  const listed = await req(`/api/films/${film.id}/overlays`);
  assert.equal(listed.status, 200);
  assert.ok(listed.data.overlays.some((asset) => asset.id === overlayAsset.id));

  const saved = await req(`/api/films/${film.id}/scenes/${sceneIds[0]}/track`, {
    method: 'POST',
    body: { overlay: { overlayId: overlayAsset.id, position: 'bottom_right', startSeconds: 0, endSeconds: 3, scale: 0.3 } },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.track.overlay.overlayId, overlayAsset.id);
  assert.equal(saved.data.track.overlay.position, 'bottom_right');

  const detail = await req(`/api/films/${film.id}`);
  const scene = detail.data.scenes.find((item) => item.id === sceneIds[0]);
  assert.equal(scene.overlay.overlayId, overlayAsset.id);
});

test('the render draws the picture-in-picture image and exports audio stems', async () => {
  await attachFixtureClips(film.id, [
    { id: sceneIds[0] },
    { id: sceneIds[1] },
  ]);
  const result = await render(film.id);
  assert.equal(result.brandLogo, false, 'no brand kit on this project');

  const filmRow = await db('film_projects').where({ id: film.id }).first();
  const probe = await probeVideo(filmRow.final_video_path);
  assert.equal(probe.hasVideo, true);
  assert.ok(probe.durationSeconds >= 7.5, `duration ${probe.durationSeconds}`);

  // The overlay is orange (255,140,0-ish) on a navy scene; sample its corner.
  const pip = await pixelAt(filmRow.final_video_path, 1, 1280 - 60, 720 - 60);
  assert.ok(pip.r > 150 && pip.b < 120, `overlay pixel should be warm, got ${JSON.stringify(pip)}`);
  const clean = await pixelAt(filmRow.final_video_path, 1, 120, 120);
  assert.ok(clean.b >= clean.r, `the unwrapped scene should stay navy, got ${JSON.stringify(clean)}`);

  const stems = await req(`/api/films/${film.id}/stems`);
  assert.equal(stems.status, 200);
  assert.equal(stems.data.available, true);
  const kinds = stems.data.stems.map((stem) => stem.kind);
  assert.ok(kinds.includes('voice'), JSON.stringify(kinds));
  assert.ok(kinds.includes('sfx'), JSON.stringify(kinds));

  const voice = await req(`/api/films/${film.id}/stems/voice`, { raw: true });
  assert.equal(voice.status, 200);
  const bytes = Buffer.from(await voice.arrayBuffer());
  assert.ok(bytes.length > 1000, `voice stem is ${bytes.length} bytes`);
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF');

  const unknown = await req(`/api/films/${film.id}/stems/drums`);
  assert.equal(unknown.status, 400);
});

test('deleting an overlay asset clears the scene reference so the render stays valid', async () => {
  const removed = await req(`/api/films/${film.id}/overlays/${overlayAsset.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.deleted, true);

  const detail = await req(`/api/films/${film.id}`);
  const scene = detail.data.scenes.find((item) => item.id === sceneIds[0]);
  assert.equal(scene.overlay, null);

  const list = await req(`/api/films/${film.id}/overlays`);
  assert.equal(list.data.overlays.length, 0);
});

test('a brand logo uploads and is burned into the advertisement render', async () => {
  const adFilm = await createFilm({ title: 'Logo Ad', type: 'advertisement', aspectRatio: '9:16', targetDurationSeconds: 8 });
  const adScenes = await screenplay(adFilm.id, 'Logo Ad');

  const kit = await req('/api/films/brand-kits', { method: 'POST', body: { name: 'Glow', product: 'Serum', tagline: 'Glow daily' } });
  assert.equal(kit.status, 201, JSON.stringify(kit.data));
  const kitId = kit.data.brandKit.id;
  assert.equal(kit.data.brandKit.hasLogo, false);

  const logoPath = await makePng(path.join(tempDir, 'logo.png'), { width: 240, height: 120, color: 'white' });
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(logoPath)], { type: 'image/png' }), 'logo.png');
  const uploaded = await req(`/api/films/brand-kits/${kitId}/logo`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.brandKit.hasLogo, true);

  const logo = await req(`/api/films/brand-kits/${kitId}/logo`, { raw: true });
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type')?.includes('image/png'), true);

  const attached = await req(`/api/films/${adFilm.id}/ads/attach`, { method: 'POST', body: { brandKitId: kitId } });
  assert.equal(attached.status, 200, JSON.stringify(attached.data));

  await attachFixtureClips(adFilm.id, adScenes);
  const result = await render(adFilm.id);
  assert.equal(result.brandLogo, true, 'the render reports the logo it burned in');
  const row = await db('film_projects').where({ id: adFilm.id }).first();
  const probe = await probeVideo(row.final_video_path);
  assert.equal(probe.hasVideo, true);
  assert.equal(probe.width, 720);
  assert.equal(probe.height, 1280);
});

test('a brand kit generates a real product shot with the configured image provider', async () => {
  const kit = await req('/api/films/brand-kits', { method: 'POST', body: { name: 'Shot Test', product: 'Amber serum', description: '30ml dropper bottle', tagline: 'Glow daily' } });
  assert.equal(kit.status, 201, JSON.stringify(kit.data));
  const kitId = kit.data.brandKit.id;
  assert.equal(kit.data.brandKit.hasProductShot, false);

  const shot = await req(`/api/films/brand-kits/${kitId}/product-shot`, { method: 'POST' });
  assert.equal(shot.status, 201, JSON.stringify(shot.data));
  assert.equal(shot.data.aiGenerated, false, 'the local renderer is labelled non-AI');
  assert.match(shot.data.provider, /procedural/);
  assert.equal(shot.data.width, shot.data.height, 'product shots are square');
  assert.equal(shot.data.brandKit.hasProductShot, true);

  const image = await req(`/api/films/brand-kits/${kitId}/product-image`, { raw: true });
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/png/);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', 'the stored file is a real PNG');

  const list = await req('/api/films/brand-kits');
  assert.ok(list.data.brandKits.find((item) => item.id === kitId).hasProductShot);

  const missing = await req('/api/films/brand-kits/brand_notreal/product-image', { raw: true });
  assert.equal(missing.status, 404);
});

test('the production agent revises a screenplay from a natural-language note', async () => {
  const started = await req('/api/films/production/start', { method: 'POST', body: { brief: 'A three-minute family drama in Abuja about a stolen inheritance.' } });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  const runFilmId = started.data.production.filmId || started.data.film?.id;
  assert.ok(runFilmId, JSON.stringify(started.data).slice(0, 200));

  const before = await req(`/api/films/${runFilmId}`);
  const beforeScenes = before.data.scenes.length;

  const revised = await req(`/api/films/${runFilmId}/production/revise`, {
    method: 'POST', body: { stage: 'screenplay', instruction: 'End on a rooftop chase and make the opening shorter.' },
  });
  assert.equal(revised.status, 200, JSON.stringify(revised.data));
  assert.equal(revised.data.revised, true);
  assert.equal(revised.data.aiGenerated, false, 'no AI provider ⇒ labelled offline draft');
  assert.ok(revised.data.scenes > 0);
  assert.equal(revised.data.production.currentStage, 'generate');

  const after = await req(`/api/films/${runFilmId}`);
  assert.equal(after.data.scenes.length, revised.data.scenes);
  assert.ok(beforeScenes > 0);

  const stages = Object.fromEntries(revised.data.production.stages.map((stage) => [stage.id, stage]));
  assert.match(stages.screenplay.detail, /revision/i);
  assert.equal(stages.locations.status, 'done');
  assert.equal(stages.direct.status, 'done');

  const locked = await req(`/api/films/${film.id}/production/revise`, {
    method: 'POST', body: { stage: 'screenplay', instruction: 'Rewrite everything.' },
  });
  assert.equal(locked.status, 404, 'a project without a production run has nothing to revise');
});

test('generation can be scheduled for an unattended run and rejects bad times', async () => {
  const started = await req('/api/films/production/start', { method: 'POST', body: { brief: 'A two-minute comedy short set in a Lagos market.' } });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  const runFilmId = started.data.production.filmId || started.data.film?.id;

  const soon = await req(`/api/films/${runFilmId}/production/schedule`, {
    method: 'POST', body: { action: 'schedule', runAt: new Date(Date.now() + 5000).toISOString() },
  });
  assert.equal(soon.status, 400);
  assert.equal(soon.data.error.code, 'run_at_too_soon');

  const bad = await req(`/api/films/${runFilmId}/production/schedule`, { method: 'POST', body: { action: 'schedule', runAt: 'not-a-date' } });
  assert.equal(bad.status, 400);

  const runAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const scheduled = await req(`/api/films/${runFilmId}/production/schedule`, { method: 'POST', body: { action: 'schedule', runAt } });
  assert.equal(scheduled.status, 202, JSON.stringify(scheduled.data));
  assert.equal(scheduled.data.scheduled, true);
  assert.equal(scheduled.data.production.status, 'scheduled');

  const job = await db('jobs').where({ dedupe_key: `film_production_run:${runFilmId}` }).first();
  assert.ok(job, 'the scheduled job exists');
  assert.equal(job.type, 'film_production_run');
  assert.equal(job.status, 'queued');
  assert.ok(new Date(job.run_at).getTime() >= new Date(runAt).getTime() - 1000);

  // Re-scheduling moves the same job instead of stacking a second charge.
  const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const rescheduled = await req(`/api/films/${runFilmId}/production/schedule`, { method: 'POST', body: { action: 'schedule', runAt: later } });
  assert.equal(rescheduled.status, 202);
  const jobs = await db('jobs').where({ type: 'film_production_run' });
  assert.equal(jobs.length, 1);
  assert.ok(new Date(jobs[0].run_at).getTime() >= new Date(later).getTime() - 1000);
});
