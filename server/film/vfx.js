/**
 * Motion Transfer & VFX.
 *
 * Two very different things live here, and the API keeps them apart:
 *
 *  1. LOCAL LOOKS — vignette, grain, punch-in, slow zoom, handheld, letterbox.
 *     These are plain FFmpeg filters (see `editing.js`) that run on any machine
 *     with FFmpeg and no AI keys. They are real and always available.
 *
 *  2. MOTION TRANSFER — animate a still with a motion prompt through an external
 *     video model. It needs a provider credential AND an explicit model id, so it
 *     fails 503 `motion_transfer_unavailable` unless FILM_MOTION_PROVIDER plus
 *     REPLICATE_API_TOKEN/FAL_API_KEY and FILM_MOTION_REPLICATE_MODEL or
 *     FILM_MOTION_FAL_MODEL are all set. We do not guess a model name.
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { db, now, number, addJob } from '../db.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { ensureProjectDir, probeVideo } from '../media/utils.js';
import { ownedFilm } from './scenes.js';
import { invalidateAssembly } from './assembly.js';
import { listVfxPresets } from './editing.js';
import { providerCredentials, requestedProvider, runProviderVideo } from './gatedProviders.js';
import fs from 'node:fs/promises';

export function motionStatus() {
  const credentials = providerCredentials();
  // A provider is only usable when the operator has chosen the model explicitly.
  const explicit = String(config.film.motionProvider || '').toLowerCase();
  const hasReplicate = Boolean(credentials.replicate && config.film.motionReplicateModel);
  const hasFal = Boolean(credentials.fal && config.film.motionFalModel);
  let provider = 'none';
  if (explicit === 'replicate' && hasReplicate) provider = 'replicate';
  else if (explicit === 'fal' && hasFal) provider = 'fal';
  else if (!explicit || explicit === 'auto') provider = hasReplicate ? 'replicate' : hasFal ? 'fal' : 'none';
  return {
    feature: 'motion_transfer',
    provider,
    configured: provider !== 'none',
    models: {
      replicate: config.film.motionReplicateModel || null,
      fal: config.film.motionFalModel || null,
    },
    localPresets: listVfxPresets(),
    note: provider === 'none'
      ? 'Motion transfer needs FILM_MOTION_PROVIDER, a provider credential and an explicit FILM_MOTION_*_MODEL. Local VFX presets work without any key.'
      : 'Motion transfer is wired to the provider prediction API; live output is unverified in this environment.',
    verified: false,
  };
}

export async function vfxOverview() {
  return {
    motion: motionStatus(),
    presets: listVfxPresets(),
    appliedAt: 'FFmpeg during assembly (local presets) / provider clip (motion transfer)',
  };
}

export async function sceneMotionStatus(userId, filmId, sceneId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  return {
    sceneId,
    hasClip: Boolean(scene.clip_path && fsSync.existsSync(scene.clip_path)),
    hasStill: Boolean(scene.poster_path && fsSync.existsSync(scene.poster_path)),
    vfxPreset: scene.vfx_preset || 'none',
    status: motionStatus(),
  };
}

export async function queueMotionTransfer(userId, filmId, sceneId, payload = {}, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  const still = scene.poster_path && fsSync.existsSync(scene.poster_path) ? scene.poster_path : null;
  if (!still) throw new AppError(409, 'still_required', 'Render a storyboard still for this scene before animating it.');
  const status = motionStatus();
  if (!status.configured) throw new AppError(503, 'motion_transfer_unavailable', status.note);
  const motionPrompt = String(payload.motionPrompt || '').trim().slice(0, 400)
    || `Subtle cinematic camera movement, ${scene.camera_movement || 'slow push in'}, ${scene.heading || 'scene'}`;
  const jobId = await addJob('film_motion', {
    filmId, userId, sceneId, provider: status.provider, stillPath: still, motionPrompt,
    durationSeconds: Math.max(2, Math.min(10, number(payload.durationSeconds, Math.min(5, number(scene.duration_seconds, 5))))),
  }, { maxAttempts: 1 });
  await db('film_projects').where({ id: filmId }).update({ updated_at: now() });
  return {
    queued: true,
    jobId,
    provider: status.provider,
    filmTitle: film.title,
    sceneOrdinal: number(scene.ordinal),
    motionPrompt,
    verified: false,
    note: 'Queued against the configured motion model. Live results are unverified in this environment.',
  };
}

export async function processMotionJob({ filmId, sceneId, provider, stillPath, motionPrompt, durationSeconds }) {
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (!stillPath || !fsSync.existsSync(stillPath)) throw new AppError(409, 'still_required', 'The source still is missing.');
  const status = motionStatus();
  const selected = requestedProvider(provider) || status.provider;
  if (!status.configured || selected === 'none') throw new AppError(503, 'motion_transfer_unavailable', status.note);
  const model = selected === 'replicate' ? config.film.motionReplicateModel : config.film.motionFalModel;
  const image = `data:image/png;base64,${(await fs.readFile(stillPath)).toString('base64')}`;
  const dir = await ensureProjectDir(`film_${filmId}`);
  const outputPath = path.join(dir, 'scenes', `motion-${String(number(scene.ordinal)).padStart(4, '0')}.mp4`);
  const result = await runProviderVideo({
    provider: selected,
    model,
    input: selected === 'replicate'
      ? { image, prompt: motionPrompt, duration: durationSeconds }
      : { image_url: image, prompt: motionPrompt, duration: String(durationSeconds) },
    outputPath,
  });
  const probe = await probeVideo(outputPath);
  if (!probe.hasVideo) throw new AppError(502, 'motion_invalid_output', 'The provider returned a file with no video stream.');
  const count = await db('film_scenes').where({ film_id: filmId }).count('* as count').first();
  await db('film_scenes').where({ id: sceneId }).update({
    clip_path: outputPath,
    provider: selected,
    provider_job_id: null,
    provider_handle: JSON.stringify({ motion: { model, prompt: motionPrompt, url: result.url } }),
    updated_at: now(),
  }).catch(async () => {
    // provider_handle may be JSON text; fall back without it never losing the clip.
    await db('film_scenes').where({ id: sceneId }).update({ clip_path: outputPath, provider: selected, updated_at: now() });
  });
  await invalidateAssembly(filmId);
  return { sceneId, provider: selected, model, bytes: result.bytes, durationSeconds: probe.durationSeconds, scenes: number(count?.count) };
}
