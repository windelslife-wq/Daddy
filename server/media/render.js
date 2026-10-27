import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, ensureProjectDir, concatEscape, formatFfmpegDuration } from './utils.js';
import { captionFrameBuffer, createThumbnail } from './images.js';
import { logger } from '../logger.js';

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function renderVideo({ projectId, plan, input, images, narration, onProgress = async () => {} }) {
  const dir = await ensureProjectDir(projectId);
  const framesDir = path.join(dir, 'frames');
  await fs.rm(framesDir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });

  const framePaths = await mapLimit(narration.frames, 3, async (frame, index) => {
    const base = images.buffers[frame.imageIndex % images.buffers.length];
    const buffer = await captionFrameBuffer(base, input.captions ? frame.caption : '', images.dimensions, frame.motion);
    const outputPath = path.join(framesDir, `frame-${String(index + 1).padStart(4, '0')}.png`);
    await fs.writeFile(outputPath, buffer);
    if (index % 4 === 0) await onProgress(76 + Math.round((index / Math.max(1, narration.frames.length)) * 13));
    return { path: outputPath, duration: frame.duration };
  });

  const concatLines = [];
  for (const frame of framePaths) {
    concatLines.push(`file ${concatEscape(frame.path)}`);
    concatLines.push(`duration ${formatFfmpegDuration(frame.duration)}`);
  }
  if (framePaths.length) concatLines.push(`file ${concatEscape(framePaths[framePaths.length - 1].path)}`);
  const concatPath = path.join(dir, 'frames.txt');
  await fs.writeFile(concatPath, `${concatLines.join('\n')}\n`, 'utf8');

  const videoPath = path.join(dir, 'video.mp4');
  const thumbnailPath = path.join(dir, 'thumbnail.jpg');
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-i', narration.audioPath,
    '-t', formatFfmpegDuration(narration.duration),
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '24',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-movflags', '+faststart', '-shortest', videoPath,
  ]);
  await onProgress(91);
  await createThumbnail(images.buffers[0], plan.title, thumbnailPath);
  await onProgress(94);
  const stat = await fs.stat(videoPath);
  if (stat.size < 1024) throw new Error('FFmpeg produced an empty video file.');
  logger.info({ projectId, bytes: stat.size, frames: framePaths.length, duration: narration.duration }, 'Rendered MP4 video');
  return { videoPath, thumbnailPath, captionPath: narration.srtPath, audioPath: narration.audioPath, duration: narration.duration, frameCount: framePaths.length };
}

export async function cleanupFrames(projectId) {
  const dir = await ensureProjectDir(projectId);
  await fs.rm(path.join(dir, 'frames'), { recursive: true, force: true });
  await fs.rm(path.join(dir, 'frames.txt'), { force: true });
}

export { ffmpeg };
