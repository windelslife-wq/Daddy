import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { ASPECTS, STYLE_PALETTES } from '../constants.js';

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code === 0) resolve({ stdout: out, stderr: err });
      else {
        const message = err.toString('utf8').slice(-4000) || `${command} exited with code ${code}`;
        reject(new Error(message));
      }
    });
  });
}

export function ffmpeg(args, options = {}) {
  return runCommand(config.media.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], options);
}

export function dimensionsFor(aspectRatio) {
  return ASPECTS.find((item) => item.id === aspectRatio) || ASPECTS[0];
}

export function stylePalette(style) {
  return STYLE_PALETTES[style] || STYLE_PALETTES.cinematic;
}

export function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}
export function seedNumber(value) {
  return hashString(value).readUInt32BE(0);
}
export function randomFromSeed(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '');
}
export function projectDir(projectId) {
  return path.join(config.storageDir, 'projects', safeId(projectId));
}
export function resolveProjectFile(projectId, filename) {
  const dir = projectDir(projectId);
  const target = path.resolve(dir, filename);
  if (target !== dir && !target.startsWith(`${dir}${path.sep}`)) throw new Error('Invalid project file path');
  return target;
}
export async function ensureProjectDir(projectId) {
  const dir = projectDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'scenes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'frames'), { recursive: true });
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  await fs.mkdir(path.join(dir, 'variants'), { recursive: true });
  return dir;
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}

export function wrapText(text, maxChars = 28) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(clean)) {
    const lines = [];
    for (let i = 0; i < clean.length; i += Math.max(6, Math.floor(maxChars * 0.6))) lines.push(clean.slice(i, i + Math.max(6, Math.floor(maxChars * 0.6))));
    return lines.slice(0, 4);
  }
  const words = clean.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

export function splitCaptionChunks(text, maxWords = 8) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(clean)) {
    const size = Math.max(8, maxWords * 2);
    return clean.match(new RegExp(`.{1,${size}}`, 'g')) || [clean];
  }
  const words = clean.split(' ');
  if (words.length <= maxWords) return [clean];
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
  return chunks;
}

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

export async function writeSrt(frames, outputPath) {
  const lines = [];
  let index = 1;
  for (const frame of frames) {
    if (!frame.caption) continue;
    lines.push(String(index++));
    lines.push(`${srtTime(frame.start)} --> ${srtTime(frame.start + frame.duration)}`);
    lines.push(frame.caption, '');
  }
  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  return outputPath;
}

export function formatFfmpegDuration(seconds) {
  return Number(seconds).toFixed(3);
}

export function concatEscape(filePath) {
  return `'${String(filePath).replace(/'/g, "'\\''")}'`;
}

export function contentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt',
    '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  }[ext] || 'application/octet-stream';
}
