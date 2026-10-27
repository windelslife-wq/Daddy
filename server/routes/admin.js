import express from 'express';
import { z } from 'zod';
import { db, now, newId, json, parseJson, bool, number, allSettings, setSetting, getUsage, logAudit, addJob } from '../db.js';
import { requireAuth, requireAdmin, userPublic } from '../auth.js';
import { asyncHandler, badRequest, notFound, conflict } from '../errors.js';
import { parseBody, planSchema } from '../validation.js';
import { providerStatus, assertProductionSecrets } from '../config.js';
import { retryPublication, publicationView } from '../services/projects.js';
import { buildIntegrationReadiness } from '../services/integrationReadiness.js';
import { accountView } from './accounts.js';
import { sendNotification } from '../notifications.js';
import { contactMessageView } from './contact.js';

const userPatchSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  planId: z.string().min(1).max(48).optional(),
  status: z.enum(['active', 'suspended']).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'No changes supplied.' });

const settingsPatchSchema = z.object({
  allowSignups: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  defaultReviewRequired: z.boolean().optional(),
  autopilotEnabled: z.boolean().optional(),
  defaultPrivacy: z.enum(['public', 'private', 'unlisted']).optional(),
  maxPublishRetries: z.number().int().min(1).max(20).optional(),
  metricsSyncIntervalHours: z.number().int().min(1).max(168).optional(),
  captionReferenceCodes: z.boolean().optional(),
  contentPolicy: z.string().max(2000).optional(),
  supportedLanguages: z.array(z.string().max(10)).max(30).optional(),
  supportedPlatforms: z.array(z.enum(['sandbox', 'facebook', 'instagram', 'youtube', 'x'])).min(1).max(5).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'No settings supplied.' });

const broadcastSchema = z.object({
  title: z.string().trim().min(2).max(220),
  body: z.string().trim().min(2).max(2000),
  type: z.enum(['info', 'attention', 'success', 'error']).default('info'),
  actionUrl: z.string().max(300).optional(),
});

const settingKeyMap = {
  allowSignups: 'allow_signups',
  maintenanceMode: 'maintenance_mode',
  defaultReviewRequired: 'default_review_required',
  autopilotEnabled: 'autopilot_enabled',
  defaultPrivacy: 'default_privacy',
  maxPublishRetries: 'max_publish_retries',
  metricsSyncIntervalHours: 'metrics_sync_interval_hours',
  captionReferenceCodes: 'caption_reference_codes',
  contentPolicy: 'content_policy',
  supportedLanguages: 'supported_languages',
  supportedPlatforms: 'supported_platforms',
};

function jobView(row) {
  return {
    id: row.id, type: row.type, status: row.status, attempts: number(row.attempts),
    maxAttempts: number(row.max_attempts), priority: number(row.priority),
    runAt: row.run_at, lockedAt: row.locked_at, lockedBy: row.locked_by,
    lastError: row.last_error, dedupeKey: row.dedupe_key,
    payload: parseJson(row.payload, {}), createdAt: row.created_at,
    updatedAt: row.updated_at, completedAt: row.completed_at,
  };
}

function planView(row) {
  return {
    id: row.id, name: row.name, priceCents: number(row.price_cents), currency: row.currency,
    interval: row.interval, maxVideosMonth: number(row.max_videos_month),
    maxRenderSecondsMonth: number(row.max_render_seconds_month), maxPostsMonth: number(row.max_posts_month),
    maxAccounts: number(row.max_accounts), maxProjects: number(row.max_projects),
    features: parseJson(row.features, []), stripePriceId: row.stripe_price_id,
    active: bool(row.active), sortOrder: number(row.sort_order),
  };
}

function planUpdateData(data) {
  return {
    name: data.name,
    price_cents: data.priceCents,
    max_videos_month: data.maxVideosMonth,
    max_render_seconds_month: data.maxRenderSecondsMonth,
    max_posts_month: data.maxPostsMonth,
    max_accounts: data.maxAccounts,
    max_projects: data.maxProjects,
    features: json(data.features || []),
    active: data.active,
    stripe_price_id: data.stripePriceId || null,
  };
}

export function adminRouter() {
  const router = express.Router();
  router.use(requireAuth, requireAdmin);

  router.get('/contact-messages', asyncHandler(async (_req, res) => {
    const rows = await db('contact_messages').orderBy('created_at', 'desc').limit(100);
    res.json({ messages: rows.map(contactMessageView) });
  }));

  router.patch('/contact-messages/:id', asyncHandler(async (req, res) => {
    const data = parseBody(z.object({ status: z.enum(['new', 'reviewed', 'archived']) }), req.body);
    const updated = await db('contact_messages').where({ id: req.params.id }).update({ status: data.status, updated_at: now() });
    if (!updated) throw notFound('Contact message not found.');
    const row = await db('contact_messages').where({ id: req.params.id }).first();
    await logAudit({ userId: req.user.id, action: 'contact.message.status_changed', entityType: 'contact_message', entityId: row.id, details: { status: data.status }, ip: req.ip || null });
    res.json({ message: contactMessageView(row) });
  }));

  router.get('/overview', asyncHandler(async (_req, res) => {
    const count = async (table, where = {}) => number((await db(table).where(where).count({ count: '*' }).first())?.count);
    const [
      users, projects, posts, publications, published, failedPublications, accounts,
      queuedJobs, runningJobs, failedJobs, metricsRows, contactMessages, newContactMessages,
    ] = await Promise.all([
      count('users'), count('projects'), count('posts'), count('publications'),
      count('publications', { status: 'published' }), count('publications', { status: 'failed' }),
      count('accounts'), count('jobs', { status: 'queued' }), count('jobs', { status: 'running' }),
      count('jobs', { status: 'failed' }), count('post_metrics'), count('contact_messages'),
      count('contact_messages', { status: 'new' }),
    ]);
    const recentJobs = await db('jobs').orderBy('created_at', 'desc').limit(12);
    const recentFailures = await db('publications').where({ status: 'failed' }).orderBy('updated_at', 'desc').limit(8);
    const recentUsers = await db('users').orderBy('created_at', 'desc').limit(8);
    const views = await db('post_metrics').sum({ total: 'views' }).first();
    res.json({
      counts: { users, projects, posts, publications, published, failedPublications, accounts, queuedJobs, runningJobs, failedJobs, metricsRows, contactMessages, newContactMessages },
      totalViews: number(views?.total),
      recentJobs: recentJobs.map(jobView),
      recentFailures: recentFailures.map((row) => publicationView(row)),
      recentUsers: recentUsers.map(userPublic),
      providerStatus: providerStatus(),
      productionWarnings: assertProductionSecrets(),
      serverTime: now(),
    });
  }));

  router.get('/users', asyncHandler(async (req, res) => {
    let query = db('users').select('*');
    if (req.query.search) query = query.where('email', 'like', `%${String(req.query.search).slice(0, 100)}%`).orWhere('name', 'like', `%${String(req.query.search).slice(0, 100)}%`);
    const rows = await query.orderBy('created_at', 'desc').limit(200);
    const users = [];
    for (const row of rows) {
      const usage = await getUsage(row.id);
      const projects = number((await db('projects').where({ user_id: row.id }).count({ count: '*' }).first())?.count);
      users.push({ ...userPublic(row), usage, projects });
    }
    res.json({ users });
  }));

  router.patch('/users/:id', asyncHandler(async (req, res) => {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) throw notFound('User not found.');
    const data = parseBody(userPatchSchema, req.body);
    if (data.planId) {
      const plan = await db('plans').where({ id: data.planId }).first();
      if (!plan) throw badRequest('Plan not found.');
    }
    await db('users').where({ id: user.id }).update({
      role: data.role || user.role,
      plan_id: data.planId || user.plan_id,
      status: data.status || user.status,
    });
    await logAudit({ userId: req.user.id, action: 'admin.user.update', entityType: 'user', entityId: user.id, details: data, ip: req.ip });
    res.json({ user: userPublic(await db('users').where({ id: user.id }).first()) });
  }));

  router.get('/plans', asyncHandler(async (_req, res) => {
    const rows = await db('plans').orderBy('sort_order', 'asc');
    res.json({ plans: rows.map(planView) });
  }));

  router.post('/plans', asyncHandler(async (req, res) => {
    const payload = req.body?.plan ? req.body : { plan: req.body, id: req.body?.id };
    const body = parseBody(z.object({ plan: planSchema, id: z.string().min(2).max(48).optional() }), payload);
    const id = body.id || slugPlanId(body.plan.name);
    const exists = await db('plans').where({ id }).first();
    if (exists) throw conflict('A plan with this ID already exists.');
    await db('plans').insert({
      id, ...planUpdateData(body.plan), currency: 'USD', interval: 'month',
      sort_order: number((await db('plans').max({ max: 'sort_order' }).first())?.max) + 1,
    });
    await logAudit({ userId: req.user.id, action: 'admin.plan.create', entityType: 'plan', entityId: id, details: body.plan });
    res.status(201).json({ plan: planView(await db('plans').where({ id }).first()) });
  }));

  router.put('/plans/:id', asyncHandler(async (req, res) => {
    const plan = await db('plans').where({ id: req.params.id }).first();
    if (!plan) throw notFound('Plan not found.');
    const data = parseBody(planSchema.partial(), req.body);
    const update = planUpdateData({ ...planView(plan), ...data });
    await db('plans').where({ id: plan.id }).update(update);
    await logAudit({ userId: req.user.id, action: 'admin.plan.update', entityType: 'plan', entityId: plan.id, details: data });
    res.json({ plan: planView(await db('plans').where({ id: plan.id }).first()) });
  }));

  router.get('/settings', asyncHandler(async (_req, res) => {
    res.json({ settings: await allSettings(), providerStatus: providerStatus(), productionWarnings: assertProductionSecrets() });
  }));

  router.patch('/settings', asyncHandler(async (req, res) => {
    const data = parseBody(settingsPatchSchema, req.body);
    for (const [camelKey, value] of Object.entries(data)) {
      await setSetting(settingKeyMap[camelKey], value, req.user.id);
    }
    await logAudit({ userId: req.user.id, action: 'admin.settings.update', entityType: 'settings', details: data });
    res.json({ ok: true, settings: await allSettings() });
  }));

  router.get('/jobs', asyncHandler(async (req, res) => {
    let query = db('jobs');
    if (req.query.status) query = query.where({ status: String(req.query.status) });
    if (req.query.type) query = query.where({ type: String(req.query.type) });
    const rows = await query.orderBy('created_at', 'desc').limit(Math.min(300, Math.max(1, Number(req.query.limit) || 100)));
    res.json({ jobs: rows.map(jobView) });
  }));

  router.post('/jobs/:id/retry', asyncHandler(async (req, res) => {
    const job = await db('jobs').where({ id: req.params.id }).first();
    if (!job) throw notFound('Job not found.');
    if (job.status === 'running') throw conflict('A running job cannot be retried.');
    await db('jobs').where({ id: job.id }).update({
      status: 'queued', run_at: now(), attempts: 0, locked_at: null, locked_by: null,
      last_error: null, completed_at: null, updated_at: now(),
    });
    await logAudit({ userId: req.user.id, action: 'admin.job.retry', entityType: 'job', entityId: job.id });
    res.json({ ok: true, job: jobView(await db('jobs').where({ id: job.id }).first()) });
  }));

  router.post('/jobs/:id/cancel', asyncHandler(async (req, res) => {
    const job = await db('jobs').where({ id: req.params.id }).first();
    if (!job) throw notFound('Job not found.');
    if (['completed', 'failed'].includes(job.status)) throw conflict('This job is already finished.');
    await db('jobs').where({ id: job.id }).update({
      status: 'failed', last_error: 'Cancelled by administrator.', completed_at: now(), updated_at: now(),
    });
    await logAudit({ userId: req.user.id, action: 'admin.job.cancel', entityType: 'job', entityId: job.id });
    res.json({ ok: true });
  }));

  router.get('/publications', asyncHandler(async (req, res) => {
    let query = db('publications').orderBy('created_at', 'desc').limit(Math.min(300, Math.max(1, Number(req.query.limit) || 100)));
    if (req.query.status) query = query.where({ status: String(req.query.status) });
    const rows = await query;
    const accountIds = [...new Set(rows.map((row) => row.account_id))];
    const accounts = accountIds.length ? await db('accounts').whereIn('id', accountIds) : [];
    const accountMap = Object.fromEntries(accounts.map((row) => [row.id, row]));
    res.json({ publications: rows.map((row) => publicationView(row, accountMap[row.account_id])) });
  }));

  router.post('/publications/:id/retry', asyncHandler(async (req, res) => {
    const publication = await db('publications').where({ id: req.params.id }).first();
    if (!publication) throw notFound('Publication not found.');
    const result = await retryPublication(publication.id, publication.user_id, 'admin');
    await logAudit({ userId: req.user.id, action: 'admin.publication.retry', entityType: 'publication', entityId: publication.id });
    res.json(result);
  }));

  router.get('/integration-readiness', asyncHandler(async (req, res) => {
    res.json(await buildIntegrationReadiness({ probe: req.query.probe === '1' }));
  }));

  router.get('/integrations', asyncHandler(async (_req, res) => {
    const status = providerStatus();
    const accounts = await db('accounts').groupBy('platform').count({ count: '*' });
    res.json({
      providerStatus: status,
      readiness: await buildIntegrationReadiness(),
      accounts: accounts.map((row) => ({ platform: row.platform, count: number(row.count) })),
      requiredEnvironment: {
        ai: ['AI_PROVIDER', 'OPENAI_API_KEY or ANTHROPIC_API_KEY or GEMINI_API_KEY'],
        images: ['IMAGE_PROVIDER', 'OPENAI_API_KEY or REPLICATE_API_TOKEN'],
        tts: ['TTS_PROVIDER', 'OPENAI_API_KEY or ELEVENLABS_API_KEY'],
        facebookInstagram: ['META_APP_ID', 'META_APP_SECRET', 'PUBLIC_BASE_URL'],
        youtube: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_BASE_URL'],
        x: ['X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'PUBLIC_BASE_URL'],
        billing: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      },
      note: 'Secrets are read only from server environment variables and are never editable through the browser.',
    });
  }));

  router.get('/audit-logs', asyncHandler(async (req, res) => {
    const rows = await db('audit_logs').orderBy('created_at', 'desc').limit(Math.min(300, Math.max(1, Number(req.query.limit) || 100)));
    res.json({ logs: rows.map((row) => ({
      id: row.id, userId: row.user_id, action: row.action, entityType: row.entity_type,
      entityId: row.entity_id, details: parseJson(row.details, {}), ip: row.ip, createdAt: row.created_at,
    })) });
  }));

  router.post('/notifications/broadcast', asyncHandler(async (req, res) => {
    const data = parseBody(broadcastSchema, req.body);
    const users = await db('users').where({ status: 'active' }).limit(1000);
    for (const user of users) await sendNotification(user.id, data);
    await logAudit({ userId: req.user.id, action: 'admin.notification.broadcast', details: { recipients: users.length, title: data.title } });
    res.json({ ok: true, recipients: users.length });
  }));

  router.post('/cleanup', asyncHandler(async (req, res) => {
    const jobId = await addJob('cleanup', {}, { dedupeKey: `cleanup:${Date.now()}`, priority: 0 });
    res.status(202).json({ ok: true, jobId });
  }));

  return router;
}

function slugPlanId(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug || `plan-${newId('').slice(0, 6)}`;
}
