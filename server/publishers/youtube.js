import fs from 'node:fs/promises';
import { db, now, json, parseJson, getSetting } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { fetchWithTimeout } from '../ai.js';
import { updatePublicationMetadata } from './context.js';
import { authError, configError, PublishError } from './errors.js';

const API = `${config.externalApis.googleApi}/youtube/v3`;
const UPLOAD = config.externalApis.googleUpload;
const ANALYTICS_API = config.externalApis.googleAnalytics;
const REPORTING_API = config.externalApis.googleReporting;
const REACH_REPORT_TYPE = 'channel_reach_basic_a1';

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

async function googleJson(path, { method = 'GET', token, params = {}, body = null, timeoutMs = 90000, base = API } = {}) {
  const url = new URL(`${base}/${path}`);
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

function publicationStartDate(ctx) {
  const candidate = ctx.publication.published_at || ctx.post.scheduled_at || ctx.project.created_at || ctx.publication.created_at;
  const parsed = new Date(candidate || Date.now());
  const safe = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const oldestUseful = Date.now() - 60 * 86400000;
  return new Date(Math.max(safe.getTime() - 2 * 86400000, oldestUseful));
}

function analyticsValue(result, metric) {
  const headers = result?.columnHeaders || [];
  const index = headers.findIndex((header) => header.name === metric || header.name === metric.toLowerCase());
  if (index < 0) return 0;
  return (result.rows || []).reduce((sum, row) => sum + (Number(row[index]) || 0), 0);
}

async function fetchAnalyticsReport(token, remoteId, startDate) {
  const params = {
    ids: 'channel==MINE',
    startDate: startDate.toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    metrics: 'views,likes,comments,shares,estimatedMinutesWatched',
    filters: `video==${remoteId}`,
  };
  try {
    const result = await googleJson('reports', { token, params, base: ANALYTICS_API, timeoutMs: 30000 });
    return { result, scope: 'full' };
  } catch (error) {
    try {
      const result = await googleJson('reports', {
        token,
        params: { ...params, metrics: 'views,estimatedMinutesWatched' },
        base: ANALYTICS_API,
        timeoutMs: 30000,
      });
      return { result, scope: 'core', warning: error.message };
    } catch (fallbackError) {
      logger.warn({ error: fallbackError.message, remoteId }, 'YouTube Analytics report unavailable; using Data API statistics');
      return { unavailable: fallbackError.message };
    }
  }
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

async function saveReachJobId(ctx, jobId) {
  const metadata = parseJson(ctx.account.metadata, {});
  await db('accounts').where({ id: ctx.account.id }).update({
    metadata: json({ ...metadata, reachReportJobId: jobId, reachReportJobCreatedAt: now() }),
    updated_at: now(),
  });
}

async function ensureReachReportingJob(ctx, token) {
  const metadata = parseJson(ctx.account.metadata, {});
  if (metadata.reachReportJobId) return { jobId: metadata.reachReportJobId };
  const jobs = await googleJson('jobs', { token, base: REPORTING_API, params: { pageSize: 50 }, timeoutMs: 30000 });
  const existing = (jobs.jobs || []).find((job) => job.reportTypeId === REACH_REPORT_TYPE && !job.expireTime);
  if (existing?.id) {
    await saveReachJobId(ctx, existing.id);
    return { jobId: existing.id, existing: true };
  }
  const types = await googleJson('reportTypes', { token, base: REPORTING_API, params: { pageSize: 100 }, timeoutMs: 30000 });
  const available = (types.reportTypes || []).some((type) => type.id === REACH_REPORT_TYPE);
  if (!available) return { unavailable: `${REACH_REPORT_TYPE} is not available for this channel or API tier.` };
  const created = await googleJson('jobs', {
    method: 'POST',
    token,
    base: REPORTING_API,
    body: { reportTypeId: REACH_REPORT_TYPE, name: `${config.appName} thumbnail impressions` },
    timeoutMs: 30000,
  });
  if (!created.id) return { unavailable: 'YouTube did not return a reporting job ID.' };
  await saveReachJobId(ctx, created.id);
  return { jobId: created.id, created: true, note: 'First bulk reach report may take up to 48 hours.' };
}

async function fetchReachImpressions(ctx, token, remoteId, startDate) {
  try {
    const job = await ensureReachReportingJob(ctx, token);
    if (!job.jobId) return { impressions: 0, reports: 0, status: 'unavailable', note: job.unavailable };
    const reports = await googleJson(`jobs/${encodeURIComponent(job.jobId)}/reports`, {
      token,
      base: REPORTING_API,
      params: {
        startTimeAtOrAfter: startDate.toISOString(),
        startTimeBefore: new Date(Date.now() + 86400000).toISOString(),
        pageSize: 100,
      },
      timeoutMs: 30000,
    });
    let impressions = 0;
    let count = 0;
    for (const report of reports.reports || []) {
      if (!report.downloadUrl) continue;
      const response = await fetch(report.downloadUrl, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) continue;
      const rows = parseCsv(await response.text());
      for (const row of rows) if (row.video_id === remoteId) impressions += Number(row.video_thumbnail_impressions || 0);
      count += 1;
    }
    return {
      impressions,
      reports: count,
      status: count ? 'ok' : 'waiting_for_first_report',
      jobId: job.jobId,
      note: job.note || (count ? 'Summed daily video_thumbnail_impressions from bulk reach reports.' : 'Bulk reach reports are generated daily and can take up to 48 hours after job creation.'),
    };
  } catch (error) {
    logger.warn({ error: error.message, remoteId }, 'YouTube Reporting API reach metrics unavailable');
    return { impressions: 0, reports: 0, status: 'unavailable', note: error.message };
  }
}

export async function fetchYouTubeMetrics(ctx, remoteId) {
  const token = tokenFor(ctx);
  const result = await googleJson('videos', { token, params: { part: 'statistics', id: remoteId } });
  const stats = result.items?.[0]?.statistics;
  if (!stats) throw new PublishError('YouTube statistics are not available for this video yet.', { code: 'metrics_unavailable', retryable: false, status: 404 });
  const startDate = publicationStartDate(ctx);
  const [analytics, reach] = await Promise.all([
    fetchAnalyticsReport(token, remoteId, startDate),
    fetchReachImpressions(ctx, token, remoteId, startDate),
  ]);
  const analyticsResult = analytics.result || {};
  const notes = [];
  if (analytics.unavailable) notes.push(`YouTube Analytics watch time is unavailable: ${analytics.unavailable}. Reconnect YouTube with the yt-analytics.readonly scope.`);
  if (analytics.scope === 'core') notes.push('Engagement metrics from YouTube Analytics were unavailable; watch time and views were still synced.');
  if (reach.status !== 'ok') notes.push(`Thumbnail impressions: ${reach.note}`);
  return {
    views: Number(stats.viewCount || 0) || analyticsValue(analyticsResult, 'views'),
    likes: Number(stats.likeCount || 0) || analyticsValue(analyticsResult, 'likes'),
    comments: Number(stats.commentCount || 0) || analyticsValue(analyticsResult, 'comments'),
    shares: analyticsValue(analyticsResult, 'shares'),
    impressions: Math.round(reach.impressions),
    watchSeconds: Math.round(analyticsValue(analyticsResult, 'estimatedMinutesWatched') * 60),
    raw: {
      dataApi: result,
      analytics: { scope: analytics.scope || 'unavailable', ...analyticsResult, warning: analytics.warning || analytics.unavailable || null },
      reach,
      notes,
      sources: ['YouTube Data API statistics', 'YouTube Analytics API reports.query', 'YouTube Reporting API channel_reach_basic_a1'],
    },
  };
}

export async function verifyYouTubeAccount(account, credentials) {
  const token = credentials.accessToken;
  if (!token) throw authError('The YouTube access token is missing.');
  const result = await googleJson('channels', { token, params: { part: 'snippet', mine: 'true', maxResults: 5 } });
  const channel = (result.items || []).find((item) => item.id === account.external_id) || result.items?.[0];
  return { ok: Boolean(channel), details: channel?.snippet || result };
}
