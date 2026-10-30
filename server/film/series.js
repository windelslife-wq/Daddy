/**
 * Episodic series: seasons, episodes, story bibles and continuity.
 * Each episode is backed by a real film_project so the same scene-by-scene
 * generation / assembly pipeline powers shorts, movies and episodes alike.
 */
import { z } from 'zod';
import { db, now, newId, json, parseJson, number } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { FILM_GENRES, FILM_STYLES, FILM_ASPECTS, generateScreenplay } from './screenplay.js';
import { createFilm, saveScreenplay, filmDetail } from './scenes.js';
import { listCharacters, characterView } from './scenes.js';
import { estimateFromScreenplay } from './credits.js';

export const EPISODE_STATUSES = ['draft', 'upcoming', 'completed', 'published'];

export const seriesSchema = z.object({
  title: z.string().trim().min(2).max(220),
  description: z.string().max(3000).optional().default(''),
  genre: z.string().max(60).optional().default('drama'),
  language: z.string().max(12).optional().default('en'),
  style: z.string().max(60).optional().default('cinematic'),
  storyBible: z.record(z.any()).optional().default({}),
  status: z.enum(['active', 'hiatus', 'completed', 'archived']).optional().default('active'),
});

export const episodeSchema = z.object({
  seasonNumber: z.number().int().min(1).max(100).optional().default(1),
  episodeNumber: z.number().int().min(1).max(10000).optional(),
  title: z.string().trim().min(2).max(220),
  synopsis: z.string().max(3000).optional().default(''),
  idea: z.string().max(4000).optional().default(''),
  status: z.enum(EPISODE_STATUSES).optional().default('draft'),
  targetDurationSeconds: z.number().int().min(5).max(config.film.maxProjectSeconds).optional(),
  aspectRatio: z.enum(FILM_ASPECTS).optional().default('9:16'),
  continuityNotes: z.string().max(3000).optional().default(''),
  credits: z.array(z.object({ name: z.string().max(120), role: z.string().max(120) })).max(50).optional().default([]),
});

export function seriesView(row, episodes = []) {
  if (!row) return null;
  const seasons = [...new Set(episodes.map((e) => number(e.season_number, 1)))].sort((a, b) => a - b);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    language: row.language,
    style: row.style,
    storyBible: parseJson(row.story_bible, {}),
    status: row.status,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seasons,
    episodeCount: episodes.length,
    completedEpisodes: episodes.filter((e) => ['completed', 'published'].includes(e.status)).length,
  };
}

export function episodeView(row, film = null) {
  if (!row) return null;
  return {
    id: row.id,
    seriesId: row.series_id,
    filmId: row.film_id || null,
    seasonNumber: number(row.season_number, 1),
    episodeNumber: number(row.episode_number),
    title: row.title,
    synopsis: row.synopsis,
    status: row.status,
    continuityNotes: row.continuity_notes,
    hasThumbnail: Boolean(row.thumbnail_path),
    credits: parseJson(row.credits, []),
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    film: film ? {
      id: film.id, title: film.title, stage: film.stage, status: film.status,
      progress: number(film.progress), sceneCount: number((parseJson(film.screenplay, {}).scenes || []).length),
      hasVideo: Boolean(film.final_video_path), durationSeconds: number(film.duration_seconds),
    } : null,
  };
}

async function ownedSeries(userId, seriesId, role = 'user') {
  const series = await db('film_series').where({ id: seriesId }).first();
  if (!series) throw new AppError(404, 'series_not_found', 'Series not found.');
  if (series.user_id !== userId && role !== 'admin') throw new AppError(403, 'forbidden', 'You do not have access to this series.');
  return series;
}

export async function createSeries(userId, payload) {
  const data = seriesSchema.parse(payload);
  const id = newId('ser_');
  const timestamp = now();
  await db('film_series').insert({
    id, user_id: userId, title: data.title, description: data.description,
    genre: data.genre, language: data.language, style: data.style,
    story_bible: json(data.storyBible), status: data.status,
    metadata: json({}), created_at: timestamp, updated_at: timestamp,
  });
  return seriesView(await db('film_series').where({ id }).first());
}

export async function listSeries(userId) {
  const rows = await db('film_series').where({ user_id: userId }).orderBy('updated_at', 'desc');
  const ids = rows.map((r) => r.id);
  const episodes = ids.length ? await db('film_episodes').whereIn('series_id', ids) : [];
  return rows.map((row) => seriesView(row, episodes.filter((e) => e.series_id === row.id)));
}

export async function seriesDetail(userId, seriesId, role = 'user') {
  const series = await ownedSeries(userId, seriesId, role);
  const [episodes, characters] = await Promise.all([
    db('film_episodes').where({ series_id: seriesId }).orderBy('season_number', 'asc').orderBy('episode_number', 'asc'),
    listCharacters(userId, { seriesId }),
  ]);
  const filmIds = episodes.map((e) => e.film_id).filter(Boolean);
  const films = filmIds.length ? await db('film_projects').whereIn('id', filmIds) : [];
  const filmMap = new Map(films.map((f) => [f.id, f]));
  return {
    ...seriesView(series, episodes),
    episodes: episodes.map((row) => episodeView(row, filmMap.get(row.film_id))),
    characters,
    limits: { maxScenes: config.film.maxScenes, maxProjectSeconds: config.film.maxProjectSeconds },
  };
}

export async function updateSeries(userId, seriesId, patch, role = 'user') {
  await ownedSeries(userId, seriesId, role);
  const data = seriesSchema.partial().parse(patch);
  const updates = { updated_at: now() };
  for (const [key, column] of Object.entries({ title: 'title', description: 'description', genre: 'genre', language: 'language', style: 'style', status: 'status' })) {
    if (data[key] !== undefined) updates[column] = data[key];
  }
  if (data.storyBible) updates.story_bible = json(data.storyBible);
  await db('film_series').where({ id: seriesId }).update(updates);
  return seriesDetail(userId, seriesId, role);
}

export async function deleteSeries(userId, seriesId, role = 'user') {
  await ownedSeries(userId, seriesId, role);
  const films = await db('film_projects').where({ series_id: seriesId }).select('id');
  for (const film of films) {
    await db('film_scenes').where({ film_id: film.id }).del();
    await db('film_characters').where({ film_id: film.id }).del();
  }
  await db('film_projects').where({ series_id: seriesId }).del();
  await db('film_episodes').where({ series_id: seriesId }).del();
  await db('film_characters').where({ series_id: seriesId }).del();
  await db('film_series').where({ id: seriesId }).del();
  return { deleted: true };
}

/** Create an episode AND its backing film project in one atomic operation. */
export async function createEpisode(userId, seriesId, payload, role = 'user') {
  const series = await ownedSeries(userId, seriesId, role);
  const data = episodeSchema.parse(payload);
  const existing = await db('film_episodes').where({ series_id: seriesId }).orderBy('episode_number', 'desc').first();
  const episodeNumber = data.episodeNumber || number(existing?.episode_number) + 1;
  const conflict = await db('film_episodes').where({ series_id: seriesId, season_number: data.seasonNumber, episode_number: episodeNumber }).first();
  if (conflict) throw new AppError(409, 'episode_exists', `Season ${data.seasonNumber} episode ${episodeNumber} already exists.`);

  const timestamp = now();
  const episodeId = newId('epd_');
  let filmId = null;
  await db.transaction(async (trx) => {
    filmId = newId('flm_');
    await trx('film_projects').insert({
      id: filmId, user_id: userId, series_id: seriesId,
      season_number: data.seasonNumber, episode_number: episodeNumber,
      type: 'episode', title: data.title, logline: data.synopsis,
      genre: series.genre, language: series.language, style: series.style,
      aspect_ratio: data.aspectRatio, target_platform: 'youtube',
      target_duration_seconds: data.targetDurationSeconds ?? 180,
      story_bible: series.story_bible, screenplay: json({}),
      status: 'draft', stage: 'draft', progress: 0,
      metadata: json({ voice: 'nova', subtitles: true, episodeId, idea: data.idea }),
      created_at: timestamp, updated_at: timestamp,
    });
    await trx('film_episodes').insert({
      id: episodeId, series_id: seriesId, user_id: userId, film_id: filmId,
      season_number: data.seasonNumber, episode_number: episodeNumber,
      title: data.title, synopsis: data.synopsis, status: data.status,
      continuity_notes: data.continuityNotes, credits: json(data.credits),
      created_at: timestamp, updated_at: timestamp,
    });
    await trx('film_series').where({ id: seriesId }).update({ updated_at: timestamp });
  });
  return episodeView(await db('film_episodes').where({ id: episodeId }).first(), await db('film_projects').where({ id: filmId }).first());
}

export const patchEpisodeSchema = episodeSchema.partial().omit({ episodeNumber: true, seasonNumber: true }).extend({
  thumbnailPath: z.string().max(500).optional(),
});

export async function updateEpisode(userId, seriesId, episodeId, patch, role = 'user') {
  await ownedSeries(userId, seriesId, role);
  const episode = await db('film_episodes').where({ id: episodeId, series_id: seriesId }).first();
  if (!episode) throw new AppError(404, 'episode_not_found', 'Episode not found.');
  const data = patchEpisodeSchema.parse(patch);
  const updates = { updated_at: now() };
  for (const [key, column] of Object.entries({ title: 'title', synopsis: 'synopsis', status: 'status', continuityNotes: 'continuity_notes' })) {
    if (data[key] !== undefined) updates[column] = data[key];
  }
  if (data.credits) updates.credits = json(data.credits);
  if (data.thumbnailPath) updates.thumbnail_path = data.thumbnailPath;
  await db('film_episodes').where({ id: episodeId }).update(updates);
  if (episode.film_id && (data.title || data.synopsis || data.targetDurationSeconds || data.idea)) {
    const filmPatch = {};
    if (data.title) filmPatch.title = data.title;
    if (data.synopsis) filmPatch.logline = data.synopsis;
    if (data.targetDurationSeconds) filmPatch.target_duration_seconds = data.targetDurationSeconds;
    if (data.idea) {
      const film = await db('film_projects').where({ id: episode.film_id }).first();
      filmPatch.metadata = json({ ...parseJson(film?.metadata, {}), idea: data.idea });
    }
    await db('film_projects').where({ id: episode.film_id }).update({ ...filmPatch, updated_at: now() });
  }
  return episodeView(await db('film_episodes').where({ id: episodeId }).first());
}

export async function deleteEpisode(userId, seriesId, episodeId, role = 'user') {
  await ownedSeries(userId, seriesId, role);
  const episode = await db('film_episodes').where({ id: episodeId, series_id: seriesId }).first();
  if (!episode) throw new AppError(404, 'episode_not_found', 'Episode not found.');
  if (episode.film_id) {
    await db('film_scenes').where({ film_id: episode.film_id }).del();
    await db('film_characters').where({ film_id: episode.film_id }).del();
    await db('film_projects').where({ id: episode.film_id }).del();
  }
  await db('film_episodes').where({ id: episodeId }).del();
  return { deleted: true };
}

/**
 * Write an episode screenplay using the series story bible, recurring cast and
 * all earlier episodes as continuity context.
 */
export async function generateEpisodeScreenplay(userId, seriesId, episodeId, options = {}, role = 'user') {
  const series = await ownedSeries(userId, seriesId, role);
  const episode = await db('film_episodes').where({ id: episodeId, series_id: seriesId }).first();
  if (!episode) throw new AppError(404, 'episode_not_found', 'Episode not found.');
  if (!episode.film_id) throw new AppError(409, 'episode_no_film', 'This episode has no linked film project.');
  const film = await db('film_projects').where({ id: episode.film_id }).first();
  const [previous, characters] = await Promise.all([
    db('film_episodes').where({ series_id: seriesId }).where('episode_number', '<', number(episode.episode_number))
      .orderBy('episode_number', 'asc').limit(30),
    listCharacters(userId, { seriesId }),
  ]);
  const metadata = parseJson(film.metadata, {});
  const idea = options.idea || metadata.idea || episode.synopsis
    || `Continue ${series.title} with season ${number(episode.season_number, 1)} episode ${number(episode.episode_number)}: ${episode.title}.`;
  const storyBible = {
    ...parseJson(series.story_bible, {}),
    seriesTitle: series.title,
    seasonNumber: number(episode.season_number, 1),
    episodeNumber: number(episode.episode_number),
    continuity_notes: episode.continuity_notes || '',
  };
  const screenplay = await generateScreenplay({
    idea, type: 'episode', genre: series.genre, language: series.language, style: series.style,
    aspectRatio: film.aspect_ratio, platform: film.target_platform,
    targetDurationSeconds: options.targetDurationSeconds || film.target_duration_seconds,
    storyBible,
    characters: characters.map((c) => ({ name: c.name, role: c.role, appearance_prompt: c.appearancePrompt, voice_preset: c.voicePreset })),
    previousEpisodes: previous.map((e) => ({ title: e.title, synopsis: e.synopsis, continuity_notes: e.continuity_notes })),
    episodeLabel: `episode ${number(episode.episode_number)} idea`,
    allowTemplate: options.allowTemplate !== false,
  });
  const detail = await saveScreenplay(userId, episode.film_id, screenplay, role);
  await db('film_episodes').where({ id: episodeId }).update({
    synopsis: screenplay.logline || episode.synopsis,
    continuity_notes: screenplay.story_bible?.continuity_notes || episode.continuity_notes,
    status: episode.status === 'draft' ? 'draft' : episode.status,
    updated_at: now(),
  });
  return {
    episode: episodeView(await db('film_episodes').where({ id: episodeId }).first()),
    film: detail,
    estimate: estimateFromScreenplay(screenplay),
    aiGenerated: screenplay.aiGenerated,
    provider: screenplay.provider,
  };
}

/** Convenience: materialise a whole season outline in one call. */
export async function bulkCreateEpisodes(userId, seriesId, { seasonNumber = 1, titles = [] }, role = 'user') {
  const series = await ownedSeries(userId, seriesId, role);
  if (!Array.isArray(titles) || !titles.length || titles.length > 50) throw new AppError(400, 'invalid_titles', 'Provide 1–50 episode titles.');
  const created = [];
  for (let i = 0; i < titles.length; i += 1) {
    created.push(await createEpisode(userId, seriesId, {
      seasonNumber, episodeNumber: i + 1, title: String(titles[i]).slice(0, 220),
      synopsis: `Episode ${i + 1} of ${series.title}.`, status: 'upcoming',
    }, role));
  }
  return created;
}
