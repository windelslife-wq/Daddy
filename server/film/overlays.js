/**
 * Overlay image assets for picture-in-picture tracks and brand logos.
 *
 * Files are uploaded by the owner, stored inside the project directory and
 * registered in `film_projects.metadata.overlayAssets`. Scenes reference an
 * asset by id, never by path, so a client cannot point FFmpeg at an arbitrary
 * file on disk — the renderer resolves the path from the owner's record.
 */
import fs from 'node:fs';
import { db, now, json, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import { ownedFilm } from './scenes.js';

function assetList(film) {
  const metadata = parseJson(film?.metadata, {});
  return Array.isArray(metadata.overlayAssets) ? metadata.overlayAssets : [];
}

export async function overlayAssetList(filmId) {
  const film = await db('film_projects').where({ id: filmId }).first();
  return assetList(film).filter((asset) => asset?.path && fs.existsSync(asset.path));
}

export async function overlayAssetMap(filmId) {
  const list = await overlayAssetList(filmId);
  return new Map(list.map((asset) => [asset.id, asset]));
}

export async function addOverlayAsset(userId, filmId, asset, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const metadata = parseJson(film.metadata, {});
  const list = assetList(film);
  const record = {
    id: `ovl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(asset.name || 'Overlay').slice(0, 120),
    path: asset.path,
    kind: asset.kind === 'logo' ? 'logo' : 'overlay',
    bytes: Number(asset.bytes) || 0,
    createdAt: now(),
  };
  metadata.overlayAssets = [...list, record];
  await db('film_projects').where({ id: filmId }).update({ metadata: json(metadata), updated_at: now() });
  return record;
}

export async function deleteOverlayAsset(userId, filmId, assetId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const metadata = parseJson(film.metadata, {});
  const list = assetList(film);
  const asset = list.find((item) => item.id === assetId);
  if (!asset) throw new AppError(404, 'overlay_not_found', 'Overlay image not found.');
  metadata.overlayAssets = list.filter((item) => item.id !== assetId);
  await db('film_projects').where({ id: filmId }).update({ metadata: json(metadata), updated_at: now() });
  // Clear scene overlays that used it, so a render can never point at a deleted file.
  const scenes = await db('film_scenes').where({ film_id: filmId }).whereNotNull('overlay_json');
  for (const scene of scenes) {
    const overlay = parseJson(scene.overlay_json, null);
    if (overlay?.overlayId === assetId) {
      await db('film_scenes').where({ id: scene.id }).update({
        overlay_json: overlay.text ? json({ ...overlay, overlayId: null }) : null,
        updated_at: now(),
      });
    }
  }
  if (asset.path) fs.rm(asset.path, { force: true }, () => {});
  return { deleted: true, id: assetId };
}
