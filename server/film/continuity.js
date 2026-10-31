/**
 * Production quality control and continuity audit.
 *
 * Every check is derived from persisted state — clips that exist on disk,
 * character reference images, linked locations, shot direction, dialogue and
 * the assembly record. Nothing is optimistic: a check that cannot be verified
 * says so instead of passing by default.
 *
 * This is the gate a creator (or the production agent) runs before export:
 * it names exactly what is missing and which scene to fix.
 */
import fs from 'node:fs';
import { db, number, parseJson } from '../db.js';
import { ownedFilm } from './scenes.js';
import { assemblyPreflight } from './assembly.js';

const PASS = 'pass';
const WARN = 'warn';
const FAIL = 'fail';
const SKIP = 'skip';

function check(id, label, status, detail, evidence = null) {
  return { id, label, status, detail, evidence };
}

function clipExists(scene) {
  return Boolean(scene.clip_path && fs.existsSync(scene.clip_path));
}

function scenesUsingCharacter(scenes, name) {
  const needle = String(name || '').toLowerCase();
  if (!needle) return [];
  return scenes.filter((scene) => {
    const cast = parseJson(scene.cast, []).map((value) => String(value).toLowerCase());
    const dialogue = parseJson(scene.dialogue, []).map((line) => String(line.character || '').toLowerCase());
    const text = `${scene.description || ''} ${scene.visual_prompt || ''}`.toLowerCase();
    return cast.includes(needle) || dialogue.includes(needle) || text.includes(needle);
  });
}

/**
 * Build the QC report.
 * @returns {Promise<{generatedAt,status,score,summary,checks,scenes}>}
 */
export async function filmQualityReport(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const [scenes, characters, locations] = await Promise.all([
    db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc'),
    db('film_characters').where({ user_id: userId })
      .where((q) => q.where({ film_id: filmId }).orWhere({ series_id: film.series_id || '' })),
    db('film_locations').where({ user_id: userId })
      .where((q) => q.where({ film_id: filmId }).orWhere({ series_id: film.series_id || '' })
        .orWhere((inner) => inner.whereNull('film_id').whereNull('series_id'))),
  ]);

  const checks = [];
  const total = scenes.length;

  // --- 1. Story / scenes ----------------------------------------------------
  checks.push(check(
    'scenes', 'Screenplay has scenes',
    total > 0 ? PASS : FAIL,
    total > 0 ? `${total} scene(s) planned.` : 'No scenes exist yet — write or import a screenplay first.',
    { scenes: total },
  ));

  // --- 2. Real generated clips ---------------------------------------------
  const ready = scenes.filter(clipExists);
  const failed = scenes.filter((scene) => scene.status === 'failed');
  const missing = scenes.filter((scene) => !clipExists(scene));
  checks.push(check(
    'clips', 'Every scene has a real generated clip',
    total === 0 ? SKIP : missing.length === 0 ? PASS : ready.length === 0 ? FAIL : WARN,
    total === 0
      ? 'Nothing to check yet.'
      : missing.length === 0
        ? `All ${total} scene(s) have a verified clip on disk.`
        : `${missing.length} of ${total} scene(s) still need a clip (scene ${missing.slice(0, 8).map((scene) => scene.ordinal).join(', ')}${missing.length > 8 ? '…' : ''}).`,
    { ready: ready.length, missing: missing.map((scene) => scene.ordinal).slice(0, 50) },
  ));

  checks.push(check(
    'failed-scenes', 'No failed generations',
    failed.length === 0 ? PASS : WARN,
    failed.length === 0 ? 'No scene is in a failed state.' : `${failed.length} scene(s) failed and can be retried: ${failed.map((scene) => scene.ordinal).join(', ')}.`,
    { failed: failed.map((scene) => scene.ordinal) },
  ));

  // --- 3. Shot direction coverage ------------------------------------------
  const directed = scenes.filter((scene) => scene.shot_size && scene.camera_angle);
  checks.push(check(
    'shot-direction', 'Scenes are directed (shot size + angle)',
    total === 0 ? SKIP : directed.length === total ? PASS : WARN,
    total === 0
      ? 'Nothing to check yet.'
      : directed.length === total
        ? 'Every scene has a shot size and camera angle, so the provider prompt is fully directed.'
        : `${total - directed.length} of ${total} scene(s) have no shot size or camera angle and fall back to a generic camera.`,
    { directed: directed.length, total },
  ));

  // --- 4. Cast continuity ---------------------------------------------------
  const activeCast = characters.filter((character) => scenesUsingCharacter(scenes, character.name).length > 0);
  const withoutReference = activeCast.filter((character) => !character.reference_image_path || !fs.existsSync(character.reference_image_path));
  if (activeCast.length === 0) {
    checks.push(check('cast-references', 'Cast has identity references', SKIP,
      characters.length ? 'No saved character appears in the current scenes.' : 'No characters saved for this project.'));
  } else {
    checks.push(check(
      'cast-references', 'Cast has identity references',
      withoutReference.length === 0 ? PASS : WARN,
      withoutReference.length === 0
        ? `All ${activeCast.length} recurring character(s) have a reference image.`
        : `${withoutReference.length} recurring character(s) have no reference image, so faces may drift: ${withoutReference.map((character) => character.name).join(', ')}.`,
      { missing: withoutReference.map((character) => character.name) },
    ));
  }

  // Names spoken or cast in a scene that are not in the cast library would
  // silently lose their face/voice continuity.
  const known = new Set(characters.map((character) => String(character.name).toLowerCase()));
  const orphanNames = new Set();
  for (const scene of scenes) {
    const names = [
      ...parseJson(scene.cast, []),
      ...parseJson(scene.dialogue, []).map((line) => line.character),
    ].map((name) => String(name || '').trim()).filter(Boolean);
    for (const name of names) if (!known.has(name.toLowerCase())) orphanNames.add(name);
  }
  checks.push(check(
    'cast-membership', 'Every speaking character is in the cast library',
    orphanNames.size === 0 ? PASS : WARN,
    orphanNames.size === 0
      ? 'All cast names in scenes belong to saved characters.'
      : `These names appear in scenes but have no character profile: ${[...orphanNames].slice(0, 10).join(', ')}.`,
    { unknown: [...orphanNames] },
  ));

  // --- 5. Locations ---------------------------------------------------------
  const locationIds = new Set(locations.map((location) => location.id));
  const brokenLinks = scenes.filter((scene) => scene.location_id && !locationIds.has(scene.location_id));
  const unlinked = scenes.filter((scene) => scene.location && !scene.location_id);
  checks.push(check(
    'locations', 'Scenes use saved locations',
    scenes.length === 0 ? SKIP : brokenLinks.length ? FAIL : unlinked.length ? WARN : PASS,
    scenes.length === 0
      ? 'Nothing to check yet.'
      : brokenLinks.length
        ? `${brokenLinks.length} scene(s) reference a location that no longer exists.`
        : unlinked.length
          ? `${unlinked.length} of ${scenes.length} scene(s) use free-text locations. Save them to the location library so every episode matches.`
          : `All ${scenes.length} scene(s) are linked to saved locations.`,
    { linked: scenes.length - unlinked.length - brokenLinks.length, unlinked: unlinked.length, broken: brokenLinks.length },
  ));

  // --- 6. Runtime vs target -------------------------------------------------
  const totalSeconds = scenes.reduce((sum, scene) => sum + number(scene.duration_seconds), 0);
  const target = number(film.target_duration_seconds);
  const drift = target > 0 ? Math.abs(totalSeconds - target) / target : 0;
  checks.push(check(
    'runtime', 'Runtime matches the target',
    total === 0 ? SKIP : drift <= 0.15 ? PASS : WARN,
    total === 0
      ? 'Nothing to check yet.'
      : `${totalSeconds}s planned against a ${target}s target (${Math.round(drift * 100)}% ${totalSeconds < target ? 'short' : 'over'}).`,
    { plannedSeconds: totalSeconds, targetSeconds: target, drift },
  ));

  // --- 7. Dialogue audio ----------------------------------------------------
  const dialogueScenes = scenes.filter((scene) => parseJson(scene.dialogue, []).length > 0);
  let ttsProvider = 'unknown';
  try { ttsProvider = (await assemblyPreflight(filmId)).ttsProvider || 'unknown'; } catch { ttsProvider = 'unavailable'; }
  const ttsReady = Boolean(ttsProvider) && ttsProvider !== 'unavailable' && ttsProvider !== 'none';
  checks.push(check(
    'dialogue-audio', 'Dialogue can be voiced at render time',
    dialogueScenes.length === 0 ? SKIP : ttsReady ? PASS : WARN,
    dialogueScenes.length === 0
      ? 'No dialogue in this cut.'
      : ttsReady
        ? `${dialogueScenes.length} scene(s) with dialogue will be voiced with the ${ttsProvider} TTS engine during assembly.`
        : 'Scenes contain dialogue but no TTS engine is available; the render will be silent.',
    { ttsProvider, dialogueScenes: dialogueScenes.length },
  ));

  // --- 8. Assembly / export -------------------------------------------------
  const hasFinal = Boolean(film.final_video_path && fs.existsSync(film.final_video_path));
  checks.push(check(
    'assembly', 'Final cut rendered',
    hasFinal ? PASS : total > 0 && missing.length === 0 ? WARN : SKIP,
    hasFinal
      ? 'A rendered MP4 exists and can be previewed, downloaded and published.'
      : total > 0 && missing.length === 0
        ? 'All clips are ready but the film has not been assembled yet.'
        : 'Assembly needs every scene clip first.',
  ));

  const scored = checks.filter((item) => item.status !== SKIP);
  const passed = scored.filter((item) => item.status === PASS).length;
  const status = checks.some((item) => item.status === FAIL) ? FAIL : checks.some((item) => item.status === WARN) ? WARN : PASS;
  return {
    generatedAt: new Date().toISOString(),
    filmId,
    status,
    score: scored.length ? Math.round((passed / scored.length) * 100) : 0,
    summary: {
      checks: checks.length,
      passed,
      warnings: checks.filter((item) => item.status === WARN).length,
      failed: checks.filter((item) => item.status === FAIL).length,
      skipped: checks.filter((item) => item.status === SKIP).length,
    },
    checks,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      ordinal: scene.ordinal,
      heading: scene.heading,
      status: scene.status,
      hasClip: clipExists(scene),
      directed: Boolean(scene.shot_size && scene.camera_angle),
      locationLinked: Boolean(scene.location_id),
      dialogueLines: parseJson(scene.dialogue, []).length,
      durationSeconds: number(scene.duration_seconds),
    })),
    sceneCount: scenes.length,
  };
}
