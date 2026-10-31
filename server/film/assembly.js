/**
 * Scene-by-scene film assembly.
 *
 * Takes the REAL clip files returned by AI video providers, normalises them to
 * one canvas/fps, splices them in storyboard order, adds per-character voice
 * audio, background music, sound effects, subtitles, a poster frame, and
 * exports an H.264/AAC MP4.
 *
 * Long-form scale:
 *  - audio is built one scene at a time and appended to a raw PCM file, so a
 *    60-minute film never holds its whole soundtrack in memory;
 *  - clips are rendered in segments (default 24 scenes) and the segments are
 *    concatenated with stream copy, so peak temp disk and encode passes stay
 *    bounded and each step reports real FFmpeg progress;
 *  - subtitles are burned in only for short films; longer films get a soft
 *    subtitle track plus a .srt file instead of a full-length re-encode.
 *
 * No synthetic video is produced here: if a scene has no provider clip the
 * assembly fails with a precise list of missing scenes. Every finished file is
 * probed for a real video stream before it is marked complete.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now, number, parseJson } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import {
  ffmpeg, ffmpegWithProgress, probeVideo, decodeAudioToPcm, ensureProjectDir,
  dimensionsFor, concatEscape, writeSrt, formatFfmpegDuration,
} from '../media/utils.js';
import { synthesizeScene, readWav, writeWav, resamplePcm, activeTtsProvider } from '../media/audio.js';
import { editFilters, sceneOverlay } from './editing.js';

const SAMPLE_RATE = 24000;
const FPS = 24;

function clip16(value) { return Math.max(-32768, Math.min(32767, Math.round(value))); }

function escapeSubtitlePath(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export function sceneDialogue(scene) {
  if (Array.isArray(scene.dialogue)) return scene.dialogue;
  try { const parsed = JSON.parse(scene.dialogue || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function sceneSfx(scene) {
  if (Array.isArray(scene.sfx)) return scene.sfx;
  try { const parsed = JSON.parse(scene.sfx || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

/** Sound-effect assets uploaded to the project (metadata.sfxAssets). */
export function filmSfxAssets(film) {
  const metadata = parseJson(film?.metadata, {});
  return Array.isArray(metadata.sfxAssets) ? metadata.sfxAssets.filter((item) => item?.path) : [];
}

/** Rough bytes needed for the render work directory (normalised clips + audio). */
export function estimateRenderBytes(scenes, { maxRenderWidth = config.film.maxRenderWidth } = {}) {
  const seconds = scenes.reduce((n, s) => n + Math.max(1, number(s.duration_seconds, config.film.maxSceneSeconds)), 0);
  // ~1.2 Mbps video for the normalised intermediate + ~0.4 Mbps audio + copies.
  const videoBytes = (seconds * 1_200_000) / 8;
  return Math.round(videoBytes * 2.4 + seconds * SAMPLE_RATE * 2 + 64 * 1024 * 1024);
}

/**
 * Preflight: what is ready, what is missing, how long the film will be, and how
 * much disk the render is expected to need.
 */
export async function assemblyPreflight(filmId) {
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) throw new AppError(404, 'film_not_found', 'Film project not found.');
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  const missing = scenes.filter((s) => !s.clip_path || !fsSync.existsSync(s.clip_path)).map((s) => ({ id: s.id, ordinal: number(s.ordinal), heading: s.heading }));
  const duration = scenes.reduce((n, s) => n + Math.max(1, number(s.duration_seconds, config.film.maxSceneSeconds)), 0);
  const sfxAssets = filmSfxAssets(film);
  const assetsById = new Map(sfxAssets.map((asset) => [asset.id, asset]));
  let sfxCount = 0;
  let unresolvedSfx = 0;
  const dialogueCharacters = scenes.reduce((n, scene) => n + sceneDialogue(scene).reduce((m, line) => m + String(line?.line || '').length, 0), 0);
  for (const scene of scenes) {
    for (const cue of sceneSfx(scene)) {
      if (cue?.assetId && assetsById.has(cue.assetId) && fsSync.existsSync(assetsById.get(cue.assetId).path)) sfxCount += 1;
      else unresolvedSfx += 1;
    }
  }
  const burnIn = duration <= config.film.burnInMaxSeconds;
  return {
    film, scenes, missing, duration,
    sceneCount: scenes.length,
    ready: scenes.length > 0 && missing.length === 0,
    ttsProvider: activeTtsProvider(),
    sfxCount,
    unresolvedSfx,
    sfxAssets,
    dialogueCharacters,
    estimatedRenderBytes: estimateRenderBytes(scenes),
    segments: Math.ceil(scenes.length / Math.max(1, config.film.assemblySegmentScenes)),
    burnInRecommended: burnIn,
  };
}

async function normaliseClip(clipPath, outputPath, durationSeconds, width, height, onProgress = () => {}, edit = {}) {
  const clipProbe = await probeVideo(clipPath);
  if (!clipProbe.hasVideo || clipProbe.durationSeconds < 0.2) {
    throw new AppError(502, 'clip_invalid', `Scene clip ${path.basename(clipPath)} has no usable video stream; regenerate this scene.`);
  }
  const duration = formatFfmpegDuration(durationSeconds);
  // Editorial decisions are applied here, where every clip is already being
  // re-encoded onto the master canvas, so the concat stays stream-copy.
  const trimStart = Math.max(0, Number(edit.trimStart) || 0);
  const trimEnd = Math.max(0, Number(edit.trimEnd) || 0);
  const usable = Math.max(0.4, clipProbe.durationSeconds - trimStart - trimEnd);
  const visible = Math.min(durationSeconds, usable);
  const fade = Math.min(0.6, Math.max(0.2, Number(config.film.transitionFadeSeconds) || 0.5));
  const transition = String(edit.transition || 'cut');
  const fades = [];
  if (visible > fade * 2) {
    if (transition === 'fade_black' || transition === 'dip_white') {
      const color = transition === 'dip_white' ? 'white' : 'black';
      fades.push(`fade=t=in:st=0:d=${fade}:color=${color}`);
      fades.push(`fade=t=out:st=${(visible - fade).toFixed(3)}:d=${fade}:color=${color}`);
    }
  }
  // Multi-track editorial layer (speed ramp, VFX preset, burned text overlay).
  const editLayer = edit.scene ? editFilters({ scene: edit.scene, width, height, visible }) : [];
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${FPS}`, 'setsar=1',
    'tpad=stop_mode=clone:stop_duration=10',
    `trim=duration=${duration}`, 'setpts=PTS-STARTPTS',
    ...editLayer,
    ...fades,
    'format=yuv420p',
  ].join(',');
  await ffmpegWithProgress([
    ...(trimStart > 0 ? ['-ss', formatFfmpegDuration(trimStart)] : []),
    '-i', clipPath, '-vf', filter, '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart', outputPath,
  ], { durationSeconds, onProgress });
  return outputPath;
}

function ttsLanguage(language) {
  const supported = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'zh'];
  return supported.includes(language) ? language : 'en';
}

/**
 * Build the voice/SFX timeline for ONE scene as raw 16-bit PCM at SAMPLE_RATE.
 * Bounded memory: a scene is at most FILM_MAX_SCENE_SECONDS long.
 */
async function buildSceneAudio({
  scene, sceneDuration, characters, voiceByName, language, voiceDefault,
  voiceCacheDir, assetCache, assetsById, subtitleFrames, sceneStart,
}) {
  const totalSamples = Math.max(1, Math.round(sceneDuration * SAMPLE_RATE));
  const track = new Int16Array(totalSamples);
  const lines = sceneDialogue(scene).filter((line) => line?.line);
  const slot = lines.length ? sceneDuration / lines.length : sceneDuration;
  let ttsCharacters = 0;
  let voices = 0;
  let sfxUsed = 0;

  for (let l = 0; l < lines.length; l += 1) {
    const line = lines[l];
    const text = String(line.line).slice(0, 600);
    const voice = voiceByName.get(String(line.character || '').toLowerCase()) || voiceDefault;
    const lang = ttsLanguage(language);
    const cacheKey = crypto.createHash('sha1').update(`${voice}|${lang}|${text}`).digest('hex');
    const cachedPath = path.join(voiceCacheDir, `${cacheKey}.wav`);
    ttsCharacters += text.length;
    try {
      if (!fsSync.existsSync(cachedPath)) {
        await synthesizeScene({ text, language: lang, voice, outputPath: cachedPath, workDir: voiceCacheDir, index: voices + 1 });
      }
      voices += 1;
      const { samples, sampleRate } = readWav(await fs.readFile(cachedPath));
      const fitted = resamplePcm(samples, Math.floor(slot * SAMPLE_RATE), sampleRate, SAMPLE_RATE);
      const startSample = Math.floor(l * slot * SAMPLE_RATE);
      for (let s = 0; s < fitted.length && startSample + s < totalSamples; s += 1) {
        track[startSample + s] = clip16(track[startSample + s] + fitted[s] * 0.95);
      }
    } catch (error) {
      // A TTS provider failure must not silently produce a silent film.
      throw new AppError(502, 'tts_failed', `Voice synthesis failed for scene ${number(scene.ordinal)}: ${error.message}`);
    }
    subtitleFrames.push({
      caption: `${line.character}: ${text}`,
      start: sceneStart + l * slot,
      duration: Math.max(0.4, slot - 0.08),
    });
  }

  // Sound effects: real uploaded audio clips mixed at a timestamp in the scene.
  for (const cue of sceneSfx(scene)) {
    const asset = cue?.assetId ? assetsById.get(cue.assetId) : null;
    if (!asset) continue;
    try {
      if (!assetCache.has(asset.id)) assetCache.set(asset.id, await readAudioPcm(asset.path));
      const pcm = assetCache.get(asset.id);
      const gain = Math.max(0, Math.min(2, Number(cue.gain) || 1));
      const at = Math.max(0, Math.min(sceneDuration - 0.05, Number(cue.atSeconds) || 0));
      const startSample = Math.floor(at * SAMPLE_RATE);
      for (let s = 0; s < pcm.length && startSample + s < totalSamples; s += 1) {
        track[startSample + s] = clip16(track[startSample + s] + pcm[s] * gain);
      }
      sfxUsed += 1;
    } catch (error) {
      throw new AppError(502, 'sfx_failed', `Sound effect "${asset.name || asset.id}" could not be decoded: ${error.message}`);
    }
  }

  return { pcm: Buffer.from(track.buffer, track.byteOffset, track.byteLength), ttsCharacters, voices, sfxUsed };
}

async function readAudioPcm(filePath) {
  const buffer = await decodeAudioToPcm(filePath, { sampleRate: SAMPLE_RATE });
  const samples = new Int16Array(buffer.length / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readInt16LE(i * 2);
  return samples;
}

async function freeDiskBytes(dir) {
  try {
    const stats = await fs.statfs(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch { return null; }
}

async function concatVideos(listPath, outputPath, count) {
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath]);
  if (count === 0) throw new AppError(500, 'render_failed', 'Nothing to concatenate.');
  return outputPath;
}

/**
 * Full render. `onProgress(percent, stage)` is called with real milestones;
 * `shouldCancel()` is polled between steps so a long render can be stopped.
 */
export async function assembleFilm(filmId, {
  onProgress = async () => {},
  subtitles = true,
  burnSubtitles,
  shouldCancel = () => false,
} = {}) {
  const pre = await assemblyPreflight(filmId);
  if (!pre.ready) {
    throw new AppError(409, 'scenes_incomplete', `Cannot assemble: ${pre.missing.length} scene(s) have no real AI video clip yet. Generate or replace them first.`, { missing: pre.missing.slice(0, 20) });
  }
  const { film, scenes, duration } = pre;
  if (shouldCancel()) throw cancelledError();

  const dir = await ensureProjectDir(`film_${film.id}`);
  const workDir = path.join(dir, 'assembly');
  const voiceCacheDir = path.join(dir, 'voice-cache');
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(voiceCacheDir, { recursive: true });

  const free = await freeDiskBytes(workDir);
  if (free !== null && free < pre.estimatedRenderBytes) {
    throw new AppError(507, 'insufficient_storage', `This render needs about ${Math.ceil(pre.estimatedRenderBytes / 1e6)} MB of temporary disk but only ${Math.floor(free / 1e6)} MB is free. Free space or reduce the film length.`);
  }

  const dims = dimensionsFor(film.aspect_ratio);
  const scale = Math.min(1, config.film.maxRenderWidth / Math.max(dims.width, dims.height));
  const width = Math.round((dims.width * scale) / 2) * 2;
  const height = Math.round((dims.height * scale) / 2) * 2;
  const segmentSize = Math.max(1, config.film.assemblySegmentScenes);
  const metadata = parseJson(film.metadata, {});
  const characters = await db('film_characters').where({ film_id: filmId });
  const voiceByName = new Map(characters.map((c) => [String(c.name).toLowerCase(), c.voice_preset || metadata.voice || 'nova']));
  const voiceDefault = metadata.voice || 'nova';
  const assetsById = new Map(pre.sfxAssets.map((asset) => [asset.id, asset]));
  const assetCache = new Map();
  const subtitleFrames = [];
  let ttsCharacters = 0;
  let voices = 0;
  let sfxUsed = 0;

  // 1. Normalise every clip once to a single canvas/fps/duration.
  await onProgress(4, 'preparing');
  const normalised = [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (shouldCancel()) throw cancelledError();
    const scene = scenes[i];
    const output = path.join(workDir, `clip-${String(i + 1).padStart(4, '0')}.mp4`);
    const sceneSeconds = Math.max(1, number(scene.duration_seconds, config.film.maxSceneSeconds));
    await normaliseClip(scene.clip_path, output, sceneSeconds, width, height, (ratio) => {
      const overall = 4 + ((i + ratio) / scenes.length) * 48;
      onProgress(Math.round(Math.min(52, overall)), 'normalising_clips').catch(() => {});
    }, { trimStart: scene.trim_start, trimEnd: scene.trim_end, transition: scene.transition, scene });
    normalised.push(output);
    await onProgress(Math.round(4 + ((i + 1) / scenes.length) * 48), 'normalising_clips');
  }

  // 2. Build the soundtrack scene by scene into one raw PCM file.
  const rawAudioPath = path.join(workDir, 'voice.raw');
  const rawHandle = await fs.open(rawAudioPath, 'w');
  let offsetSeconds = 0;
  try {
    for (let i = 0; i < scenes.length; i += 1) {
      if (shouldCancel()) throw cancelledError();
      const scene = scenes[i];
      const sceneSeconds = Math.max(1, number(scene.duration_seconds, config.film.maxSceneSeconds));
      const built = await buildSceneAudio({
        scene, sceneDuration: sceneSeconds, characters, voiceByName,
        language: film.language, voiceDefault, voiceCacheDir, assetCache, assetsById,
        subtitleFrames, sceneStart: offsetSeconds,
      });
      await rawHandle.write(built.pcm);
      ttsCharacters += built.ttsCharacters;
      voices += built.voices;
      sfxUsed += built.sfxUsed;
      offsetSeconds += sceneSeconds;
      await onProgress(Math.round(52 + ((i + 1) / scenes.length) * 12), 'voice');
    }
  } finally {
    await rawHandle.close();
  }
  const voicePath = path.join(workDir, 'voice.wav');
  await ffmpeg(['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', rawAudioPath, '-c:a', 'pcm_s16le', voicePath]);
  const srtPath = path.join(dir, 'film-subtitles.srt');
  await writeSrt(subtitles === false ? [] : subtitleFrames, srtPath);
  if (shouldCancel()) throw cancelledError();

  // 3. Render segments (bounded temp disk) then concatenate with stream copy.
  await onProgress(66, 'segments');
  const segments = [];
  let segmentStartSeconds = 0;
  for (let start = 0; start < scenes.length; start += segmentSize) {
    if (shouldCancel()) throw cancelledError();
    const chunk = normalised.slice(start, start + segmentSize);
    const chunkScenes = scenes.slice(start, start + segmentSize);
    const segmentSeconds = chunkScenes.reduce((n, scene) => n + Math.max(1, number(scene.duration_seconds, config.film.maxSceneSeconds)), 0);
    const listPath = path.join(workDir, `segment-${segments.length + 1}.txt`);
    await fs.writeFile(listPath, `${chunk.map((p) => `file ${concatEscape(p)}`).join('\n')}\n`, 'utf8');
    const silentPath = path.join(workDir, `segment-${segments.length + 1}-video.mp4`);
    await concatVideos(listPath, silentPath, chunk.length);
    const segmentPath = path.join(workDir, `segment-${String(segments.length + 1).padStart(3, '0')}.mp4`);
    await ffmpeg([
      '-i', silentPath,
      '-ss', formatFfmpegDuration(segmentStartSeconds), '-t', formatFfmpegDuration(segmentSeconds), '-i', voicePath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', '-shortest', segmentPath,
    ]);
    segments.push(segmentPath);
    segmentStartSeconds += segmentSeconds;
    await fs.rm(silentPath, { force: true });
    await onProgress(Math.round(66 + ((start + chunk.length) / scenes.length) * 14), 'segments');
  }

  const basePath = path.join(workDir, 'base.mp4');
  const segmentList = path.join(workDir, 'segments.txt');
  await fs.writeFile(segmentList, `${segments.map((p) => `file ${concatEscape(p)}`).join('\n')}\n`, 'utf8');
  await concatVideos(segmentList, basePath, segments.length);
  await onProgress(84, 'mixing');
  if (shouldCancel()) throw cancelledError();

  // 4. Mix background music under dialogue (video stream is copied).
  //    The music is side-chain compressed by the dialogue so lines stay
  //    intelligible without raising the whole track; if the filter is
  //    unavailable on this FFmpeg build we fall back to a static bed.
  let mixedPath = basePath;
  if (film.music_path && fsSync.existsSync(film.music_path)) {
    mixedPath = path.join(workDir, 'with-music.mp4');
    const mixArgs = (filter) => [
      '-i', basePath, '-stream_loop', '-1', '-i', film.music_path,
      '-filter_complex', filter,
      '-map', '0:v:0', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-t', formatFfmpegDuration(duration), '-movflags', '+faststart', mixedPath,
    ];
    const ducked = '[1:a]volume=0.55[m];[m][0:a]sidechaincompress=threshold=0.03:ratio=12:attack=5:release=250:makeup=1[md];[0:a][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]';
    const staticBed = '[1:a]volume=0.16[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[aout]';
    try {
      await ffmpegWithProgress(mixArgs(ducked), { durationSeconds: duration, shouldCancel });
      await onProgress(88, 'music_ducking');
    } catch (error) {
      if (shouldCancel()) throw cancelledError();
      logger.warn({ err: { message: error.message } }, 'Sidechain music ducking failed; falling back to a static bed');
      await ffmpegWithProgress(mixArgs(staticBed), { durationSeconds: duration, shouldCancel });
    }
    await fs.rm(basePath, { force: true });
    await onProgress(90, 'music');
  }

  // 5. Subtitles: burn in short films, soft-track longer ones (no full re-encode).
  // The output is staged inside the work directory and published atomically, so
  // a cancelled or failed render can never truncate a previous finished cut.
  const stagedPath = path.join(workDir, 'final.mp4');
  const finalPath = path.join(dir, 'final.mp4');
  const thumbnailPath = path.join(dir, 'thumbnail.jpg');
  const wantsSubtitles = subtitles !== false && subtitleFrames.length > 0;
  const burn = wantsSubtitles && (burnSubtitles ?? (duration <= config.film.burnInMaxSeconds));
  if (burn) {
    const style = 'FontName=DejaVu Sans,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,BackColour=&H80000000,Alignment=2,MarginV=40';
    const videoFilter = `subtitles=filename='${escapeSubtitlePath(srtPath)}':force_style='${style}'`;
    await ffmpegWithProgress([
      '-i', mixedPath, '-vf', videoFilter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-c:a', 'copy', '-movflags', '+faststart', '-shortest', stagedPath,
    ], { durationSeconds: duration, shouldCancel });
  } else if (wantsSubtitles) {
    await ffmpeg([
      '-i', mixedPath, '-i', srtPath,
      '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0',
      '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', stagedPath,
    ]);
  } else {
    await fs.copyFile(mixedPath, stagedPath);
  }
  if (mixedPath !== basePath) await fs.rm(mixedPath, { force: true });
  await onProgress(96, 'thumbnail');

  // 6. Verify the staged file is a real, playable video before publishing it.
  const finalProbe = await probeVideo(stagedPath);
  const stat = await fs.stat(stagedPath);
  if (!finalProbe.hasVideo || stat.size < 4096 || finalProbe.durationSeconds < 0.2) {
    await fs.rm(stagedPath, { force: true }).catch(() => {});
    throw new AppError(500, 'render_failed', 'FFmpeg did not produce a usable video file; the render was rejected rather than reported as complete.');
  }
  await fs.rename(stagedPath, finalPath);
  await ffmpeg(['-ss', duration > 2 ? '1' : '0', '-i', finalPath, '-frames:v', '1', '-q:v', '3', thumbnailPath]);
  await onProgress(99, 'finalising');

  const captionPath = path.join(dir, 'captions.srt');
  await fs.copyFile(srtPath, captionPath);
  await db('film_projects').where({ id: filmId }).update({
    final_video_path: finalPath,
    thumbnail_path: fsSync.existsSync(thumbnailPath) ? thumbnailPath : null,
    caption_path: captionPath,
    duration_seconds: Math.round(duration),
    status: 'completed', stage: 'completed', error: null, progress: 100,
    assembly_cancel_requested: 0,
    completed_at: now(), updated_at: now(),
  });
  await fs.rm(workDir, { recursive: true, force: true });
  return {
    videoPath: finalPath, thumbnailPath, captionPath,
    durationSeconds: Math.round(duration), bytes: stat.size,
    scenes: scenes.length, segments: segments.length,
    subtitles: wantsSubtitles ? (burn ? 'burned-in' : 'soft-track') : 'none',
    ttsProvider: pre.ttsProvider, ttsCharacters, voices, sfxUsed,
    width, height, fps: FPS,
  };
}

function cancelledError() {
  const error = new AppError(409, 'assembly_cancelled', 'The render was cancelled. Reserved credits were refunded and the previous cut (if any) was kept.');
  error.cancelled = true;
  return error;
}

/** Wipe the final render but keep all scene clips (for re-assembly after an edit). */
export async function invalidateAssembly(filmId) {
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) return;
  const dir = await ensureProjectDir(`film_${filmId}`);
  for (const file of ['final.mp4', 'thumbnail.jpg', 'captions.srt']) {
    await fs.rm(path.join(dir, file), { force: true }).catch(() => {});
  }
  if (film.status === 'completed') {
    await db('film_projects').where({ id: filmId }).update({ status: 'draft', stage: 'review', final_video_path: null, thumbnail_path: null, caption_path: null, completed_at: null, updated_at: now() });
  }
}
