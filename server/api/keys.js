/**
 * API key lifecycle for the public developer API.
 *
 * Security model:
 *   - the secret is generated with the platform CSPRNG and shown exactly once,
 *   - only a SHA-256 hash and a short human-readable prefix are stored,
 *   - lookup is by prefix, then a constant-time comparison of the digest,
 *   - revocation is a timestamp, so audit history survives,
 *   - keys are bound to one user and carry explicit scopes.
 */
import crypto from 'node:crypto';
import { db, now, newId, json, parseJson, number } from '../db.js';
import { AppError, unauthorized, notFound, badRequest } from '../errors.js';
import { KEY_TOKEN_PREFIX, MAX_KEYS_PER_USER, SCOPES_BY_ID } from './catalog.js';

const SECRET_LENGTH = 40;
const PREFIX_LENGTH = 10;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomSecret(length = SECRET_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) out += BASE62[bytes[index] % BASE62.length];
  return out;
}

export function hashApiKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function apiKeyDisplayPrefix(prefix) {
  return `${KEY_TOKEN_PREFIX}${prefix}…`;
}

export function apiKeyView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    prefix: apiKeyDisplayPrefix(row.prefix),
    scopes: parseJson(row.scopes, []),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    requestCount: number(row.request_count, 0),
    revokedAt: row.revoked_at || null,
    active: !row.revoked_at,
  };
}

export function normaliseScopes(input) {
  const list = Array.isArray(input) && input.length ? [...new Set(input.map(String))] : Object.keys(SCOPES_BY_ID);
  const unknown = list.filter((scope) => !SCOPES_BY_ID[scope]);
  if (unknown.length) throw badRequest(`Unknown scope: ${unknown.join(', ')}.`, { allowed: Object.keys(SCOPES_BY_ID) });
  return list;
}

export async function listApiKeys(userId) {
  const rows = await db('api_keys').where({ user_id: userId }).orderBy('created_at', 'desc');
  return rows.map(apiKeyView);
}

/**
 * Creates a key and returns the plaintext token exactly once.
 * @returns {Promise<{ token: string, key: object }>}
 */
export async function createApiKey(userId, { name, scopes } = {}) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) throw badRequest('Give the key a name between 2 and 80 characters.');
  const resolvedScopes = normaliseScopes(scopes);
  const active = await db('api_keys').where({ user_id: userId }).whereNull('revoked_at').count({ count: '*' }).first();
  if (number(active?.count, 0) >= MAX_KEYS_PER_USER) {
    throw new AppError(409, 'key_limit_reached', `You can keep ${MAX_KEYS_PER_USER} active keys. Revoke one before creating another.`);
  }
  const secret = randomSecret();
  const token = `${KEY_TOKEN_PREFIX}${secret}`;
  const row = {
    id: newId('key_'),
    user_id: userId,
    name: cleanName,
    prefix: secret.slice(0, PREFIX_LENGTH),
    key_hash: hashApiKey(token),
    scopes: json(resolvedScopes),
    created_at: now(),
    last_used_at: null,
    revoked_at: null,
    request_count: 0,
  };
  await db('api_keys').insert(row);
  return { token, key: apiKeyView(row) };
}

export async function revokeApiKey(userId, keyId) {
  const row = await db('api_keys').where({ id: String(keyId), user_id: userId }).first();
  if (!row) throw notFound('API key not found.');
  if (!row.revoked_at) await db('api_keys').where({ id: row.id }).update({ revoked_at: now() });
  return apiKeyView({ ...row, revoked_at: row.revoked_at || now() });
}

/** Resolves a bearer token to `{ key, user }` or throws a 401. */
export async function authenticateApiKey(token) {
  const value = String(token || '').trim();
  if (!value) throw unauthorized('API key required. Send Authorization: Bearer fcl_live_…');
  if (!value.startsWith(KEY_TOKEN_PREFIX)) throw unauthorized('Invalid API key format.');
  const prefix = value.slice(KEY_TOKEN_PREFIX.length, KEY_TOKEN_PREFIX.length + PREFIX_LENGTH);
  const row = await db('api_keys').where({ prefix }).first();
  if (!row) throw unauthorized('Invalid API key.');
  const expected = Buffer.from(String(row.key_hash));
  const actual = Buffer.from(hashApiKey(value));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw unauthorized('Invalid API key.');
  if (row.revoked_at) throw unauthorized('This API key has been revoked.');
  const user = await db('users').where({ id: row.user_id }).first();
  if (!user) throw unauthorized('The account for this API key no longer exists.');
  if (user.status && user.status !== 'active') throw unauthorized('This account is not active.');
  // Usage telemetry is best effort: a write failure must never break a request.
  db('api_keys').where({ id: row.id }).update({ last_used_at: now(), request_count: number(row.request_count, 0) + 1 }).catch(() => {});
  return { key: row, user };
}
