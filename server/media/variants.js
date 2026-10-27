import path from 'node:path';
import fs from 'node:fs/promises';
import { parseJson } from '../db.js';
import { config } from '../config.js';
import { PLATFORMS, ASPECTS } from '../constants.js';
import { ffmpeg, ensureProjectDir, dimensionsFor, formatFfmpegDuration } from './utils.js';
import { signedMediaUrl } from './urls.js';

function aspectSpec(aspect) {
  return ASPECTS.find((item) => item.id === aspect) || null;
}

export async function platformVideoPath(project, platform, publicationId) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`Unsupported publishing platform "${platform}".`);
  const projectConfig = parseJson(project.config, {});
  const original = project.video_path;
  if (!original) throw new Error('Project has no rendered video.');
  const targetAspect = spec.aspect || projectConfig.aspectRatio || '9:16';
  const targetDuration = Number(spec.maxDuration) || 180;
  const needsResize = projectConfig.aspectRatio !== targetAspect;
  const needsTrim = Number(project.duration_seconds || 0) > targetDuration;
  if (!needsResize && !needsTrim) return original;
  const dims = dimensionsFor(targetAspect);
  const dir = await ensureProjectDir(project.id);
  const outputPath = path.join(dir, 'variants', `video-${platform}-${publicationId}.mp4`);
  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {}
  const filter = [
    `[1:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height},boxblur=24:2[bg]`,
    `[0:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
  ].join(';');
  const args = [
    '-i', original, '-i', original,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-r', '24',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
  ];
  if (needsTrim) args.push('-t', formatFfmpegDuration(targetDuration));
  else if (Number(project.duration_seconds) > 0) args.push('-t', formatFfmpegDuration(Number(project.duration_seconds)));
  args.push('-shortest', outputPath);
  await ffmpeg(args);
  return outputPath;
}

export function mediaUrlsForProject(project, publicationId, platform) {
  const videoPath = project.video_path;
  const thumbnailPath = project.thumbnail_path;
  const captionPath = project.caption_path;
  if (!videoPath) throw new Error('Project has no media files.');
  return {
    video: signedMediaUrl(project.id, videoPath, { ttlSeconds: 3 * 86400 }),
    thumbnail: thumbnailPath ? signedMediaUrl(project.id, thumbnailPath, { ttlSeconds: 3 * 86400 }) : null,
    captions: captionPath ? signedMediaUrl(project.id, captionPath, { ttlSeconds: 3 * 86400 }) : null,
  };
}

export function assertPublicHttps() {
  if (!config.publicBaseUrl.startsWith('https://')) {
    throw new Error('Instagram publishing requires PUBLIC_BASE_URL to be a publicly reachable HTTPS URL so Meta can download the signed video and cover image.');
  }
}

export function platformDimensions(platform, fallbackAspect = '9:16') {
  return dimensionsFor(PLATFORMS[platform]?.aspect || fallbackAspect);
}
