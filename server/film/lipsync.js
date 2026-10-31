/**
 * Voice & lip-sync: re-sync a finished scene clip to the recorded voice take.
 *
 * Honesty rules encoded here:
 *  - the scene must already have a PROVIDER CLIP and a VOICE TAKE; we never
 *    invent either, and the API says which one is missing;
 *  - with no lip-sync credential the request fails 503 `lip_sync_unavailable`
 *    (the UI labels it "requires a provider key");
 *  - the provider transport is implemented against the public Replicate/fal
 *    prediction APIs but could not be exercised here (no account, no egress),
 *    so results are marked `verified: false` until a real key runs it.
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { db, now, number, addJob, json, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { ensureProjectDir, probeVideo } from '../media/utils.js';
import { ownedFilm } from './scenes.js';
import { invalidateAssembly } from './assembly.js';
import {
  providerStatus, requestedProvider, inlineVideo, inlineAudio, runProviderVideo,
} from './gatedProviders.js';

const FEATURE = 'lip_sync';

export function lipSyncStatus() {
  return {
    ...providerStatus({
      feature: FEATURE,
      envProvider: config.film.lipSyncProvider,
      models: {
        replicate: config.film.lipSyncReplicateModel,
        fal: config.film.lipSyncFalModel,
      },
    }),
    requirements: ['scene clip from the video provider', 'recorded voice take'],
  };
}

export async function sceneLipSync(userId, filmId, sceneId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  return {
    sceneId,
    hasClip: Boolean(scene.clip_path && fsSync.existsSync(scene.clip_path)),
    hasVoice: Boolean(scene.voice_path && fsSync.existsSync(scene.voice_path)),
    provider: scene.lipsync_provider || null,
    syncedAt: scene.lipsync_at || null,
    status: lipSyncStatus(),
  };
}

export async function queueLipSync(userId, filmId, sceneId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (!scene.clip_path || !fsSync.existsSync(scene.clip_path)) {
    throw new AppError(409, 'clip_required', 'Render this scene clip before syncing lips.');
  }
  if (!scene.voice_path || !fsSync.existsSync(scene.voice_path)) {
    throw new AppError(409, 'voice_take_required', 'Record a voice take for this scene before syncing lips.');
  }
  const status = lipSyncStatus();
  if (!status.configured) {
    throw new AppError(503, 'lip_sync_unavailable', 'No lip-sync provider is configured. Set FILM_LIPSYNC_PROVIDER and REPLICATE_API_TOKEN or FAL_API_KEY. Nothing was changed.');
  }
  const jobId = await addJob('film_lipsync', { filmId, userId, sceneId, provider: status.provider }, { maxAttempts: 1 });
  await db('film_projects').where({ id: filmId }).update({ updated_at: now() });
  return {
    queued: true,
    jobId,
    provider: status.provider,
    filmTitle: film.title,
    sceneOrdinal: number(scene.ordinal),
    verified: false,
    note: 'Queued against the configured provider. Live results are unverified in this environment.',
  };
}

export async function processLipSyncJob({ filmId, sceneId, provider }) {
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (!scene.clip_path || !scene.voice_path) throw new AppError(409, 'lip_sync_inputs_missing', 'Clip or voice take disappeared before the job ran.');
  const selected = requestedProvider(provider) || provider;
  const status = lipSyncStatus();
  if (!status.configured || !selected) {
    throw new AppError(503, 'lip_sync_unavailable', 'No lip-sync provider credential at run time. Nothing was changed.');
  }
  const dir = await ensureProjectDir(`film_${filmId}`);
  const outputPath = path.join(dir, 'scenes', `lipsync-${String(number(scene.ordinal)).padStart(4, '0')}.mp4`);
  const model = selected === 'replicate' ? config.film.lipSyncReplicateModel : config.film.lipSyncFalModel;
  const video = await inlineVideo(scene.clip_path);
  const audio = await inlineAudio(scene.voice_path);
  const result = await runProviderVideo({
    provider: selected,
    model,
    input: selected === 'replicate'
      ? { video, audio, sync_mode: 'cut_off' }
      : { video_url: video, audio_url: audio },
    outputPath,
  }).catch(async (error) => {
    await db('film_scenes').where({ id: sceneId }).update({ error: error.message, updated_at: now() });
    throw error;
  });
  const probe = await probeVideo(outputPath);
  if (!probe.hasVideo) throw new AppError(502, 'lipsync_invalid_output', 'The provider returned a file with no video stream.');
  await db('film_scenes').where({ id: sceneId }).update({
    clip_path: outputPath,
    lipsync_provider: selected,
    lipsync_at: now(),
    provider_handle: json({ ...parseJson(scene.provider_handle, {}), lipsync: { model, url: result.url } }),
    updated_at: now(),
  });
  await invalidateAssembly(filmId);
  return { sceneId, provider: selected, model, bytes: result.bytes, durationSeconds: probe.durationSeconds };
}
