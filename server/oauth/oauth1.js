import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export function createOAuth1Client() {
  if (!config.oauth.xConsumerKey || !config.oauth.xConsumerSecret) throw new AppError(503, 'integration_not_configured', 'X_CONSUMER_KEY and X_CONSUMER_SECRET are not configured.');
  return new OAuth({
    consumer: { key: config.oauth.xConsumerKey, secret: config.oauth.xConsumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

export function oauth1Header(url, method, token, data = undefined) {
  const client = createOAuth1Client();
  const request = { url: String(url), method, ...(data ? { data } : {}) };
  const authorized = token ? client.authorize(request, token) : client.authorize(request);
  return client.toHeader(authorized).Authorization;
}

export async function oauth1Fetch(url, { method = 'POST', token = null, data, body, headers = {}, formResponse = false } = {}) {
  const authorization = oauth1Header(url, method, token, data);
  const response = await fetch(url, {
    method,
    headers: { authorization, ...headers },
    body,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let payload;
  if (formResponse) payload = Object.fromEntries(new URLSearchParams(text));
  else { try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; } }
  if (!response.ok) {
    throw new AppError(502, 'oauth_provider_error', `X OAuth returned ${response.status}: ${String(payload?.error || payload?.raw || text).slice(0, 500)}`);
  }
  return payload;
}
