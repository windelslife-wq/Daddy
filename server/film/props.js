/**
 * Props continuity.
 *
 * A prop is a persisted object with a look and a state per scene ("the letter,
 * folded" → "the letter, torn"). Props are linked to scenes, injected into the
 * image/video prompt, and audited by QC, so a prop cannot silently change shape
 * or vanish between shots.
 */
import fs from 'node:fs';
import { z } from 'zod';
import { db, now, newId, json, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import { ownedFilm } from './scenes.js';
import { propClause } from './propPrompt.js';

export const propSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).optional().default(''),
  category: z.string().max(60).optional().default('prop'),
  material: z.string().max(80).optional().default(''),
  color: z.string().max(60).optional().default(''),
});

export const scenePropsSchema = z.array(z.object({
  propId: z.string().min(1).max(48),
  state: z.string().max(120).optional().default(''),
})).max(12);

export function propView(row, extra = {}) {
  return {
    id: row.id,
    filmId: row.film_id || null,
    name: row.name,
    description: row.description,
    category: row.category,
    material: row.material,
    color: row.color,
    hasReferenceImage: Boolean(row.reference_image_path && fs.existsSync(row.reference_image_path)),
    metadata: parseJson(row.metadata, {}),
    ...extra,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProps(userId, { filmId } = {}) {
  const query = db('film_props').where({ user_id: userId });
  if (filmId) query.where((q) => q.where({ film_id: filmId }).orWhereNull('film_id'));
  const rows = await query.orderBy('created_at', 'asc');
  const links = rows.length
    ? await db('film_scene_props').whereIn('prop_id', rows.map((row) => row.id))
    : [];
  const usage = new Map();
  for (const link of links) usage.set(link.prop_id, (usage.get(link.prop_id) || 0) + 1);
  return rows.map((row) => propView(row, { sceneCount: usage.get(row.id) || 0 }));
}

export async function createProp(userId, filmId, input = {}, role = 'user') {
  if (filmId) await ownedFilm(userId, filmId, role);
  const data = propSchema.parse(input);
  const id = newId('prop_');
  await db('film_props').insert({
    id, user_id: userId, film_id: filmId || null,
    name: data.name, description: data.description, category: data.category,
    material: data.material, color: data.color, reference_image_path: null,
    metadata: json({}), created_at: now(), updated_at: now(),
  });
  return propView(await db('film_props').where({ id }).first());
}

export async function updateProp(userId, propId, input = {}) {
  const row = await db('film_props').where({ id: propId }).first();
  if (!row) throw new AppError(404, 'prop_not_found', 'Prop not found.');
  if (row.user_id !== userId) throw new AppError(403, 'forbidden', 'You do not have access to this prop.');
  const data = propSchema.partial().parse(input);
  await db('film_props').where({ id: propId }).update({ ...data, updated_at: now() });
  return propView(await db('film_props').where({ id: propId }).first());
}

export async function deleteProp(userId, propId) {
  const row = await db('film_props').where({ id: propId }).first();
  if (!row) throw new AppError(404, 'prop_not_found', 'Prop not found.');
  if (row.user_id !== userId) throw new AppError(403, 'forbidden', 'You do not have access to this prop.');
  await db('film_scene_props').where({ prop_id: propId }).delete();
  await db('film_props').where({ id: propId }).delete();
  return { deleted: true };
}

export async function propsForScenes(userId, sceneIds) {
  if (!sceneIds.length) return new Map();
  const links = await db('film_scene_props').whereIn('scene_id', sceneIds);
  if (!links.length) return new Map();
  const props = await db('film_props').whereIn('id', [...new Set(links.map((link) => link.prop_id))]).where({ user_id: userId });
  const byId = new Map(props.map((prop) => [prop.id, prop]));
  const map = new Map();
  for (const link of links) {
    const prop = byId.get(link.prop_id);
    if (!prop) continue;
    if (!map.has(link.scene_id)) map.set(link.scene_id, []);
    map.get(link.scene_id).push(propView(prop, { state: link.state }));
  }
  return map;
}

/** Link the props a scene shows, replacing previous links. */
export async function setSceneProps(userId, filmId, sceneId, entries, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  const data = scenePropsSchema.parse(entries || []);
  if (data.length) {
    const known = await db('film_props').where({ user_id: userId }).whereIn('id', data.map((entry) => entry.propId));
    const knownIds = new Set(known.map((prop) => prop.id));
    const unknown = data.filter((entry) => !knownIds.has(entry.propId));
    if (unknown.length) throw new AppError(400, 'prop_unknown', 'Save the prop to your library first, then link it to the scene.');
  }
  await db('film_scene_props').where({ scene_id: sceneId }).delete();
  if (data.length) {
    await db('film_scene_props').insert(data.map((entry) => ({
      film_id: filmId, scene_id: sceneId, prop_id: entry.propId,
      state: entry.state || '', created_at: now(),
    })));
  }
  await db('film_scenes').where({ id: sceneId }).update({ updated_at: now() });
  return (await propsForScenes(userId, [sceneId])).get(sceneId) || [];
}

export { propClause };
