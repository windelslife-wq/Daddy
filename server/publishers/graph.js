import crypto from 'node:crypto';
import { config } from '../config.js';
import { fetchWithTimeout } from '../ai.js';
import { PublishError } from './errors.js';

export function graphUrl(path, params = {}, accessToken = null) {
  const version = config.oauth.metaGraphVersion.replace(/^\/?v?/, 'v').replace(/\/$/, '');
  const url = new URL(`https://graph.facebook.com/${version}/${String(path).replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  if (accessToken) {
    url.searchParams.set('access_token', accessToken);
    if (config.oauth.metaAppSecret) {
      url.searchParams.set('appsecret_proof', crypto.createHmac('sha256', config.oauth.metaAppSecret).update(accessToken).digest('hex'));
    }
  }
  return url;
}

function metaErrorMessage(payload) {
  const error = payload?.error;
  if (!error) return 'Meta Graph API request failed.';
  const parts = [error.message || error.type || 'Meta API error'];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.error_subcode) parts.push(`subcode ${error.error_subcode}`);
  if (error.error_user_title) parts.push(error.error_user_title);
  if (error.error_user_msg) parts.push(error.error_user_msg);
  return parts.join(' — ');
}

export async function graphRequest(path, { method = 'GET', params = {}, accessToken = null, body = null, headers = {}, timeoutMs = 90000 } = {}) {
  const url = graphUrl(path, params, accessToken);
  const options = { method, headers: { ...headers } };
  if (body instanceof URLSearchParams) {
    options.body = body;
    options.headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (Buffer.isBuffer(body)) {
    options.body = body;
    options.headers['content-type'] = 'application/octet-stream';
  } else if (body && typeof body === 'object') {
    options.body = JSON.stringify(body);
    options.headers['content-type'] = 'application/json';
  } else if (body) {
    options.body = body;
  }
  let text;
  try {
    const result = await fetchWithTimeout(url, options, timeoutMs);
    text = result.text;
  } catch (error) {
    let payload = null;
    try { payload = error.responseBody ? JSON.parse(error.responseBody) : null; } catch {}
    if (payload?.error) {
      const code = payload.error.code;
      throw new PublishError(metaErrorMessage(payload), {
        code: code === 190 ? 'meta_token_expired' : `meta_${code || 'error'}`,
        retryable: code === 190 || code === 4 || code === 17 || code === 32 || code === 613 || error.status >= 500,
        status: code === 190 ? 401 : error.status || 502,
        details: { code, subcode: payload.error.error_subcode, type: payload.error.type },
      });
    }
    const retryable = error.status === 429 || error.status >= 500 || !error.status;
    throw new PublishError(`Meta Graph API request failed: ${error.message}`, {
      code: error.status === 429 ? 'meta_rate_limited' : 'meta_api_error',
      retryable,
      status: error.status || 502,
    });
  }
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (payload.error) {
    const code = payload.error.code;
    const retryable = code === 4 || code === 17 || code === 32 || code === 613 || payload.error.type === 'OAuthException' && code >= 200;
    throw new PublishError(metaErrorMessage(payload), {
      code: code === 190 ? 'meta_token_expired' : `meta_${code || 'error'}`,
      retryable: retryable || code === 190,
      status: code === 190 ? 401 : 502,
      details: { code, subcode: payload.error.error_subcode, type: payload.error.type },
    });
  }
  return payload;
}

export async function graphUploadRequest(path, { method = 'POST', accessToken, body, headers = {}, params = {}, timeoutMs = 180000 } = {}) {
  return graphRequest(path, { method, accessToken, body, headers, params, timeoutMs });
}
