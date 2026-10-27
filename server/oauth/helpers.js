import crypto from 'node:crypto';
import { db, now, newId, json, parseJson, logAudit } from '../db.js';
import { config } from '../config.js';
import { encrypt, randomToken, safeParseCredentials } from '../security.js';
import { badRequest, AppError } from '../errors.js';
import { syncAccountsForPost } from '../services/projects.js';
import { sendNotification } from '../notifications.js';
import { logger } from '../logger.js';

export function oauthCallbackUrl(provider, extraParams = {}) {
  const url = new URL(`/api/oauth/${provider}/callback`, config.publicBaseUrl);
  for (const [key, value] of Object.entries(extraParams)) url.searchParams.set(key, String(value));
  return url.toString();
}

export async function createState(provider, userId, metadata = {}, expiresInSeconds = 10 * 60) {
  const state = randomToken(24);
  const row = {
    id: newId('oas_'), user_id: userId, provider, state,
    code_verifier: metadata.codeVerifier || null,
    redirect_url: metadata.redirectUrl || null,
    metadata: json(metadata),
    expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    created_at: now(),
  };
  await db('oauth_states').insert(row);
  return state;
}

export async function getValidState(provider, state) {
  if (!state) throw badRequest('Missing OAuth state.');
  const row = await db('oauth_states')
    .where({ provider, state })
    .whereNull('consumed_at')
    .where('expires_at', '>', now())
    .first();
  if (!row) throw badRequest('This authorization link is invalid or has expired. Start the connection again.');
  return { ...row, metadataObject: parseJson(row.metadata, {}) };
}

export async function consumeState(provider, state) {
  const row = await getValidState(provider, state);
  const changed = await db('oauth_states')
    .where({ id: row.id })
    .whereNull('consumed_at')
    .update({ consumed_at: now() });
  if (!changed) throw badRequest('This authorization link was already used. Start the connection again.');
  return row;
}

export async function markStateUsed(id) {
  await db('oauth_states').where({ id }).update({ consumed_at: now() });
}

function cleanError(error) {
  return String(error?.message || error)
    .replace(/(client_secret|access_token|refresh_token|code|oauth_token_secret)=[^&\s]+/gi, '$1=[redacted]')
    .slice(0, 500);
}

export function oauthSuccess(res, provider, message, extra = {}) {
  const params = new URLSearchParams({ oauth: 'success', provider, message, ...extra });
  return res.redirect(`/app/accounts?${params.toString()}`);
}

export function oauthFailure(res, provider, error) {
  const message = cleanError(error);
  logger.warn({ provider, error: message }, 'OAuth connection failed');
  const params = new URLSearchParams({ oauth: 'error', provider, message });
  return res.redirect(`/app/accounts?${params.toString()}`);
}

export async function upsertConnectedAccount({ userId, platform, externalId, displayName, handle = null, avatarUrl = null, credentials, scopes = [], permissions = [], tokenExpiresAt = null, metadata = {}, mergeCredentials = true }) {
  const timestamp = now();
  const existing = await db('accounts').where({ user_id: userId, platform, external_id: String(externalId) }).first();
  let nextCredentials = credentials;
  if (existing && mergeCredentials) {
    try { nextCredentials = { ...safeParseCredentials(existing.credentials), ...credentials }; } catch {}
  }
  const data = {
    user_id: userId,
    platform,
    external_id: String(externalId),
    display_name: displayName,
    handle,
    avatar_url: avatarUrl,
    status: 'connected',
    active: existing ? existing.active : true,
    automation_enabled: existing ? existing.automation_enabled : true,
    credentials: encrypt(nextCredentials),
    scopes: json(scopes),
    permissions: json(permissions),
    token_expires_at: tokenExpiresAt,
    metadata: json({ ...(existing ? parseJson(existing.metadata, {}) : {}), ...metadata, connectedAt: timestamp }),
    updated_at: timestamp,
    last_error: null,
    last_verified_at: timestamp,
  };
  let accountId;
  if (existing) {
    accountId = existing.id;
    await db('accounts').where({ id: accountId }).update(data);
  } else {
    accountId = newId('acc_');
    await db('accounts').insert({ id: accountId, created_at: timestamp, ...data });
  }
  await logAudit({ userId, action: 'account.connect', entityType: 'account', entityId: accountId, details: { platform, externalId: String(externalId) } });
  await sendNotification(userId, {
    type: 'success',
    title: 'Account connected',
    body: `${displayName} (${platform}) is connected and ready for publishing.`,
    actionUrl: '/app/accounts',
  });
  await attachAccountToPendingPosts(userId, platform);
  return db('accounts').where({ id: accountId }).first();
}

export async function attachAccountToPendingPosts(userId, platform) {
  const posts = await db('posts')
    .where({ user_id: userId })
    .whereIn('status', ['draft', 'needs_review', 'scheduled', 'processing'])
    .orderBy('created_at', 'desc')
    .limit(100);
  let attached = 0;
  for (const post of posts) {
    const metadata = parseJson(post.metadata, {});
    let platforms = Array.isArray(metadata.platforms) ? metadata.platforms : null;
    if (!platforms) {
      const project = await db('projects').where({ id: post.project_id }).first();
      platforms = parseJson(project?.config, {}).platforms || [];
    }
    if (platforms.includes(platform)) {
      const created = await syncAccountsForPost(post.id, userId, [platform], post.status);
      attached += created.length;
    }
  }
  return attached;
}

export async function oauthFetchJson(url, options = {}, { form = false } = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  let payload;
  if (form) payload = Object.fromEntries(new URLSearchParams(text));
  else { try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; } }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error_description || payload?.error || payload?.message || payload?.raw || `OAuth provider returned ${response.status}`;
    throw new AppError(502, 'oauth_provider_error', String(message).slice(0, 800));
  }
  return payload;
}
