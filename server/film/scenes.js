/**
 * Film project + scene service layer.
 *
 * Every expensive operation reserves credits before starting, persists an
 * opaque provider handle, and enqueues a durable job. The worker can be killed
 * at any point: on restart it resumes polling the same provider prediction,
 * and any definitive failure refunds the reservation exactly once.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, now, newId, json, parseJson, number, addJob, notify } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { ensureProjectDir, projectDir, ffmpeg } from '../media/utils.js';
import {
  FILM_TYPES, FILM_GENRES, FILM_STYLES, FILM_ASPECTS, FILM_PLATFORMS,
  clampInt, filmLimits, planSceneCount, normaliseEditedScreenplay,
} from './screenplay.js';
import {
  estimateFilm, sceneCreditCost, assemblyCreditCost,
  reserveCredits, refundCredits, getBalance,
} from './credits.js';
import {
  startVideoGeneration, pollVideoGeneration, downloadProviderVideo, requireVideoProvider,
} from './videoProviders.js';
import { invalidateAssembly, assembleFilm, assemblyPreflight } from './assembly.js';

const SCENE_STATUSES = ['draft', 'queued', 'processing', 'ready', 'failed'];

export const createFilmSchema = z.object({
  type: z.enum(FILM_TYPES).default('short_drama'),
  title: z.string().trim().min(2).max(220),
  logline: z.string().max(1000).optional().default(''),
  genre: z.string().max(60).optional().default('drama'),
  language: z.string().max(12).optional().default('en'),
  style: z.string().max(60).optional().default('cinematic'),
  aspectRatio: z.enum(FILM_ASPECTS).optional().default('9:16'),
  targetPlatform: z.string().max(40).optional().default('tiktok'),
  targetDurationSeconds: z.number().int().min(5).max(config.film.maxProjectSeconds).optional().default(60),
  storyBible: z.record(z.any()).optional().default({}),
  seriesId: z.string().max(48).optional().nullable(),
  seasonNumber: z.number().int().min(0).max(100).optional().default(0),
  episodeNumber: z.number().int().min(0).max(1000).optional().default(0),
  voice: z.string().max(60).optional().default('nova'),
});

export const patchFilmSchema = createFilmSchema.partial().omit({ type: true, seriesId: true }).extend({
  status: z.string().max(30).optional(),
  subtitles: z.boolean().optional(),
});

export const patchSceneSchema = z.object({
  heading: z.string().max(220).optional(),
  location: z.string().max(220).optional(),
  time_of_day: z.string().max(60).optional(),
  description: z.string().max(2000).optional(),
  dialogue: z.array(z.object({ character: z.string().min(1).max(120), line: z.string().min(1).max(1000), emotion: z.string().max(80).optional() })).max(20).optional(),
  camera_movement: z.string().max(120).optional(),
  visual_prompt: z.string().max(2000).optional(),
  duration_seconds: z.number().int().min(4).max(config.film.maxSceneSeconds).optional(),
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
    creditsEstimated: number(row.credits_estimated),
    creditsSpent: number(row.credits_spent),
    hasVideo: Boolean(row.final_video_path),
    hasThumbnail: Boolean(row.thumbnail_path),
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
    visualPrompt: row.visual_prompt,
    durationSeconds: number(row.duration_seconds),
    status: row.status,
    stage: row.stage,
    progress: number(row.progress),
    detail: row.detail || null,
    hasClip: Boolean(row.clip_path && fs.existsSync(row.clip_path)),
    hasPoster: Boolean(row.poster_path && fs.existsSync(row.poster_path)),
    provider: row.provider || null,
    providerJobId: row.provider_job_id || null,
    creditsCost: number(row.credits_cost),
    attempts: number(row.attempts),
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
    hasReferenceImage: Boolean(row.reference_image_path),
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
  const map = new Map(filmIds.map((id) => [id, { sceneCount: 0, readyScenes: 0, failedScenes: 0, queuedScenes: 0 }]));
  for (const row of rows) {
    const item = map.get(row.film_id);
    if (!item) continue;
    item.sceneCount += 1;
    if (row.status === 'ready') item.readyScenes += 1;
    else if (row.status === 'failed') item.failedScenes += 1;
    else if (row.status === 'queued' || row.status === 'processing') item.queuedScenes += 1;
  }
  return map;
}

// --- project CRUD ----------------------------------------------------------
export async function createFilm(userId, input) {
  const data = createFilmSchema.parse(input);
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
    created_at: timestamp, updated_at: timestamp,
  });
  await ensureProjectDir(`film_${id}`);
  return filmView(await db('film_projects').where({ id }).first());
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
  if (data.storyBible) updates.story_bible = json(data.storyBible);
  if (data.voice !== undefined || data.subtitles !== undefined) {
    updates.metadata = json({ ...parseJson(film.metadata, {}), ...(data.voice !== undefined ? { voice: data.voice } : {}), ...(data.subtitles !== undefined ? { subtitles: data.subtitles } : {}) });
  }
  await db('film_projects').where({ id: filmId }).update(updates);
  return filmView(await db('film_projects').where({ id: filmId }).first(), (await sceneSummary([filmId])).get(filmId));
}

export async function deleteFilm(userId, filmId, role = 'user') {
  await ownedFilm(userId, filmId, role);
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
export async function saveScreenplay(userId, filmId, screenplay, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const clean = normaliseEditedScreenplay(screenplay);
  if (clean.scenes.length > config.film.maxScenes) throw new AppError(400, 'too_many_scenes', `A project cannot have more than ${config.film.maxScenes} scenes.`);
  const timestamp = now();
  await db.transaction(async (trx) => {
    await trx('film_scenes').where({ film_id: filmId }).del();
    for (const scene of clean.scenes) {
      await trx('film_scenes').insert({
        id: newId('scn_'), film_id: filmId, ordinal: scene.ordinal,
        heading: scene.heading, location: scene.location, time_of_day: scene.time_of_day,
        description: scene.description, dialogue: json(scene.dialogue),
        camera_movement: scene.camera_movement, visual_prompt: scene.visual_prompt,
        duration_seconds: scene.duration_seconds,
        status: 'draft', stage: 'draft', progress: 0,
        created_at: timestamp, updated_at: timestamp,
      });
    }
    const estimate = estimateFilm(clean.scenes);
    // Never silently replace the user's own title. The generated title is
    // surfaced in the UI as a suggestion the creator can explicitly apply.
    await trx('film_projects').where({ id: filmId }).update({
      logline: film.logline || clean.logline,
      story_bible: json(clean.story_bible),
      screenplay: json(clean),
      credits_estimated: estimate.total,
      stage: 'screenplay', progress: 0, error: null, updated_at: timestamp,
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
  for (const key of ['heading', 'location', 'time_of_day', 'description', 'camera_movement', 'visual_prompt', 'duration_seconds']) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  if (data.dialogue) updates.dialogue = json(data.dialogue);
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
    heading: row.heading, location: row.location, time_of_day: row.time_of_day,
    description: row.description, dialogue: parseJson(row.dialogue, []),
    camera_movement: row.camera_movement, visual_prompt: row.visual_prompt,
    duration_seconds: number(row.duration_seconds),
  };
}

export async function addScene(userId, filmId, payload = {}, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const count = number((await db('film_scenes').where({ film_id: filmId }).count('* as count').first())?.count);
  if (count >= config.film.maxScenes) throw new AppError(400, 'too_many_scenes', `A project cannot have more than ${config.film.maxScenes} scenes.`);
  const data = patchSceneSchema.parse(payload);
  const id = newId('scn_');
  await db('film_scenes').insert({
    id, film_id: filmId, ordinal: count + 1,
    heading: data.heading || `SCENE ${count + 1}`, location: data.location || '',
    time_of_day: data.time_of_day || '', description: data.description || '',
    dialogue: json(data.dialogue || []), camera_movement: data.camera_movement || '',
    visual_prompt: data.visual_prompt || '', duration_seconds: data.duration_seconds || config.film.maxSceneSeconds,
    status: 'draft', stage: 'draft', progress: 0, created_at: now(), updated_at: now(),
  });
  await invalidateAssembly(filmId);
  return sceneView(await db('film_scenes').where({ id }).first());
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
      voice_provider: data.voiceProvider, updated_at: now(),
    });
    return characterView(await db('film_characters').where({ id: existing.id }).first());
  }
  const id = newId('chr_');
  await db('film_characters').insert({
    id, user_id: userId, film_id: data.filmId || null, series_id: data.seriesId || null,
    name: data.name, role: data.role, description: data.description,
    appearance_prompt: data.appearancePrompt, voice_preset: data.voicePreset,
    voice_provider: data.voiceProvider || null, metadata: json({}),
    created_at: now(), updated_at: now(),
  });
  return characterView(await db('film_characters').where({ id }).first());
}

export async function deleteCharacter(userId, characterId) {
  const character = await db('film_characters').where({ id: characterId, user_id: userId }).first();
  if (!character) throw new AppError(404, 'character_not_found', 'Character not found.');
  await db('film_characters').where({ id: characterId }).del();
  return { deleted: true };
}

// --- generation ------------------------------------------------------------
function scenePrompt(film, scene, characters) {
  const style = film.style;
  const cast = characters.filter((c) => (scene.visual_prompt || '').toLowerCase().includes(String(c.name).toLowerCase())
    || (scene.dialogue || '').toLowerCase().includes(String(c.name).toLowerCase()));
  const appearance = cast.length ? ` Consistent cast: ${cast.map((c) => `${c.name} (${c.appearance_prompt})`).join('; ')}.` : '';
  const dialogue = parseJson(scene.dialogue, []).map((d) => `${d.character}: ${d.line}`).join(' | ');
  return [scene.visual_prompt || scene.description, `Setting: ${scene.location}, ${scene.time_of_day}.`,
    `Camera: ${scene.camera_movement || 'cinematic'}.`, dialogue ? `Dialogue context: ${dialogue}.` : '',
    appearance, `${style} visual style, ${film.genre} drama, no text, no watermark, no logos, high production value.`]
    .filter(Boolean).join(' ').slice(0, 4000);
}

async function referenceImageFor(film, scene, characters) {
  if (film.reference_image_path && fs.existsSync(film.reference_image_path)) return film.reference_image_path;
  const names = `${scene.visual_prompt} ${scene.description} ${scene.dialogue}`.toLowerCase();
  const match = characters.find((c) => c.reference_image_path && names.includes(String(c.name).toLowerCase()));
  return match?.reference_image_path || null;
}

/**
 * Reserve credits, start a REAL provider prediction, persist its handle and
 * enqueue the polling job. Regenerating a scene never touches other scenes.
 */
export async function requestSceneGeneration(userId, filmId, sceneId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (scene.status === 'queued' || scene.status === 'processing') {
    throw new AppError(409, 'scene_busy', 'This scene is already generating. Wait for it to finish or fail.');
  }
  requireVideoProvider();
  const cost = sceneCreditCost(scene);
  const attempt = number(scene.attempts) + 1;
  const reserveKey = `film_scene_reserve:${sceneId}:${attempt}`;
  const film = await db('film_projects').where({ id: filmId }).first();
  // Claim the attempt number FIRST. If the provider start fails, the attempt is
  // still consumed so a retry gets fresh reserve/refund keys and cannot double
  // refund credits that were never held.
  await db('film_scenes').where({ id: sceneId }).update({
    status: 'processing', stage: 'starting_provider', progress: 2,
    detail: 'Reserving credits and starting AI provider',
    attempts: attempt, credits_cost: cost, error: null, updated_at: now(),
  });
  try {
    await reserveCredits(userId, cost, {
      idempotencyKey: reserveKey, referenceType: 'film_scene', referenceId: sceneId,
      metadata: { filmId, attempt, seconds: number(scene.duration_seconds) },
    });
  } catch (error) {
    // No credits were held, so consume no attempt and restore the scene.
    await db('film_scenes').where({ id: sceneId }).update({
      status: scene.status, stage: scene.stage, progress: number(scene.progress),
      detail: scene.detail, attempts: number(scene.attempts),
      credits_cost: number(scene.credits_cost), error: error.message, updated_at: now(),
    });
    throw error;
  }

  let handle;
  try {
    const characters = await db('film_characters').where({ user_id: userId }).where((q) => q.where({ film_id: filmId }).orWhere({ series_id: film.series_id || '' }));
    handle = await startVideoGeneration({
      prompt: scenePrompt(film, scene, characters),
      referenceImagePath: await referenceImageFor(film, scene, characters),
      seconds: number(scene.duration_seconds, config.film.maxSceneSeconds),
      aspectRatio: film.aspect_ratio,
    });
  } catch (error) {
    await failScene({ ...scene, attempts: attempt, credits_cost: cost }, film, `AI provider start failed: ${error.message}`);
    throw error;
  }

  const timestamp = now();
  await db('film_scenes').where({ id: sceneId }).update({
    status: 'queued', stage: 'queued', progress: 5,
    detail: `${handle.provider} prediction started`,
    provider: handle.provider, provider_job_id: handle.providerJobId,
    provider_handle: json(handle), credits_cost: cost, attempts: attempt,
    error: null, updated_at: timestamp,
  });
  await db('film_projects').where({ id: filmId }).update({ status: 'generating', stage: 'generating', error: null, updated_at: timestamp });
  await addJob('film_generate_scene', { filmId, sceneId, userId, attempt }, {
    dedupeKey: `film_scene_job:${sceneId}:${attempt}`, priority: 5,
  });
  return sceneView(await db('film_scenes').where({ id: sceneId }).first());
}

/** Queue every draft/failed scene that is not already in flight. */
export async function requestAllScenes(userId, filmId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  if (!scenes.length) throw new AppError(409, 'no_scenes', 'Write a screenplay first — there are no scenes to generate.');
  requireVideoProvider();
  const estimate = estimateFilm(scenes.map((s) => ({ duration_seconds: number(s.duration_seconds), dialogue: parseJson(s.dialogue, []) })));
  const balance = await getBalance(userId);
  const pending = scenes.filter((s) => !['ready', 'queued', 'processing'].includes(s.status));
  const needed = pending.reduce((n, s) => n + sceneCreditCost(s), 0);
  if (needed > balance) {
    throw new AppError(402, 'insufficient_credits', `Generating ${pending.length} scenes needs ${needed} credits; your balance is ${balance}. Generate individual scenes or add credits.`, { required: needed, balance, estimate });
  }
  const queued = []; const skipped = []; const errors = [];
  for (const scene of pending) {
    try { queued.push(await requestSceneGeneration(userId, filmId, scene.id, role)); }
    catch (error) { errors.push({ sceneId: scene.id, message: error.message }); }
  }
  for (const scene of scenes.filter((s) => ['ready', 'queued', 'processing'].includes(s.status))) skipped.push(scene.id);
  return { queued: queued.length, skipped: skipped.length, errors, estimate, balance };
}

/** Worker handler. Resumable: provider handle is read from the DB each time. */
export async function processFilmSceneJob(payload = {}) {
  const { filmId, sceneId, userId, attempt } = payload;
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) return { ok: false, reason: 'scene_missing' };
  if (!['queued', 'processing'].includes(scene.status)) return { ok: true, reason: 'already_final', status: scene.status };
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) return { ok: false, reason: 'film_missing' };
  const handle = parseJson(scene.provider_handle, null);
  if (!handle) return await failScene(scene, film, 'Provider handle missing — regenerate this scene.');

  await db('film_scenes').where({ id: sceneId }).update({ status: 'processing', stage: 'polling', progress: 10, detail: 'Polling AI provider', updated_at: now() });
  const maxDuration = Math.min(config.film.pollTimeoutMs, Math.max(60000, config.worker.jobTimeoutMs - 60000));
  const deadline = Date.now() + maxDuration;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastProgress = 10;

  while (Date.now() < deadline) {
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
    if (poll.done && poll.error) return await failScene(scene, film, poll.error);
    if (poll.done) {
      try {
        const dir = await ensureProjectDir(`film_${filmId}`);
        const scenesDir = path.join(dir, 'scenes');
        await fsp.mkdir(scenesDir, { recursive: true });
        const clipPath = path.join(scenesDir, `clip-${number(scene.ordinal)}-${attempt || number(scene.attempts)}.mp4`);
        await downloadProviderVideo(poll, clipPath);
        const posterPath = path.join(scenesDir, `poster-${number(scene.ordinal)}.jpg`);
        await ffmpeg(['-ss', '0.2', '-i', clipPath, '-frames:v', '1', '-q:v', '3', posterPath]).catch(() => {});
        await db('film_scenes').where({ id: sceneId }).update({
          status: 'ready', stage: 'ready', progress: 100,
          detail: `Real clip from ${handle.provider}`, clip_path: clipPath,
          poster_path: fs.existsSync(posterPath) ? posterPath : null,
          error: null, updated_at: now(),
        });
        await db('film_projects').where({ id: filmId }).update({
          credits_spent: db.raw('credits_spent + ?', [number(scene.credits_cost)]), updated_at: now(),
        });
        await invalidateAssembly(filmId);
        await refreshFilmProgress(filmId);
        return { ok: true, sceneId, provider: handle.provider, clipPath };
      } catch (error) {
        return await failScene(scene, film, `Could not store provider clip: ${error.message}`);
      }
    }
    const progress = Math.max(lastProgress, Math.min(90, Number(poll.progress) || 30));
    lastProgress = progress;
    await db('film_scenes').where({ id: sceneId }).update({ progress, detail: String(poll.detail || 'Provider is generating').slice(0, 500), updated_at: now() });
    await refreshFilmProgress(filmId);
    await sleep(config.film.pollIntervalMs);
  }
  return await failScene(scene, film, `AI provider did not finish within ${Math.round(maxDuration / 60000)} minutes. The prediction may still be running at the provider; check ${handle.providerJobId}.`);
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
    provider_handle: null, updated_at: now(),
  });
  await refreshFilmProgress(film.id);
  await notify(film.user_id, {
    type: 'film_scene_failed', title: 'Scene generation failed',
    body: `${film.title}: scene ${number(scene.ordinal)} — ${String(message).slice(0, 180)}`,
    actionUrl: `/films/${film.id}`,
  }).catch(() => {});
  return { ok: false, sceneId: scene.id, error: String(message) };
}

export async function refreshFilmProgress(filmId) {
  const scenes = await db('film_scenes').where({ film_id: filmId }).select('status', 'progress');
  if (!scenes.length) return;
  const ready = scenes.filter((s) => s.status === 'ready').length;
  const failed = scenes.filter((s) => s.status === 'failed').length;
  const busy = scenes.filter((s) => s.status === 'queued' || s.status === 'processing').length;
  const progress = Math.round((ready / scenes.length) * 100);
  const current = await db('film_projects').where({ id: filmId }).first();
  const protectedStatuses = ['completed', 'published', 'assembling', 'failed'];
  let stage = ready === scenes.length ? 'ready_to_assemble' : ready > 0 ? 'partial' : 'screenplay';
  let status = busy > 0 ? 'generating' : ready === scenes.length ? 'ready' : 'draft';
  if (busy > 0) stage = 'generating';
  const updates = {
    progress, stage,
    detail: `${ready}/${scenes.length} scenes ready${failed ? `, ${failed} failed` : ''}${busy ? `, ${busy} generating` : ''}`,
    updated_at: now(),
  };
  if (!protectedStatuses.includes(current?.status)) updates.status = status;
  await db('film_projects').where({ id: filmId }).update(updates);
}

// --- assembly --------------------------------------------------------------
export async function requestAssembly(userId, filmId, { subtitles = true } = {}, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const pre = await assemblyPreflight(filmId);
  if (!pre.ready) {
    throw new AppError(409, 'scenes_incomplete', `${pre.missing.length} scene(s) have no real AI video clip. Generate them before assembling.`, { missing: pre.missing });
  }
  const existing = await db('film_projects').where({ id: filmId }).first();
  if (existing.status === 'assembling') throw new AppError(409, 'assembly_busy', 'An assembly is already in progress.');
  const cost = assemblyCreditCost(pre.scenes.map((s) => ({ dialogue: parseJson(s.dialogue, []) })));
  const attempt = number((await db('film_scenes').where({ film_id: filmId }).max('attempts as m').first())?.m) + 1;
  const reserveKey = `film_assembly_reserve:${filmId}:${attempt}`;
  await reserveCredits(userId, cost, {
    idempotencyKey: reserveKey, referenceType: 'film', referenceId: filmId,
    metadata: { attempt, subtitles },
  });
  await db('film_projects').where({ id: filmId }).update({
    status: 'assembling', stage: 'assembling', progress: 0, detail: 'Render queued', error: null, updated_at: now(),
  });
  await addJob('film_assemble', { filmId, userId, attempt, subtitles }, {
    dedupeKey: `film_assembly_job:${filmId}:${attempt}`, priority: 4,
  });
  return { queued: true, creditsReserved: cost, sceneCount: pre.scenes.length, durationSeconds: pre.duration };
}

export async function processFilmAssemblyJob(payload = {}) {
  const { filmId, userId, attempt = 1, subtitles = true } = payload;
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) return { ok: false, reason: 'film_missing' };
  const scenes = await db('film_scenes').where({ film_id: filmId });
  const cost = assemblyCreditCost(scenes.map((s) => ({ dialogue: parseJson(s.dialogue, []) })));
  try {
    const result = await assembleFilm(filmId, {
      subtitles,
      onProgress: async (progress, stage) => {
        await db('film_projects').where({ id: filmId }).update({ progress, detail: `Rendering: ${stage} (${progress}%)`, updated_at: now() });
      },
    });
    await db('film_projects').where({ id: filmId }).update({
      credits_spent: db.raw('credits_spent + ?', [cost]), progress: 100, detail: 'Film ready', updated_at: now(),
    });
    await notify(userId, {
      type: 'film_completed', title: 'Your film is ready',
      body: `${film.title} — ${result.durationSeconds}s, ${result.scenes} scenes. Preview and download it now.`,
      actionUrl: `/films/${filmId}`,
    }).catch(() => {});
    return { ok: true, ...result };
  } catch (error) {
    await refundCredits(userId, cost, {
      idempotencyKey: `film_assembly_refund:${filmId}:${attempt}`,
      referenceType: 'film', referenceId: filmId, metadata: { reason: 'assembly_failed' },
    });
    await db('film_projects').where({ id: filmId }).update({
      status: 'failed', stage: 'failed', progress: 0,
      error: String(error.message).slice(0, 2000), detail: null, updated_at: now(),
    });
    await notify(userId, {
      type: 'film_failed', title: 'Film assembly failed',
      body: `${film.title}: ${String(error.message).slice(0, 180)}`, actionUrl: `/films/${filmId}`,
    }).catch(() => {});
    return { ok: false, error: String(error.message) };
  }
}

// --- detail + publishing ---------------------------------------------------
export async function filmDetail(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const [scenes, characters, summary, balance] = await Promise.all([
    db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc'),
    listCharacters(userId, { filmId, seriesId: film.series_id || undefined }),
    sceneSummary([filmId]),
    getBalance(userId),
  ]);
  const estimate = estimateFilm(scenes.map((s) => ({ duration_seconds: number(s.duration_seconds), dialogue: parseJson(s.dialogue, []) })));
  let preflight = { ready: false, missing: [], ttsProvider: 'unknown' };
  try { preflight = await assemblyPreflight(filmId); }
  catch (error) { preflight = { ready: false, missing: [], ttsProvider: `unavailable: ${error.message}` }; }
  return {
    ...filmView(film, summary.get(filmId)),
    scenes: scenes.map(sceneView),
    characters,
    estimate,
    balance,
    assemblyReady: preflight.ready,
    missingScenes: preflight.missing,
    ttsProvider: preflight.ttsProvider,
    limits: filmLimits(),
    scenePlan: planSceneCount(film.target_duration_seconds),
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
