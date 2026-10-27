import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { fetchWithTimeout } from '../ai.js';
import { logger } from '../logger.js';
import { dimensionsFor, stylePalette, seedNumber, randomFromSeed, escapeXml, wrapText, ensureProjectDir } from './utils.js';

function pointList(points) {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function proceduralSvg({ width, height, style, palette, seed, index, niche, visualPrompt }) {
  const rnd = randomFromSeed(seed + index * 7919);
  const [primary, secondary, accent, dark] = palette;
  const horizon = height * (0.58 + rnd() * 0.12);
  const orbX = width * (0.18 + rnd() * 0.64);
  const orbY = height * (0.16 + rnd() * 0.2);
  const orbR = Math.min(width, height) * (0.1 + rnd() * 0.08);
  const line = Math.max(2, Math.round(width / 500));
  const particles = Array.from({ length: 55 }, () => {
    const x = rnd() * width;
    const y = rnd() * height * 0.78;
    const r = 1 + rnd() * Math.max(2, width / 360);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${accent}" opacity="${(0.08 + rnd() * 0.4).toFixed(2)}"/>`;
  }).join('');

  let styleShapes = '';
  if (style === 'comic' || style === 'creepy-comic') {
    const rays = Array.from({ length: 18 }, (_, i) => {
      const angle = (i / 18) * Math.PI * 2;
      const x2 = orbX + Math.cos(angle) * width;
      const y2 = orbY + Math.sin(angle) * width;
      return `<line x1="${orbX}" y1="${orbY}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${style === 'creepy-comic' ? primary : accent}" stroke-width="${line * 2}" opacity="0.18"/>`;
    }).join('');
    const jagged = Array.from({ length: 9 }, (_, i) => {
      const x = (i / 8) * width;
      const y = horizon + (rnd() - 0.5) * height * 0.18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    styleShapes = `${rays}<rect width="${width}" height="${height}" fill="url(#halftone)" opacity="${style === 'creepy-comic' ? 0.22 : 0.16}"/>
      <polyline points="${jagged}" fill="none" stroke="${dark}" stroke-width="${line * 10}" opacity="0.65"/>
      <circle cx="${orbX}" cy="${orbY}" r="${orbR * 1.25}" fill="none" stroke="${accent}" stroke-width="${line * 6}" stroke-dasharray="${line * 18} ${line * 8}" opacity="0.8"/>`;
  } else if (style === 'modern-cartoon' || style === 'animated') {
    const blobs = Array.from({ length: 7 }, (_, i) => {
      const x = rnd() * width;
      const y = rnd() * height * 0.8;
      const rx = width * (0.08 + rnd() * 0.22);
      const ry = rx * (0.5 + rnd() * 0.8);
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${[primary, secondary, accent][i % 3]}" opacity="${(0.12 + rnd() * 0.18).toFixed(2)}"/>`;
    }).join('');
    styleShapes = `${blobs}<path d="M0 ${horizon.toFixed(1)} Q ${width * 0.25} ${(horizon - height * 0.12).toFixed(1)} ${width * 0.5} ${horizon.toFixed(1)} T ${width} ${horizon.toFixed(1)} V ${height} H0 Z" fill="${dark}" opacity="0.75"/>`;
  } else if (style === '3d') {
    const spheres = Array.from({ length: 6 }, (_, i) => {
      const x = width * (0.1 + rnd() * 0.8);
      const y = height * (0.15 + rnd() * 0.55);
      const r = width * (0.04 + rnd() * 0.12);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#sphere${i % 3})" stroke="${accent}" stroke-opacity="0.35" stroke-width="${line}"/><ellipse cx="${x.toFixed(1)}" cy="${(y + r * 1.5).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.22).toFixed(1)}" fill="#000" opacity="0.18"/>`;
    }).join('');
    styleShapes = `${spheres}<path d="M0 ${height * 0.78} Q ${width / 2} ${height * 0.67} ${width} ${height * 0.78} V ${height} H0 Z" fill="${dark}" opacity="0.7"/>`;
  } else {
    const mountains = [
      pointList([[0, horizon + height * 0.12], [width * 0.18, horizon - height * 0.12], [width * 0.34, horizon + height * 0.02], [width * 0.52, horizon - height * 0.2], [width * 0.7, horizon + height * 0.03], [width * 0.86, horizon - height * 0.13], [width, horizon + height * 0.08], [width, height], [0, height]]),
      pointList([[0, horizon + height * 0.18], [width * 0.22, horizon + height * 0.02], [width * 0.42, horizon + height * 0.14], [width * 0.63, horizon - height * 0.03], [width * 0.82, horizon + height * 0.12], [width, horizon], [width, height], [0, height]]),
    ];
    const buildings = Array.from({ length: 16 }, (_, i) => {
      const bw = width / 18;
      const x = i * bw;
      const bh = height * (0.08 + rnd() * 0.18);
      return `<rect x="${x.toFixed(1)}" y="${(horizon - bh).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${(bh + height * 0.2).toFixed(1)}" fill="${dark}" opacity="0.65"/>`;
    }).join('');
    styleShapes = `<polygon points="${mountains[0]}" fill="${dark}" opacity="0.55"/><g>${buildings}</g><polygon points="${mountains[1]}" fill="#050817" opacity="0.8"/>
      <path d="M${orbX} ${orbY} L0 ${height} M${orbX} ${orbY} L${width} ${height}" stroke="${accent}" stroke-width="${line * 2}" opacity="0.08"/>`;
  }

  const subjectX = width * (0.42 + rnd() * 0.16);
  const subjectY = horizon - height * 0.02;
  const headR = Math.min(width, height) * 0.035;
  const bodyH = Math.min(width, height) * 0.19;
  const subject = style === '3d' || style === 'modern-cartoon' || style === 'animated'
    ? `<ellipse cx="${subjectX}" cy="${subjectY + bodyH * 0.5}" rx="${width * 0.07}" ry="${bodyH * 0.55}" fill="url(#sphere0)" opacity="0.85"/>`
    : `<g opacity="0.76"><circle cx="${subjectX}" cy="${subjectY - bodyH * 0.65}" r="${headR}" fill="${dark}"/><path d="M${subjectX - headR * 1.7} ${subjectY - bodyH * 0.3} Q${subjectX} ${subjectY - bodyH * 0.6} ${subjectX + headR * 1.7} ${subjectY - bodyH * 0.3} L${subjectX + headR * 2.4} ${subjectY + bodyH * 0.8} H${subjectX - headR * 2.4} Z" fill="${dark}"/></g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${dark}"/><stop offset="42%" stop-color="${primary}"/><stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0%" stop-color="${accent}" stop-opacity="0.95"/><stop offset="55%" stop-color="${accent}" stop-opacity="0.18"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="sphere0" cx="35%" cy="28%"><stop offset="0%" stop-color="#ffffff"/><stop offset="35%" stop-color="${accent}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>
    <radialGradient id="sphere1" cx="35%" cy="28%"><stop offset="0%" stop-color="#ffffff"/><stop offset="40%" stop-color="${primary}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>
    <radialGradient id="sphere2" cx="35%" cy="28%"><stop offset="0%" stop-color="#ffffff"/><stop offset="40%" stop-color="${secondary}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${dark}" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.88"/></linearGradient>
    <pattern id="halftone" width="${Math.round(width / 70)}" height="${Math.round(width / 70)}" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2.2" fill="${accent}"/></pattern>
    <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(width / 45)}"/></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width * 0.12}" cy="${height * 0.12}" r="${width * 0.45}" fill="${secondary}" opacity="0.18" filter="url(#blur)"/>
  <circle cx="${width * 0.88}" cy="${height * 0.34}" r="${width * 0.38}" fill="${primary}" opacity="0.2" filter="url(#blur)"/>
  <circle cx="${orbX}" cy="${orbY}" r="${orbR}" fill="url(#glow)"/>
  <circle cx="${orbX}" cy="${orbY}" r="${orbR * 0.55}" fill="${accent}" opacity="0.72"/>
  ${particles}
  ${styleShapes}
  <rect x="0" y="${height * 0.58}" width="${width}" height="${height * 0.42}" fill="url(#bottom)"/>
  ${subject}
  <rect x="${line * 4}" y="${line * 4}" width="${width - line * 8}" height="${height - line * 8}" fill="none" stroke="${accent}" stroke-opacity="0.22" stroke-width="${line}"/>
  <title>${escapeXml(`${niche} scene ${index + 1}: ${visualPrompt}`)}</title>
</svg>`;
}

function imageSize(aspectRatio) {
  if (aspectRatio === '16:9') return '1536x1024';
  if (aspectRatio === '1:1') return '1024x1024';
  return '1024x1536';
}

async function openAiImage(prompt, aspectRatio) {
  if (!config.ai.openaiKey) throw new Error('IMAGE_PROVIDER=openai requires OPENAI_API_KEY. No AI images were generated.');
  const model = config.media.openaiImageModel;
  const body = { model, prompt, n: 1, size: imageSize(aspectRatio) };
  if (model.startsWith('dall-e')) body.response_format = 'b64_json';
  const { text } = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.openaiKey}` },
    body: JSON.stringify(body),
  }, 180000);
  const data = JSON.parse(text).data?.[0];
  if (!data) throw new Error('OpenAI image generation returned no image.');
  if (data.b64_json) return Buffer.from(data.b64_json, 'base64');
  if (data.url) {
    const response = await fetch(data.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Unable to download generated image: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('OpenAI image generation response did not include b64_json or a URL.');
}

async function replicateImage(prompt, aspectRatio) {
  if (!config.media.replicateToken) throw new Error('IMAGE_PROVIDER=replicate requires REPLICATE_API_TOKEN. No AI images were generated.');
  const model = config.media.replicateModel;
  let prediction;
  const { text } = await fetchWithTimeout(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.media.replicateToken}`,
      prefer: 'wait=60',
    },
    body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio === '16:9' ? '16:9' : aspectRatio === '1:1' ? '1:1' : '9:16', output_format: 'png', prompt_upsampling: true } }),
  }, 180000);
  prediction = JSON.parse(text);
  const deadline = Date.now() + 180000;
  while (prediction.status !== 'succeeded' && Date.now() < deadline) {
    if (prediction.status === 'failed' || prediction.status === 'canceled') throw new Error(`Replicate image generation ${prediction.status}: ${prediction.error || 'unknown error'}`);
    const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { text: pollText } = await fetchWithTimeout(pollUrl, { headers: { authorization: `Bearer ${config.media.replicateToken}` } }, 60000);
    prediction = JSON.parse(pollText);
  }
  if (prediction.status !== 'succeeded') throw new Error('Replicate image generation timed out.');
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const url = typeof output === 'string' ? output : output?.url?.() || output?.url;
  if (!url) throw new Error('Replicate prediction did not return an image URL.');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Unable to download Replicate image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

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

export function activeImageProvider() {
  const requested = config.media.imageProvider;
  if (requested === 'procedural') return 'procedural-svg';
  if (requested === 'openai') return `openai:${config.media.openaiImageModel}`;
  if (requested === 'replicate') return `replicate:${config.media.replicateModel}`;
  throw new Error(`Unsupported IMAGE_PROVIDER "${requested}". Use procedural, openai, or replicate.`);
}

export async function generateSceneImages({ projectId, plan, input, onProgress = async () => {} }) {
  const dir = await ensureProjectDir(projectId);
  const dims = dimensionsFor(input.aspectRatio);
  const seed = seedNumber(`${projectId}:${input.topic}:${input.style}`);
  const provider = activeImageProvider();
  const paths = await mapLimit(plan.scenes, 2, async (scene, index) => {
    const outputPath = path.join(dir, 'scenes', `scene-${String(index + 1).padStart(2, '0')}.png`);
    const prompt = `${scene.visualPrompt}. Original ${input.style} visual, cinematic composition, high contrast, no text, no watermark, no logo, no real person, no copyrighted character. Safe for social media.`;
    let source;
    if (config.media.imageProvider === 'openai') source = await openAiImage(prompt, input.aspectRatio);
    else if (config.media.imageProvider === 'replicate') source = await replicateImage(prompt, input.aspectRatio);
    else source = Buffer.from(proceduralSvg({
      width: dims.width, height: dims.height, style: input.style, palette: stylePalette(input.style), seed,
      index, niche: input.niche, visualPrompt: scene.visualPrompt,
    }), 'utf8');
    await sharp(source).resize(dims.width, dims.height, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9 }).toFile(outputPath);
    await onProgress(35 + Math.round(((index + 1) / plan.scenes.length) * 20));
    return outputPath;
  });
  const buffers = await Promise.all(paths.map((file) => fs.readFile(file)));
  logger.info({ projectId, provider, scenes: paths.length }, 'Generated scene images');
  return { paths, buffers, provider, dimensions: dims };
}

export async function captionFrameBuffer(baseBuffer, caption, dims, motion = 0) {
  const { width, height } = dims;
  const zoom = 1.015 + Math.max(0, Math.min(1, motion)) * 0.055;
  const resized = await sharp(baseBuffer)
    .resize(Math.round(width * zoom), Math.round(height * zoom), { fit: 'cover' })
    .extract({
      left: Math.round((width * zoom - width) / 2),
      top: Math.round((height * zoom - height) * (0.35 + motion * 0.15)),
      width, height,
    })
    .png()
    .toBuffer();
  if (!caption) return resized;
  const maxChars = width >= 1600 ? 44 : width >= 1000 ? 27 : 24;
  const lines = wrapText(caption, maxChars);
  const fontSize = width >= 1600 ? 60 : width >= 1000 ? 58 : 52;
  const lineHeight = Math.round(fontSize * 1.24);
  const boxHeight = Math.round(lines.length * lineHeight + fontSize * 0.9);
  const boxY = Math.round(height - boxHeight - height * 0.13);
  const textY = boxY + Math.round(fontSize * 1.05);
  const textElements = lines.map((line, i) => `<tspan x="${width / 2}" y="${textY + i * lineHeight}">${escapeXml(line)}</tspan>`).join('');
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050816" stop-opacity="0"/><stop offset="1" stop-color="#050816" stop-opacity="0.92"/></linearGradient></defs>
    <rect x="0" y="${Math.round(height - boxHeight - height * 0.2)}" width="${width}" height="${Math.round(boxHeight + height * 0.2)}" fill="url(#cap)"/>
    <rect x="${Math.round(width * 0.06)}" y="${boxY}" width="${Math.round(width * 0.88)}" height="${boxHeight}" rx="${Math.round(fontSize * 0.35)}" fill="#050816" fill-opacity="0.76" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
    <text text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff" stroke="#000000" stroke-width="7" paint-order="stroke fill">${textElements}</text>
  </svg>`;
  return sharp(resized).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).png().toBuffer();
}

export async function createThumbnail(baseBuffer, title, outputPath) {
  const width = 1280;
  const height = 720;
  const resized = await sharp(baseBuffer).resize(width, height, { fit: 'cover' }).png().toBuffer();
  const lines = wrapText(title, 26).slice(0, 3);
  const fontSize = 58;
  const lineHeight = 70;
  const boxY = height - lines.length * lineHeight - 100;
  const textElements = lines.map((line, i) => `<tspan x="70" y="${boxY + 70 + i * lineHeight}">${escapeXml(line)}</tspan>`).join('');
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050816" stop-opacity="0"/><stop offset="1" stop-color="#050816" stop-opacity="0.92"/></linearGradient></defs>
    <rect x="0" y="${Math.round(height * 0.42)}" width="${width}" height="${Math.round(height * 0.58)}" fill="url(#shade)"/>
    <rect x="40" y="${boxY}" width="${width - 80}" height="${lines.length * lineHeight + 70}" rx="28" fill="#050816" fill-opacity="0.76"/>
    <text font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff" stroke="#000" stroke-width="7" paint-order="stroke fill">${textElements}</text>
    <rect x="70" y="${boxY + 18}" width="92" height="8" rx="4" fill="#8b7cff"/>
  </svg>`;
  await sharp(resized).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).jpeg({ quality: 88 }).toFile(outputPath);
  return outputPath;
}
