/**
 * Film project + scene service layer.
 *
 * Every expensive operation reserves credits before starting, persists an
 * opaque provider handle, and enqueues a durable job. The worker can be killed
 * at any point: on restart it resumes polling the same provider prediction,
 * and any definitive failure refunds the reservation exactly once.
 *
 * Long-form production:
 *  - a project's scene plan is never truncated (see screenplay.planProject);
 *  - "generate all" starts at most `film.sceneConcurrency` scenes at once and
 *    leaves the rest as `planned`, dispatched as slots free up;
 *  - a run can be paused, resumed, cancelled, and failed scenes retried;
 *  - each scene clip is probed for a real video stream before it is accepted.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, now, newId, json, parseJson, number, addJob, notify } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { ensureProjectDir, projectDir, ffmpeg, probeVideo } from '../media/utils.js';
import {
  FILM_TYPES, FILM_GENRES, FILM_STYLES, FILM_ASPECTS, FILM_PLATFORMS,
  clampInt, filmLimits, planSceneCount, planProject, assertScenePlanFits, MAX_REQUESTABLE_SECONDS,
  distributeDurations, normaliseEditedScreenplay,
} from './screenplay.js';
import {
  estimateFilm, sceneCreditCost, assemblyCreditCost,
  reserveCredits, refundCredits, getBalance,
} from './credits.js';
import {
  startVideoGeneration, pollVideoGeneration, downloadProviderVideo,
  requireVideoProvider, resolveVideoProvider, cancelVideoGeneration, providerStatus,
} from './videoProviders.js';
import { invalidateAssembly, assembleFilm, assemblyPreflight } from './assembly.js';
import { propClause, scenePropsForPrompt } from './propPrompt.js';
import { resolveEnabledVideoProvider } from './providerGuard.js';
import {
  SHOT_SIZES, CAMERA_ANGLES, CAMERA_MOVEMENTS, LENSES, LIGHTING, COLOR_GRADES,
  describeShot,
} from './cinematography.js';
import { listLocations } from './locations.js';

const SCENE_STATUSES = ['draft', 'planned', 'queued', 'processing', 'ready', 'failed', 'cancelled'];
const ACTIVE_SCENE_STATUSES = ['queued', 'processing'];
const PENDING_SCENE_STATUSES = ['draft', 'planned', 'failed', 'cancelled', 'paused'];

export const createFilmSchema = z.object({
  type: z.enum(FILM_TYPES).default('short_drama'),
  title: z.string().trim().min(2).max(220),
  logline: z.string().max(1000).optional().default(''),
  genre: z.string().max(60).optional().default('drama'),
  language: z.string().max(12).optional().default('en'),
  style: z.string().max(60).optional().default('cinematic'),
  aspectRatio: z.enum(FILM_ASPECTS).optional().default('9:16'),
  targetPlatform: z.string().max(40).optional().default('tiktok'),
  targetDurationSeconds: z.number().int().min(config.film.minProjectSeconds).max(MAX_REQUESTABLE_SECONDS).optional().default(60),
  storyBible: z.record(z.any()).optional().default({}),
  seriesId: z.string().max(48).optional().nullable(),
  seasonNumber: z.number().int().min(0).max(100).optional().default(0),
  episodeNumber: z.number().int().min(0).max(1000).optional().default(0),
  voice: z.string().max(60).optional().default('nova'),
  sceneProvider: z.string().max(60).optional().nullable(),
});

export const patchFilmSchema = createFilmSchema.partial().omit({ type: true, seriesId: true }).extend({
  status: z.string().max(30).optional(),
  subtitles: z.boolean().optional(),
  sceneProvider: z.string().max(60).optional().nullable(),
});

const emptyOr = (values) => z.enum(['', ...values]).optional();
export const patchSceneSchema = z.object({
  heading: z.string().max(220).optional(),
  location: z.string().max(220).optional(),
  location_id: z.string().max(48).optional().nullable(),
  time_of_day: z.string().max(60).optional(),
  description: z.string().max(2000).optional(),
  dialogue: z.array(z.object({ character: z.string().min(1).max(120), line: z.string().min(1).max(1000), emotion: z.string().max(80).optional() })).max(20).optional(),
  camera_movement: z.string().max(120).optional(),
  visual_prompt: z.string().max(2000).optional(),
  duration_seconds: z.number().int().min(config.film.minSceneSeconds).max(config.film.maxSceneSeconds).optional(),
  cast: z.array(z.string().min(1).max(120)).max(20).optional(),
  // Cinematography: closed vocabularies, so an invalid control is rejected here
  // instead of silently producing a prompt the provider ignores.
  shot_size: emptyOr(SHOT_SIZES),
  camera_angle: emptyOr(CAMERA_ANGLES),
  lens: emptyOr(LENSES),
  lighting: emptyOr(LIGHTING),
  color_grade: emptyOr(COLOR_GRADES),
  composition: z.string().max(400).optional(),
  // Timeline / edit decisions. They change the render, so they are validated.
  transition: z.enum(['cut', 'fade_black', 'dip_white']).optional(),
  trim_start: z.number().min(0).max(30).optional(),
  trim_end: z.number().min(0).max(30).optional(),
  sfx: z.array(z.object({
    assetId: z.string().min(1).max(60),
    atSeconds: z.number().min(0).max(120).optional().default(0),
    gain: z.number().min(0).max(2).optional().default(1),
  })).max(8).optional(),
});

// --- views -----------------------------------------------------------------
export function filmView(row, summary = {}) {
  if (!row) return null;
  return {
    id: row.id,
    seriesId: row.series_id || null,
    seasonNumber: number(row.season_number),
    episodeNumber: number(row.episode_number),
    type: row.type,
    title: row.title,
    logline: row.logline,
    genre: row.genre,
    language: row.language,
    style: row.style,
    aspectRatio: row.aspect_ratio,
    targetPlatform: row.target_platform,
    targetDurationSeconds: number(row.target_duration_seconds),
    storyBible: parseJson(row.story_bible, {}),
    screenplay: parseJson(row.screenplay, {}),
    hasReferenceImage: Boolean(row.reference_image_path),
    hasMusic: Boolean(row.music_path),
    status: row.status,
    stage: row.stage,
    progress: number(row.progress),
    detail: row.detail || null,
    runState: row.run_state || 'idle',
    sceneProvider: row.scene_provider || null,
    creditsEstimated: number(row.credits_estimated),
    creditsSpent: number(row.credits_spent),
    hasVideo: Boolean(row.final_video_path),
    hasThumbnail: Boolean(row.thumbnail_path),
    hasPoster: Boolean(row.poster_path && fs.existsSync(row.poster_path)),
    hasCaptions: Boolean(row.caption_path),
    durationSeconds: number(row.duration_seconds),
    error: row.error || null,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    sceneCount: number(summary.sceneCount, 0),
    readyScenes: number(summary.readyScenes, 0),
    failedScenes: number(summary.failedScenes, 0),
    queuedScenes: number(summary.queuedScenes, 0),
    plannedScenes: number(summary.plannedScenes, 0),
    cancelledScenes: number(summary.cancelledScenes, 0),
    etaSeconds: summary.etaSeconds ?? null,
  };
}

export function sceneView(row) {
  if (!row) return null;
  return {
    id: row.id,
    filmId: row.film_id,
    ordinal: number(row.ordinal),
    heading: row.heading,
    location: row.location,
    timeOfDay: row.time_of_day,
    description: row.description,
    dialogue: parseJson(row.dialogue, []),
    cameraMovement: row.camera_movement,
    shotSize: row.shot_size || '',
    cameraAngle: row.camera_angle || '',
    lens: row.lens || '',
    lighting: row.lighting || '',
    colorGrade: row.color_grade || '',
    composition: row.composition || '',
    locationId: row.location_id || null,
    visualPrompt: row.visual_prompt,
    durationSeconds: number(row.duration_seconds),
    cast: parseJson(row.cast, []),
    sfx: parseJson(row.sfx, []),
    status: row.status,
    stage: row.stage,
    progress: number(row.progress),
    detail: row.detail || null,
    hasClip: Boolean(row.clip_path && fs.existsSync(row.clip_path)),
    hasPoster: Boolean(row.poster_path && fs.existsSync(row.poster_path)),
    hasStoryboard: Boolean(row.storyboard_path && fs.existsSync(row.storyboard_path)),
    storyboardProvider: row.storyboard_provider || null,
    hasVoiceTake: Boolean(row.voice_path && fs.existsSync(row.voice_path)),
    voiceProvider: row.voice_provider || null,
    voiceDurationSeconds: Number(row.voice_duration) || 0,
    transition: row.transition || 'cut',
    trimStart: Number(row.trim_start) || 0,
    trimEnd: Number(row.trim_end) || 0,
    speedFactor: Number(row.speed_factor) || 1,
    vfxPreset: row.vfx_preset || 'none',
    overlay: parseJson(row.overlay_json, null),
    lipSyncProvider: row.lipsync_provider || null,
    lipSyncAt: row.lipsync_at || null,
    provider: row.provider || null,
    providerJobId: row.provider_job_id || null,
    creditsCost: number(row.credits_cost),
    attempts: number(row.attempts),
    cancelRequested: number(row.cancel_requested) === 1,
    error: row.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function characterView(row) {
  if (!row) return null;
  return {
    id: row.id, filmId: row.film_id || null, seriesId: row.series_id || null,
    name: row.name, role: row.role, description: row.description,
    appearancePrompt: row.appearance_prompt, voicePreset: row.voice_preset,
    voiceProvider: row.voice_provider || null,
    wardrobe: row.wardrobe || '',
    expressions: parseJson(row.expressions, []),
    relationships: parseJson(row.relationships, []),
    ageRange: row.age_range || '',
    isLibrary: number(row.is_library) === 1,
    hasReferenceImage: Boolean(row.reference_image_path && fs.existsSync(row.reference_image_path)),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// --- ownership -------------------------------------------------------------
export async function ownedFilm(userId, filmId, role = 'user') {
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) throw new AppError(404, 'film_not_found', 'Film project not found.');
  if (film.user_id !== userId && role !== 'admin') throw new AppError(403, 'forbidden', 'You do not have access to this project.');
  return film;
}

async function sceneSummary(filmIds) {
  if (!filmIds.length) return new Map();
  const rows = await db('film_scenes').whereIn('film_id', filmIds).select('film_id', 'status');
  const map = new Map(filmIds.map((id) => [id, {
    sceneCount: 0, readyScenes: 0, failedScenes: 0, queuedScenes: 0, plannedScenes: 0, cancelledScenes: 0,
  }]));
  for (const row of rows) {
    const item = map.get(row.film_id);
    if (!item) continue;
    item.sceneCount += 1;
    if (row.status === 'ready') item.readyScenes += 1;
    else if (row.status === 'failed') item.failedScenes += 1;
    else if (row.status === 'cancelled') item.cancelledScenes += 1;
    else if (row.status === 'planned') item.plannedScenes += 1;
    else if (row.status === 'queued' || row.status === 'processing') item.queuedScenes += 1;
  }
  return map;
}

function assertSceneQuota(count) {
  if (count > config.film.maxScenes) {
    throw new AppError(400, 'too_many_scenes',
      `A project cannot have more than ${config.film.maxScenes} scenes. Raise FILM_MAX_SCENES and FILM_MAX_PROJECT_SECONDS together to support a longer film.`,
      { count, maxScenes: config.film.maxScenes });
  }
}

/** Scene provider for a project: explicit override, else the server default. */
export function filmSceneProvider(film) {
  return film?.scene_provider || config.film.videoProvider;
}

/** Validate that a requested provider is real and configured (no fallback). */
export function validateSceneProvider(value) {
  if (value === null || value === undefined || value === '') return null;
  return resolveVideoProvider(String(value));
}

// --- project CRUD ----------------------------------------------------------
export async function createFilm(userId, input) {
  const data = createFilmSchema.parse(input);
  const plan = assertScenePlanFits(data.targetDurationSeconds);
  const sceneProvider = validateSceneProvider(data.sceneProvider);
  const id = newId('flm_');
  const timestamp = now();
  await db('film_projects').insert({
    id, user_id: userId,
    series_id: data.seriesId || null,
    season_number: data.seasonNumber,
    episode_number: data.episodeNumber,
    type: data.type, title: data.title, logline: data.logline,
    genre: data.genre, language: data.language, style: data.style,
    aspect_ratio: data.aspectRatio, target_platform: data.targetPlatform,
    target_duration_seconds: data.targetDurationSeconds,
    story_bible: json(data.storyBible), screenplay: json({}),
    status: 'draft', stage: 'draft', progress: 0,
    metadata: json({ voice: data.voice, subtitles: true }),
    run_state: 'idle', scene_provider: sceneProvider,
    credits_estimated: estimateFilm([], { assembly: false }).total,
    created_at: timestamp, updated_at: timestamp,
  });
  await ensureProjectDir(`film_${id}`);
  const row = await db('film_projects').where({ id }).first();
  return { ...filmView(row), plan };
}

export async function listFilms(userId, { type, seriesId, status, limit = 50, offset = 0 } = {}) {
  const query = db('film_projects').where({ user_id: userId });
  if (type) query.where({ type });
  if (seriesId) query.where({ series_id: seriesId });
  if (status) query.where({ status });
  const rows = await query.orderBy('updated_at', 'desc').limit(Math.min(100, Math.max(1, limit))).offset(Math.max(0, offset));
  const summaries = await sceneSummary(rows.map((r) => r.id));
  return rows.map((row) => filmView(row, summaries.get(row.id)));
}

export async function updateFilm(userId, filmId, patch, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const data = patchFilmSchema.parse(patch);
  const updates = { updated_at: now() };
  const map = {
    title: 'title', logline: 'logline', genre: 'genre', language: 'language', style: 'style',
    aspectRatio: 'aspect_ratio', targetPlatform: 'target_platform',
    targetDurationSeconds: 'target_duration_seconds', status: 'status',
  };
  for (const [key, column] of Object.entries(map)) {
    if (data[key] !== undefined) updates[column] = data[key];
  }
  if (data.targetDurationSeconds !== undefined) assertScenePlanFits(data.targetDurationSeconds);
  if (data.sceneProvider !== undefined) updates.scene_provider = validateSceneProvider(data.sceneProvider);
  if (data.storyBible) updates.story_bible = json(data.storyBible);
  if (data.voice !== undefined || data.subtitles !== undefined) {
    updates.metadata = json({ ...parseJson(film.metadata, {}), ...(data.voice !== undefined ? { voice: data.voice } : {}), ...(data.subtitles !== undefined ? { subtitles: data.subtitles } : {}) });
  }
  await db('film_projects').where({ id: filmId }).update(updates);
  return filmView(await db('film_projects').where({ id: filmId }).first(), (await sceneSummary([filmId])).get(filmId));
}

export async function deleteFilm(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const jobs = await db('jobs').where({ type: 'film_generate_scene' }).where('payload', 'like', `%${filmId}%`).select('id');
  await db('jobs').whereIn('id', jobs.map((job) => job.id)).update({ status: 'cancelled', completed_at: now(), locked_at: null, updated_at: now() }).catch(() => {});
  await db.transaction(async (trx) => {
    await trx('film_scenes').where({ film_id: filmId }).del();
    await trx('film_characters').where({ film_id: filmId }).del();
    await trx('film_episodes').where({ film_id: filmId }).update({ film_id: null, status: 'draft', updated_at: now() });
    await trx('film_projects').where({ id: filmId }).del();
  });
  const dir = projectDir(`film_${filmId}`);
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return { deleted: true };
}

// --- screenplay / scenes ---------------------------------------------------
function castFromScene(scene) {
  const names = new Set(
    (Array.isArray(scene.cast) ? scene.cast : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  );
  for (const line of Array.isArray(scene.dialogue) ? scene.dialogue : []) {
    if (line?.character) names.add(String(line.character).trim());
  }
  return [...names];
}

export async function saveScreenplay(userId, filmId, screenplay, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const clean = normaliseEditedScreenplay(screenplay);
  assertSceneQuota(clean.scenes.length);
  // Match the requested runtime instead of defaulting every clip to the maximum.
  const timed = distributeDurations(clean.scenes, film.target_duration_seconds || clean.estimatedSeconds);
  const timestamp = now();
  await db.transaction(async (trx) => {
    await trx('film_scenes').where({ film_id: filmId }).del();
    for (const scene of timed) {
      await trx('film_scenes').insert({
        id: newId('scn_'), film_id: filmId, ordinal: scene.ordinal,
        heading: scene.heading, location: scene.location, time_of_day: scene.time_of_day,
        description: scene.description, dialogue: json(scene.dialogue),
        camera_movement: scene.camera_movement, visual_prompt: scene.visual_prompt,
        location_id: scene.location_id || null,
        shot_size: scene.shot_size || '', camera_angle: scene.camera_angle || '',
        lens: scene.lens || '', lighting: scene.lighting || '',
        color_grade: scene.color_grade || '', composition: scene.composition || '',
        duration_seconds: scene.duration_seconds,
        cast: json(castFromScene(scene)),
        status: 'draft', stage: 'draft', progress: 0,
        created_at: timestamp, updated_at: timestamp,
      });
    }
    const estimate = estimateFilm(timed);
    // Never silently replace the user's own title. The generated title is
    // surfaced in the UI as a suggestion the creator can explicitly apply.
    await trx('film_projects').where({ id: filmId }).update({
      logline: film.logline || clean.logline,
      story_bible: json(clean.story_bible),
      screenplay: json({ ...clean, scenes: timed }),
      credits_estimated: estimate.total,
      stage: 'screenplay', progress: 0, error: null, run_state: 'idle', updated_at: timestamp,
    });
  });
  await invalidateAssembly(filmId);
  // Upsert recurring cast by name so continuity survives to new episodes.
  for (const character of clean.characters) {
    const existing = await db('film_characters')
      .where({ user_id: userId, series_id: film.series_id || null, film_id: filmId })
      .whereRaw('LOWER(name) = ?', [String(character.name).toLowerCase()]).first();
    if (existing) {
      await db('film_characters').where({ id: existing.id }).update({
        role: character.role, description: character.description,
        appearance_prompt: character.appearance_prompt, voice_preset: character.voice_preset,
        updated_at: now(),
      });
    } else {
      await db('film_characters').insert({
        id: newId('chr_'), user_id: userId, film_id: filmId, series_id: film.series_id || null,
        name: character.name, role: character.role, description: character.description,
        appearance_prompt: character.appearance_prompt, voice_preset: character.voice_preset,
        metadata: json({}), created_at: now(), updated_at: now(),
      });
    }
  }
  return filmDetail(userId, filmId, role);
}

export async function listScenes(userId, filmId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const rows = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  return rows.map(sceneView);
}

export async function updateScene(userId, filmId, sceneId, patch, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  const data = patchSceneSchema.parse(patch);
  const updates = { updated_at: now() };
  for (const key of [
    'heading', 'location', 'time_of_day', 'description', 'camera_movement', 'visual_prompt',
    'duration_seconds', 'shot_size', 'camera_angle', 'lens', 'lighting', 'color_grade', 'composition',
    'transition', 'trim_start', 'trim_end',
  ]) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  if (data.location_id !== undefined) {
    if (data.location_id) {
      const location = await db('film_locations').where({ id: data.location_id, user_id: userId }).first();
      if (!location) throw new AppError(400, 'location_unknown', 'Save this location to your library first, then link it to the scene.');
      updates.location_id = location.id;
      // Linking a location also names it on the slate unless the user typed a
      // different on-screen location for this scene.
      if (!data.location) updates.location = data.location || location.name;
    } else {
      updates.location_id = null;
    }
  }
  if (data.dialogue) updates.dialogue = json(data.dialogue);
  if (data.cast) updates.cast = json(data.cast);
  if (data.sfx) {
    const assets = await sfxAssetList(filmId);
    const known = new Set(assets.map((asset) => asset.id));
    const unknown = data.sfx.filter((cue) => !known.has(cue.assetId));
    if (unknown.length) throw new AppError(400, 'sfx_asset_unknown', 'Attach sound effects that were uploaded to this project first.');
    updates.sfx = json(data.sfx);
  }
  await db('film_scenes').where({ id: sceneId }).update(updates);
  const fresh = await db('film_scenes').where({ id: sceneId }).first();
  const stored = parseJson((await db('film_projects').where({ id: filmId }).first())?.screenplay, {});
  if (Array.isArray(stored.scenes)) {
    const index = number(fresh.ordinal) - 1;
    if (stored.scenes[index]) Object.assign(stored.scenes[index], sceneViewToScreenplayScene(fresh));
    await db('film_projects').where({ id: filmId }).update({ screenplay: json(stored), updated_at: now() });
  }
  await invalidateAssembly(filmId);
  return sceneView(fresh);
}

function sceneViewToScreenplayScene(row) {
  return {
    heading: row.heading, location: row.location, location_id: row.location_id || null,
    time_of_day: row.time_of_day,
    description: row.description, dialogue: parseJson(row.dialogue, []),
    camera_movement: row.camera_movement, visual_prompt: row.visual_prompt,
    shot_size: row.shot_size || '', camera_angle: row.camera_angle || '',
    lens: row.lens || '', lighting: row.lighting || '',
    color_grade: row.color_grade || '', composition: row.composition || '',
    duration_seconds: number(row.duration_seconds),
    cast: parseJson(row.cast, []),
  };
}

export async function addScene(userId, filmId, payload = {}, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const count = number((await db('film_scenes').where({ film_id: filmId }).count('* as count').first())?.count);
  assertSceneQuota(count + 1);
  const data = patchSceneSchema.parse(payload);
  const id = newId('scn_');
  await db('film_scenes').insert({
    id, film_id: filmId, ordinal: count + 1,
    heading: data.heading || `SCENE ${count + 1}`, location: data.location || '',
    time_of_day: data.time_of_day || '', description: data.description || '',
    dialogue: json(data.dialogue || []), camera_movement: data.camera_movement || '',
    visual_prompt: data.visual_prompt || '', duration_seconds: data.duration_seconds || config.film.maxSceneSeconds,
    location_id: data.location_id || null,
    shot_size: data.shot_size || '', camera_angle: data.camera_angle || '',
    lens: data.lens || '', lighting: data.lighting || '',
    color_grade: data.color_grade || '', composition: data.composition || '',
    cast: json(castFromScene(data)), sfx: json([]),
    status: 'draft', stage: 'draft', progress: 0,
    created_at: now(), updated_at: now(),
  });
  await invalidateAssembly(filmId);
  return sceneView(await db('film_scenes').where({ id }).first());
}

/**
 * Split a scene in two at a point inside its duration.
 *
 * Both halves keep the same clip and direction; the first keeps the head of the
 * clip, the second starts later (trim_start) and gets the remaining time. This is
 * the editing operation behind cutting on action, and it is reversible by
 * deleting either half.
 */
export async function splitScene(userId, filmId, sceneId, atSeconds, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  const duration = number(scene.duration_seconds);
  const split = Number(atSeconds);
  const min = config.film.minSceneSeconds;
  if (!Number.isFinite(split) || split < min || duration - split < min) {
    throw new AppError(400, 'invalid_split', `Split point must leave at least ${min}s on each side of a ${duration}s scene.`);
  }
  const ordinal = number(scene.ordinal);
  const timestamp = now();
  const secondSeconds = duration - split;
  // Make room for the new ordinal without violating the (film_id, ordinal)
  // unique constraint: shifting in one UPDATE would collide mid-statement.
  const later = await db('film_scenes').where({ film_id: filmId }).where('ordinal', '>', ordinal)
    .orderBy('ordinal', 'desc').select('id', 'ordinal');
  for (const row of later) {
    await db('film_scenes').where({ id: row.id }).update({ ordinal: number(row.ordinal) + 1 });
  }
  const newIdValue = newId('scn_');
  await db('film_scenes').insert({
    ...scene,
    id: newIdValue,
    ordinal: ordinal + 1,
    duration_seconds: secondSeconds,
    trim_start: number(scene.trim_start) + split,
    trim_end: number(scene.trim_end),
    dialogue: json([]),
    voice_path: null, voice_provider: null, voice_duration: 0, voice_at: null,
    status: scene.clip_path ? 'ready' : scene.status,
    stage: scene.clip_path ? 'ready' : scene.stage,
    progress: scene.clip_path ? 100 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
  await db('film_scenes').where({ id: sceneId }).update({
    duration_seconds: split,
    trim_end: number(scene.trim_end) + secondSeconds,
    updated_at: timestamp,
  });
  // Trigger rows carry an ordinal; the new half must not fire old SFX cues.
  await db('film_scenes').where({ id: newIdValue }).update({ sfx: json([]) });
  await invalidateAssembly(filmId);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  return {
    first: sceneView(scenes.find((row) => row.id === sceneId)),
    second: sceneView(scenes.find((row) => row.id === newIdValue)),
    scenes: scenes.length,
  };
}

export async function deleteScene(userId, filmId, sceneId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  await db.transaction(async (trx) => {
    await trx('film_scenes').where({ id: sceneId }).del();
    await reindexScenes(trx, filmId);
  });
  await invalidateAssembly(filmId);
  return { deleted: true };
}

export async function reorderScenes(userId, filmId, orderedIds, role = 'user') {
  await ownedFilm(userId, filmId, role);
  if (!Array.isArray(orderedIds) || !orderedIds.length) throw new AppError(400, 'invalid_order', 'Provide an array of scene ids.');
  const scenes = await db('film_scenes').where({ film_id: filmId });
  const known = new Set(scenes.map((s) => s.id));
  if (orderedIds.length !== scenes.length || new Set(orderedIds).size !== scenes.length || orderedIds.some((id) => !known.has(id))) {
    throw new AppError(400, 'invalid_order', 'Scene order must contain every scene id exactly once.');
  }
  await db.transaction(async (trx) => {
    // Two-phase update avoids the unique (film_id, ordinal) constraint.
    await trx('film_scenes').where({ film_id: filmId }).update({ ordinal: db.raw('ordinal + ?', [100000]) });
    for (let i = 0; i < orderedIds.length; i += 1) {
      await trx('film_scenes').where({ id: orderedIds[i] }).update({ ordinal: i + 1, updated_at: now() });
    }
  });
  await invalidateAssembly(filmId);
  return listScenes(userId, filmId, role);
}

async function reindexScenes(trx, filmId) {
  const rows = await trx('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc').select('id');
  await trx('film_scenes').where({ film_id: filmId }).update({ ordinal: db.raw('ordinal + ?', [100000]) });
  for (let i = 0; i < rows.length; i += 1) await trx('film_scenes').where({ id: rows[i].id }).update({ ordinal: i + 1 });
}

// --- sound effects ---------------------------------------------------------
export async function sfxAssetList(filmId) {
  const film = await db('film_projects').where({ id: filmId }).first();
  const metadata = parseJson(film?.metadata, {});
  return Array.isArray(metadata.sfxAssets) ? metadata.sfxAssets.filter((asset) => asset?.path && fs.existsSync(asset.path)) : [];
}

export async function addSfxAsset(userId, filmId, asset, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const metadata = parseJson(film.metadata, {});
  const list = Array.isArray(metadata.sfxAssets) ? metadata.sfxAssets : [];
  const record = {
    id: `sfx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(asset.name || 'Sound effect').slice(0, 120),
    path: asset.path,
    durationSeconds: Number(asset.durationSeconds) || 0,
    bytes: Number(asset.bytes) || 0,
    createdAt: now(),
  };
  await db('film_projects').where({ id: filmId }).update({
    metadata: json({ ...metadata, sfxAssets: [...list, record].slice(-100) }), updated_at: now(),
  });
  return record;
}

export async function deleteSfxAsset(userId, filmId, assetId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const metadata = parseJson(film.metadata, {});
  const list = Array.isArray(metadata.sfxAssets) ? metadata.sfxAssets : [];
  const asset = list.find((item) => item.id === assetId);
  if (!asset) throw new AppError(404, 'sfx_asset_not_found', 'Sound effect not found.');
  await db('film_projects').where({ id: filmId }).update({
    metadata: json({ ...metadata, sfxAssets: list.filter((item) => item.id !== assetId) }), updated_at: now(),
  });
  const scenes = await db('film_scenes').where({ film_id: filmId });
  for (const scene of scenes) {
    const cues = parseJson(scene.sfx, []).filter((cue) => cue.assetId !== assetId);
    if (cues.length !== parseJson(scene.sfx, []).length) await db('film_scenes').where({ id: scene.id }).update({ sfx: json(cues) });
  }
  await fsp.rm(asset.path, { force: true }).catch(() => {});
  await invalidateAssembly(filmId);
  return { deleted: true };
}

// --- characters ------------------------------------------------------------
export async function listCharacters(userId, { filmId, seriesId } = {}) {
  const query = db('film_characters').where({ user_id: userId });
  if (filmId) query.where({ film_id: filmId });
  if (seriesId) query.where({ series_id: seriesId });
  const rows = await query.orderBy('created_at', 'asc');
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.series_id || ''}:${String(row.name).toLowerCase()}`;
    if (!seen.has(key) || row.film_id === filmId) seen.set(key, row);
  }
  return [...seen.values()].map(characterView);
}

export const characterSchema = z.object({
  id: z.string().max(48).optional(),
  name: z.string().trim().min(1).max(120),
  role: z.string().max(60).optional().default('supporting'),
  description: z.string().max(1000).optional().default(''),
  appearancePrompt: z.string().max(1500).optional().default(''),
  voicePreset: z.string().max(60).optional().default('nova'),
  voiceProvider: z.string().max(60).optional().nullable(),
  // Character depth: wardrobe, named expressions, relationships and reuse.
  wardrobe: z.string().max(600).optional().default(''),
  expressions: z.array(z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(300).optional().default(''),
  })).max(12).optional().default([]),
  relationships: z.array(z.object({
    with: z.string().min(1).max(120),
    kind: z.string().max(60).optional().default(''),
  })).max(12).optional().default([]),
  ageRange: z.string().max(40).optional().default(''),
  isLibrary: z.boolean().optional().default(false),
  filmId: z.string().max(48).optional().nullable(),
  seriesId: z.string().max(48).optional().nullable(),
});

export async function upsertCharacter(userId, payload) {
  const data = characterSchema.parse(payload);
  const existing = data.id
    ? await db('film_characters').where({ id: data.id, user_id: userId }).first()
    : await db('film_characters').where({ user_id: userId, film_id: data.filmId || null, series_id: data.seriesId || null })
      .whereRaw('LOWER(name) = ?', [data.name.toLowerCase()]).first();
  if (existing) {
    await db('film_characters').where({ id: existing.id }).update({
      name: data.name, role: data.role, description: data.description,
      appearance_prompt: data.appearancePrompt, voice_preset: data.voicePreset,
      voice_provider: data.voiceProvider,
      wardrobe: data.wardrobe || '', expressions: json(data.expressions || []),
      relationships: json(data.relationships || []), age_range: data.ageRange || '',
      is_library: data.isLibrary ? 1 : 0,
      updated_at: now(),
    });
    return characterView(await db('film_characters').where({ id: existing.id }).first());
  }
  const id = newId('chr_');
  await db('film_characters').insert({
    id, user_id: userId, film_id: data.filmId || null, series_id: data.seriesId || null,
    name: data.name, role: data.role, description: data.description,
    appearance_prompt: data.appearancePrompt, voice_preset: data.voicePreset,
    voice_provider: data.voiceProvider || null, metadata: json({}),
    wardrobe: data.wardrobe || '', expressions: json(data.expressions || []),
    relationships: json(data.relationships || []), age_range: data.ageRange || '',
    is_library: data.isLibrary ? 1 : 0,
    created_at: now(), updated_at: now(),
  });
  return characterView(await db('film_characters').where({ id }).first());
}

/** Copy a character (or a library entry) into another project. */
export async function cloneCharacter(userId, characterId, filmId, role = 'user') {
  const source = await db('film_characters').where({ id: characterId, user_id: userId }).first();
  if (!source) throw new AppError(404, 'character_not_found', 'Character not found.');
  if (filmId) await ownedFilm(userId, filmId, role);
  const clash = await db('film_characters').where({ user_id: userId, film_id: filmId || null })
    .whereRaw('LOWER(name) = ?', [String(source.name).toLowerCase()]).first();
  if (clash) throw new AppError(409, 'character_exists', `${source.name} is already cast in this project.`);
  const id = newId('chr_');
  await db('film_characters').insert({
    id, user_id: userId, film_id: filmId || null, series_id: null,
    name: source.name, role: source.role, description: source.description,
    appearance_prompt: source.appearance_prompt,
    voice_preset: source.voice_preset, voice_provider: source.voice_provider,
    wardrobe: source.wardrobe, expressions: source.expressions,
    relationships: source.relationships, age_range: source.age_range,
    is_library: 0, metadata: json({ clonedFrom: source.id }),
    created_at: now(), updated_at: now(),
  });
  return characterView(await db('film_characters').where({ id }).first());
}

/** User-level cast library: characters marked reusable across projects. */
export async function castLibrary(userId) {
  const rows = await db('film_characters').where({ user_id: userId, is_library: 1 }).orderBy('name', 'asc');
  return rows.map(characterView);
}

export async function deleteCharacter(userId, characterId) {
  const character = await db('film_characters').where({ id: characterId, user_id: userId }).first();
  if (!character) throw new AppError(404, 'character_not_found', 'Character not found.');
  await db('film_characters').where({ id: characterId }).del();
  return { deleted: true };
}

// --- prompts & continuity --------------------------------------------------
function sceneCast(film, scene, characters) {
  const declared = parseJson(scene.cast, []).map((name) => String(name).toLowerCase());
  const text = `${scene.visual_prompt || ''} ${scene.description || ''} ${scene.heading || ''}`.toLowerCase();
  const dialogueNames = parseJson(scene.dialogue, []).map((line) => String(line.character || '').toLowerCase());
  return characters.filter((character) => {
    const name = String(character.name || '').toLowerCase();
    return declared.includes(name) || dialogueNames.includes(name) || (name && text.includes(name));
  });
}

/**
 * Build the provider prompt with explicit continuity anchors.
 *
 * Faces, wardrobe, hairstyles, locations and the story bible are repeated in
 * every scene so separate predictions stay visually consistent; image-to-video
 * models additionally receive the strongest available reference image.
 */
export function scenePrompt(film, scene, characters = [], location = null, props = []) {
  const cast = sceneCast(film, scene, characters);
  const bible = parseJson(film.story_bible, {});
  const metadata = parseJson(film.metadata, {});
  const dialogue = parseJson(scene.dialogue, []).map((line) => `${line.character}: ${line.line}`).join(' | ');
  const castBlock = cast.length
    ? `CONSISTENT CAST — identical face, hair, age and wardrobe in this shot: ${cast.map((character) => `${character.name} (${character.appearance_prompt || character.description || character.role}${character.wardrobe ? `; wardrobe: ${character.wardrobe}` : ''}${character.age_range ? `; age: ${character.age_range}` : ''})`).join('; ')}.`
    : '';
  // The saved location record wins over prose: it is the shared production
  // design every scene in this set reuses.
  const setting = location
    ? `${location.name}${location.description ? ` — ${location.description}` : ''}`
    : (scene.location || 'unspecified');
  const weather = location?.weather ? `; weather: ${location.weather}` : '';
  const shot = describeShot(scene);
  return [
    `${film.style} ${film.genre} film scene. ${scene.visual_prompt || scene.description || scene.heading}`,
    `Setting: ${setting}; time of day: ${scene.time_of_day || location?.time_of_day || 'unspecified'}${weather}.`,
    castBlock,
    shot ? `Cinematography: ${shot}.` : 'Cinematography: cinematic, natural.',
    location?.palette ? `Production palette: ${location.palette}.` : '',
    propClause(props),
    dialogue ? `Dialogue context (do not render text): ${dialogue}.` : '',
    bible.world ? `World: ${bible.world}.` : '',
    bible.continuity_notes ? `Continuity: ${bible.continuity_notes}.` : '',
    metadata.continuity ? `Production continuity: ${metadata.continuity}.` : '',
    metadata.brand
      ? `Brand campaign: ${metadata.brand.name}${metadata.brand.product ? ` — ${metadata.brand.product}` : ''}${metadata.brand.tagline ? `, tagline "${metadata.brand.tagline}"` : ''}${metadata.brand.colors?.length ? `, brand colours ${metadata.brand.colors.join('/')}` : ''}.`
      : '',
    `Aspect ratio ${film.aspect_ratio}, ${film.language} language production, ${film.style} visual style, no on-screen text, no subtitles, no watermark, no logos, high production value.`,
  ].filter(Boolean).join(' ').slice(0, 4000);
}

function referenceImageFor(film, scene, characters = []) {
  const exists = (value) => value && fs.existsSync(value);
  if (exists(film.reference_image_path)) return film.reference_image_path;
  const metadata = parseJson(film.metadata, {});
  if (exists(metadata.characterSheet)) return metadata.characterSheet;
  const cast = sceneCast(film, scene, characters);
  const preferred = cast.find((character) => exists(character.reference_image_path))
    || characters.find((character) => exists(character.reference_image_path));
  return preferred?.reference_image_path || null;
}

// --- generation ------------------------------------------------------------
async function characterRowsFor(userId, filmId, film) {
  return db('film_characters')
    .where({ user_id: userId })
    .where((q) => q.where({ film_id: filmId }).orWhere({ series_id: film.series_id || '' }));
}

async function cancelSceneJobRows(sceneId, attempt) {
  await db('jobs').where({ dedupe_key: `film_scene_job:${sceneId}:${attempt}` })
    .whereIn('status', ['queued', 'running'])
    .update({ status: 'cancelled', completed_at: now(), locked_at: null, locked_by: null, updated_at: now() })
    .catch(() => {});
}

/** Refund one scene reservation exactly once for its attempt number. */
async function refundSceneAttempt(userId, scene, reason) {
  await refundCredits(userId, number(scene.credits_cost), {
    idempotencyKey: `film_scene_refund:${scene.id}:${number(scene.attempts)}`,
    referenceType: 'film_scene', referenceId: scene.id,
    metadata: { sceneId: scene.id, attempt: number(scene.attempts), reason },
  });
}

/**
 * Reserve credits, start a REAL provider prediction, persist its handle and
 * enqueue the polling job. Regenerating a scene never touches other scenes.
 */
export async function requestSceneGeneration(userId, filmId, sceneId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (ACTIVE_SCENE_STATUSES.includes(scene.status)) {
    throw new AppError(409, 'scene_busy', 'This scene is already generating. Wait for it to finish or cancel it.');
  }
  const provider = await resolveEnabledVideoProvider(filmSceneProvider(film));
  if (film.run_state !== 'running') {
    await db('film_projects').where({ id: filmId }).update({ run_state: 'running', run_started_at: film.run_started_at || now(), error: null, updated_at: now() });
  }
  await startSceneGeneration({ film, userId, scene, provider });
  await refreshFilmProgress(filmId);
  return sceneView(await db('film_scenes').where({ id: sceneId }).first());
}

/**
 * Claim + start one scene job. `alreadyClaimed` is used by the dispatcher which
 * atomically moved the row from planned → processing.
 */
async function startSceneGeneration({ film, userId, scene, provider, alreadyClaimed = false }) {
  const sceneId = scene.id;
  const cost = sceneCreditCost(scene);
  const attempt = number(scene.attempts) + 1;
  const reserveKey = `film_scene_reserve:${sceneId}:${attempt}`;
  // Claim the attempt number FIRST. If the provider start fails, the attempt is
  // still consumed so a retry gets fresh reserve/refund keys and cannot double
  // refund credits that were never held.
  await db('film_scenes').where({ id: sceneId }).update({
    status: 'processing', stage: alreadyClaimed ? 'starting_provider' : 'starting_provider', progress: 2,
    detail: 'Reserving credits and starting AI provider',
    attempts: attempt, credits_cost: cost, error: null, cancel_requested: 0,
    queued_at: now(), updated_at: now(),
  });
  try {
    await reserveCredits(userId, cost, {
      idempotencyKey: reserveKey, referenceType: 'film_scene', referenceId: sceneId,
      metadata: { filmId: film.id, attempt, seconds: number(scene.duration_seconds) },
    });
  } catch (error) {
    await db('film_scenes').where({ id: sceneId }).update({
      status: scene.status, stage: scene.stage, progress: number(scene.progress),
      detail: scene.detail, attempts: number(scene.attempts),
      credits_cost: number(scene.credits_cost), error: error.message, updated_at: now(),
    });
    throw error;
  }

  let handle;
  try {
    const characters = await characterRowsFor(userId, film.id, film);
    const location = scene.location_id
      ? await db('film_locations').where({ id: scene.location_id, user_id: userId }).first()
      : null;
    handle = await startVideoGeneration({
      prompt: scenePrompt(film, scene, characters, location, await scenePropsForPrompt(film.id, scene.id)),
      referenceImagePath: referenceImageFor(film, scene, characters),
      seconds: number(scene.duration_seconds, config.film.maxSceneSeconds),
      aspectRatio: film.aspect_ratio,
      provider,
    });
  } catch (error) {
    await failScene({ ...scene, attempts: attempt, credits_cost: cost, user_id: userId }, film, `AI provider start failed: ${error.message}`);
    throw error;
  }

  const timestamp = now();
  await db('film_scenes').where({ id: sceneId }).update({
    status: 'queued', stage: 'queued', progress: 5,
    detail: `${handle.provider} prediction started (${handle.providerSeconds || number(scene.duration_seconds)}s clip)`,
    provider: handle.provider, provider_job_id: handle.providerJobId,
    provider_handle: json(handle), credits_cost: cost, attempts: attempt,
    cancel_requested: 0, error: null, updated_at: timestamp,
  });
  await db('film_projects').where({ id: film.id }).update({ status: 'generating', stage: 'generating', error: null, updated_at: timestamp });
  await addJob('film_generate_scene', { filmId: film.id, sceneId, userId, attempt }, {
    dedupeKey: `film_scene_job:${sceneId}:${attempt}`, priority: 5,
  });
  return { attempt, provider: handle.provider, providerSeconds: handle.providerSeconds };
}

/**
 * Start as many planned scenes as the concurrency budget allows. Called when a
 * batch is requested and again whenever a scene finishes, is cancelled, or the
 * run is resumed.
 */
export async function dispatchPlannedScenes(filmId, { keepAlive = false } = {}) {
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) return { started: 0, reason: 'film_missing' };
  if (film.run_state === 'cancelled' || film.run_state === 'paused') return { started: 0, reason: film.run_state };
  const active = number((await db('film_scenes').where({ film_id: filmId }).whereIn('status', ACTIVE_SCENE_STATUSES).count('* as count').first())?.count);
  const slots = Math.max(0, config.film.sceneConcurrency - active);
  if (!slots) return { started: 0, reason: 'concurrency', active };
  const planned = await db('film_scenes').where({ film_id: filmId, status: 'planned' }).orderBy('ordinal', 'asc').limit(slots);
  if (!planned.length) return { started: 0, reason: 'nothing_planned', active };

  let started = 0;
  const errors = [];
  for (const scene of planned) {
    const fresh = await db('film_projects').where({ id: filmId }).first();
    if (!fresh || fresh.run_state === 'paused' || fresh.run_state === 'cancelled') break;
    const claimed = await db('film_scenes').where({ id: scene.id, status: 'planned' }).update({
      status: 'processing', stage: 'starting_provider', progress: 1, detail: 'Queued for a provider slot', updated_at: now(),
    });
    if (!claimed) continue;
    try {
      const provider = await resolveEnabledVideoProvider(filmSceneProvider(fresh));
      await startSceneGeneration({ film: fresh, userId: fresh.user_id, scene: { ...scene, status: 'processing' }, provider, alreadyClaimed: true });
      started += 1;
    } catch (error) {
      errors.push({ sceneId: scene.id, message: error.message });
      // Insufficient credits or a missing provider stops the whole run — the
      // remaining scenes stay planned so the user can top up and resume.
      if (['insufficient_credits', 'video_provider_unavailable'].includes(error.code)) {
        await db('film_projects').where({ id: filmId }).update({ run_state: 'paused', detail: `Paused: ${error.message}`, run_stopped_at: now(), updated_at: now() });
        break;
      }
    }
  }
  if (started) await refreshFilmProgress(filmId);
  else if (keepAlive) await refreshFilmProgress(filmId);
  return { started, errors, active };
}

/** Queue every draft/failed scene that is not already in flight. */
export async function queueFilmScenes(userId, filmId, { sceneIds = null, role = 'user' } = {}) {
  const film = await ownedFilm(userId, filmId, role);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  if (!scenes.length) throw new AppError(409, 'no_scenes', 'Write a screenplay first — there are no scenes to generate.');
  const provider = await resolveEnabledVideoProvider(filmSceneProvider(film));
  const target = sceneIds && sceneIds.length
    ? scenes.filter((scene) => sceneIds.includes(scene.id))
    : scenes.filter((scene) => PENDING_SCENE_STATUSES.includes(scene.status) && scene.status !== 'planned');
  const estimate = estimateFilm(scenes.map((s) => ({ duration_seconds: number(s.duration_seconds), dialogue: parseJson(s.dialogue, []) })));
  const balance = await getBalance(userId);
  const needed = target.reduce((n, s) => n + sceneCreditCost(s), 0);
  if (needed > balance && target.length) {
    throw new AppError(402, 'insufficient_credits', `Generating ${target.length} scenes needs ${needed} credits; your balance is ${balance}. Generate individual scenes, reduce the film length, or add credits.`, { required: needed, balance, estimate });
  }
  if (!target.length) {
    return { queued: 0, planned: 0, skipped: scenes.length, errors: [], estimate, balance, provider };
  }
  await db('film_projects').where({ id: filmId }).update({
    run_state: 'running', run_started_at: film.run_started_at || now(), run_stopped_at: null, error: null, updated_at: now(),
  });
  await db('film_scenes').whereIn('id', target.map((scene) => scene.id)).update({
    status: 'planned', stage: 'planned', progress: 0, detail: 'Waiting for a provider slot',
    cancel_requested: 0, error: null, updated_at: now(),
  });
  const dispatch = await dispatchPlannedScenes(filmId, { keepAlive: true });
  await refreshFilmProgress(filmId);
  await notify(userId, {
    type: 'film_generation_started', title: 'Film generation started',
    body: `${film.title}: ${target.length} scene(s) queued across ${provider}. ${dispatch.started} started immediately.`,
    actionUrl: `/films/${filmId}`,
  }).catch(() => {});
  return {
    queued: dispatch.started,
    planned: Math.max(0, target.length - dispatch.started),
    skipped: scenes.length - target.length,
    errors: dispatch.errors || [],
    estimate,
    balance: await getBalance(userId),
    provider,
  };
}

export async function requestAllScenes(userId, filmId, role = 'user') {
  const result = await queueFilmScenes(userId, filmId, { role });
  return { ...result, total: result.queued + result.planned };
}

export async function pauseFilmGeneration(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  if (film.status === 'assembling') throw new AppError(409, 'assembly_busy', 'The film is currently rendering; cancel the render first.');
  await db('film_projects').where({ id: filmId }).update({
    run_state: 'paused', status: 'paused', stage: 'paused',
    detail: 'Generation paused — in-flight scenes will finish, no new scenes will start.',
    run_stopped_at: now(), updated_at: now(),
  });
  const counts = await sceneStatusCounts(filmId);
  return { paused: true, ...counts };
}

export async function resumeFilmGeneration(userId, filmId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const pending = await db('film_scenes').where({ film_id: filmId, status: 'planned' }).count('* as count').first();
  if (!number(pending?.count)) {
    const counts = await sceneStatusCounts(filmId);
    await db('film_projects').where({ id: filmId }).update({ run_state: counts.busy || counts.planned ? 'running' : 'idle', status: counts.ready === counts.total && counts.total ? 'ready' : 'draft', updated_at: now() });
    return { resumed: false, reason: 'nothing_planned', ...counts };
  }
  await db('film_projects').where({ id: filmId }).update({
    run_state: 'running', status: 'generating', stage: 'generating',
    detail: 'Generation resumed', run_stopped_at: null, error: null, updated_at: now(),
  });
  const dispatch = await dispatchPlannedScenes(filmId, { keepAlive: true });
  await refreshFilmProgress(filmId);
  return { resumed: true, started: dispatch.started, ...(await sceneStatusCounts(filmId)) };
}

/**
 * Cancel one scene's generation: cancel the provider job when supported,
 * refund the reservation exactly once, and never attach a late result.
 */
export async function cancelSceneGeneration(userId, filmId, sceneId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (scene.status === 'ready') throw new AppError(409, 'scene_ready', 'This scene already has a real clip. Regenerate it instead.');
  if (scene.status === 'planned' || scene.status === 'draft') {
    await db('film_scenes').where({ id: sceneId }).update({ status: 'draft', stage: 'draft', progress: 0, detail: null, cancel_requested: 0, updated_at: now() });
    await refreshFilmProgress(filmId);
    return { cancelled: true, refunded: 0, providerCancelled: false };
  }
  const handle = parseJson(scene.provider_handle, null);
  const providerResult = handle ? await cancelVideoGeneration(handle) : { cancelled: false, supported: false };
  await refundSceneAttempt(film.user_id || userId, scene, 'cancelled_by_user');
  await cancelSceneJobRows(sceneId, number(scene.attempts));
  await db('film_scenes').where({ id: sceneId }).update({
    status: 'cancelled', stage: 'cancelled', progress: 0,
    detail: providerResult.cancelled ? 'Cancelled — provider job stopped' : 'Cancelled — provider job cannot be stopped; its result will be discarded',
    error: null, provider_handle: null, cancel_requested: 1, updated_at: now(),
  });
  await refreshFilmProgress(filmId);
  return { cancelled: true, refunded: number(scene.credits_cost), providerCancelled: Boolean(providerResult.cancelled), providerReason: providerResult.reason || null };
}

/** Cancel the entire run: stop provider jobs where possible, refund, keep clips. */
export async function cancelFilmGeneration(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  await db('film_projects').where({ id: filmId }).update({
    run_state: 'cancelled', status: 'draft', stage: 'draft',
    detail: 'Generation cancelled — finished clips were kept.', run_stopped_at: now(), updated_at: now(),
  });
  await db('film_projects').where({ id: filmId }).update({ assembly_cancel_requested: 1 });
  const scenes = await db('film_scenes').where({ film_id: filmId }).whereIn('status', ['planned', 'queued', 'processing']);
  let refunded = 0;
  let cancelledActive = 0;
  let returnedToDraft = 0;
  for (const scene of scenes) {
    if (scene.status === 'planned') {
      await db('film_scenes').where({ id: scene.id }).update({ status: 'draft', stage: 'draft', progress: 0, detail: null, updated_at: now() });
      returnedToDraft += 1;
      continue;
    }
    cancelledActive += 1;
    const handle = parseJson(scene.provider_handle, null);
    if (handle) await cancelVideoGeneration(handle);
    await refundSceneAttempt(film.user_id || userId, scene, 'run_cancelled');
    await cancelSceneJobRows(scene.id, number(scene.attempts));
    refunded += number(scene.credits_cost);
    await db('film_scenes').where({ id: scene.id }).update({
      status: 'cancelled', stage: 'cancelled', progress: 0, detail: 'Run cancelled',
      provider_handle: null, cancel_requested: 1, updated_at: now(),
    });
  }
  await refreshFilmProgress(filmId);
  return { cancelled: true, refunded, scenes: cancelledActive, drafted: returnedToDraft };
}

/** Requeue every failed/cancelled scene that has no real clip. */
export async function retryFailedScenes(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scenes = await db('film_scenes').where({ film_id: filmId }).whereIn('status', ['failed', 'cancelled']);
  if (!scenes.length) return { retried: 0, planned: 0, errors: [], balance: await getBalance(userId) };
  const result = await queueFilmScenes(userId, filmId, { sceneIds: scenes.map((scene) => scene.id), role });
  return { ...result, retried: result.queued + result.planned };
}

export async function sceneStatusCounts(filmId) {
  const rows = await db('film_scenes').where({ film_id: filmId }).select('status');
  const counts = { total: rows.length, ready: 0, failed: 0, cancelled: 0, planned: 0, queued: 0, processing: 0, draft: 0 };
  for (const row of rows) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  counts.active = counts.queued + counts.processing;
  counts.busy = counts.active;
  return counts;
}

/** Lightweight polling payload for the workspace progress panel. */
export async function filmProgress(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const counts = await sceneStatusCounts(filmId);
  const activeScenes = await db('film_scenes')
    .where({ film_id: filmId })
    .whereIn('status', ['queued', 'processing'])
    .orderBy('ordinal', 'asc')
    .select('id', 'ordinal', 'status', 'progress', 'detail', 'provider');
  const summary = (await sceneSummary([filmId])).get(filmId);
  const eta = await estimateRemaining(filmId, counts);
  return {
    filmId,
    status: film.status,
    runState: film.run_state || 'idle',
    progress: counts.total ? Math.round((counts.ready / counts.total) * 100) : 0,
    detail: film.detail || null,
    error: film.error || null,
    counts,
    etaSeconds: eta,
    activeScenes: activeScenes.map((scene) => ({
      id: scene.id, ordinal: number(scene.ordinal), status: scene.status,
      progress: number(scene.progress), detail: scene.detail, provider: scene.provider || null,
    })),
    summary,
    sceneConcurrency: config.film.sceneConcurrency,
  };
}

async function estimateRemaining(filmId, counts) {
  const remaining = counts.total - counts.ready;
  if (!remaining) return 0;
  const done = await db('film_scenes').where({ film_id: filmId, status: 'ready' }).whereNotNull('queued_at')
    .select('queued_at', 'updated_at').limit(40);
  const durations = done
    .map((row) => (Date.parse(row.updated_at) - Date.parse(row.queued_at)) / 1000)
    .filter((value) => Number.isFinite(value) && value > 0 && value < 3600);
  if (!durations.length) return null;
  const average = durations.reduce((n, value) => n + value, 0) / durations.length;
  const lanes = Math.max(1, Math.min(config.film.sceneConcurrency, remaining));
  return Math.round((remaining * average) / lanes);
}

/** Worker handler. Resumable: provider handle is read from the DB each time. */
export async function processFilmSceneJob(payload = {}) {
  const { filmId, sceneId, userId, attempt } = payload;
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) return { ok: false, reason: 'scene_missing' };
  if (!['queued', 'processing'].includes(scene.status)) return { ok: true, reason: 'already_final', status: scene.status };
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) return { ok: false, reason: 'film_missing' };
  if (film.run_state === 'cancelled') {
    await refundSceneAttempt(film.user_id || userId, scene, 'run_cancelled');
    await db('film_scenes').where({ id: sceneId }).update({ status: 'cancelled', stage: 'cancelled', progress: 0, detail: 'Run cancelled', provider_handle: null, updated_at: now() });
    await refreshFilmProgress(filmId);
    return { ok: true, cancelled: true, reason: 'run_cancelled' };
  }
  const handle = parseJson(scene.provider_handle, null);
  if (!handle) return await failScene(scene, film, 'Provider handle missing — regenerate this scene.');

  await db('film_scenes').where({ id: sceneId }).update({ status: 'processing', stage: 'polling', progress: 10, detail: 'Polling AI provider', updated_at: now() });
  const maxDuration = Math.min(config.film.pollTimeoutMs, Math.max(60000, config.worker.jobTimeoutMs - 60000));
  const deadline = Date.now() + maxDuration;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastProgress = 10;

  while (Date.now() < deadline) {
    // Cancellation is checked every poll so a cancel request takes effect
    // before a late provider result can be attached to the scene.
    const live = await db('film_scenes').where({ id: sceneId }).first();
    const liveFilm = await db('film_projects').where({ id: filmId }).first();
    if (!live) return { ok: false, reason: 'scene_missing' };
    if (number(live.cancel_requested) === 1 || liveFilm?.run_state === 'cancelled') {
      await cancelVideoGeneration(handle);
      await refundSceneAttempt(film.user_id || userId, live, 'cancelled_during_poll');
      await db('film_scenes').where({ id: sceneId }).update({
        status: 'cancelled', stage: 'cancelled', progress: 0,
        detail: 'Cancelled during generation', error: null, provider_handle: null, updated_at: now(),
      });
      await refreshFilmProgress(filmId);
      return { ok: true, cancelled: true, sceneId };
    }

    let poll;
    try {
      poll = await pollVideoGeneration(handle);
    } catch (error) {
      if (error.retryable !== false && error.status !== 400 && error.status !== 401) {
        const transient = new AppError(502, 'video_poll_transient', `AI provider polling failed, will retry: ${error.message}`);
        transient.retryable = true;
        throw transient;
      }
      return await failScene(scene, film, `AI provider error: ${error.message}`);
    }
    if (poll.done && poll.error) {
      await failScene(scene, film, poll.error);
      await dispatchPlannedScenes(filmId).catch(() => {});
      return { ok: false, sceneId, error: poll.error };
    }
    if (poll.done) {
      try {
        const dir = await ensureProjectDir(`film_${filmId}`);
        const scenesDir = path.join(dir, 'scenes');
        await fsp.mkdir(scenesDir, { recursive: true });
        const clipPath = path.join(scenesDir, `clip-${number(scene.ordinal)}-${attempt || number(scene.attempts)}.mp4`);
        await downloadProviderVideo(poll, clipPath);
        // A provider "success" with an empty/corrupt file is a failure, not a scene.
        const probe = await probeVideo(clipPath);
        if (!probe.hasVideo || probe.durationSeconds < 0.2) {
          await fsp.rm(clipPath, { force: true }).catch(() => {});
          await failScene(scene, film, 'The provider reported success but returned a file without a usable video stream. No clip was accepted.');
          await dispatchPlannedScenes(filmId).catch(() => {});
          return { ok: false, sceneId, error: 'clip_invalid' };
        }
        const posterPath = path.join(scenesDir, `poster-${number(scene.ordinal)}.jpg`);
        await ffmpeg(['-ss', '0.2', '-i', clipPath, '-frames:v', '1', '-q:v', '3', posterPath]).catch(() => {});
        await db('film_scenes').where({ id: sceneId }).update({
          status: 'ready', stage: 'ready', progress: 100,
          detail: `Real ${handle.provider} clip (${probe.durationSeconds.toFixed(1)}s)`, clip_path: clipPath,
          poster_path: fs.existsSync(posterPath) ? posterPath : null,
          error: null, provider_handle: null, updated_at: now(),
        });
        await db('film_projects').where({ id: filmId }).update({
          credits_spent: db.raw('credits_spent + ?', [number(scene.credits_cost)]), updated_at: now(),
        });
        await invalidateAssembly(filmId);
        await refreshFilmProgress(filmId);
        await dispatchPlannedScenes(filmId).catch(() => {});
        return { ok: true, sceneId, provider: handle.provider, clipPath, seconds: probe.durationSeconds };
      } catch (error) {
        await failScene(scene, film, `Could not store provider clip: ${error.message}`);
        await dispatchPlannedScenes(filmId).catch(() => {});
        return { ok: false, sceneId, error: error.message };
      }
    }
    const progress = Math.max(lastProgress, Math.min(90, Number(poll.progress) || 30));
    lastProgress = progress;
    await db('film_scenes').where({ id: sceneId }).update({ progress, detail: String(poll.detail || 'Provider is generating').slice(0, 500), updated_at: now() });
    await refreshFilmProgress(filmId);
    await sleep(config.film.pollIntervalMs);
  }
  await failScene(scene, film, `AI provider did not finish within ${Math.round(maxDuration / 60000)} minutes. The prediction may still be running at the provider; check ${handle.providerJobId}.`);
  await dispatchPlannedScenes(filmId).catch(() => {});
  return { ok: false, sceneId, error: 'provider_timeout' };
}

async function failScene(scene, film, message) {
  const attempt = number(scene.attempts);
  await refundCredits(scene.user_id || film.user_id, number(scene.credits_cost), {
    idempotencyKey: `film_scene_refund:${scene.id}:${attempt}`,
    referenceType: 'film_scene', referenceId: scene.id,
    metadata: { filmId: film.id, attempt, reason: 'generation_failed' },
  });
  await db('film_scenes').where({ id: scene.id }).update({
    status: 'failed', stage: 'failed', progress: 0,
    detail: null, error: String(message).slice(0, 2000),
    provider_handle: null, cancel_requested: 0, updated_at: now(),
  });
  await refreshFilmProgress(film.id);
  await notify(film.user_id, {
    type: 'film_scene_failed', title: 'Scene generation failed',
    body: `${film.title}: scene ${number(scene.ordinal)} — ${String(message).slice(0, 180)}`,
    actionUrl: `/films/${film.id}`,
  }).catch(() => {});
  return { ok: false, sceneId: scene.id, error: String(message) };
}

/**
 * Called when a scene job exhausts its retries outside the polling loop (for
 * example the worker crashed mid-poll). The scene is failed and refunded rather
 * than being left "processing" forever with no job watching it.
 */
export async function handleSceneJobFailure(payload = {}, error) {
  const { filmId, sceneId } = payload;
  if (!filmId || !sceneId) return { ok: false, reason: 'payload_incomplete' };
  const scene = await db('film_scenes').where({ id: sceneId }).first();
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!scene || !film) return { ok: false, reason: 'missing' };
  if (!['queued', 'processing'].includes(scene.status)) return { ok: true, reason: 'already_final' };
  const result = await failScene(scene, film, `Background job failed: ${error?.message || error}`);
  await dispatchPlannedScenes(filmId).catch(() => {});
  return result;
}

export async function refreshFilmProgress(filmId) {
  const scenes = await db('film_scenes').where({ film_id: filmId }).select('status', 'progress');
  if (!scenes.length) return;
  const ready = scenes.filter((s) => s.status === 'ready').length;
  const failed = scenes.filter((s) => s.status === 'failed').length;
  const cancelled = scenes.filter((s) => s.status === 'cancelled').length;
  const planned = scenes.filter((s) => s.status === 'planned').length;
  const busy = scenes.filter((s) => ACTIVE_SCENE_STATUSES.includes(s.status)).length;
  const progress = Math.round((ready / scenes.length) * 100);
  const current = await db('film_projects').where({ id: filmId }).first();
  if (!current) return;
  const protectedStatuses = ['completed', 'published', 'assembling', 'failed'];
  const counts = { ready, failed, cancelled, planned, busy, total: scenes.length };
  let stage = ready === scenes.length ? 'ready_to_assemble' : ready > 0 ? 'partial' : 'screenplay';
  if (busy > 0 || planned > 0) stage = 'generating';
  let status = busy > 0 || planned > 0 ? 'generating' : ready === scenes.length ? 'ready' : 'draft';
  if (current.run_state === 'paused') { status = 'paused'; stage = 'paused'; }
  if (current.run_state === 'cancelled') { status = 'draft'; stage = 'draft'; }
  const updates = {
    progress,
    stage,
    detail: `${ready}/${scenes.length} scenes ready${failed ? `, ${failed} failed` : ''}${cancelled ? `, ${cancelled} cancelled` : ''}${planned ? `, ${planned} queued` : ''}${busy ? `, ${busy} generating` : ''}`,
    updated_at: now(),
  };
  if (!protectedStatuses.includes(current.status)) updates.status = status;
  else if (current.status === 'failed' && ready > 0) updates.status = status;
  await db('film_projects').where({ id: filmId }).update(updates);
  return counts;
}

/**
 * Worker sweep: keeps `planned` scenes moving even if no completion event fired
 * (for example after a restart or a worker crash). Cheap single query.
 */
export async function sweepFilmGenerations() {
  const rows = await db('film_scenes').where({ status: 'planned' }).distinct('film_id').limit(20);
  for (const row of rows) {
    await dispatchPlannedScenes(row.film_id).catch(() => {});
  }
  return rows.length;
}

// --- assembly --------------------------------------------------------------
export async function requestAssembly(userId, filmId, { subtitles, burnSubtitles } = {}, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const pre = await assemblyPreflight(filmId);
  if (!pre.ready) {
    throw new AppError(409, 'scenes_incomplete', `${pre.missing.length} scene(s) have no real AI video clip. Generate them before assembling.`, { missing: pre.missing });
  }
  const existing = await db('film_projects').where({ id: filmId }).first();
  if (existing.status === 'assembling') throw new AppError(409, 'assembly_busy', 'An assembly is already in progress.');
  const metadata = parseJson(existing.metadata, {});
  const wantsSubtitles = subtitles === undefined ? metadata.subtitles !== false : Boolean(subtitles);
  const burn = burnSubtitles === undefined ? (wantsSubtitles && pre.duration <= config.film.burnInMaxSeconds) : Boolean(burnSubtitles);
  const cost = assemblyCreditCost(pre.scenes.map((s) => ({ dialogue: parseJson(s.dialogue, []) })));
  const attempt = number((await db('film_scenes').where({ film_id: filmId }).max('attempts as m').first())?.m) + 1;
  const reserveKey = `film_assembly_reserve:${filmId}:${attempt}`;
  await reserveCredits(userId, cost, {
    idempotencyKey: reserveKey, referenceType: 'film', referenceId: filmId,
    metadata: { attempt, subtitles: wantsSubtitles, burnSubtitles: burn },
  });
  await db('film_projects').where({ id: filmId }).update({
    status: 'assembling', stage: 'assembling', progress: 0, detail: 'Render queued',
    error: null, assembly_cancel_requested: 0, updated_at: now(),
  });
  await addJob('film_assemble', { filmId, userId, attempt, subtitles: wantsSubtitles, burnSubtitles: burn }, {
    dedupeKey: `film_assembly_job:${filmId}:${attempt}`, priority: 4, maxAttempts: 2,
  });
  return {
    queued: true, creditsReserved: cost, sceneCount: pre.scenes.length,
    durationSeconds: pre.duration, segments: pre.segments,
    estimatedRenderBytes: pre.estimatedRenderBytes,
    subtitles: wantsSubtitles ? (burn ? 'burned-in' : 'soft-track') : 'none',
  };
}

export async function cancelFilmAssembly(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  if (film.status !== 'assembling') return { cancelling: false, reason: 'not_rendering' };
  await db('film_projects').where({ id: filmId }).update({
    assembly_cancel_requested: 1, detail: 'Cancelling render…', updated_at: now(),
  });
  await db('jobs').where({ type: 'film_assemble', status: 'queued' }).where('payload', 'like', `%${filmId}%`)
    .update({ status: 'cancelled', completed_at: now(), updated_at: now() }).catch(() => {});
  return { cancelling: true };
}

export async function processFilmAssemblyJob(payload = {}) {
  const { filmId, userId, attempt = 1, subtitles = true, burnSubtitles } = payload;
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) return { ok: false, reason: 'film_missing' };
  const scenes = await db('film_scenes').where({ film_id: filmId });
  const cost = assemblyCreditCost(scenes.map((s) => ({ dialogue: parseJson(s.dialogue, []) })));
  let cancelled = false;
  let lastPoll = 0;
  const shouldCancel = () => cancelled;
  try {
    const result = await assembleFilm(filmId, {
      subtitles,
      burnSubtitles,
      shouldCancel,
      onProgress: async (progress, stage) => {
        // Poll the DB flag at most every second while FFmpeg reports progress.
        if (Date.now() - lastPoll > 1000) {
          lastPoll = Date.now();
          const live = await db('film_projects').where({ id: filmId }).first();
          if (number(live?.assembly_cancel_requested) === 1) cancelled = true;
        }
        await db('film_projects').where({ id: filmId }).update({ progress, detail: `Rendering: ${stage} (${progress}%)`, updated_at: now() });
      },
    });
    // The assembly cost was already reserved (and debited) by requestAssembly
    // before this job was queued. Debiting again here charged every successful
    // render twice; completion only records the spend against the project.
    await db('film_projects').where({ id: filmId }).update({
      credits_spent: db.raw('credits_spent + ?', [cost]),
      progress: 100, detail: 'Film ready', error: null, assembly_cancel_requested: 0, updated_at: now(),
    });
    await notify(userId, {
      type: 'film_completed', title: 'Your film is ready',
      body: `${film.title} — ${result.durationSeconds}s, ${result.scenes} scenes. Preview and download it now.`,
      actionUrl: `/films/${filmId}`,
    }).catch(() => {});
    return { ok: true, ...result };
  } catch (error) {
    const wasCancelled = error.cancelled || error.code === 'assembly_cancelled' || cancelled;
    await refundCredits(userId, cost, {
      idempotencyKey: `film_assembly_refund:${filmId}:${attempt}`,
      referenceType: 'film', referenceId: filmId, metadata: { reason: wasCancelled ? 'assembly_cancelled' : 'assembly_failed' },
    });
    // A cancelled/failed render never overwrites the previous finished cut:
    // assembly stages its output inside the work directory until it succeeds.
    const keepExisting = film.final_video_path && fs.existsSync(film.final_video_path);
    await db('film_projects').where({ id: filmId }).update({
      status: wasCancelled ? (keepExisting ? 'completed' : 'ready') : 'failed',
      stage: wasCancelled ? 'render' : 'failed',
      progress: wasCancelled ? 0 : number(film.progress),
      error: wasCancelled ? null : String(error.message).slice(0, 2000),
      detail: wasCancelled ? 'Render cancelled — credits refunded' : null,
      final_video_path: keepExisting ? film.final_video_path : null,
      assembly_cancel_requested: 0, updated_at: now(),
    });
    if (!wasCancelled) {
      await notify(userId, {
        type: 'film_failed', title: 'Film assembly failed',
        body: `${film.title}: ${String(error.message).slice(0, 180)}`, actionUrl: `/films/${filmId}`,
      }).catch(() => {});
    }
    return { ok: false, cancelled: Boolean(wasCancelled), error: String(error.message) };
  }
}

// --- detail + publishing ---------------------------------------------------
export async function filmDetail(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const [scenes, characters, locations, summary, balance] = await Promise.all([
    db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc'),
    listCharacters(userId, { filmId, seriesId: film.series_id || undefined }),
    listLocations(userId, { filmId, seriesId: film.series_id || undefined }),
    sceneSummary([filmId]),
    getBalance(userId),
  ]);
  const estimate = estimateFilm(scenes.map((s) => ({ duration_seconds: number(s.duration_seconds), dialogue: parseJson(s.dialogue, []) })));
  let preflight = { ready: false, missing: [], ttsProvider: 'unknown' };
  try { preflight = await assemblyPreflight(filmId); }
  catch (error) { preflight = { ready: false, missing: [], ttsProvider: `unavailable: ${error.message}` }; }
  const provider = providerStatus(filmSceneProvider(film));
  const plan = planProject(film.target_duration_seconds);
  return {
    ...filmView(film, summary.get(filmId)),
    scenes: scenes.map(sceneView),
    sceneProps: await (async () => {
      const links = await db('film_scene_props').where({ film_id: filmId });
      const props = links.length ? await db('film_props').whereIn('id', [...new Set(links.map((link) => link.prop_id))]).where({ user_id: userId }) : [];
      const byId = new Map(props.map((prop) => [prop.id, prop]));
      const grouped = {};
      for (const link of links) {
        const prop = byId.get(link.prop_id);
        if (!prop) continue;
        if (!grouped[link.scene_id]) grouped[link.scene_id] = [];
        grouped[link.scene_id].push({ id: prop.id, name: prop.name, state: link.state || '' });
      }
      return grouped;
    })(),
    props: await (async () => {
      const rows = await db('film_props').where({ user_id: userId }).where((q) => q.where({ film_id: filmId }).orWhereNull('film_id'));
      return rows.map((row) => ({ id: row.id, name: row.name, category: row.category, description: row.description, color: row.color }));
    })(),
    characters,
    locations,
    estimate,
    balance,
    assemblyReady: preflight.ready,
    missingScenes: preflight.missing,
    ttsProvider: preflight.ttsProvider,
    sfxAssets: preflight.sfxAssets || [],
    preflight: {
      durationSeconds: preflight.duration,
      segments: preflight.segments,
      estimatedRenderBytes: preflight.estimatedRenderBytes,
      sfxCount: preflight.sfxCount || 0,
      unresolvedSfx: preflight.unresolvedSfx || 0,
      burnInRecommended: preflight.burnInRecommended,
    },
    limits: filmLimits(),
    scenePlan: plan.sceneCount,
    plan,
    videoProvider: provider,
    runState: film.run_state || 'idle',
  };
}

export async function publishFilm(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  if (!film.final_video_path || !fs.existsSync(film.final_video_path)) {
    throw new AppError(409, 'film_not_rendered', 'Render the film before publishing.');
  }
  const metadata = { ...parseJson(film.metadata, {}), publishedAt: now() };
  await db('film_projects').where({ id: filmId }).update({ status: 'published', metadata: json(metadata), updated_at: now() });
  if (film.series_id) {
    await db('film_episodes').where({ film_id: filmId }).update({
      status: 'completed', thumbnail_path: film.thumbnail_path,
      credits: json(metadata.credits || []), published_at: metadata.publishedAt, updated_at: now(),
    });
  }
  return filmView(await db('film_projects').where({ id: filmId }).first());
}
