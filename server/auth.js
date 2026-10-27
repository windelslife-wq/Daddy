import express from 'express';
import rateLimit from 'express-rate-limit';
import { db, now, newId, bool, getPlan, getUsage, getSetting } from './db.js';
import { config, providerStatus } from './config.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './security.js';
import { unauthorized, forbidden, badRequest, asyncHandler } from './errors.js';
import { authSchemas, parseBody } from './validation.js';

const COOKIE = 'fs_session';

export function userPublic(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    planId: user.plan_id,
    status: user.status,
    mustChangePassword: bool(user.must_change_password),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export async function sessionUser(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const session = await db('sessions').where({ token_hash: sha256(token) }).where('expires_at', '>', now()).first();
  if (!session) return null;
  const user = await db('users').where({ id: session.user_id, status: 'active' }).first();
  if (!user) return null;
  return user;
}

export async function createSession(res, user, req) {
  const token = randomToken(32);
  const id = newId('ses_');
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400000);
  await db('sessions').insert({
    id, user_id: user.id, token_hash: sha256(token), expires_at: expires.toISOString(),
    created_at: now(), user_agent: (req.get('user-agent') || '').slice(0, 300), ip: (req.ip || '').slice(0, 100),
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.security.secureCookies,
    expires,
    path: '/',
  });
  return token;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const user = await sessionUser(req);
  if (!user) throw unauthorized('Please sign in to continue.');
  req.user = user;
  next();
});

export const requireAdmin = asyncHandler(async (req, _res, next) => {
  if (!req.user) {
    const user = await sessionUser(req);
    if (!user) throw unauthorized('Please sign in to continue.');
    req.user = user;
  }
  if (req.user.role !== 'admin') throw forbidden('Administrator access required.');
  next();
});

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = await sessionUser(req);
  next();
});

export function sameOriginGuard(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // Non-browser clients and same-origin fetches.
  try {
    const originUrl = new URL(origin);
    const allowed = new Set();
    allowed.add(`${req.protocol}://${req.get('host')}`.toLowerCase());
    allowed.add(new URL(config.appUrl).origin.toLowerCase());
    allowed.add(new URL(config.publicBaseUrl).origin.toLowerCase());
    if (req.get('x-forwarded-host')) allowed.add(`${req.get('x-forwarded-proto') || 'https'}://${req.get('x-forwarded-host')}`.toLowerCase());
    if (!allowed.has(originUrl.origin.toLowerCase())) return next(badRequest('Cross-origin request rejected.', { origin: originUrl.origin }));
  } catch {
    return next(badRequest('Invalid Origin header.'));
  }
  return next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many authentication attempts. Try again in 15 minutes.' } },
});

export function authRouter() {
  const router = express.Router();

  router.get('/session', asyncHandler(async (req, res) => {
    const user = await sessionUser(req);
    if (!user) return res.json({ authenticated: false, user: null });
    const [plan, usage] = await Promise.all([getPlan(user.plan_id), getUsage(user.id)]);
    res.json({ authenticated: true, user: userPublic(user), plan, usage, providerStatus: providerStatus() });
  }));

  router.post('/register', authLimiter, asyncHandler(async (req, res) => {
    if (!await getSetting('allow_signups', true)) throw forbidden('New registrations are currently disabled.');
    const data = parseBody(authSchemas.register, req.body);
    const exists = await db('users').where({ email: data.email }).first();
    if (exists) throw badRequest('An account with this email already exists.');
    const id = newId('usr_');
    await db('users').insert({
      id, email: data.email, name: data.name, password_hash: hashPassword(data.password),
      role: 'user', plan_id: 'free', status: 'active', metadata: '{}', created_at: now(),
    });
    const user = await db('users').where({ id }).first();
    await createSession(res, user, req);
    const [plan, usage] = await Promise.all([getPlan(user.plan_id), getUsage(user.id)]);
    res.status(201).json({ user: userPublic(user), plan, usage });
  }));

  router.post('/login', authLimiter, asyncHandler(async (req, res) => {
    const data = parseBody(authSchemas.login, req.body);
    const user = await db('users').where({ email: data.email, status: 'active' }).first();
    if (!user || !verifyPassword(data.password, user.password_hash)) throw unauthorized('Invalid email or password.');
    await db('users').where({ id: user.id }).update({ last_login_at: now() });
    await createSession(res, user, req);
    const [plan, usage] = await Promise.all([getPlan(user.plan_id), getUsage(user.id)]);
    res.json({ user: userPublic(user), plan, usage });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) await db('sessions').where({ token_hash: sha256(token) }).del();
    res.clearCookie(COOKIE, { path: '/', sameSite: 'lax', secure: config.security.secureCookies });
    res.json({ ok: true });
  }));

  router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
    const data = parseBody(authSchemas.changePassword, req.body);
    if (!verifyPassword(data.currentPassword, req.user.password_hash)) throw badRequest('Current password is incorrect.');
    await db('users').where({ id: req.user.id }).update({ password_hash: hashPassword(data.newPassword), must_change_password: false });
    await db('sessions').where({ user_id: req.user.id }).del();
    res.json({ ok: true, message: 'Password changed. Please sign in again.' });
  }));

  router.patch('/profile', requireAuth, asyncHandler(async (req, res) => {
    const data = parseBody(authSchemas.updateProfile, req.body);
    if (data.email && data.email !== req.user.email) {
      const existing = await db('users').where({ email: data.email }).whereNot({ id: req.user.id }).first();
      if (existing) throw badRequest('That email address is already in use.');
    }
    await db('users').where({ id: req.user.id }).update({ name: data.name, email: data.email || req.user.email });
    res.json({ user: userPublic(await db('users').where({ id: req.user.id }).first()) });
  }));

  return router;
}

export async function removeExpiredSessions() {
  await db('sessions').where('expires_at', '<', now()).del();
}
