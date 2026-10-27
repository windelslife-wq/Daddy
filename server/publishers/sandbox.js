import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { PublishError } from './errors.js';

function sandboxUrl(pathname) {
  return `http://127.0.0.1:${config.port}/api/sandbox/v1${pathname}`;
}

async function sandboxFetch(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(sandboxUrl(pathname), {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    throw new PublishError(`Sandbox publisher is unreachable: ${error.message}`, { code: 'sandbox_unreachable', retryable: true, status: 502 });
  }
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    throw new PublishError(payload?.error?.message || `Sandbox publisher returned ${response.status}`, {
      code: payload?.error?.code || 'sandbox_error',
      retryable: ![400, 401, 403, 409].includes(response.status),
      status: response.status,
      details: payload?.error?.details,
    });
  }
  return payload;
}

export async function publishSandbox(ctx) {
  const token = ctx.credentials.accessToken;
  if (!token) throw new PublishError('Sandbox account has no access token. Reconnect it.', { code: 'sandbox_auth_missing', retryable: false, status: 401 });
  const video = await fs.readFile(ctx.videoPath);
  const form = new FormData();
  form.append('publicationId', ctx.publication.id);
  form.append('refCode', ctx.caption.refCode);
  form.append('title', ctx.caption.title);
  form.append('caption', ctx.caption.text);
  form.append('video', new Blob([video], { type: 'video/mp4' }), path.basename(ctx.videoPath));
  if (ctx.project.thumbnail_path) {
    try {
      const thumbnail = await fs.readFile(ctx.project.thumbnail_path);
      form.append('thumbnail', new Blob([thumbnail], { type: 'image/jpeg' }), 'thumbnail.jpg');
    } catch {}
  }
  const result = await sandboxFetch('/posts', { method: 'POST', token, body: form });
  if (!result.remoteId) throw new PublishError('Sandbox publisher did not return a post ID.', { code: 'sandbox_invalid_response', retryable: true, status: 502 });
  return {
    remoteId: result.remoteId,
    remoteUrl: result.url || `/app/publishing?remoteId=${encodeURIComponent(result.remoteId)}`,
    raw: result,
    duplicate: Boolean(result.duplicate),
  };
}

export async function fetchSandboxMetrics(ctx, remoteId) {
  const result = await sandboxFetch(`/posts/${encodeURIComponent(remoteId)}/metrics`, { token: ctx?.credentials?.accessToken });
  return {
    views: Number(result.views || 0),
    likes: Number(result.likes || 0),
    comments: Number(result.comments || 0),
    shares: Number(result.shares || 0),
    impressions: Number(result.impressions || 0),
    watchSeconds: Number(result.watchSeconds || 0),
    raw: { ...result, simulated: true, note: 'Sandbox metrics are deterministic simulated values for end-to-end testing, not real social engagement.' },
  };
}

export async function verifySandboxAccount(credentials) {
  const result = await sandboxFetch('/verify', { token: credentials.accessToken });
  return { ok: Boolean(result.ok), details: result };
}
