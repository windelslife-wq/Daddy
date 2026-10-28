/**
 * Scene-by-scene film assembly.
 *
 * Takes the REAL clip files returned by AI video providers, normalises them to
 * one canvas/fps, splices them in storyboard order, adds per-character voice
 * audio, optional music, subtitles, a poster frame, and exports an H.264 MP4.
 *
 * No synthetic video is produced here: if a scene has no provider clip the
 * assembly fails with a precise list of missing scenes.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { db, now, number } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { ffmpeg, ensureProjectDir, dimensionsFor, concatEscape, writeSrt, formatFfmpegDuration } from '../media/utils.js';
import { synthesizeScene, readWav, writeWav, resamplePcm, activeTtsProvider } from '../media/audio.js';

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

/** Preflight: what is ready, what is missing, how long the film will be. */
export async function assemblyPreflight(filmId) {
  const film = await db('film_projects').where({ id: filmId }).first();
  if (!film) throw new AppError(404, 'film_not_found', 'Film project not found.');
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  const missing = scenes.filter((s) => !s.clip_path || !fsSync.existsSync(s.clip_path)).map((s) => ({ id: s.id, ordinal: number(s.ordinal), heading: s.heading }));
  const duration = scenes.reduce((n, s) => n + Math.max(1, number(s.duration_seconds, config.film.maxSceneSeconds)), 0);
  return {
    film, scenes, missing, duration,
    sceneCount: scenes.length,
    ready: scenes.length > 0 && missing.length === 0,
    ttsProvider: activeTtsProvider(),
  };
}

async function normaliseClip(clipPath, outputPath, durationSeconds, width, height) {
  const duration = formatFfmpegDuration(durationSeconds);
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${FPS}`, 'setsar=1',
    'tpad=stop_mode=clone:stop_duration=10',
    `trim=duration=${duration}`, 'setpts=PTS-STARTPTS', 'format=yuv420p',
  ].join(',');
  await ffmpeg([
    '-i', clipPath, '-vf', filter, '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart', outputPath,
  ]);
  return outputPath;
}

/**
 * Build a single voice/ambient timeline plus an SRT file.
 * Dialogue lines are timed inside their scene; subtitles are optional.
 */
async function buildAudio({ dir, scenes, characters, language, voiceDefault, subtitles, duration }) {
  const audioDir = path.join(dir, 'film-audio');
  await fs.mkdir(audioDir, { recursive: true });
  const voiceByName = new Map(characters.map((c) => [String(c.name).toLowerCase(), c.voice_preset || voiceDefault]));
  const totalSamples = Math.max(1, Math.round(duration * SAMPLE_RATE));
  const track = new Int16Array(totalSamples);
  const frames = [];
  let offsetSeconds = 0;
  let ttsCharacters = 0;
  let voices = 0;

  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const sceneDuration = Math.max(1, number(scene.duration_seconds, config.film.maxSceneSeconds));
    const lines = sceneDialogue(scene).filter((line) => line?.line);
    const slot = lines.length ? sceneDuration / lines.length : sceneDuration;
    for (let l = 0; l < lines.length; l += 1) {
      const line = lines[l];
      const text = String(line.line).slice(0, 600);
      const voice = voiceByName.get(String(line.character || '').toLowerCase()) || voiceDefault;
      const rawPath = path.join(audioDir, `line-${i + 1}-${l + 1}.wav`);
      ttsCharacters += text.length;
      try {
        await synthesizeScene({ text, language: ttsLanguage(language), voice, outputPath: rawPath, workDir: audioDir, index: voices + 1 });
        voices += 1;
        const { samples, sampleRate } = readWav(await fs.readFile(rawPath));
        const fitted = resamplePcm(samples, Math.floor(slot * SAMPLE_RATE), sampleRate, SAMPLE_RATE);
        const startSample = Math.floor((offsetSeconds + l * slot) * SAMPLE_RATE);
        for (let s = 0; s < fitted.length && startSample + s < totalSamples; s += 1) {
          track[startSample + s] = clip16(track[startSample + s] + fitted[s] * 0.95);
        }
      } catch (error) {
        // A TTS provider failure must not silently produce a silent film.
        throw new AppError(502, 'tts_failed', `Voice synthesis failed for scene ${i + 1}: ${error.message}`);
      }
      frames.push({
        caption: `${line.character}: ${text}`,
        start: offsetSeconds + l * slot,
        duration: Math.max(0.4, slot - 0.08),
      });
    }
    offsetSeconds += sceneDuration;
  }
  const voicePath = path.join(audioDir, 'voice.wav');
  await writeWav(track, voicePath);
  const srtPath = path.join(dir, 'film-subtitles.srt');
  await writeSrt(subtitles === false ? [] : frames, srtPath);
  return { voicePath, srtPath, ttsCharacters, voices, subtitleFrames: frames.length };
}

function ttsLanguage(language) {
  const supported = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'zh'];
  return supported.includes(language) ? language : 'en';
}

/** Full offline render. `onProgress` receives (percent, stage). */
export async function assembleFilm(filmId, { onProgress = async () => {}, subtitles = true } = {}) {
  const pre = await assemblyPreflight(filmId);
  if (!pre.ready) {
    throw new AppError(409, 'scenes_incomplete', `Cannot assemble: ${pre.missing.length} scene(s) have no real AI video clip yet. Generate or replace them first.`, { missing: pre.missing.slice(0, 20) });
  }
  const { film, scenes, duration } = pre;
  const dir = await ensureProjectDir(`film_${film.id}`);
  const workDir = path.join(dir, 'assembly');
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  const dims = dimensionsFor(film.aspect_ratio);
  const scale = Math.min(1, 1280 / Math.max(dims.width, dims.height));
  const width = Math.round((dims.width * scale) / 2) * 2;
  const height = Math.round((dims.height * scale) / 2) * 2;
  await onProgress(8, 'normalising_clips');

  const normalised = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const output = path.join(workDir, `clip-${String(i + 1).padStart(4, '0')}.mp4`);
    await normaliseClip(scenes[i].clip_path, output, Math.max(1, number(scenes[i].duration_seconds, config.film.maxSceneSeconds)), width, height);
    normalised.push(output);
    if (i % 2 === 0) await onProgress(8 + Math.round(((i + 1) / scenes.length) * 37), 'normalising_clips');
  }
  const concatPath = path.join(workDir, 'clips.txt');
  await fs.writeFile(concatPath, `${normalised.map((p) => `file ${concatEscape(p)}`).join('\n')}\n`, 'utf8');
  await onProgress(47, 'voice');

  const characters = await db('film_characters').where({ film_id: filmId });
  const audio = await buildAudio({
    dir: workDir, scenes, characters, language: film.language,
    voiceDefault: (JSON.parse(film.metadata || '{}').voice) || 'nova', subtitles, duration,
  });
  await onProgress(68, 'muxing');

  const finalPath = path.join(dir, 'final.mp4');
  const thumbnailPath = path.join(dir, 'thumbnail.jpg');
  const args = ['-f', 'concat', '-safe', '0', '-i', concatPath, '-i', audio.voicePath];
  if (film.music_path && fsSync.existsSync(film.music_path)) {
    args.push('-stream_loop', '-1', '-i', film.music_path);
  }
  const videoFilters = [];
  if (subtitles !== false && audio.subtitleFrames > 0) {
    const style = 'FontName=DejaVu Sans,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,BackColour=&H80000000,Alignment=2,MarginV=40';
    videoFilters.push(`subtitles=filename='${escapeSubtitlePath(audio.srtPath)}':force_style='${style}'`);
  }
  if (videoFilters.length) args.push('-vf', videoFilters.join(','));
  if (film.music_path && fsSync.existsSync(film.music_path)) {
    args.push('-filter_complex', '[1:a]volume=1.0[v];[2:a]volume=0.16[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0[aout]');
    args.push('-map', '0:v:0', '-map', '[aout]');
  } else {
    args.push('-map', '0:v:0', '-map', '1:a:0');
  }
  args.push(
    '-t', formatFfmpegDuration(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-shortest', finalPath,
  );
  await ffmpeg(args);
  await onProgress(88, 'thumbnail');
  const stat = await fs.stat(finalPath);
  if (stat.size < 4096) throw new AppError(500, 'render_failed', 'FFmpeg produced an unusable video file.');
  await ffmpeg(['-ss', duration > 2 ? '1' : '0', '-i', finalPath, '-frames:v', '1', '-q:v', '3', thumbnailPath]);
  await onProgress(98, 'finalising');

  const captionPath = path.join(dir, 'captions.srt');
  await fs.copyFile(audio.srtPath, captionPath);
  await db('film_projects').where({ id: filmId }).update({
    final_video_path: finalPath,
    thumbnail_path: fsSync.existsSync(thumbnailPath) ? thumbnailPath : null,
    caption_path: captionPath,
    duration_seconds: Math.round(duration),
    status: 'completed', stage: 'completed', error: null,
    completed_at: now(), updated_at: now(),
  });
  await fs.rm(workDir, { recursive: true, force: true });
  return {
    videoPath: finalPath, thumbnailPath, captionPath,
    durationSeconds: Math.round(duration), bytes: stat.size,
    scenes: scenes.length, ttsProvider: pre.ttsProvider, ttsCharacters: audio.ttsCharacters,
  };
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
