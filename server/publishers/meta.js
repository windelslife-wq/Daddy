import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { parseJson } from '../db.js';
import { graphRequest } from './graph.js';
import { updatePublicationMetadata } from './context.js';
import { assertPublicHttps } from '../media/variants.js';
import { signedMediaUrl } from '../media/urls.js';
import { configError, authError, PublishError } from './errors.js';

function pageToken(ctx) {
  return ctx.credentials.pageAccessToken || ctx.credentials.accessToken;
}
function userToken(ctx) {
  return ctx.credentials.userAccessToken || ctx.credentials.accessToken;
}
function assertMetaConfig() {
  if (!config.oauth.metaAppId || !config.oauth.metaAppSecret) throw configError('META_APP_ID and META_APP_SECRET are not configured on the server.');
}
function addProof(form, token) {
  form.set('access_token', token);
  if (config.oauth.metaAppSecret) form.set('appsecret_proof', crypto.createHmac('sha256', config.oauth.metaAppSecret).update(token).digest('hex'));
  return form;
}
function graphErrorMessage(error) {
  return String(error?.message || error).replace(/(access_token|appsecret_proof)=[^&\s]+/gi, '$1=[redacted]');
}

async function findExistingFacebookVideo(ctx) {
  const result = await graphRequest(`/${ctx.account.external_id}/videos`, {
    method: 'GET', accessToken: pageToken(ctx),
    params: { fields: 'id,description,created_time,permalink_url,title', limit: 50 },
  });
  return (result.data || []).find((video) => String(video.description || '').includes(ctx.caption.refCode));
}

async function uploadFacebookVideo(ctx) {
  assertMetaConfig();
  const metadata = parseJson(ctx.publication.metadata, {});
  const fileStat = await fs.stat(ctx.videoPath);
  const token = userToken(ctx);
  if (!token) throw authError('A Meta user access token is missing. Reconnect the Facebook account.');
  let sessionId = metadata.uploadSessionId;
  if (!sessionId) {
    const session = await graphRequest(`/${config.oauth.metaAppId}/uploads`, {
      method: 'POST', accessToken: token,
      params: { file_name: path.basename(ctx.videoPath), file_length: fileStat.size, file_type: 'video/mp4' },
    });
    sessionId = session.id;
    if (!sessionId) throw new PublishError('Meta did not return a resumable upload session.', { code: 'meta_upload_session_missing', retryable: true });
    await updatePublicationMetadata(ctx.publication.id, { uploadSessionId: sessionId });
  }
  if (metadata.fileHandle) return metadata.fileHandle;
  let offset = 0;
  try {
    const status = await graphRequest(`/${sessionId}`, {
      method: 'GET', accessToken: token,
      headers: { authorization: `OAuth ${token}` },
    });
    offset = Math.min(fileStat.size, Math.max(0, Number(status.file_offset || 0)));
  } catch (error) {
    if (!String(error.message).includes('file_offset')) offset = 0;
    else throw error;
  }
  const video = await fs.readFile(ctx.videoPath);
  const uploadResult = await graphRequest(`/${sessionId}`, {
    method: 'POST', accessToken: token,
    headers: { authorization: `OAuth ${token}`, file_offset: String(offset) },
    body: offset > 0 ? video.subarray(offset) : video,
    timeoutMs: 180000,
  });
  const handle = uploadResult.h;
  if (!handle) throw new PublishError('Meta upload did not return a file handle.', { code: 'meta_file_handle_missing', retryable: true });
  await updatePublicationMetadata(ctx.publication.id, { uploadSessionId: sessionId, fileHandle: handle });
  return handle;
}

export async function publishFacebook(ctx) {
  assertMetaConfig();
  const token = pageToken(ctx);
  if (!token) throw authError('The Facebook Page access token is missing. Reconnect the account.');
  const existing = await findExistingFacebookVideo(ctx).catch(() => null);
  if (existing) {
    return { remoteId: String(existing.id), remoteUrl: existing.permalink_url || null, raw: existing, duplicate: true };
  }
  const handle = await uploadFacebookVideo(ctx);
  const form = addProof(new URLSearchParams({
    title: ctx.caption.title,
    description: ctx.caption.description,
    fbuploader_video_file_chunk: handle,
    published: 'true',
  }), token);
  let result;
  try {
    result = await graphRequest(`/${ctx.account.external_id}/videos`, { method: 'POST', body: form, timeoutMs: 120000 });
  } catch (error) {
    const recovered = await findExistingFacebookVideo(ctx).catch(() => null);
    if (recovered) return { remoteId: String(recovered.id), remoteUrl: recovered.permalink_url || null, raw: recovered, duplicate: true };
    throw new PublishError(`Facebook video publish failed: ${graphErrorMessage(error)}`, { code: error.code || 'meta_publish_error', retryable: error.retryable !== false, status: error.status || 502 });
  }
  if (!result.id) throw new PublishError('Facebook did not return a video ID.', { code: 'meta_publish_missing_id', retryable: true });
  let remoteUrl = null;
  try {
    const detail = await graphRequest(`/${result.id}`, { method: 'GET', accessToken: token, params: { fields: 'permalink_url' } });
    remoteUrl = detail.permalink_url || null;
  } catch {}
  return { remoteId: String(result.id), remoteUrl, raw: { ...result, refCode: ctx.caption.refCode } };
}

async function findExistingInstagramMedia(ctx) {
  const result = await graphRequest(`/${ctx.account.external_id}/media`, {
    method: 'GET', accessToken: pageToken(ctx),
    params: { fields: 'id,caption,permalink,timestamp,media_type', limit: 50 },
  });
  return (result.data || []).find((media) => String(media.caption || '').includes(ctx.caption.refCode));
}

export async function publishInstagram(ctx) {
  assertMetaConfig();
  assertPublicHttps();
  const token = pageToken(ctx);
  if (!token) throw authError('The Instagram Page access token is missing. Reconnect the account.');
  const existing = await findExistingInstagramMedia(ctx).catch(() => null);
  if (existing) return { remoteId: String(existing.id), remoteUrl: existing.permalink || null, raw: existing, duplicate: true };
  const metadata = parseJson(ctx.publication.metadata, {});
  let containerId = metadata.containerId;
  if (!containerId) {
    const videoUrl = signedMediaUrl(ctx.project.id, ctx.videoPath, { ttlSeconds: 24 * 3600 });
    const coverUrl = ctx.project.thumbnail_path ? signedMediaUrl(ctx.project.id, ctx.project.thumbnail_path, { ttlSeconds: 24 * 3600 }) : null;
    const form = addProof(new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: ctx.caption.description,
      share_to_feed: 'true',
      thumb_offset: '1000',
      ...(coverUrl ? { cover_url: coverUrl } : {}),
    }), token);
    const container = await graphRequest(`/${ctx.account.external_id}/media`, { method: 'POST', body: form, timeoutMs: 120000 });
    containerId = container.id;
    if (!containerId) throw new PublishError('Instagram did not return a media container ID.', { code: 'instagram_container_missing', retryable: true });
    await updatePublicationMetadata(ctx.publication.id, { containerId, containerCreatedAt: new Date().toISOString(), pollCount: 0 });
  }
  const status = await graphRequest(`/${containerId}`, {
    method: 'GET', accessToken: token, params: { fields: 'status_code,status' },
  });
  const state = String(status.status_code || status.status || 'IN_PROGRESS').toUpperCase();
  if (state === 'IN_PROGRESS' || state === 'PROCESSING' || state === 'PENDING') {
    const pollCount = Number(metadata.pollCount || 0) + 1;
    if (pollCount > 20) throw new PublishError('Instagram container did not finish processing within the polling window.', { code: 'instagram_processing_timeout', retryable: false, status: 504 });
    return {
      pending: true,
      jobType: 'finalize_instagram',
      jobKey: `${containerId}:${pollCount}`,
      delayMs: 30000,
      metadataPatch: { containerId, pollCount },
      raw: status,
    };
  }
  if (['ERROR', 'EXPIRED'].includes(state)) {
    await updatePublicationMetadata(ctx.publication.id, { containerId: null, pollCount: 0, lastContainerStatus: status });
    throw new PublishError(`Instagram container ${state.toLowerCase()}: ${status.status || 'video processing failed'}.`, { code: `instagram_${state.toLowerCase()}`, retryable: true });
  }
  const publishForm = addProof(new URLSearchParams({ creation_id: String(containerId) }), token);
  let result;
  try {
    result = await graphRequest(`/${ctx.account.external_id}/media_publish`, { method: 'POST', body: publishForm, timeoutMs: 120000 });
  } catch (error) {
    const recovered = await findExistingInstagramMedia(ctx).catch(() => null);
    if (recovered) return { remoteId: String(recovered.id), remoteUrl: recovered.permalink || null, raw: recovered, duplicate: true };
    throw error;
  }
  const remoteId = String(result.id || '');
  if (!remoteId) throw new PublishError('Instagram did not return a published media ID.', { code: 'instagram_publish_missing_id', retryable: true });
  let remoteUrl = null;
  try {
    const detail = await graphRequest(`/${remoteId}`, { method: 'GET', accessToken: token, params: { fields: 'permalink,shortcode,timestamp' } });
    remoteUrl = detail.permalink || null;
  } catch {}
  return { remoteId, remoteUrl, raw: { ...result, containerId, refCode: ctx.caption.refCode }, metadataPatch: { containerId, publishedContainer: true } };
}

function metricValue(data, names) {
  for (const name of names) {
    const item = (data || []).find((entry) => entry.name === name);
    if (!item) continue;
    const value = Array.isArray(item.values) ? item.values[0]?.value : item.value;
    if (typeof value === 'object' && value) return Object.values(value).reduce((sum, n) => sum + Number(n || 0), 0);
    if (value != null) return Number(value) || 0;
  }
  return 0;
}

export async function fetchMetaMetrics(ctx, remoteId) {
  const token = pageToken(ctx);
  const metrics = ctx.account.platform === 'instagram'
    ? ['plays', 'views', 'likes', 'comments', 'shares', 'saved', 'reach']
    : ['total_video_views', 'total_video_reactions', 'total_video_comments', 'total_video_shares', 'total_video_impressions'];
  const edge = ctx.account.platform === 'facebook' ? 'video_insights' : 'insights';
  const result = await graphRequest(`/${remoteId}/${edge}`, {
    method: 'GET', accessToken: token, params: { metric: metrics.join(',') },
  });
  if (!result?.data?.length) throw new PublishError('No metrics are available yet for this post.', { code: 'metrics_unavailable', retryable: false, status: 404 });
  return {
    views: metricValue(result.data, ctx.account.platform === 'instagram' ? ['plays', 'views'] : ['total_video_views']),
    likes: metricValue(result.data, ctx.account.platform === 'instagram' ? ['likes'] : ['total_video_reactions']),
    comments: metricValue(result.data, ctx.account.platform === 'instagram' ? ['comments'] : ['total_video_comments']),
    shares: metricValue(result.data, ctx.account.platform === 'instagram' ? ['shares'] : ['total_video_shares']),
    impressions: metricValue(result.data, ctx.account.platform === 'instagram' ? ['reach'] : ['total_video_impressions']),
    watchSeconds: 0,
    raw: result,
  };
}

export async function verifyMetaAccount(account, credentials) {
  const token = credentials.pageAccessToken || credentials.accessToken;
  if (!token) throw authError('No Meta Page token is stored for this account.');
  const fields = account.platform === 'instagram' ? 'id,name,username' : 'id,name';
  const result = await graphRequest(`/${account.external_id}`, { method: 'GET', accessToken: token, params: { fields } });
  return { ok: Boolean(result.id), details: { id: result.id, name: result.name, username: result.username } };
}
