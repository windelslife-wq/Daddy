/**
 * Multi-track scene editing: text overlays, speed ramps and local VFX presets.
 *
 * These are REAL FFmpeg operations applied while the clip is normalised onto the
 * master canvas in `assembly.js`, so what the editor shows is what the render
 * performs. Nothing here fabricates footage: if a scene has no provider clip the
 * render still refuses with `scenes_incomplete`.
 *
 * Presets are plain filter fragments with no external service, so they work on a
 * machine with FFmpeg and no AI keys. Motion transfer (video-to-video) is a
 * provider capability and lives in `vfx.js`, gated and honest about it.
 */
import fsSync from 'node:fs';
import { db, now, parseJson, number } from '../db.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { ownedFilm } from './scenes.js';

export const MAX_OVERLAY_TEXT = 120;
const FONT_CANDIDATES = [
  process.env.FILM_OVERLAY_FONT,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
].filter(Boolean);

export function overlayFont() {
  return FONT_CANDIDATES.find((candidate) => { try { return fsSync.existsSync(candidate); } catch { return false; } }) || null;
}

/**
 * Local looks. Each entry returns an FFmpeg filter fragment appended after the
 * canvas is already scaled/padded, so width/height are known.
 */
export const VFX_PRESETS = [
  { id: 'none', label: 'None', description: 'No extra look.' },
  {
    id: 'vignette', label: 'Vignette', description: 'Darkened corners.',
    filter: () => 'vignette=PI/5',
  },
  {
    id: 'film_grain', label: 'Film grain', description: 'Animated luma noise.',
    filter: () => 'noise=alls=12:allf=t+u',
  },
  {
    id: 'soft_blur', label: 'Soft focus', description: 'Gentle gaussian blur.',
    filter: () => 'gblur=sigma=2.2',
  },
  {
    id: 'punch_in', label: 'Punch-in', description: '8% crop then rescale — tighter frame.',
    filter: (width, height) => `crop=iw*0.92:ih*0.92,scale=${width}:${height}`,
  },
  {
    id: 'slow_zoom', label: 'Slow zoom', description: 'Ken Burns push while the scene plays.',
    filter: (width, height) => `zoompan=z=' min(zoom+0.0009,1.12) ':d=1:s=${width}x${height}:fps=24`,
  },
  {
    id: 'handheld', label: 'Handheld', description: 'Small drifting camera shake.',
    filter: (width, height) => `crop=iw*0.94:ih*0.94:x='iw*0.03+sin(n/2.7)*5':y='ih*0.03+cos(n/3.4)*4',scale=${width}:${height}`,
  },
  {
    id: 'letterbox', label: 'Letterbox', description: 'Cinematic bars top and bottom.',
    filter: () => 'drawbox=x=0:y=0:w=iw:h=ih*0.055:color=black:t=fill,drawbox=x=0:y=ih*0.945:w=iw:h=ih*0.055:color=black:t=fill',
  },
];

const PRESET_IDS = VFX_PRESETS.map((preset) => preset.id);

export function listVfxPresets() {
  return VFX_PRESETS.map(({ id, label, description }) => ({ id, label, description }));
}

export function vfxFilter(presetId, width, height) {
  const preset = VFX_PRESETS.find((item) => item.id === presetId);
  if (!preset || !preset.filter) return '';
  try { return preset.filter(width, height); } catch { return ''; }
}

export const OVERLAY_POSITIONS = ['bottom', 'top', 'center'];

export function drawTextEscape(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

/** Validate and clamp an overlay payload. Returns null when clearing. */
export function normaliseOverlay(input) {
  if (!input) return null;
  const text = String(input.text || '').trim().slice(0, MAX_OVERLAY_TEXT);
  if (!text) return null;
  const start = Number(input.startSeconds);
  const end = Number(input.endSeconds);
  return {
    text,
    position: OVERLAY_POSITIONS.includes(input.position) ? input.position : 'bottom',
    startSeconds: Number.isFinite(start) ? Math.max(0, Math.min(600, start)) : 0,
    endSeconds: Number.isFinite(end) ? Math.max(0, Math.min(600, end)) : 0,
    opacity: Number.isFinite(Number(input.opacity)) ? Math.max(0.15, Math.min(1, Number(input.opacity))) : 0.9,
    size: Number.isFinite(Number(input.size)) ? Math.max(12, Math.min(96, Math.round(Number(input.size)))) : 28,
  };
}

export function sceneOverlay(scene) {
  if (!scene) return null;
  const parsed = typeof scene.overlay_json === 'string' ? parseJson(scene.overlay_json, null) : scene.overlay_json;
  return normaliseOverlay(parsed);
}

export function sceneTrack(scene) {
  return {
    speedFactor: Math.max(0.25, Math.min(4, Number(scene?.speed_factor) || 1)),
    vfxPreset: PRESET_IDS.includes(scene?.vfx_preset) ? scene.vfx_preset : 'none',
    overlay: sceneOverlay(scene),
    trimStart: number(scene?.trim_start),
    trimEnd: number(scene?.trim_end),
    transition: scene?.transition || 'cut',
    lipsyncProvider: scene?.lipsync_provider || null,
  };
}

/**
 * FFmpeg filters for the editorial layer of one scene clip.
 * `visible` is the final on-timeline length, used to bound the overlay.
 */
export function editFilters({ scene, width, height, visible }) {
  const track = sceneTrack(scene);
  const filters = [];
  if (track.speedFactor !== 1) filters.push(`setpts=PTS/${track.speedFactor}`);
  const look = vfxFilter(track.vfxPreset, width, height);
  if (look) filters.push(look);
  if (track.overlay) {
    const font = overlayFont();
    if (font) {
      const overlay = track.overlay;
      const start = Math.max(0, Math.min(overlay.startSeconds, Math.max(0, visible - 0.2)));
      const end = overlay.endSeconds > 0 ? Math.min(overlay.endSeconds, visible) : visible;
      const y = overlay.position === 'top' ? 'h*0.08' : overlay.position === 'center' ? '(h-text_h)/2' : 'h*0.82-text_h';
      // Every value is escaped for the filtergraph rather than single-quoted:
      // a quote inside the text (apostrophes are common) would otherwise end the
      // value early and corrupt the rest of the chain. Verified against real
      // FFmpeg renders for all presets (see tests/film-editing.test.js).
      const enable = end > start ? `:enable=between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})` : '';
      filters.push(
        `drawtext=fontfile=${font.replace(/:/g, '\\:')}:text=${drawTextEscape(overlay.text)}`
        + `:fontcolor=white@${overlay.opacity.toFixed(2)}:fontsize=${overlay.size}`
        + `:box=1:boxcolor=black@0.35:boxborderw=12:x=(w-text_w)/2:y=${y}${enable}`,
      );
    }
  }
  return filters;
}

export async function updateSceneTrack(userId, filmId, sceneId, payload = {}, role = 'user') {
  await ownedFilm(userId, filmId, role);
  const scene = await db('film_scenes').where({ id: sceneId, film_id: filmId }).first();
  if (!scene) throw new AppError(404, 'scene_not_found', 'Scene not found.');
  const patch = { updated_at: now() };
  if (payload.speedFactor !== undefined) {
    const speed = Number(payload.speedFactor);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      throw new AppError(400, 'invalid_speed_factor', 'speedFactor must be between 0.25 and 4.');
    }
    patch.speed_factor = speed;
  }
  if (payload.vfxPreset !== undefined) {
    const preset = String(payload.vfxPreset || 'none');
    if (!PRESET_IDS.includes(preset)) throw new AppError(400, 'unknown_vfx_preset', `Unknown VFX preset "${preset}".`);
    patch.vfx_preset = preset;
  }
  if (payload.overlay !== undefined) {
    const overlay = normaliseOverlay(payload.overlay);
    patch.overlay_json = overlay ? JSON.stringify(overlay) : null;
  }
  await db('film_scenes').where({ id: sceneId }).update(patch);
  const updated = await db('film_scenes').where({ id: sceneId }).first();
  return {
    sceneId,
    track: sceneTrack(updated),
    renderable: Boolean(updated.clip_path),
    appliedBy: 'FFmpeg during assembly',
    vfxPresets: listVfxPresets(),
  };
}

export async function editingOverview(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc')
    .select('id', 'ordinal', 'heading', 'duration_seconds', 'clip_path', 'overlay_json', 'speed_factor', 'vfx_preset', 'trim_start', 'trim_end', 'transition', 'lipsync_provider');
  return {
    filmId: film.id,
    title: film.title,
    font: overlayFont(),
    vfxPresets: listVfxPresets(),
    scenes: scenes.map((scene) => ({
      id: scene.id,
      ordinal: number(scene.ordinal),
      heading: scene.heading,
      durationSeconds: number(scene.duration_seconds),
      hasClip: Boolean(scene.clip_path && fsSync.existsSync(scene.clip_path)),
      track: sceneTrack(scene),
    })),
    tracks: ['video (provider clip)', 'overlay text (FFmpeg drawtext)', 'voice/SFX/music mix (assembly)', 'burned subtitles'],
    notImplemented: ['image picture-in-picture', 'separate music stems beyond the score mix', 'frame-accurate keyframes'],
    maxSceneSeconds: config.film.maxSceneSeconds,
  };
}
