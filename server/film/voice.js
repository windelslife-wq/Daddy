/**
 * Voice studio: real per-scene dialogue takes.
 *
 * A take is genuine audio produced by the configured TTS provider (the local
 * meSpeak engine works with no credentials, so this is testable offline) and
 * stored on disk. The final mix is still voiced by the same provider at
 * assembly time; these takes exist so a director can hear a scene, check pacing
 * and catch an awkward line before spending video credits.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, now, number, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import { ensureProjectDir, probeVideo } from '../media/utils.js';
import { activeTtsProvider, synthesizeScene } from '../media/audio.js';
import { ownedFilm } from './scenes.js';

export const voiceSchema = z.object({
  sceneIds: z.array(z.string()).max(400).optional(),
  force: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(40).optional().default(20),
});

export function ttsStatus() {
  try {
    const provider = activeTtsProvider();
    return { provider, configured: true, local: provider.startsWith('mespeak') };
  } catch (error) {
    return { provider: null, configured: false, local: false, error: error.message };
  }
}

/** All spoken lines in a scene, in order. */
export function sceneLines(scene) {
  return parseJson(scene.dialogue, []).filter((line) => line?.line);
}

export function sceneScript(scene) {
  return sceneLines(scene).map((line) => `${line.character || 'Narrator'}: ${line.line}`).join('\n');
}

export async function voiceOverview(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  const characters = await db('film_characters').where({ film_id: filmId });
  const voiceByName = new Map(characters.map((character) => [String(character.name).toLowerCase(), character.voice_preset || null]));
  const metadata = parseJson(film.metadata, {});
  return {
    tts: ttsStatus(),
    language: film.language,
    voice: metadata.voice || 'nova',
    scenes: scenes.map((scene) => {
      const lines = sceneLines(scene);
      const cast = [...new Set(lines.map((line) => line.character).filter(Boolean))];
      const hasTake = Boolean(scene.voice_path && fs.existsSync(scene.voice_path));
      return {
        id: scene.id,
        ordinal: number(scene.ordinal),
        heading: scene.heading,
        dialogueLines: lines.length,
        cast,
        voices: cast.map((name) => ({ name, voice: voiceByName.get(String(name).toLowerCase()) || null })),
        take: hasTake ? {
          provider: scene.voice_provider,
          durationSeconds: Number(scene.voice_duration) || 0,
          generatedAt: scene.voice_at,
          url: `/api/films/${filmId}/scenes/${scene.id}/voice`,
        } : null,
        script: sceneScript(scene),
      };
    }),
    totals: {
      scenes: scenes.length,
      withDialogue: scenes.filter((scene) => sceneLines(scene).length).length,
      withTake: scenes.filter((scene) => scene.voice_path && fs.existsSync(scene.voice_path)).length,
    },
  };
}

/**
 * Generate takes for scenes that have dialogue and no take yet (or all of them
 * with `force`). One bad line never destroys the rest: failures are reported
 * per scene with their real provider error.
 */
export async function generateVoiceTakes(userId, filmId, input = {}, role = 'user') {
  const data = voiceSchema.parse(input);
  const film = await ownedFilm(userId, filmId, role);
  const tts = ttsStatus();
  if (!tts.configured) {
    throw new AppError(503, 'tts_unavailable', tts.error || 'No text-to-speech provider is configured.');
  }
  let scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  if (data.sceneIds?.length) scenes = scenes.filter((scene) => data.sceneIds.includes(scene.id));
  const spoken = scenes.filter((scene) => sceneLines(scene).length);
  if (!spoken.length) throw new AppError(409, 'no_dialogue', 'No scene has dialogue yet. Write or edit the screenplay first.');

  const needsTake = (scene) => data.force || !scene.voice_path || !fs.existsSync(scene.voice_path);
  const targets = spoken.filter(needsTake).slice(0, data.limit);
  if (!targets.length) {
    return { generated: 0, failed: 0, skipped: scenes.length, provider: tts.provider, takes: [] };
  }

  const characters = await db('film_characters').where({ film_id: filmId });
  const voiceByName = new Map(characters.map((character) => [String(character.name).toLowerCase(), character.voice_preset]));
  const metadata = parseJson(film.metadata, {});
  const dir = path.join(await ensureProjectDir(`film_${filmId}`), 'voice');
  const workDir = path.join(dir, 'raw');
  await fsp.mkdir(workDir, { recursive: true });

  const takes = [];
  const errors = [];
  for (const scene of targets) {
    const text = sceneScript(scene);
    const firstSpeaker = sceneLines(scene)[0]?.character;
    const voice = voiceByName.get(String(firstSpeaker).toLowerCase()) || metadata.voice || 'nova';
    const outputPath = path.join(dir, `scene-${String(number(scene.ordinal)).padStart(4, '0')}.wav`);
    try {
      await synthesizeScene({
        text, language: film.language, voice, outputPath, workDir,
        index: number(scene.ordinal),
      });
      const probe = await probeVideo(outputPath);
      const duration = probe.durationSeconds || 0;
      await db('film_scenes').where({ id: scene.id }).update({
        voice_path: outputPath, voice_provider: tts.provider,
        voice_duration: duration, voice_at: now(), updated_at: now(),
      });
      takes.push({
        sceneId: scene.id, ordinal: number(scene.ordinal), provider: tts.provider,
        durationSeconds: duration, url: `/api/films/${filmId}/scenes/${scene.id}/voice`,
      });
    } catch (error) {
      errors.push({ sceneId: scene.id, ordinal: number(scene.ordinal), error: error.message });
    }
  }

  return {
    generated: takes.length,
    failed: errors.length,
    errors,
    provider: tts.provider,
    takes,
    remaining: Math.max(0, spoken.length - targets.length - takes.length),
  };
}

export async function sceneTakePath(userId, filmId, sceneId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  if (!scene.voice_path || !fs.existsSync(scene.voice_path)) {
    throw new AppError(404, 'voice_take_missing', 'This scene has no voice take yet. Generate one first.');
  }
  return { path: scene.voice_path, filename: `scene-${number(scene.ordinal)}-voice.wav` };
}
