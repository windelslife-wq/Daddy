/**
 * Reusable filming locations.
 *
 * A location is a real production asset: it carries the set description, the
 * time of day, the palette and an optional reference still. Scenes link to a
 * location by id so every episode that returns to the same place keeps the
 * same production design instead of re-describing it in prose each time.
 *
 * Scope:
 *  - film-scoped    → used by one project
 *  - series-scoped  → shared by every episode of a series
 *  - user-scoped    → a personal library location, reusable anywhere
 */
import { z } from 'zod';
import { db, now, json, newId, parseJson } from '../db.js';
import { AppError } from '../errors.js';

const optionalId = z.string().trim().max(48).optional().nullable();

export const locationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional().default(''),
  timeOfDay: z.string().max(60).optional().default(''),
  weather: z.string().max(60).optional().default(''),
  palette: z.string().max(120).optional().default(''),
  style: z.string().max(60).optional().default(''),
  filmId: optionalId,
  seriesId: optionalId,
});

export const patchLocationSchema = locationSchema.partial();

export function locationView(row) {
  if (!row) return null;
  return {
    id: row.id,
    filmId: row.film_id || null,
    seriesId: row.series_id || null,
    name: row.name,
    description: row.description,
    timeOfDay: row.time_of_day,
    weather: row.weather,
    palette: row.palette,
    style: row.style,
    hasReferenceImage: Boolean(row.reference_image_path),
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Verify the target film/series belongs to this user before scoping a location to it. */
async function assertScope(userId, { filmId, seriesId }, role = 'user') {
  if (filmId && seriesId) {
    throw new AppError(400, 'location_scope_conflict', 'A location belongs to a film OR a series, not both.');
  }
  if (filmId) {
    const film = await db('film_projects').where({ id: filmId }).first();
    if (!film) throw new AppError(404, 'film_not_found', 'Film project not found.');
    if (film.user_id !== userId && role !== 'admin') throw new AppError(403, 'forbidden', 'You do not have access to this project.');
  }
  if (seriesId) {
    const series = await db('film_series').where({ id: seriesId }).first();
    if (!series) throw new AppError(404, 'series_not_found', 'Series not found.');
    if (series.user_id !== userId && role !== 'admin') throw new AppError(403, 'forbidden', 'You do not have access to this series.');
  }
}

/** Locations available to a project: its own, its series', plus the user library. */
export async function listLocations(userId, { filmId, seriesId } = {}) {
  let series = seriesId;
  if (filmId && !series) {
    const film = await db('film_projects').where({ id: filmId, user_id: userId }).first();
    series = film?.series_id || null;
  }
  const query = db('film_locations').where({ user_id: userId });
  if (filmId || series) {
    query.where((q) => {
      if (filmId) q.where({ film_id: filmId });
      if (series) q.orWhere({ series_id: series });
      q.orWhere((inner) => inner.whereNull('film_id').whereNull('series_id'));
    });
  }
  const rows = await query.orderBy('created_at', 'asc');
  return rows.map(locationView);
}

export async function ownedLocation(userId, locationId) {
  const row = await db('film_locations').where({ id: locationId }).first();
  if (!row) throw new AppError(404, 'location_not_found', 'Location not found.');
  if (row.user_id !== userId) throw new AppError(403, 'forbidden', 'You do not have access to this location.');
  return row;
}

export async function createLocation(userId, payload = {}, role = 'user') {
  const data = locationSchema.parse(payload);
  await assertScope(userId, data, role);
  const id = newId('loc_');
  const timestamp = now();
  await db('film_locations').insert({
    id,
    user_id: userId,
    film_id: data.filmId || null,
    series_id: data.seriesId || null,
    name: data.name,
    description: data.description || '',
    time_of_day: data.timeOfDay || '',
    weather: data.weather || '',
    palette: data.palette || '',
    style: data.style || '',
    metadata: json({}),
    created_at: timestamp,
    updated_at: timestamp,
  });
  return locationView(await db('film_locations').where({ id }).first());
}

export async function updateLocation(userId, locationId, patch = {}, role = 'user') {
  const existing = await ownedLocation(userId, locationId);
  const data = patchLocationSchema.parse(patch);
  await assertScope(userId, { filmId: data.filmId, seriesId: data.seriesId }, role);
  const updates = { updated_at: now() };
  const columns = {
    name: 'name', description: 'description', timeOfDay: 'time_of_day',
    weather: 'weather', palette: 'palette', style: 'style',
  };
  for (const [key, column] of Object.entries(columns)) {
    if (data[key] !== undefined) updates[column] = data[key];
  }
  if (data.filmId !== undefined) updates.film_id = data.filmId || null;
  if (data.seriesId !== undefined) updates.series_id = data.seriesId || null;
  if (updates.film_id && updates.series_id) {
    throw new AppError(400, 'location_scope_conflict', 'A location belongs to a film OR a series, not both.');
  }
  await db('film_locations').where({ id: existing.id }).update(updates);
  return locationView(await db('film_locations').where({ id: existing.id }).first());
}

/** Delete a location and detach it from any scene that referenced it. */
export async function deleteLocation(userId, locationId) {
  const existing = await ownedLocation(userId, locationId);
  let detached = 0;
  await db.transaction(async (trx) => {
    detached = await trx('film_scenes').where({ location_id: existing.id }).update({ location_id: null, updated_at: now() });
    await trx('film_locations').where({ id: existing.id }).del();
  });
  return { deleted: true, detachedScenes: Number(detached) || 0 };
}

/** True when the location exists and belongs to the user (used by scene updates). */
export async function locationExistsFor(userId, locationId) {
  if (!locationId) return false;
  const row = await db('film_locations').where({ id: locationId, user_id: userId }).first();
  return Boolean(row);
}
