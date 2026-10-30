/**
 * Real AI video provider adapters (Google Veo, Replicate, fal.ai).
 *
 * IMPORTANT: this module NEVER produces synthetic video and NEVER reports a
 * successful generation without a real provider response. When no provider is
 * configured, `providerStatus()` says so and `startVideoGeneration()` throws
 * 503. Local/offline work is limited to FFmpeg assembly of clips the provider
 * actually returned.
 *
 * Supported providers (each needs server-side credentials):
 *  - replicate  — api.replicate.com predictions, any video model
 *  - fal        — queue.fal.run queue API, any video model
 *  - veo        — Google Veo predictLongRunning on generativelanguage.googleapis.com
 *
 * Several providers may be configured at once. `FILM_VIDEO_PROVIDER` is the
 * server default; a project can store its own `scene_provider` override, which
 * is validated against this list on the server before any request is made.
 *
 * Model-specific input key names differ between providers. Override them with
 * FILM_REPLICATE_INPUT_JSON / FILM_FAL_INPUT_JSON / FILM_VEO_PARAMETERS_JSON
 * (partial JSON merged into the generated input) or change the model env vars.
 * Providers only accept a fixed set of clip lengths; FILM_*_DURATIONS lets you
 * declare the supported values for a custom model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const DEFAULT_DURATIONS = {
  replicate: [5, 10],
  fal: [5, 10],
  veo: [4, 6, 8],
};

const PROVIDER_LABELS = {
  replicate: 'Replicate (Kling / Wan / Minimax / etc.)',
  fal: 'fal.ai (Kling / Veo / Wan / etc.)',
  veo: 'Google Veo (Gemini API)',
};

const PROVIDER_IDS = ['replicate', 'fal', 'veo'];

function roots() {
  return {
    replicate: process.env.REPLICATE_API_ROOT || 'https://api.replicate.com',
    fal: process.env.FAL_API_ROOT || 'https://queue.fal.run',
    veo: process.env.GOOGLE_VEO_API_ROOT || 'https://generativelanguage.googleapis.com',
  };
}

function providerToken(provider) {
  if (provider === 'replicate') return config.film.replicateToken;
  if (provider === 'fal') return config.film.falKey;
  if (provider === 'veo') return config.film.veoKey;
  return '';
}

function redact(text) {
  return String(text || '')
    .replace(/(Bearer|Key)\s+[A-Za-z0-9._-]+/gi, '$1 [redacted]')
    .replace(/([?&](?:key|api_key|token))=[^&\\s]+/gi, '$1=[redacted]')
    .replace(/r8_[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

function providerFetchError(name, response, body) {
  const snippet = redact(body).slice(0, 600);
  const error = new AppError(
    response.status === 401 || response.status === 403 ? 502 : response.status >= 500 ? 502 : 400,
    'video_provider_error',
    `${name} returned HTTP ${response.status}: ${snippet || response.statusText}`,
  );
  error.retryable = response.status === 429 || response.status >= 500;
  error.providerStatus = response.status;
  throw error;
}

async function requestJson(url, options = {}, timeoutMs = 90000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) providerFetchError(options.providerName || new URL(url).hostname, response, text);
  try { return JSON.parse(text); }
  catch { throw new AppError(502, 'video_provider_error', `Provider returned non-JSON: ${redact(text).slice(0, 300)}`); }
}

/** Declared clip lengths for a provider, configurable per deployment/model. */
export function durationOptionsFor(provider) {
  const raw = process.env[`FILM_${String(provider).toUpperCase()}_DURATIONS`];
  const parsed = String(raw || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 60);
  const options = parsed.length ? [...new Set(parsed)].sort((a, b) => a - b) : (DEFAULT_DURATIONS[provider] || []);
  return options.length ? options : [config.film.maxSceneSeconds];
}

/**
 * Map a requested scene length onto the nearest supported clip length.
 * The renderer trims or pads each clip to the scene's storyboard duration, so
 * a 7s beat on a 5/10s model becomes a 10s prediction trimmed back to 7s.
 */
export function resolveProviderDuration(provider, seconds) {
  const options = durationOptionsFor(provider).filter((value) => value <= config.film.maxSceneSeconds);
  const usable = options.length ? options : [config.film.maxSceneSeconds];
  const requested = Math.max(1, Number(seconds) || config.film.maxSceneSeconds);
  return usable.find((value) => value >= requested) ?? usable[usable.length - 1];
}

/** Machine-readable capability catalogue, safe to expose to the browser. */
export function providerCatalog() {
  return PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    configured: Boolean(providerToken(id)),
    model: id === 'replicate' ? config.film.replicateModel : id === 'fal' ? config.film.falModel : config.film.veoModel,
    durations: durationOptionsFor(id).filter((value) => value <= config.film.maxSceneSeconds),
    maxSeconds: Math.max(...durationOptionsFor(id).filter((value) => value <= config.film.maxSceneSeconds), 0) || config.film.maxSceneSeconds,
    aspectRatios: id === 'veo' ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1'],
    supportsReferenceImage: true,
    supportsCancel: id !== 'veo',
  }));
}

export function configuredProviders() {
  return providerCatalog().filter((item) => item.configured).map((item) => item.id);
}

/**
 * Choose the provider for a project. An explicit, configured project override
 * wins; otherwise the server default is used. Unknown or unconfigured choices
 * fail loudly rather than silently swapping providers.
 */
export function resolveVideoProvider(requested) {
  const chosen = String(requested || '').toLowerCase();
  if (chosen && chosen !== 'none') {
    if (!PROVIDER_IDS.includes(chosen)) throw new AppError(400, 'video_provider_unknown', `Unknown video provider "${chosen}".`);
    if (!providerToken(chosen)) {
      throw new AppError(503, 'video_provider_unavailable', `The ${chosen} provider is not configured on this server. Add its API key or choose a configured provider.`);
    }
    return chosen;
  }
  const active = config.film.videoProvider;
  if (!PROVIDER_IDS.includes(active) || !providerToken(active)) {
    throw new AppError(503, 'video_provider_unavailable',
      'Real AI video generation is not configured on this server. An administrator must set FILM_VIDEO_PROVIDER plus REPLICATE_API_TOKEN, FAL_API_KEY, or GOOGLE_VEO_API_KEY. The system will not fabricate a video clip.');
  }
  return active;
}

/** Which provider is active, plus capability/limit info for the UI. */
export function providerStatus(requested) {
  let active = String(requested || config.film.videoProvider || 'none').toLowerCase();
  if (!PROVIDER_IDS.includes(active)) active = 'none';
  const configured = Boolean(providerToken(active));
  const anyConfigured = PROVIDER_IDS.some((id) => providerToken(id));
  return {
    provider: active,
    active,
    configured,
    anyConfigured,
    catalog: providerCatalog(),
    model: active === 'replicate' ? config.film.replicateModel : active === 'fal' ? config.film.falModel : active === 'veo' ? config.film.veoModel : null,
    durations: PROVIDER_IDS.includes(active) ? durationOptionsFor(active) : [],
    maxSceneSeconds: config.film.maxSceneSeconds,
    supportsReferenceImage: configured,
    supportsLipSync: active === 'veo',
    supportsCancel: active !== 'none' && active !== 'veo',
    realGeneration: configured,
    message: configured
      ? `${active} is configured. Scene videos will be generated by the real provider.`
      : anyConfigured
        ? `Real generation is available through: ${configuredProviders().join(', ')}. Select one for this project.`
        : 'No AI video provider is configured. Set FILM_VIDEO_PROVIDER and its API key on the server. Scenes can be written and assembled, but clips will NOT be fabricated.',
    providers: [
      { id: 'none', label: 'None (screenplay + editing only)', configured: !anyConfigured },
      ...providerCatalog().map((item) => ({ id: item.id, label: item.label, configured: item.configured })),
    ],
  };
}

export function requireVideoProvider(requested) {
  const provider = resolveVideoProvider(requested);
  const status = providerStatus(provider);
  if (!status.configured) {
    throw new AppError(503, 'video_provider_unavailable',
      `No real AI video provider is configured. Set FILM_VIDEO_PROVIDER plus REPLICATE_API_TOKEN, FAL_API_KEY, or GOOGLE_VEO_API_KEY. The system will not fabricate a video clip.`);
  }
  return status;
}

function mergeInputOverride(raw, base) {
  if (!raw) return base;
  try {
    const extra = JSON.parse(raw);
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('expected a JSON object');
    const merged = { ...base, ...extra };
    for (const key of Object.keys(merged)) if (merged[key] === undefined || merged[key] === null || merged[key] === '') delete merged[key];
    return merged;
  } catch (error) {
    throw new AppError(500, 'provider_input_override_invalid', `Invalid provider input override JSON: ${error.message}`);
  }
}

function imageDataUri(buffer, mimeType) {
  return `data:${mimeType || 'image/png'};base64,${buffer.toString('base64')}`;
}

function safeProviderId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9/._:-]/g, '').slice(0, 200);
}

// --- Replicate -------------------------------------------------------------
async function replicateStart({ prompt, imageBuffer, imageMime, seconds, aspectRatio }) {
  const model = safeProviderId(config.film.replicateModel);
  const duration = resolveProviderDuration('replicate', seconds);
  const input = mergeInputOverride(process.env.FILM_REPLICATE_INPUT_JSON, {
    prompt,
    ...(imageBuffer ? { [process.env.FILM_REPLICATE_IMAGE_KEY || 'start_image']: imageDataUri(imageBuffer, imageMime) } : {}),
    duration,
    aspect_ratio: aspectRatio,
    ...(process.env.FILM_REPLICATE_NEGATIVE_PROMPT ? { negative_prompt: process.env.FILM_REPLICATE_NEGATIVE_PROMPT } : {}),
  });
  const data = await requestJson(`${roots().replicate}/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.film.replicateToken}`, prefer: 'wait=60' },
    body: JSON.stringify({ input }),
    providerName: 'Replicate',
  });
  if (!data?.id) throw new AppError(502, 'video_provider_error', 'Replicate did not return a prediction id.');
  return {
    provider: 'replicate', providerJobId: data.id,
    pollRef: `/v1/predictions/${encodeURIComponent(data.id)}`,
    requestedSeconds: Number(seconds),
    providerSeconds: duration,
  };
}

async function replicatePoll(handle) {
  const data = await requestJson(`${roots().replicate}${handle.pollRef}`, {
    headers: { authorization: `Bearer ${config.film.replicateToken}` }, providerName: 'Replicate',
  }, 60000);
  const status = String(data.status || '').toLowerCase();
  if (status === 'succeeded') {
    const output = data.output;
    const url = typeof output === 'string' ? output : Array.isArray(output) ? output[0] : output?.video || output?.url;
    if (!url) throw new AppError(502, 'video_provider_error', 'Replicate succeeded but returned no video URL.');
    return { done: true, videoUrl: String(url), headers: {} };
  }
  if (['failed', 'canceled', 'cancelled'].includes(status)) {
    return { done: true, error: `Replicate prediction ${status}: ${redact(data.error || 'unknown error').slice(0, 400)}` };
  }
  return { done: false, progress: status === 'processing' ? 55 : 25, detail: `Replicate: ${status || 'queued'}` };
}

// --- Fal.ai ----------------------------------------------------------------
async function falStart({ prompt, imageBuffer, imageMime, seconds, aspectRatio }) {
  const model = safeProviderId(config.film.falModel);
  const duration = resolveProviderDuration('fal', seconds);
  const input = mergeInputOverride(process.env.FILM_FAL_INPUT_JSON, {
    prompt,
    ...(imageBuffer ? { [process.env.FILM_FAL_IMAGE_KEY || 'image_url']: imageDataUri(imageBuffer, imageMime) } : {}),
    duration: String(duration),
    aspect_ratio: aspectRatio,
  });
  const data = await requestJson(`${roots().fal}/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${config.film.falKey}` },
    body: JSON.stringify(input),
    providerName: 'Fal.ai',
  });
  if (!data?.request_id || !data?.status_url || !data?.response_url) {
    throw new AppError(502, 'video_provider_error', 'Fal.ai did not return queue URLs. Check the model id and FAL_API_KEY.');
  }
  return { provider: 'fal', providerJobId: data.request_id, pollRef: data.status_url, resultRef: data.response_url, requestedSeconds: Number(seconds), providerSeconds: duration };
}

async function falPoll(handle) {
  const status = await requestJson(handle.pollRef, {
    headers: { authorization: `Key ${config.film.falKey}` }, providerName: 'Fal.ai',
  }, 60000);
  const state = String(status.status || '').toUpperCase();
  if (state === 'COMPLETED') {
    const output = await requestJson(handle.resultRef, {
      headers: { authorization: `Key ${config.film.falKey}` }, providerName: 'Fal.ai',
    }, 60000);
    const url = output?.video?.url || output?.video_url || output?.output?.video?.url
      || (Array.isArray(output?.videos) ? output.videos[0]?.url : null);
    if (!url) throw new AppError(502, 'video_provider_error', 'Fal.ai completed but returned no video URL.');
    return { done: true, videoUrl: String(url), headers: { authorization: `Key ${config.film.falKey}` } };
  }
  if (state === 'FAILED' || state === 'CANCELLED') {
    return { done: true, error: `Fal.ai ${state.toLowerCase()}: ${redact(status.error || status.detail || 'unknown error').slice(0, 400)}` };
  }
  return { done: false, progress: state === 'IN_PROGRESS' ? 60 : 30, detail: `Fal.ai: ${state || 'IN_QUEUE'}${status.queue_position ? ` (position ${status.queue_position})` : ''}` };
}

// --- Google Veo ------------------------------------------------------------
function veoUrl(suffix) {
  const key = encodeURIComponent(config.film.veoKey);
  return `${roots().veo}/v1beta/${suffix}${suffix.includes('?') ? '&' : '?'}key=${key}`;
}

async function veoStart({ prompt, imageBuffer, imageMime, seconds, aspectRatio }) {
  const model = safeProviderId(config.film.veoModel);
  const duration = resolveProviderDuration('veo', seconds);
  const instance = { prompt };
  if (imageBuffer) instance.image = { bytesBase64Encoded: imageBuffer.toString('base64'), mimeType: imageMime || 'image/png' };
  const parameters = mergeInputOverride(process.env.FILM_VEO_PARAMETERS_JSON, {
    aspectRatio: aspectRatio === '9:16' ? '9:16' : aspectRatio === '1:1' ? '1:1' : '16:9',
    sampleCount: 1,
    durationSeconds: duration,
    personGeneration: 'allow_adult',
  });
  const data = await requestJson(veoUrl(`models/${model}:predictLongRunning`), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instances: [instance], parameters }),
    providerName: 'Google Veo',
  }, 120000);
  if (!data?.name) throw new AppError(502, 'video_provider_error', `Google Veo did not return an operation name: ${redact(JSON.stringify(data)).slice(0, 300)}`);
  return { provider: 'veo', providerJobId: data.name, pollRef: data.name.replace(/^\//, ''), requestedSeconds: Number(seconds), providerSeconds: duration };
}

async function veoPoll(handle) {
  const data = await requestJson(veoUrl(handle.pollRef), { providerName: 'Google Veo' }, 60000);
  if (data.error) return { done: true, error: `Google Veo error: ${redact(data.error.message || JSON.stringify(data.error)).slice(0, 400)}` };
  if (!data.done) return { done: false, progress: 45, detail: 'Google Veo: operation running' };
  const samples = data.response?.generateVideoResponse?.generatedSamples
    || data.response?.generatedSamples || data.result?.generateVideoResponse?.generatedSamples || [];
  const sample = samples[0];
  if (!sample) return { done: true, error: 'Google Veo finished without generated samples.' };
  if (sample.video?.uri) return { done: true, videoUrl: `${sample.video.uri}${sample.video.uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(config.film.veoKey)}`, headers: {} };
  const bytes = sample.video?.videoBytes || sample.video?.bytesBase64Encoded || sample.bytesBase64Encoded;
  if (bytes) return { done: true, base64: bytes };
  return { done: true, error: 'Google Veo returned an unrecognised video payload.' };
}

/**
 * Start a real provider prediction. Returns an opaque handle that is persisted
 * with the scene so a worker restart can resume polling.
 */
export async function startVideoGeneration({ prompt, referenceImagePath, seconds, aspectRatio = '9:16', provider: requestedProvider }) {
  const provider = resolveVideoProvider(requestedProvider);
  const duration = Math.max(1, Math.min(config.film.maxSceneSeconds, Number(seconds) || config.film.maxSceneSeconds));
  let imageBuffer = null; let imageMime = null;
  if (referenceImagePath) {
    const abs = path.resolve(referenceImagePath);
    if (!fs.existsSync(abs)) throw new AppError(400, 'reference_image_missing', 'Reference image not found on the server.');
    const stat = fs.statSync(abs);
    if (stat.size > config.film.maxReferenceImageMb * 1024 * 1024) {
      throw new AppError(400, 'reference_image_too_large', `Reference image must be under ${config.film.maxReferenceImageMb} MB.`);
    }
    imageBuffer = fs.readFileSync(abs);
    imageMime = path.extname(abs).toLowerCase() === '.jpg' || path.extname(abs).toLowerCase() === '.jpeg' ? 'image/jpeg' : 'image/png';
  }
  const args = { prompt: String(prompt || '').slice(0, 4000) || 'Cinematic dramatic scene.', imageBuffer, imageMime, seconds: duration, aspectRatio };
  if (provider === 'replicate') return replicateStart(args);
  if (provider === 'fal') return falStart(args);
  if (provider === 'veo') return veoStart(args);
  throw new AppError(500, 'video_provider_unknown', `Unknown FILM_VIDEO_PROVIDER "${provider}".`);
}

/** Poll a persisted handle. Never fabricates completion. */
export async function pollVideoGeneration(handle) {
  if (!handle?.provider || !handle?.pollRef) throw new AppError(500, 'video_handle_invalid', 'Stored provider handle is invalid; regenerate this scene.');
  requireVideoProvider(handle.provider);
  if (handle.provider === 'replicate') return replicatePoll(handle);
  if (handle.provider === 'fal') return falPoll(handle);
  if (handle.provider === 'veo') return veoPoll(handle);
  throw new AppError(500, 'video_provider_unknown', `Unknown provider in stored handle: ${handle.provider}`);
}

/**
 * Best-effort cancellation of a provider job. Veo has no cancel operation, so
 * it reports `supported: false` instead of pretending the job stopped. Credits
 * are refunded locally either way, and a late provider result is never attached
 * to a cancelled scene.
 */
export async function cancelVideoGeneration(handle) {
  if (!handle?.provider) return { cancelled: false, supported: false, reason: 'No provider job to cancel.' };
  const token = providerToken(handle.provider);
  if (!token) return { cancelled: false, supported: false, reason: 'Provider is not configured.' };
  try {
    if (handle.provider === 'replicate') {
      await requestJson(`${roots().replicate}/v1/predictions/${encodeURIComponent(handle.providerJobId)}/cancel`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, providerName: 'Replicate',
      }, 30000);
      return { cancelled: true, supported: true };
    }
    if (handle.provider === 'fal') {
      const base = String(handle.pollRef || '').replace(/\/status\/?$/, '');
      if (!base) return { cancelled: false, supported: true, reason: 'Missing fal queue reference.' };
      await requestJson(`${base}/cancel`, {
        method: 'PUT', headers: { authorization: `Key ${token}` }, providerName: 'Fal.ai',
      }, 30000);
      return { cancelled: true, supported: true };
    }
    return { cancelled: false, supported: false, reason: `${handle.provider} does not expose a cancellation endpoint. The job will finish at the provider but its result is discarded.` };
  } catch (error) {
    return { cancelled: false, supported: handle.provider !== 'veo', reason: redact(error.message).slice(0, 400) };
  }
}

/** Download a provider video to disk with a hard size cap. */
export async function downloadProviderVideo(result, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (result.base64) {
    const buffer = Buffer.from(result.base64, 'base64');
    if (buffer.length > config.film.maxClipMb * 1024 * 1024) throw new AppError(502, 'clip_too_large', 'Provider video exceeds the configured clip size limit.');
    fs.writeFileSync(destination, buffer);
    return destination;
  }
  if (!result.videoUrl) throw new AppError(502, 'video_provider_error', 'Provider returned no downloadable video.');
  const response = await fetch(result.videoUrl, { headers: result.headers || {}, signal: AbortSignal.timeout(180000) });
  if (!response.ok) providerFetchError('Video download', response, await response.text().catch(() => ''));
  const length = Number(response.headers.get('content-length') || 0);
  if (length > config.film.maxClipMb * 1024 * 1024) throw new AppError(502, 'clip_too_large', 'Provider video exceeds the configured clip size limit.');
  if (!response.body) throw new AppError(502, 'video_provider_error', 'Provider video response had no body.');
  let received = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > config.film.maxClipMb * 1024 * 1024) cb(new AppError(502, 'clip_too_large', 'Provider video exceeds the configured clip size limit.'));
      else cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(destination));
  if (fs.statSync(destination).size < 1024) {
    fs.rmSync(destination, { force: true });
    throw new AppError(502, 'clip_too_small', 'Provider returned an unexpectedly small video; refusing to use it.');
  }
  return destination;
}
