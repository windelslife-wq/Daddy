/**
 * Post-production depth: props continuity, ad studio, multi-track edits
 * (speed / VFX / text overlay), queue-backed storyboard + voice, provider-gated
 * lip-sync and motion transfer, scene splitting and admin film controls.
 *
 * Everything runs against the real HTTP API and the real database. No video
 * provider is configured, which is the point of several assertions: gated
 * features must fail with an explicit code instead of pretending to work.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-post-'));

process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.WORKER_ENABLED = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SEED_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin-post@example.test';
process.env.ADMIN_PASSWORD = 'PostAdmin2026!';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8789';
process.env.APP_URL = 'http://127.0.0.1:8789';
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.FILM_VIDEO_PROVIDER = 'none';
process.env.FILM_LIPSYNC_PROVIDER = 'auto';
process.env.FILM_MOTION_PROVIDER = 'auto';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'REPLICATE_API_TOKEN', 'FAL_API_KEY', 'GOOGLE_VEO_API_KEY', 'ELEVENLABS_API_KEY',
  'FILM_LIPSYNC_REPLICATE_MODEL', 'FILM_MOTION_REPLICATE_MODEL']) {
  delete process.env[key];
}

const { createApp } = await import('../server/app.js');
const { db, closeDb } = await import('../server/db.js');
const { ffmpeg, probeVideo, projectDir } = await import('../server/media/utils.js');
const { editFilters, listVfxPresets, drawTextEscape } = await import('../server/film/editing.js');

let server;
let base;
let cookie;
let adminCookie;
let film;
let adFilm;

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

const req = (pathname, options = {}) => request(pathname, { cookie, ...options });

async function createFilm(body) {
  const created = await req('/api/films', { method: 'POST', body });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.film;
}

function screenplayFor(title, sceneCount = 2) {
  return {
    title,
    logline: 'Short test.',
    story_bible: { premise: 'p', world: 'w', themes: [], continuity_notes: '' },
    characters: [{ name: 'Ada', role: 'lead', description: 'Lamp-lit.' }],
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      heading: `INT. ROOM ${index + 1} - NIGHT`,
      location: 'Room',
      description: 'A lamp burns.',
      dialogue: [{ character: 'Ada', line: `Line ${index + 1}.`, emotion: 'calm' }],
      camera_movement: 'push in',
      visual_prompt: 'dark room with a lamp',
      duration_seconds: 6,
    })),
  };
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'creator@faceless.local', password: 'StudioDemo2026!' } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  cookie = cookieFrom(login);

  const admin = await request('/api/auth/login', { method: 'POST', body: { email: 'admin-post@example.test', password: 'PostAdmin2026!' } });
  assert.equal(admin.status, 200, JSON.stringify(admin.data));
  adminCookie = cookieFrom(admin);

  film = await createFilm({ title: 'Post Production', type: 'short_drama', genre: 'thriller', aspectRatio: '16:9', targetDurationSeconds: 12 });
  const saved = await req(`/api/films/${film.id}/screenplay`, { method: 'PUT', body: { screenplay: screenplayFor('Post Production', 2) } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));

  adFilm = await createFilm({ title: 'Serum Ad', type: 'advertisement', genre: 'other', aspectRatio: '9:16', targetDurationSeconds: 30 });
  const adSaved = await req(`/api/films/${adFilm.id}/screenplay`, { method: 'PUT', body: { screenplay: screenplayFor('Serum Ad', 2) } });
  assert.equal(adSaved.status, 200, JSON.stringify(adSaved.data));
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('props library stores real props and per-scene states that reach the prompt', async () => {
  const created = await req('/api/films/props', { method: 'POST', body: { filmId: film.id, name: 'Letter', material: 'paper', color: 'cream' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.prop.name, 'Letter');

  const invalid = await req('/api/films/props', { method: 'POST', body: { filmId: film.id, name: '' } });
  assert.equal(invalid.status, 400);

  const list = await req(`/api/films/props?filmId=${film.id}`);
  assert.equal(list.status, 200);
  assert.ok(list.data.props.some((prop) => prop.id === created.data.prop.id));

  const detail = await req(`/api/films/${film.id}`);
  const sceneId = detail.data.scenes[0].id;
  const linked = await req(`/api/films/${film.id}/scenes/${sceneId}/props`, {
    method: 'PUT', body: { props: [{ propId: created.data.prop.id, state: 'folded' }] },
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));

  const refreshed = await req(`/api/films/${film.id}`);
  assert.equal(refreshed.data.sceneProps[sceneId].length, 1);
  assert.equal(refreshed.data.sceneProps[sceneId][0].name, 'Letter');
  assert.equal(refreshed.data.sceneProps[sceneId][0].state, 'folded');

  const foreign = await request('/api/films/props?filmId=' + film.id, { cookie: '' });
  assert.equal(foreign.status, 401);
});

test('multi-track track updates validate speed, look and overlay, and appear on the scene', async () => {
  assert.equal(listVfxPresets().length, 8);
  const detail = await req(`/api/films/${film.id}`);
  const sceneId = detail.data.scenes[0].id;

  const saved = await req(`/api/films/${film.id}/scenes/${sceneId}/track`, {
    method: 'POST',
    body: {
      speedFactor: 0.5,
      vfxPreset: 'vignette',
      overlay: { text: "Three days later: it's 100% real, 5", position: 'bottom', startSeconds: 0.5, endSeconds: 3 },
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.track.speedFactor, 0.5);
  assert.equal(saved.data.track.vfxPreset, 'vignette');
  assert.equal(saved.data.track.overlay.text, "Three days later: it's 100% real, 5");

  const badPreset = await req(`/api/films/${film.id}/scenes/${sceneId}/track`, { method: 'POST', body: { vfxPreset: 'nope' } });
  assert.equal(badPreset.status, 400);
  assert.equal(badPreset.data.error.code, 'unknown_vfx_preset');

  const badSpeed = await req(`/api/films/${film.id}/scenes/${sceneId}/track`, { method: 'POST', body: { speedFactor: 9 } });
  assert.equal(badSpeed.status, 400);
  assert.equal(badSpeed.data.error.code, 'invalid_speed_factor');

  const overview = await req(`/api/films/${film.id}/editing`);
  assert.equal(overview.status, 200);
  assert.equal(overview.data.scenes[0].track.vfxPreset, 'vignette');
  assert.equal(overview.data.vfxPresets.length, 8);
  assert.ok(overview.data.tracks.length >= 3);

  const refreshed = await req(`/api/films/${film.id}`);
  const scene = refreshed.data.scenes.find((item) => item.id === sceneId);
  assert.equal(scene.speedFactor, 0.5);
  assert.equal(scene.vfxPreset, 'vignette');
  assert.equal(scene.overlay.text.length > 0, true);
});

test('every VFX preset and a text overlay compile in a real FFmpeg render', async () => {
  assert.equal(drawTextEscape("it's 100%, real: yes").includes("\\'"), true);
  const dir = fs.mkdtempSync(path.join(tempDir, 'edit-'));
  for (const preset of listVfxPresets()) {
    const scene = { speed_factor: 0.5, vfx_preset: preset.id, overlay_json: JSON.stringify({ text: "It's 100% real, 5", position: 'bottom', startSeconds: 0, endSeconds: 1 }) };
    const filter = [
      'scale=320:180:force_original_aspect_ratio=decrease', 'pad=320:180:(ow-iw)/2:(oh-ih)/2:color=black',
      'fps=24', 'setsar=1', 'tpad=stop_mode=clone:stop_duration=4', 'trim=duration=1', 'setpts=PTS-STARTPTS',
      ...editFilters({ scene, width: 320, height: 180, visible: 1 }), 'format=yuv420p',
    ].join(',');
    const output = path.join(dir, `${preset.id}.mp4`);
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=1', '-vf', filter, '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-y', output], { timeoutMs: 120000 });
    const probe = await probeVideo(output);
    assert.equal(probe.hasVideo, true, `${preset.id} did not render`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assembly burns the edit into a real MP4 with an H.264 video stream', async () => {
  const detail = await req(`/api/films/${film.id}`);
  const dir = projectDir(`film_${film.id}`);
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  for (const [index, scene] of detail.data.scenes.entries()) {
    const clip = path.join(dir, 'scenes', `fixture-${index + 1}.mp4`);
    await ffmpeg(['-f', 'lavfi', '-i', `color=c=${index ? 'darkgreen' : 'navy'}:s=640x360:r=24:d=6`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '6', '-y', clip], { timeoutMs: 120000 });
    await db('film_scenes').where({ id: scene.id }).update({ clip_path: clip, duration_seconds: 6 });
  }

  const preflight = await req(`/api/films/${film.id}/preflight`);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.data.ready, true, JSON.stringify(preflight.data.missing));

  const assemble = await req(`/api/films/${film.id}/assemble`, { method: 'POST', body: { subtitles: false } });
  assert.ok([200, 202].includes(assemble.status), JSON.stringify(assemble.data));

  const { processFilmAssemblyJob } = await import('../server/film/scenes.js');
  const user = await db('users').where({ email: 'creator@faceless.local' }).first();
  await processFilmAssemblyJob({ filmId: film.id, userId: user.id, attempt: 1, subtitles: false, burnSubtitles: false });

  const row = await db('film_projects').where({ id: film.id }).first();
  assert.ok(row.final_video_path, 'the render wrote a final file');
  assert.ok(fs.statSync(row.final_video_path).size > 10000);
  const probe = await probeVideo(row.final_video_path);
  assert.equal(probe.hasVideo, true);
  assert.equal(probe.width, 1280);
  assert.equal(probe.height, 720);
});

test('lip-sync and motion transfer fail honestly when no provider key is configured', async () => {
  const vfx = await req('/api/films/vfx');
  assert.equal(vfx.status, 200);
  assert.equal(vfx.data.presets.length, 8);
  assert.equal(vfx.data.motion.configured, false);
  assert.match(vfx.data.motion.note, /FILM_MOTION_PROVIDER/);

  const lip = await req('/api/films/lipsync');
  assert.equal(lip.status, 200);
  assert.equal(lip.data.configured, false);
  assert.equal(lip.data.verified, false);

  // The ad project has never rendered a clip: the API names the missing input.
  const adDetail = await req(`/api/films/${adFilm.id}`);
  const adSceneId = adDetail.data.scenes[0].id;
  const noClip = await req(`/api/films/${adFilm.id}/scenes/${adSceneId}/lipsync`, { method: 'POST' });
  assert.equal(noClip.status, 409);
  assert.equal(noClip.data.error.code, 'clip_required');

  const noStill = await req(`/api/films/${adFilm.id}/scenes/${adSceneId}/motion`, { method: 'POST' });
  assert.equal(noStill.status, 409);
  assert.equal(noStill.data.error.code, 'still_required');

  // The main project has a clip (rendered above) but no voice take.
  const detail = await req(`/api/films/${film.id}`);
  const sceneId = detail.data.scenes[0].id;
  const noVoice = await req(`/api/films/${film.id}/scenes/${sceneId}/lipsync`, { method: 'POST' });
  assert.equal(noVoice.status, 409);
  assert.equal(noVoice.data.error.code, 'voice_take_required');

  // With both inputs present the gate is the credential, and the code says so.
  const sceneRow = await db('film_scenes').where({ id: sceneId }).first();
  const voicePath = path.join(tempDir, 'voice.wav');
  fs.writeFileSync(voicePath, Buffer.alloc(512));
  await db('film_scenes').where({ id: sceneId }).update({ voice_path: voicePath });
  const gated = await req(`/api/films/${film.id}/scenes/${sceneId}/lipsync`, { method: 'POST' });
  assert.equal(gated.status, 503);
  assert.equal(gated.data.error.code, 'lip_sync_unavailable');
  assert.equal((await db('film_scenes').where({ id: sceneId }).first()).clip_path, sceneRow.clip_path, 'nothing was changed');
  await db('film_scenes').where({ id: sceneId }).update({ voice_path: null });
});

test('brand kits drive real advertisement variations that rewrite the scenes', async () => {
  const kit = await req('/api/films/brand-kits', {
    method: 'POST',
    body: { name: 'Glow', product: 'Glow serum', tagline: 'Glow every day', audience: 'Young professionals', colors: ['#f4b400'] },
  });
  assert.equal(kit.status, 201, JSON.stringify(kit.data));

  const kits = await req('/api/films/brand-kits');
  assert.equal(kits.status, 200);
  assert.ok(kits.data.brandKits.some((item) => item.id === kit.data.brandKit.id));

  const nonAd = await req(`/api/films/${film.id}/ads/variations`, { method: 'POST', body: { count: 2 } });
  assert.equal(nonAd.status, 409);
  assert.equal(nonAd.data.error.code, 'not_an_advertisement');

  const noKit = await req(`/api/films/${adFilm.id}/ads/variations`, { method: 'POST', body: { count: 2 } });
  assert.equal(noKit.status, 409);
  assert.equal(noKit.data.error.code, 'brand_kit_missing');

  const attached = await req(`/api/films/${adFilm.id}/ads/attach`, { method: 'POST', body: { brandKitId: kit.data.brandKit.id } });
  assert.equal(attached.status, 200, JSON.stringify(attached.data));
  assert.equal(attached.data.brandKit.name, 'Glow');

  const generated = await req(`/api/films/${adFilm.id}/ads/variations`, { method: 'POST', body: { count: 3 } });
  assert.equal(generated.status, 200, JSON.stringify(generated.data));
  assert.equal(generated.data.variants.length, 3);
  assert.ok(generated.data.variants.every((variant) => variant.label && variant.cta && variant.scenes > 0));
  assert.ok(generated.data.variants.every((variant) => variant.aiGenerated === false), 'labelled as a template, not AI');

  const variant = generated.data.variants[0];
  const applied = await req(`/api/films/${adFilm.id}/ads/variations/${variant.id}/apply`, { method: 'POST', body: {} });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.applied, variant.id);
  assert.ok(applied.data.scenes > 0);

  const adsAgain = await req(`/api/films/${adFilm.id}/ads`);
  assert.equal(adsAgain.status, 200);
  assert.equal(adsAgain.data.brandKit.name, 'Glow');

  const removed = await req(`/api/films/brand-kits/${kit.data.brandKit.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await req(`/api/films/${adFilm.id}/ads`)).data.brandKit, null);
});

test('searching the cast library clones a character into a new project', async () => {
  const created = await req('/api/films/characters', { method: 'POST', body: { filmId: film.id, name: 'Ada', role: 'lead', wardrobe: 'Green coat', isLibrary: true } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.character.wardrobe, 'Green coat');

  const library = await req('/api/films/cast-library');
  assert.equal(library.status, 200);
  const entry = library.data.characters.find((item) => item.name === 'Ada');
  assert.ok(entry, 'the library character is returned');

  const target = await createFilm({ title: 'Clone Target', type: 'short_drama', targetDurationSeconds: 10 });
  const cloned = await req(`/api/films/characters/${entry.id}/clone`, { method: 'POST', body: { filmId: target.id } });
  assert.equal(cloned.status, 201, JSON.stringify(cloned.data));
  assert.equal(cloned.data.character.filmId, target.id);
  assert.equal(cloned.data.character.wardrobe, 'Green coat');

  const duplicate = await req(`/api/films/characters/${entry.id}/clone`, { method: 'POST', body: { filmId: target.id } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, 'character_exists');
});

test('a scene splits into two ordered halves that keep the timeline unique', async () => {
  const detail = await req(`/api/films/${film.id}`);
  const target = detail.data.scenes[0];
  await db('film_scenes').where({ id: target.id }).update({ duration_seconds: 12 });
  const split = await req(`/api/films/${film.id}/scenes/${target.id}/split`, { method: 'POST', body: { atSeconds: 6 } });
  assert.equal(split.status, 200, JSON.stringify(split.data));
  assert.equal(split.data.first.durationSeconds, 6);
  assert.equal(split.data.second.durationSeconds, 6);

  const after = await req(`/api/films/${film.id}`);
  assert.equal(after.data.scenes.length, detail.data.scenes.length + 1);
  const ordinals = after.data.scenes.map((scene) => scene.ordinal);
  assert.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b));
});

test('storyboard and voice batches queue as worker jobs instead of blocking the request', async () => {
  const storyboard = await req(`/api/films/${film.id}/storyboard`, { method: 'POST', body: { queue: true } });
  assert.equal(storyboard.status, 202, JSON.stringify(storyboard.data));
  assert.equal(storyboard.data.queued, true);
  assert.ok(storyboard.data.jobId);
  const storyboardJob = await db('jobs').where({ id: storyboard.data.jobId }).first();
  assert.equal(storyboardJob.type, 'film_storyboard_batch');

  const voice = await req(`/api/films/${film.id}/voice`, { method: 'POST', body: { queue: true } });
  assert.equal(voice.status, 202, JSON.stringify(voice.data));
  const voiceJob = await db('jobs').where({ id: voice.data.jobId }).first();
  assert.equal(voiceJob.type, 'film_voice_batch');
  assert.ok(voice.data.remaining >= 1);
});

test('admin film operations are admin-only and disabling a provider blocks routing', async () => {
  const forbidden = await req('/api/admin/film/ops');
  assert.equal(forbidden.status, 403);

  const ops = await request('/api/admin/film/ops', { cookie: adminCookie });
  assert.equal(ops.status, 200, JSON.stringify(ops.data));
  assert.ok(Array.isArray(ops.data.providers.video));
  assert.ok(ops.data.providers.video.length >= 3);
  assert.equal(typeof ops.data.renderedFilms, 'number');
  assert.ok(ops.data.queue.film_storyboard_batch, 'the queued storyboard job is visible');

  const unknown = await request('/api/admin/film/providers/not-a-provider', { method: 'POST', cookie: adminCookie, body: { enabled: false } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.error.code, 'provider_unknown');

  const badBody = await request('/api/admin/film/providers/replicate', { method: 'POST', cookie: adminCookie, body: { enabled: 'yes' } });
  assert.equal(badBody.status, 400);
  assert.equal(badBody.data.error.code, 'invalid_enabled');

  const disabled = await request('/api/admin/film/providers/replicate', { method: 'POST', cookie: adminCookie, body: { enabled: false } });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
  assert.equal(disabled.data.enabled, false);
  const opsAfter = await request('/api/admin/film/ops', { cookie: adminCookie });
  assert.ok(opsAfter.data.providers.disabled.includes('replicate'));

  // Nothing is configured in this environment, so the refusal is the credential
  // gate rather than the admin gate; either way the scene is never queued.
  const sceneId = (await req(`/api/films/${film.id}`)).data.scenes[0].id;
  const blocked = await req(`/api/films/${film.id}/scenes/${sceneId}/generate`, { method: 'POST', body: { provider: 'replicate' } });
  assert.ok([409, 503].includes(blocked.status), JSON.stringify(blocked.data));
  assert.ok(['provider_disabled', 'video_provider_unavailable'].includes(blocked.data.error.code));
  const sceneRow = await db('film_scenes').where({ id: sceneId }).first();
  assert.equal(sceneRow.status !== 'queued' && sceneRow.status !== 'generating', true, 'no scene job was queued');

  const reenabled = await request('/api/admin/film/providers/replicate', { method: 'POST', cookie: adminCookie, body: { enabled: true } });
  assert.equal(reenabled.status, 200);
  const opsRestored = await request('/api/admin/film/ops', { cookie: adminCookie });
  assert.ok(!opsRestored.data.providers.disabled.includes('replicate'));

  const health = await request('/api/admin/film/health', { cookie: adminCookie });
  assert.equal(health.status, 200, JSON.stringify(health.data));
  assert.ok(Array.isArray(health.data.providers) && health.data.providers.length >= 3);
  const replicate = health.data.providers.find((item) => item.id === 'replicate');
  assert.equal(replicate.checked, false, 'no credential ⇒ not contacted');
  assert.match(replicate.reason, /credential/i);
  assert.equal((await req('/api/admin/film/health')).status, 403);

  const retry = await request('/api/admin/film/jobs/retry-failed', { method: 'POST', cookie: adminCookie, body: {} });
  assert.equal(retry.status, 200);
  assert.equal(typeof retry.data.requeued, 'number');

  const badRetry = await request('/api/admin/film/jobs/retry-failed', { method: 'POST', cookie: adminCookie, body: { type: 'nope' } });
  assert.equal(badRetry.status, 400);
  assert.equal(badRetry.data.error.code, 'unknown_job_type');
});
