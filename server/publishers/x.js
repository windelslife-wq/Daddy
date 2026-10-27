import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import OAuth from 'oauth-1.0a';
import { config } from '../config.js';
import { parseJson } from '../db.js';
import { logger } from '../logger.js';
import { updatePublicationMetadata } from './context.js';
import { authError, configError, PublishError } from './errors.js';

const UPLOAD_URL = config.externalApis.xUpload;
const API = config.externalApis.xApi;

function assertXConfig() {
  if (!config.oauth.xConsumerKey || !config.oauth.xConsumerSecret) throw configError('X_CONSUMER_KEY and X_CONSUMER_SECRET are not configured on the server.');
}

function oauthClient() {
  assertXConfig();
  return new OAuth({
    consumer: { key: config.oauth.xConsumerKey, secret: config.oauth.xConsumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

function tokenPair(ctx) {
  const token = ctx?.credentials?.oauthToken;
  const secret = ctx?.credentials?.oauthTokenSecret;
  if (!token || !secret) throw authError('The X OAuth 1.0a user tokens are missing. Reconnect the account.');
  return { key: token, secret };
}

function oauthHeader(url, method, tokens, data = undefined) {
  const oauth = oauthClient();
  const request = { url: String(url), method, ...(data ? { data } : {}) };
  return oauth.toHeader(oauth.authorize(request, tokens)).Authorization;
}

async function xRawFetch(url, { method = 'GET', tokens, data, body, headers = {}, timeoutMs = 120000 } = {}) {
  const auth = oauthHeader(url, method, tokens, data);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { authorization: auth, ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new PublishError(`X API request failed: ${error.message}`, { code: 'x_network_error', retryable: true, status: 502 });
  }
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return { response, text, payload };
}

function xError({ response, payload }, fallback = 'X API request failed') {
  const status = response.status;
  const message = payload?.detail || payload?.title || payload?.error || payload?.message || payload?.raw || fallback;
  const isAuth = status === 401 || /authenticat|authoriz|invalid token/i.test(String(message));
  const isDuplicate = status === 403 && /duplicate/i.test(String(message));
  const retryable = status === 429 || status >= 500 || /rate limit/i.test(String(message));
  return new PublishError(String(message).slice(0, 1000), {
    code: isAuth ? 'x_authentication_failed' : isDuplicate ? 'x_duplicate_post' : `x_api_${status}`,
    retryable: !isAuth && !isDuplicate && retryable,
    status,
    details: payload,
  });
}

async function xJson(url, options = {}) {
  const result = await xRawFetch(url, options);
  if (!result.response.ok) throw xError(result);
  return result.payload;
}

async function findExistingTweet(ctx, refCode) {
  const tokens = tokenPair(ctx);
  const url = new URL(`${API}/users/${encodeURIComponent(ctx.account.external_id)}/tweets`);
  url.searchParams.set('max_results', '20');
  url.searchParams.set('tweet.fields', 'text,created_at');
  const data = Object.fromEntries(url.searchParams);
  try {
    const result = await xJson(url, { method: 'GET', tokens, data });
    return (result.data || []).find((tweet) => String(tweet.text || '').includes(refCode));
  } catch (error) {
    logger.warn({ error: error.message, accountId: ctx.account.id }, 'X duplicate lookup unavailable; using local idempotency only');
    return null;
  }
}

async function mediaCommand(ctx, command, extra = {}, { multipart = false, chunk = null, chunkIndex = 0 } = {}) {
  const tokens = tokenPair(ctx);
  if (multipart) {
    const form = new FormData();
    form.append('command', command);
    for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
    if (chunk) form.append('media', new Blob([chunk], { type: 'application/octet-stream' }), `chunk-${chunkIndex}`);
    const result = await xRawFetch(UPLOAD_URL, { method: 'POST', tokens, body: form, timeoutMs: 180000 });
    if (!result.response.ok) throw xError(result, `X ${command} media command failed`);
    return result.payload;
  }
  const form = new URLSearchParams({ command, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  const data = Object.fromEntries(form);
  const result = await xRawFetch(UPLOAD_URL, { method: 'POST', tokens, data, body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeoutMs: 180000 });
  if (!result.response.ok) throw xError(result, `X ${command} media command failed`);
  return result.payload;
}

async function mediaStatus(ctx, mediaId) {
  const tokens = tokenPair(ctx);
  const url = new URL(UPLOAD_URL);
  url.searchParams.set('command', 'STATUS');
  url.searchParams.set('media_id', mediaId);
  const data = Object.fromEntries(url.searchParams);
  const result = await xJson(url, { method: 'GET', tokens, data, timeoutMs: 60000 });
  return result.processing_info || { state: 'succeeded' };
}

export async function publishX(ctx) {
  const tokens = tokenPair(ctx);
  assertXConfig();
  const existing = await findExistingTweet(ctx, ctx.caption.refCode);
  if (existing) {
    return { remoteId: String(existing.id), remoteUrl: `https://x.com/i/web/status/${existing.id}`, raw: existing, duplicate: true };
  }
  const metadata = parseJson(ctx.publication.metadata, {});
  let mediaId = metadata.mediaId ? String(metadata.mediaId) : null;
  let mediaState = metadata.mediaState || null;
  if (!mediaId) {
    const buffer = await fs.readFile(ctx.videoPath);
    const init = await mediaCommand(ctx, 'INIT', {
      media_type: 'video/mp4',
      total_bytes: buffer.length,
      media_category: 'tweet_video',
    });
    mediaId = String(init.media_id_string || init.media_id || '');
    if (!mediaId) throw new PublishError('X media INIT did not return a media ID.', { code: 'x_media_init_missing_id', retryable: true });
    const chunkSize = 2 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(buffer.length / chunkSize));
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = buffer.subarray(index * chunkSize, Math.min(buffer.length, (index + 1) * chunkSize));
      await mediaCommand(ctx, 'APPEND', { media_id: mediaId, segment_index: index }, { multipart: true, chunk, chunkIndex: index });
    }
    const finalized = await mediaCommand(ctx, 'FINALIZE', { media_id: mediaId });
    mediaState = finalized.processing_info?.state || 'succeeded';
    await updatePublicationMetadata(ctx.publication.id, { mediaId, mediaState, mediaProcessing: finalized.processing_info || null });
  }
  if (mediaState === 'pending' || mediaState === 'in_progress') {
    const info = await mediaStatus(ctx, mediaId);
    const pollCount = Number(metadata.pollCount || 0) + 1;
    if (['pending', 'in_progress'].includes(String(info.state).toLowerCase())) {
      if (pollCount > 20) throw new PublishError('X media processing did not finish within the polling window.', { code: 'x_media_timeout', retryable: false, status: 504 });
      return {
        pending: true,
        jobType: 'finalize_x',
        jobKey: `${mediaId}:${pollCount}`,
        delayMs: Math.max(5000, Number(info.check_after_secs || 5) * 1000),
        metadataPatch: { mediaId, mediaState, pollCount, mediaProcessing: info },
        raw: info,
      };
    }
    if (String(info.state).toLowerCase() === 'failed') {
      await updatePublicationMetadata(ctx.publication.id, { mediaId: null, mediaState: null, pollCount: 0, mediaProcessing: info });
      throw new PublishError(`X media processing failed: ${info.error?.message || 'unknown error'}`, { code: 'x_media_failed', retryable: true });
    }
    mediaState = 'succeeded';
    await updatePublicationMetadata(ctx.publication.id, { mediaId, mediaState, pollCount, mediaProcessing: info });
  }
  const body = JSON.stringify({ text: ctx.caption.description, media: { media_ids: [String(mediaId)] } });
  let result;
  try {
    result = await xJson(`${API}/tweets`, {
      method: 'POST', tokens, body,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const recovered = await findExistingTweet(ctx, ctx.caption.refCode);
    if (recovered) return { remoteId: String(recovered.id), remoteUrl: `https://x.com/i/web/status/${recovered.id}`, raw: recovered, duplicate: true };
    throw error;
  }
  const remoteId = result.data?.id;
  if (!remoteId) throw new PublishError('X did not return a post ID.', { code: 'x_missing_post_id', retryable: true });
  const handle = String(ctx.account.handle || '').replace(/^@/, '');
  return {
    remoteId: String(remoteId),
    remoteUrl: handle ? `https://x.com/${handle}/status/${remoteId}` : `https://x.com/i/web/status/${remoteId}`,
    raw: { ...result, mediaId, refCode: ctx.caption.refCode },
    metadataPatch: { mediaId, mediaState: 'published' },
  };
}

function estimatedWatchSeconds(media) {
  const durationSeconds = Number(media?.duration_ms || 0) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const playback = media?.non_public_metrics || media?.organic_metrics || {};
  const quarter = [0, 25, 50, 75, 100].map((point) => Number(playback[`playback_${point}_count`] || 0));
  if (!quarter.some((value) => value > 0)) return 0;
  const buckets = [
    [0.125, Math.max(0, quarter[0] - quarter[1])],
    [0.375, Math.max(0, quarter[1] - quarter[2])],
    [0.625, Math.max(0, quarter[2] - quarter[3])],
    [0.875, Math.max(0, quarter[3] - quarter[4])],
    [1, Math.max(0, quarter[4])],
  ];
  return Math.round(buckets.reduce((total, [fraction, count]) => total + durationSeconds * fraction * count, 0));
}

async function xTweetLookup(remoteId, tokens, includePrivateMetrics) {
  const url = new URL(`${API}/tweets/${encodeURIComponent(remoteId)}`);
  if (includePrivateMetrics) {
    url.searchParams.set('expansions', 'attachments.media_keys');
    url.searchParams.set('tweet.fields', 'public_metrics,created_at,attachments,non_public_metrics,organic_metrics');
    url.searchParams.set('media.fields', 'duration_ms,public_metrics,non_public_metrics,organic_metrics,type,media_key');
  } else {
    url.searchParams.set('tweet.fields', 'public_metrics,created_at');
  }
  return xJson(url, { method: 'GET', tokens, data: Object.fromEntries(url.searchParams) });
}

export async function fetchXMetrics(ctx, remoteId) {
  const tokens = tokenPair(ctx);
  const notes = [];
  let result;
  try {
    result = await xTweetLookup(remoteId, tokens, true);
  } catch (error) {
    if (![400, 401, 403, 404].includes(Number(error.status))) throw error;
    notes.push('Private media metrics are not available with the current X API tier; public post metrics were used.');
    result = await xTweetLookup(remoteId, tokens, false);
  }
  const metrics = result.data?.public_metrics;
  if (!metrics) throw new PublishError('X public metrics are not available for this post with the current API access.', { code: 'metrics_unavailable', retryable: false, status: 404 });
  const media = (result.includes?.media || []).find((item) => item.type === 'video') || result.includes?.media?.[0] || null;
  const mediaPublicMetrics = media?.public_metrics || {};
  const impressions = Number(metrics.impression_count || 0);
  const views = Number(mediaPublicMetrics.view_count || media?.organic_metrics?.view_count || impressions);
  const watchSeconds = estimatedWatchSeconds(media);
  if (media && !watchSeconds) notes.push('X exposes video playback quartiles rather than exact watch time; watchSeconds is 0 until those private fields are available.');
  else if (watchSeconds) notes.push('watchSeconds is estimated from X video playback quartiles and media duration.');
  return {
    views,
    likes: Number(metrics.like_count || 0),
    comments: Number(metrics.reply_count || 0),
    shares: Number(metrics.retweet_count || 0) + Number(metrics.quote_count || 0),
    impressions,
    watchSeconds,
    raw: { ...result, notes, mediaMetrics: media ? { public: media.public_metrics || {}, organic: media.organic_metrics || {}, nonPublic: media.non_public_metrics || {}, durationMs: media.duration_ms || null } : null },
  };
}

export async function verifyXAccount(account, credentials) {
  const tokens = { key: credentials.oauthToken, secret: credentials.oauthTokenSecret };
  if (!tokens.key || !tokens.secret) throw authError('The X OAuth 1.0a user tokens are missing.');
  const result = await xJson(`${API}/users/me?user.fields=id,username,name`, { method: 'GET', tokens });
  return { ok: Boolean(result.data?.id), details: result.data || result };
}
