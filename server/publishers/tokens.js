import { db, now, parseJson } from '../db.js';
import { config } from '../config.js';
import { encrypt, safeParseCredentials } from '../security.js';
import { fetchWithTimeout } from '../ai.js';
import { graphRequest } from './graph.js';
import { authError, configError, PublishError } from './errors.js';

function inFuture(iso, marginMs = 0) {
  return Boolean(iso) && new Date(iso).getTime() > Date.now() + marginMs;
}

async function saveCredentials(accountId, credentials, tokenExpiresAt = null, status = 'connected') {
  const update = { credentials: encrypt(credentials), updated_at: now(), status, last_error: null };
  if (tokenExpiresAt !== undefined) update.token_expires_at = tokenExpiresAt;
  await db('accounts').where({ id: accountId }).update(update);
  return credentials;
}

async function refreshGoogle(account, credentials) {
  if (credentials.accessToken && inFuture(credentials.expiresAt || account.token_expires_at, 5 * 60 * 1000)) return credentials;
  if (!credentials.refreshToken) throw authError('The YouTube connection needs to be reauthorized because its refresh token is unavailable.');
  if (!config.oauth.googleClientId || !config.oauth.googleClientSecret) throw configError('Google OAuth credentials are not configured on the server.');
  const form = new URLSearchParams({
    client_id: config.oauth.googleClientId,
    client_secret: config.oauth.googleClientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });
  let payload;
  try {
    const { text } = await fetchWithTimeout(`${config.externalApis.googleOAuth}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
    }, 30000);
    payload = JSON.parse(text);
  } catch (error) {
    throw new PublishError(`Google token refresh failed: ${error.message}`, { code: 'google_token_refresh_failed', retryable: !error.status || error.status >= 500 || error.status === 429, status: error.status || 502 });
  }
  if (!payload.access_token) throw authError('Google did not return an access token. Reconnect the YouTube account.');
  const expiresAt = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString();
  const next = { ...credentials, accessToken: payload.access_token, expiresAt };
  return saveCredentials(account.id, next, expiresAt);
}

async function refreshMeta(account, credentials) {
  const needsRefresh = account.status === 'expired' || (account.token_expires_at && !inFuture(account.token_expires_at, 24 * 60 * 60 * 1000));
  if (!needsRefresh && (credentials.pageAccessToken || credentials.accessToken)) return credentials;
  if (!config.oauth.metaAppId || !config.oauth.metaAppSecret) throw configError('Meta app credentials are not configured on the server.');
  const userToken = credentials.userAccessToken || credentials.accessToken;
  if (!userToken) throw authError('The Meta connection needs to be reauthorized because its user access token is missing.');
  const tokenResult = await graphRequest('/oauth/access_token', {
    method: 'GET',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: config.oauth.metaAppId,
      client_secret: config.oauth.metaAppSecret,
      fb_exchange_token: userToken,
    },
  });
  const refreshedUserToken = tokenResult.access_token;
  if (!refreshedUserToken) throw authError('Meta did not return a refreshed long-lived token. Reconnect the account.');
  const expiresAt = tokenResult.expires_in ? new Date(Date.now() + Number(tokenResult.expires_in) * 1000).toISOString() : null;
  const pagesResult = await graphRequest('/me/accounts', {
    method: 'GET', accessToken: refreshedUserToken,
    params: { fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: 100 },
  });
  const tokenByExternalId = new Map();
  for (const page of pagesResult.data || []) {
    if (page.access_token) {
      tokenByExternalId.set(String(page.id), page.access_token);
      if (page.instagram_business_account?.id) tokenByExternalId.set(String(page.instagram_business_account.id), page.access_token);
    }
  }
  const accounts = await db('accounts').where({ user_id: account.user_id }).whereIn('platform', ['facebook', 'instagram']);
  for (const row of accounts) {
    const existing = safeParseCredentials(row.credentials);
    const pageToken = tokenByExternalId.get(String(row.external_id)) || existing.pageAccessToken || existing.accessToken;
    await saveCredentials(row.id, {
      ...existing, userAccessToken: refreshedUserToken, pageAccessToken: pageToken, accessToken: pageToken, expiresAt,
    }, expiresAt);
  }
  const updated = await db('accounts').where({ id: account.id }).first();
  return safeParseCredentials(updated.credentials);
}

export async function resolveAccountCredentials(account) {
  if (account.status !== 'connected') throw authError(`The ${account.platform} account is ${account.status}. Reconnect it before publishing.`);
  let credentials;
  try { credentials = safeParseCredentials(account.credentials); }
  catch (error) { throw authError(error.message); }
  if (account.platform === 'youtube') return refreshGoogle(account, credentials);
  if (account.platform === 'facebook' || account.platform === 'instagram') return refreshMeta(account, credentials);
  return credentials;
}

export async function markAccountExpired(account, message) {
  await db('accounts').where({ id: account.id }).update({ status: 'expired', last_error: String(message).slice(0, 1000), updated_at: now() });
}
