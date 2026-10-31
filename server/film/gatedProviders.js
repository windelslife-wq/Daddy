/**
 * Small, shared HTTP client for the two provider-gated post-production steps:
 * lip-sync and motion transfer (video-to-video).
 *
 * Both reuse the SAME credentials as the film video providers (Replicate / fal)
 * instead of inventing a parallel integration, and both are strictly honest:
 *
 *  - with no credential the feature reports `configured: false` and the API
 *    answers 503 `lip_sync_unavailable` / `motion_transfer_unavailable`;
 *  - when configured, the file is sent as a data URI to the provider's public
 *    prediction API and the returned MP4 is downloaded to the project folder;
 *  - the live call has NOT been verified in this environment (no provider
 *    account, no outbound egress), so the transport is documented as unverified.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

const MAX_INLINE_BYTES = 8 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function providerCredentials() {
  return {
    replicate: config.film.replicateToken || null,
    fal: config.film.falKey || null,
  };
}

export function requestedProvider(preferred) {
  const credentials = providerCredentials();
  const requested = String(preferred || config.film.lipSyncProvider || '').toLowerCase();
  if (requested === 'replicate' && credentials.replicate) return 'replicate';
  if (requested === 'fal' && credentials.fal) return 'fal';
  if (requested && requested !== 'auto') return null;
  if (credentials.replicate) return 'replicate';
  if (credentials.fal) return 'fal';
  return null;
}

export function providerStatus({ feature, envProvider, models }) {
  const provider = requestedProvider(envProvider);
  return {
    feature,
    provider: provider || 'none',
    configured: Boolean(provider),
    models,
    note: provider
      ? 'Credential found. Calls go to the provider prediction API; this environment could not exercise a live call.'
      : `No ${feature.replace(/_/g, ' ')} provider credential. Set FILM_LIPSYNC_PROVIDER/FILM_MOTION_PROVIDER plus REPLICATE_API_TOKEN or FAL_API_KEY.`,
    verified: false,
  };
}

async function fileToDataUri(filePath, mime) {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_INLINE_BYTES) {
    const error = new Error(`File is ${(stats.size / 1024 / 1024).toFixed(1)} MB; inline provider uploads are limited to 8 MB.`);
    error.code = 'file_too_large';
    throw error;
  }
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function inlineVideo(filePath) { return fileToDataUri(filePath, 'video/mp4'); }
export async function inlineAudio(filePath) { return fileToDataUri(filePath, 'audio/wav'); }

async function replicateCreate({ model, input, token }) {
  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ model, input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Replicate rejected the request (${response.status}): ${body.detail || body.title || 'unknown error'}`);
  return body;
}

async function replicatePoll(prediction, token, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const started = Date.now();
  let current = prediction;
  while (current?.status && ['starting', 'processing'].includes(current.status)) {
    if (Date.now() - started > timeoutMs) throw new Error('Provider prediction timed out.');
    await sleep(4000);
    const response = await fetch(current.urls?.get || `https://api.replicate.com/v1/predictions/${current.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    current = await response.json();
  }
  if (current?.status !== 'succeeded') {
    throw new Error(`Provider prediction ${current?.status}: ${current?.error || 'no output'}`);
  }
  return current;
}

async function falRun({ model, input, token }) {
  const response = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`fal rejected the request (${response.status}): ${body.detail || 'unknown error'}`);
  return body;
}

function firstUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstUrl(value[0]);
  if (typeof value === 'object') {
    for (const key of ['video', 'output', 'url', 'file']) {
      if (value[key]) return firstUrl(value[key]);
    }
  }
  return null;
}

/**
 * Run one provider post-production prediction and store the resulting MP4.
 * Returns { provider, url, outputPath, bytes }.
 */
export async function runProviderVideo({ provider, model, input, outputPath }) {
  const credentials = providerCredentials();
  let url;
  if (provider === 'replicate') {
    const created = await replicateCreate({ model, input, token: credentials.replicate });
    const done = await replicatePoll(created, credentials.replicate);
    url = firstUrl(done.output);
  } else if (provider === 'fal') {
    const done = await falRun({ model, input, token: credentials.fal });
    url = firstUrl(done.video) || firstUrl(done.output) || firstUrl(done);
  } else {
    throw new Error('No provider selected.');
  }
  if (!url) throw new Error('Provider finished without a video URL.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the provider result (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error('Provider returned a file that is too small to be a video.');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  logger.info({ provider, model, bytes: buffer.length }, 'Provider video stored');
  return { provider, model, url, outputPath, bytes: buffer.length };
}
