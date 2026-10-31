/**
 * Public developer API — /api/v1
 *
 * Authentication is an API key only. Session cookies are ignored here, and every
 * query is filtered by the key owner, so a key can never reach another account's
 * content (an admin key included).
 *
 * The route table is generated from `server/api/catalog.js`: a catalogued endpoint
 * without a handler throws at boot, and a handler cannot be mounted without being
 * documented. `tests/api-v1.test.js` exercises every documented endpoint.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, number, getPlan, getUsage, parseJson } from '../db.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound, forbidden, AppError } from '../errors.js';
import { parseBody, projectSchema, platformEnum } from '../validation.js';
import { ENDPOINTS, SCOPES_BY_ID } from '../api/catalog.js';
import { authenticateApiKey } from '../api/keys.js';
import {
  createProject, projectView, postView, createPostForProject,
  approvePost, schedulePost,
} from '../services/projects.js';
import { createFilm, listFilms, filmDetail, requestAllScenes } from '../film/scenes.js';
import { getBalance } from '../film/credits.js';
import { accountView } from './accounts.js';

function apiUser(user) {
  const { id, email, name, role, created_at: createdAt } = user;
  return { id, email, name, role, createdAt };
}

function planView(plan) {
  return {
    id: plan.id,
    name: plan.name,
    priceCents: number(plan.price_cents),
    maxVideosMonth: number(plan.max_videos_month),
    maxPostsMonth: number(plan.max_posts_month),
    maxProjects: number(plan.max_projects),
    maxAccounts: number(plan.max_accounts),
    features: plan.features || [],
  };
}

function paging(req, { defaultLimit = 25 } = {}) {
  const limit = Math.min(100, Math.max(1, number(req.query.limit, defaultLimit) || defaultLimit));
  const offset = Math.max(0, number(req.query.offset, 0));
  return { limit, offset };
}

/** Strip internal columns that are not part of the public contract. */
function publicPost(view) {
  if (!view) return null;
  const { userId, ...rest } = view;
  return rest;
}

async function ownedProject(userId, id) {
  const row = await db('projects').where({ id: String(id), user_id: userId }).first();
  if (!row) throw notFound('Project not found.');
  return row;
}

async function ownedPost(userId, id) {
  const row = await db('posts').where({ id: String(id), user_id: userId }).first();
  if (!row) throw notFound('Post not found.');
  return row;
}

const postCreateSchema = z.object({
  platforms: z.array(platformEnum).max(5).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  autoPublish: z.boolean().optional(),
  reviewRequired: z.boolean().optional(),
});

const scheduleSchema = z.object({ scheduledAt: z.string().datetime({ offset: true }) });

const listFilter = z.object({
  type: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
});

/**
 * Domain services raise plain Errors with `status`/`code` (quota, provider gating).
 * Surface those with their documented code instead of collapsing them to 500.
 */
function publicError(error) {
  if (error instanceof AppError) return error;
  if (error?.name === 'ZodError') {
    return badRequest('Please correct the highlighted fields.', error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
  }
  if (error && error.code && Number(error.status) >= 400 && Number(error.status) < 600) {
    return new AppError(Number(error.status), error.code, error.message);
  }
  return error;
}

/** Handlers are keyed by the catalogue id so coverage is provable at boot. */
const handlers = {
  async me(req, res) {
    const [plan, usage, credits] = await Promise.all([getPlan(req.user.plan_id), getUsage(req.user.id), getBalance(req.user.id)]);
    res.json({
      account: apiUser(req.user),
      plan: planView(plan),
      usage: {
        period: usage.period,
        videos: usage.videos,
        posts: usage.posts,
        renderSeconds: usage.render_seconds,
        ttsCharacters: usage.tts_characters,
        aiRequests: usage.ai_requests,
      },
      credits,
      apiKey: { id: req.apiKey.id, name: req.apiKey.name, scopes: req.apiKey.scopes },
    });
  },

  async 'projects.list'(req, res) {
    const { limit, offset } = paging(req);
    const status = req.query.status ? String(req.query.status) : null;
    const filtered = () => {
      const query = db('projects').where({ user_id: req.user.id });
      if (status) query.where({ status });
      return query;
    };
    const rows = await filtered().orderBy('updated_at', 'desc').limit(limit).offset(offset);
    const total = await filtered().count({ count: '*' }).first();
    res.json({ projects: rows.map(projectView), pagination: { limit, offset, total: number(total?.count) } });
  },

  async 'projects.create'(req, res) {
    const data = parseBody(projectSchema, req.body);
    const result = await createProject(req.user, data, { createPost: Boolean(req.body?.createPost) });
    res.status(201).json(result);
  },

  async 'projects.get'(req, res) {
    const project = await ownedProject(req.user.id, req.params.id);
    const rows = await db('posts').where({ project_id: project.id, user_id: req.user.id }).orderBy('created_at', 'asc');
    const posts = await Promise.all(rows.map(async (row) => publicPost(await postView(row, false))));
    res.json({ project: projectView(project), posts });
  },

  async 'projects.createPost'(req, res) {
    const project = await ownedProject(req.user.id, req.params.id);
    const input = parseBody(postCreateSchema, req.body || {});
    const postId = await createPostForProject(project, req.user, input);
    const row = await db('posts').where({ id: postId }).first();
    res.status(201).json({ post: publicPost(await postView(row, true)) });
  },

  async 'posts.list'(req, res) {
    const { limit, offset } = paging(req);
    const status = req.query.status ? String(req.query.status) : null;
    const filtered = () => {
      const query = db('posts').where({ user_id: req.user.id });
      if (status) query.where({ status });
      return query;
    };
    const rows = await filtered().orderBy('updated_at', 'desc').limit(limit).offset(offset);
    const total = await filtered().count({ count: '*' }).first();
    res.json({ posts: await Promise.all(rows.map(async (row) => publicPost(await postView(row, false)))), pagination: { limit, offset, total: number(total?.count) } });
  },

  async 'posts.get'(req, res) {
    const row = await ownedPost(req.user.id, req.params.id);
    res.json({ post: publicPost(await postView(row, true)) });
  },

  async 'posts.approve'(req, res) {
    const row = await ownedPost(req.user.id, req.params.id);
    await approvePost(row.id, req.user.id, 'user');
    const fresh = await db('posts').where({ id: row.id }).first();
    res.json({ post: publicPost(await postView(fresh, false)) });
  },

  async 'posts.schedule'(req, res) {
    const row = await ownedPost(req.user.id, req.params.id);
    const { scheduledAt } = parseBody(scheduleSchema, req.body);
    await schedulePost(row.id, req.user.id, scheduledAt, 'user');
    const fresh = await db('posts').where({ id: row.id }).first();
    res.json({ post: publicPost(await postView(fresh, false)) });
  },

  async 'films.list'(req, res) {
    const { limit, offset } = paging(req);
    const filter = parseBody(listFilter, req.query || {});
    const films = await listFilms(req.user.id, { ...filter, limit, offset });
    const query = db('film_projects').where({ user_id: req.user.id });
    if (filter.type) query.where({ type: filter.type });
    if (filter.status) query.where({ status: filter.status });
    const total = await query.count({ count: '*' }).first();
    res.json({ films, pagination: { limit, offset, total: number(total?.count) } });
  },

  async 'films.create'(req, res) {
    const film = await createFilm(req.user.id, req.body || {});
    res.status(201).json({ film });
  },

  async 'films.get'(req, res) {
    const film = await filmDetail(req.user.id, req.params.id, 'user');
    res.json({ film });
  },

  async 'films.generate'(req, res) {
    // filmDetail proves ownership before any work is queued.
    await filmDetail(req.user.id, req.params.id, 'user');
    const result = await requestAllScenes(req.user.id, req.params.id, 'user');
    res.status(202).json({ ...result, status: 'generating' });
  },

  async 'accounts.list'(req, res) {
    const rows = await db('accounts').where({ user_id: req.user.id }).orderBy('created_at', 'asc');
    res.json({ accounts: rows.map(accountView) });
  },
};

export function apiV1Router() {
  const router = express.Router();

  // Authenticate before rate limiting so limits are per key, not per IP.
  router.use(asyncHandler(async (req, _res, next) => {
    const header = req.get('authorization') || '';
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const { key, user } = await authenticateApiKey(bearer || req.get('x-api-key') || '');
    req.apiKey = { id: key.id, name: key.name, scopes: parseJson(key.scopes, []) };
    req.user = user;
    next();
  }));

  router.use(rateLimit({
    windowMs: 60 * 1000,
    limit: config.api.keyRateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.apiKey.id,
    message: { error: { code: 'rate_limited', message: 'API key rate limit exceeded. Retry after the RateLimit-Reset window.' } },
  }));

  for (const endpoint of ENDPOINTS) {
    const handler = handlers[endpoint.id];
    if (!handler) throw new Error(`API catalogue endpoint "${endpoint.id}" has no handler.`);
    if (!SCOPES_BY_ID[endpoint.scope]) throw new Error(`API catalogue endpoint "${endpoint.id}" uses unknown scope "${endpoint.scope}".`);
    router[endpoint.method.toLowerCase()](endpoint.path, asyncHandler(async (req, res, next) => {
      if (!req.apiKey.scopes.includes(endpoint.scope)) {
        return next(forbidden(`This API key is missing the "${endpoint.scope}" scope.`));
      }
      try {
        return await handler(req, res, next);
      } catch (error) {
        throw publicError(error);
      }
    }));
  }

  router.use((_req, _res, next) => next(notFound('API endpoint not found. See /api/developer/spec for the documented v1 endpoints.')));
  return router;
}

export { handlers as apiV1Handlers };
