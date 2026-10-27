import fs from 'node:fs/promises';
import { db, parseJson, getSetting } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { fetchWithTimeout } from '../ai.js';
import { updatePublicationMetadata } from './context.js';
import { authError, configError, PublishError } from './errors.js';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

function tokenFor(ctx) {
  const token = ctx.credentials.accessToken;
  if (!token) throw authError('The YouTube access token is missing. Reconnect the account.');
  return token;
}

async function rawFetch(url, options = {}, timeoutMs = 180000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return { response, text };
}

function parseGoogleError(status, text) {
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  const apiError = payload.error?.errors?.[0] || payload.error || {};
  const reason = apiError.reason || '';
  const message = payload.error?.message || apiError.message || `YouTube API returned ${status}`;
  const retryable = status === 429 || status >= 500 || ['quotaExceeded', 'rateLimitExceeded', 'backendError', 'internalError'].includes(reason);
  const isAuth = status === 401 || reason === 'authError' || reason === 'invalidCredentials';
  return new PublishError(`YouTube API: ${message}`, {
    code: isAuth ? 'google_token_expired' : reason || 'youtube_api_error',
    retryable: !isAuth && retryable,
    status: isAuth ? 401 : status,
    details: { reason, status },
  });
}

async function googleJson(path, { method = 'GET', token, params = {}, body = null, timeoutMs = 90000 } = {}) {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const options = { method, headers: { authorization: `Bearer ${token}` } };
  if (body) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
  const { response, text } = await rawFetch(url, options, timeoutMs);
  if (!response.ok) throw parseGoogleError(response.status, text);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

async function findExistingVideo(token, refCode) {
  const channels = await googleJson('channels', { token, params: { part: 'contentDetails', mine: 'true', maxResults: 1 } });
  const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return null;
  const items = await googleJson('playlistItems', { token, params: { part: 'snippet', playlistId: uploads, maxResults: 50 } });
  return (items.items || []).find((item) => String(item.snippet?.description || '').includes(refCode));
}

async function initiateUpload(ctx, token, fileSize) {
  const metadata = {
    snippet: {
      title: ctx.caption.title.slice(0, 100),
      description: ctx.caption.description.slice(0, 5000),
      tags: ctx.caption.hashtags.map((tag) => String(tag).replace(/^#/, '')).slice(0, 15),
      categoryId: '22',
      defaultLanguage: parseJson(ctx.project.config, {}).language || 'en',
    },
    status: {
      privacyStatus: await getSetting('default_privacy', 'public'),
      selfDeclaredMadeForKids: false,
    },
  };
  const url = new URL(`${UPLOAD}/videos`);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('part', 'snippet,status');
  const { response, text } = await rawFetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': 'video/mp4',
      'x-upload-content-length': String(fileSize),
    },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw parseGoogleError(response.status, text);
  const sessionUri = response.headers.get('location');
  if (!sessionUri) throw new PublishError('YouTube did not return a resumable upload session URL.', { code: 'youtube_session_missing', retryable: true });
  await updatePublicationMetadata(ctx.publication.id, { uploadSessionUri: sessionUri });
  return sessionUri;
}

async function queryResume(sessionUri, token) {
  const { response, text } = await rawFetch(sessionUri, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-length': '0', 'content-range': 'bytes */*' },
  }, 60000);
  if (response.ok) {
    try { return { completed: JSON.parse(text) }; } catch { return { completed: { id: null, raw: text } }; }
  }
  if (response.status === 308) {
    const range = response.headers.get('range');
    const match = range && /bytes=0-(\d+)/.exec(range);
    return { offset: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.status === 404) return { expired: true };
  throw parseGoogleError(response.status, text);
}

async function putUpload(sessionUri, token, buffer, offset = 0) {
  const size = buffer.length;
  const chunk = offset > 0 ? buffer.subarray(offset) : buffer;
  const { response, text } = await rawFetch(sessionUri, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'video/mp4',
      'content-length': String(chunk.length),
      'content-range': `bytes ${offset}-${size - 1}/${size}`,
    },
    body: chunk,
  }, 300000);
  if (response.ok) {
    try { return { completed: JSON.parse(text) }; } catch { return { completed: { raw: text } }; }
  }
  if (response.status === 308) {
    throw new PublishError('YouTube upload is incomplete; the worker will resume from the saved session.', { code: 'youtube_upload_incomplete', retryable: true, status: 308 });
  }
  throw parseGoogleError(response.status, text);
}

async function uploadCaptions(ctx, token, videoId) {
  if (!ctx.project.caption_path) return null;
  try {
    const srt = await fs.readFile(ctx.project.caption_path);
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      snippet: {
        videoId,
        language: parseJson(ctx.project.config, {}).language || 'en',
        name: 'AI generated captions',
        isDraft: false,
      },
    })], { type: 'application/json' }), 'metadata.json');
    form.append('media', new Blob([srt], { type: 'text/plain; charset=UTF-8' }), 'captions.srt');
    const url = `${UPLOAD}/captions?uploadType=multipart&part=snippet`;
    const { response, text } = await rawFetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, 120000);
    if (!response.ok) throw parseGoogleError(response.status, text);
    return text ? JSON.parse(text) : {};
  } catch (error) {
    logger.warn({ error: error.message, publicationId: ctx.publication.id, videoId }, 'YouTube caption upload failed; video remains published');
    return { warning: error.message };
  }
}

export async function publishYouTube(ctx) {
  const token = tokenFor(ctx);
  const existing = await findExistingVideo(token, ctx.caption.refCode).catch(() => null);
  if (existing) {
    return { remoteId: existing.snippet.resourceId?.videoId || existing.id, remoteUrl: existing.snippet.resourceId?.videoId ? `https://www.youtube.com/watch?v=${existing.snippet.resourceId.videoId}` : null, raw: existing, duplicate: true };
  }
  const buffer = await fs.readFile(ctx.videoPath);
  const metadata = parseJson(ctx.publication.metadata, {});
  let sessionUri = metadata.uploadSessionUri;
  let offset = 0;
  let completed = null;
  if (sessionUri) {
    const resumed = await queryResume(sessionUri, token);
    if (resumed.expired) {
      await updatePublicationMetadata(ctx.publication.id, { uploadSessionUri: null });
      sessionUri = null;
    } else if (resumed.completed) {
      completed = resumed.completed;
    } else {
      offset = resumed.offset || 0;
    }
  }
  if (!sessionUri && !completed) sessionUri = await initiateUpload(ctx, token, buffer.length);
  if (!completed) {
    const result = await putUpload(sessionUri, token, buffer, offset);
    completed = result.completed;
  }
  const videoId = completed?.id;
  if (!videoId) throw new PublishError('YouTube upload finished without a video ID.', { code: 'youtube_missing_video_id', retryable: false, status: 502 });
  const captions = await uploadCaptions(ctx, token, videoId);
  return {
    remoteId: String(videoId),
    remoteUrl: `https://www.youtube.com/watch?v=${videoId}`,
    raw: { upload: completed, captions, refCode: ctx.caption.refCode, privacyStatus: await getSetting('default_privacy', 'public') },
    metadataPatch: { uploadSessionUri: null },
  };
}

export async function fetchYouTubeMetrics(ctx, remoteId) {
  const token = tokenFor(ctx);
  const result = await googleJson('videos', { token, params: { part: 'statistics', id: remoteId } });
  const stats = result.items?.[0]?.statistics;
  if (!stats) throw new PublishError('YouTube statistics are not available for this video yet.', { code: 'metrics_unavailable', retryable: false, status: 404 });
  return {
    views: Number(stats.viewCount || 0),
    likes: Number(stats.likeCount || 0),
    comments: Number(stats.commentCount || 0),
    shares: 0,
    impressions: 0,
    watchSeconds: 0,
    raw: { ...result, note: 'Shares, impressions, and watch time require YouTube Analytics API access and are reported as 0 here.' },
  };
}

export async function verifyYouTubeAccount(account, credentials) {
  const token = credentials.accessToken;
  if (!token) throw authError('The YouTube access token is missing.');
  const result = await googleJson('channels', { token, params: { part: 'snippet', mine: 'true', maxResults: 5 } });
  const channel = (result.items || []).find((item) => item.id === account.external_id) || result.items?.[0];
  return { ok: Boolean(channel), details: channel?.snippet || result };
}
