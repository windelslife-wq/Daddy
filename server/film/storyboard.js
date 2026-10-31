/**
 * Storyboard, poster and character-concept stills.
 *
 * These are real images produced by the configured image provider and stored on
 * disk: with IMAGE_PROVIDER=procedural that is the built-in renderer (labelled
 * procedural, never AI), with openai/replicate it is a real model. The module
 * never fabricates a file and never sets a character reference image from
 * procedural art, because a reference must show the actual face.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, now, newId, number, parseJson, addJob } from '../db.js';
import { AppError } from '../errors.js';
import { ensureProjectDir } from '../media/utils.js';
import { generatePromptImage, imageProviderStatus } from '../media/images.js';
import { ownedFilm, scenePrompt } from './scenes.js';
import { scenePropsForPrompt } from './propPrompt.js';

const STORYBOARD_SUFFIX = 'Storyboard still frame for a film shot. Single cinematic image, correct composition, no text, no subtitles, no watermark, no logo, no collage.';

export const storyboardSchema = z.object({
  sceneIds: z.array(z.string()).max(400).optional(),
  force: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(60).optional().default(24),
});

export async function ownedFrame(userId, filmId, frameId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const frame = await db('film_storyboard_frames').where({ id: frameId, film_id: filmId }).first();
  if (!frame) throw new AppError(404, 'frame_not_found', 'Storyboard frame not found.');
  return frame;
}

export function frameView(frame) {
  return {
    id: frame.id,
    filmId: frame.film_id,
    sceneId: frame.scene_id,
    kind: frame.kind,
    characterId: frame.character_id,
    provider: frame.provider,
    width: number(frame.width),
    height: number(frame.height),
    status: frame.status,
    error: frame.error,
    hasImage: Boolean(frame.path && fs.existsSync(frame.path)),
    imageUrl: frame.path && fs.existsSync(frame.path) ? `/api/films/${frame.film_id}/storyboard/${frame.id}/image` : null,
    updatedAt: frame.updated_at,
  };
}

/** Current storyboard coverage for a film. */
export async function storyboardOverview(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  const frames = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  const byScene = new Map(frames.map((frame) => [frame.scene_id, frame]));
  return {
    provider: imageProviderStatus(),
    poster: Boolean(film.poster_path && fs.existsSync(film.poster_path)),
    scenes: scenes.map((scene) => {
      const frame = byScene.get(scene.id);
      return {
        id: scene.id,
        ordinal: number(scene.ordinal),
        heading: scene.heading,
        location: scene.location,
        durationSeconds: number(scene.duration_seconds),
        frame: frame ? frameView(frame) : null,
        hasClip: Boolean(scene.clip_path && fs.existsSync(scene.clip_path)),
      };
    }),
  };
}

async function upsertFrame({ filmId, sceneId, kind, characterId = null, patch }) {
  const query = db('film_storyboard_frames').where({ film_id: filmId, kind });
  if (sceneId) query.where({ scene_id: sceneId });
  else query.whereNull('scene_id');
  if (characterId) query.where({ character_id: characterId });
  const existing = await query.first();
  const timestamp = now();
  if (existing) {
    await db('film_storyboard_frames').where({ id: existing.id }).update({ ...patch, updated_at: timestamp });
    return { ...existing, ...patch, updated_at: timestamp };
  }
  const id = newId('frm_');
  await db('film_storyboard_frames').insert({
    id, film_id: filmId, scene_id: sceneId, kind, character_id: characterId,
    path: null, provider: null, width: 0, height: 0, prompt: '', status: 'pending', error: null,
    created_at: timestamp, updated_at: timestamp, ...patch,
  });
  return db('film_storyboard_frames').where({ id }).first();
}

/**
 * Render storyboard stills for scenes that do not have one yet (or all of them
 * with `force`). Bounded by `limit` so one request cannot block for minutes.
 */
export async function generateStoryboard(userId, filmId, input = {}, role = 'user') {
  const data = storyboardSchema.parse(input);
  const film = await ownedFilm(userId, filmId, role);
  const status = imageProviderStatus();
  if (!status.configured) {
    throw new AppError(503, 'image_provider_unavailable', `Storyboard stills need an image provider. IMAGE_PROVIDER=${status.provider} has no credentials; set OPENAI_API_KEY or REPLICATE_API_TOKEN, or use IMAGE_PROVIDER=procedural for local stills.`);
  }

  let scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  if (data.sceneIds?.length) scenes = scenes.filter((scene) => data.sceneIds.includes(scene.id));
  if (!scenes.length) throw new AppError(409, 'no_scenes', 'Write a screenplay first — there are no scenes to storyboard.');

  const characters = await db('film_characters').where({ film_id: filmId });
  const locations = await db('film_locations').where({ film_id: filmId });
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const existing = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  const existingByScene = new Map(existing.map((frame) => [frame.scene_id, frame]));

  const targets = (data.force ? scenes : scenes.filter((scene) => {
    const frame = existingByScene.get(scene.id);
    return !frame || !frame.path || !fs.existsSync(frame.path);
  })).slice(0, data.limit);

  if (!targets.length) {
    return { generated: 0, failed: 0, provider: status, skipped: scenes.length, frames: [] };
  }

  const dir = path.join(await ensureProjectDir(`film_${filmId}`), 'storyboard');
  await fsp.mkdir(dir, { recursive: true });
  const seedBase = `${filmId}:${film.style}:${film.genre}`;

  const frames = [];
  let generated = 0;
  const errors = [];
  for (const scene of targets) {
    const location = scene.location_id ? locationById.get(scene.location_id) : null;
    const prompt = `${scenePrompt(film, scene, characters, location, await scenePropsForPrompt(filmId, scene.id))} ${STORYBOARD_SUFFIX}`.slice(0, 2000);
    const outputPath = path.join(dir, `scene-${String(number(scene.ordinal)).padStart(4, '0')}.png`);
    await upsertFrame({
      filmId, sceneId: scene.id, kind: 'scene',
      patch: { prompt, status: 'generating', error: null },
    });
    try {
      const result = await generatePromptImage({
        prompt, aspectRatio: film.aspect_ratio, style: film.style,
        seedKey: `${seedBase}:${scene.id}`, outputPath,
      });
      const frame = await upsertFrame({
        filmId, sceneId: scene.id, kind: 'scene',
        patch: {
          path: result.path, provider: result.provider, width: result.width, height: result.height,
          status: 'ready', error: null, prompt,
        },
      });
      await db('film_scenes').where({ id: scene.id }).update({
        storyboard_path: result.path, storyboard_provider: result.provider,
        storyboard_at: now(), updated_at: now(),
      });
      frames.push(frameView(frame));
      generated += 1;
    } catch (error) {
      errors.push({ sceneId: scene.id, ordinal: number(scene.ordinal), error: error.message });
      await upsertFrame({
        filmId, sceneId: scene.id, kind: 'scene',
        patch: { status: 'failed', error: error.message, prompt },
      });
    }
  }

  return {
    generated, failed: errors.length, errors,
    provider: status,
    remaining: Math.max(0, scenes.length - (existingByScene.size + generated)),
    frames,
  };
}

/** A poster built from the film's own logline, style and palette. */
export async function generatePoster(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const status = imageProviderStatus();
  if (!status.configured) {
    throw new AppError(503, 'image_provider_unavailable', `Posters need an image provider. IMAGE_PROVIDER=${status.provider} has no credentials.`);
  }
  const bible = parseJson(film.story_bible, {});
  const prompt = [
    `Movie poster key art for "${film.title}".`,
    film.logline ? `Story: ${film.logline}.` : '',
    `Genre ${film.genre}, visual style ${film.style}, ${film.aspect_ratio}.`,
    bible.world ? `World: ${bible.world}.` : '',
    'Dramatic single-subject composition, cinematic lighting, negative space for the title, no text, no watermark, no logo.',
  ].filter(Boolean).join(' ').slice(0, 2000);

  const dir = await ensureProjectDir(`film_${filmId}`);
  const outputPath = path.join(dir, 'poster.png');
  const result = await generatePromptImage({
    prompt, aspectRatio: film.aspect_ratio, style: film.style, seedKey: `${filmId}:poster`, outputPath,
  });
  await db('film_projects').where({ id: filmId }).update({ poster_path: result.path, thumbnail_path: film.thumbnail_path || result.path, updated_at: now() });
  const frame = await upsertFrame({
    filmId, sceneId: null, kind: 'poster',
    patch: { path: result.path, provider: result.provider, width: result.width, height: result.height, prompt, status: 'ready', error: null },
  });
  return { poster: frameView(frame), provider: status, ai: result.ai };
}

/**
 * Character concept art. With a real AI provider this also becomes the
 * character's reference image (so faces stay consistent). Procedural art is
 * stored as concept art only and never used as a face reference.
 */
export async function generateCharacterConcept(userId, filmId, characterId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const character = await db('film_characters').where({ id: characterId, film_id: filmId }).first();
  if (!character) throw new AppError(404, 'character_not_found', 'Character not found.');
  const status = imageProviderStatus();
  if (!status.configured) {
    throw new AppError(503, 'image_provider_unavailable', `Character art needs an image provider. IMAGE_PROVIDER=${status.provider} has no credentials.`);
  }
  const prompt = [
    `Character concept portrait of ${character.name} (${character.role}) for a ${film.style} ${film.genre} film.`,
    character.appearance_prompt || character.description || '',
    'Front-facing, neutral studio background, consistent wardrobe, cinematic lighting, no text, no watermark.',
  ].filter(Boolean).join(' ').slice(0, 2000);
  const dir = path.join(await ensureProjectDir(`film_${filmId}`), 'cast');
  await fsp.mkdir(dir, { recursive: true });
  const safe = String(character.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || character.id;
  const result = await generatePromptImage({
    prompt, aspectRatio: '1:1', style: film.style, seedKey: `${filmId}:${character.id}`, outputPath: path.join(dir, `${safe}.png`),
  });
  const frame = await upsertFrame({
    filmId, sceneId: null, kind: 'character', characterId: character.id,
    patch: { path: result.path, provider: result.provider, width: result.width, height: result.height, prompt, status: 'ready', error: null },
  });
  if (result.ai && !character.reference_image_path) {
    await db('film_characters').where({ id: character.id }).update({ reference_image_path: result.path, updated_at: now() });
  }
  return {
    concept: frameView(frame), provider: status, ai: result.ai,
    usedAsReference: Boolean(result.ai && !character.reference_image_path),
  };
}

/**
 * Background queueing for long films: a 120-scene storyboard would otherwise
 * need five manual requests and hold an HTTP connection open for minutes.
 */
export async function queueStoryboard(userId, filmId, input = {}, role = 'user') {
  const data = storyboardSchema.parse(input);
  const film = await ownedFilm(userId, filmId, role);
  const status = imageProviderStatus();
  if (!status.configured) {
    throw new AppError(503, 'image_provider_unavailable', `Storyboard stills need an image provider. IMAGE_PROVIDER=${status.provider} has no credentials.`);
  }
  const scenes = await db('film_scenes').where({ film_id: filmId });
  if (!scenes.length) throw new AppError(409, 'no_scenes', 'Write a screenplay first — there are no scenes to storyboard.');
  const frames = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  const done = new Set(frames.filter((frame) => frame.path && fs.existsSync(frame.path)).map((frame) => frame.scene_id));
  const remaining = data.force ? scenes.length : scenes.filter((scene) => !done.has(scene.id)).length;
  const jobId = await addJob('film_storyboard_batch', { filmId, userId, force: data.force }, { maxAttempts: 2 });
  return { queued: true, jobId, remaining, provider: status, film: { id: film.id, title: film.title } };
}

/** Worker entry point: renders until the board is complete (bounded per job). */
export async function processStoryboardBatchJob({ filmId, userId, force = false } = {}) {
  let generated = 0;
  let failed = 0;
  let rounds = 0;
  while (rounds < 8) {
    const result = await generateStoryboard(userId, filmId, { force: force && rounds === 0, limit: 60 });
    generated += result.generated;
    failed += result.failed;
    rounds += 1;
    if (!result.generated && !result.failed) break;
    if (!result.remaining) break;
  }
  const scenes = await db('film_scenes').where({ film_id: filmId });
  const frames = await db('film_storyboard_frames').where({ film_id: filmId, kind: 'scene' });
  const done = frames.filter((frame) => frame.path && fs.existsSync(frame.path)).length;
  return { generated, failed, scenes: scenes.length, withStill: done, complete: done >= scenes.length };
}
