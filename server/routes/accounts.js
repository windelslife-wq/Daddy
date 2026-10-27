import express from 'express';
import { z } from 'zod';
import { db, now, json, parseJson, bool, logAudit } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, notFound, forbidden } from '../errors.js';
import { parseBody } from '../validation.js';
import { encrypt, safeParseCredentials } from '../security.js';
import { PLATFORMS } from '../constants.js';
import { config, providerStatus } from '../config.js';
import { graphRequest } from '../publishers/graph.js';
import { oauth1Fetch } from '../oauth/oauth1.js';
import { verifyAccountConnection } from '../publishers/index.js';
import { sendNotification } from '../notifications.js';
import { logger } from '../logger.js';

const patchAccountSchema = z.object({
  active: z.boolean().optional(),
  automationEnabled: z.boolean().optional(),
}).refine((data) => data.active !== undefined || data.automationEnabled !== undefined, { message: 'Provide at least one setting to update.' });

export function accountView(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    platformName: PLATFORMS[row.platform]?.name || row.platform,
    official: Boolean(PLATFORMS[row.platform]?.official),
    externalId: row.external_id,
    displayName: row.display_name,
    handle: row.handle,
    avatarUrl: row.avatar_url,
    status: row.status,
    active: bool(row.active),
    automationEnabled: bool(row.automation_enabled),
    scopes: parseJson(row.scopes, []),
    permissions: parseJson(row.permissions, []),
    tokenExpiresAt: row.token_expires_at,
    metadata: parseJson(row.metadata, {}),
    lastError: row.last_error,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requirements: PLATFORMS[row.platform]?.requirements || '',
  };
}

async function ownedAccount(req, id) {
  const account = await db('accounts').where({ id }).first();
  if (!account) throw notFound('Account not found.');
  if (account.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  return account;
}

export async function attemptRemoteRevoke(account) {
  let credentials = {};
  try { credentials = safeParseCredentials(account.credentials); } catch { return { revoked: false, reason: 'Stored credentials could not be read.' }; }
  try {
    if (account.platform === 'youtube') {
      const token = credentials.refreshToken || credentials.accessToken;
      if (token) {
        await fetch(`${config.externalApis.googleOAuth}/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000) });
        return { revoked: true, provider: 'google' };
      }
    }
    if (['facebook', 'instagram'].includes(account.platform)) {
      const token = credentials.userAccessToken || credentials.accessToken;
      if (token) {
        await graphRequest('/me/permissions', { method: 'DELETE', accessToken: token, timeoutMs: 15000 });
        return { revoked: true, provider: 'meta' };
      }
    }
    if (account.platform === 'x') {
      const token = credentials.oauthToken;
      const secret = credentials.oauthTokenSecret;
      if (token && secret) {
        await oauth1Fetch(`${config.externalApis.xOAuth}/1.1/oauth/invalidate_token.json`, {
          method: 'POST',
          token: { key: token, secret },
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        return { revoked: true, provider: 'x' };
      }
    }
  } catch (error) {
    logger.warn({ error: error.message, accountId: account.id }, 'Provider-side revoke failed; local tokens were still removed');
    return { revoked: false, reason: error.message };
  }
  return { revoked: false, reason: 'Stored credentials are missing or this provider has no remote revoke endpoint.' };
}

export function accountsRouter() {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await db('accounts').where({ user_id: req.user.id }).orderBy('created_at', 'desc');
    res.json({ accounts: rows.map(accountView), providerStatus: providerStatus() });
  }));

  router.get('/status', asyncHandler(async (req, res) => {
    const status = providerStatus();
    const counts = await db('accounts').where({ user_id: req.user.id }).groupBy('platform').count({ count: '*' });
    res.json({
      integrations: Object.fromEntries(Object.entries(status.integrations).map(([key, value]) => [key, {
        ...value,
        connectUrl: `/api/oauth/${key === 'youtube' ? 'google' : key}/connect`,
        connectedCount: Number(counts.find((row) => row.platform === key)?.count || 0),
      }])),
      publicBaseUrl: status.publicBaseUrl,
      publicMediaReady: status.publicMediaReady,
    });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const account = await ownedAccount(req, req.params.id);
    const data = parseBody(patchAccountSchema, req.body);
    await db('accounts').where({ id: account.id }).update({
      active: data.active !== undefined ? data.active : bool(account.active),
      automation_enabled: data.automationEnabled !== undefined ? data.automationEnabled : bool(account.automation_enabled),
      updated_at: now(),
    });
    await logAudit({ userId: req.user.id, action: 'account.update', entityType: 'account', entityId: account.id, details: data });
    res.json({ account: accountView(await db('accounts').where({ id: account.id }).first()) });
  }));

  router.post('/:id/test', asyncHandler(async (req, res) => {
    const account = await ownedAccount(req, req.params.id);
    const result = await verifyAccountConnection(account.id);
    await logAudit({ userId: req.user.id, action: 'account.verify', entityType: 'account', entityId: account.id, details: { ok: result.ok } });
    res.json(result);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const account = await ownedAccount(req, req.params.id);
    const revoke = await attemptRemoteRevoke(account);
    const metadata = { ...parseJson(account.metadata, {}), disconnectedAt: now(), revoke };
    await db('accounts').where({ id: account.id }).update({
      credentials: encrypt({ disconnected: true }),
      status: 'disconnected', active: false, automation_enabled: false,
      scopes: '[]', permissions: '[]', token_expires_at: null,
      metadata: json(metadata), last_error: null, updated_at: now(),
    });
    await logAudit({ userId: req.user.id, action: 'account.disconnect', entityType: 'account', entityId: account.id, details: { revoke } });
    await sendNotification(req.user.id, {
      type: 'info',
      title: 'Account disconnected',
      body: `${account.display_name} was disconnected and its stored tokens were removed.${revoke.revoked ? ' Provider authorization was also revoked.' : ' Revoke app access in the provider settings if needed.'}`,
      actionUrl: '/app/accounts',
    });
    res.json({ ok: true, revoke });
  }));

  return router;
}
