import express from 'express';
import { z } from 'zod';
import { db, now, newId, json, parseJson, bool, number, addJob, getSetting, logAudit } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, badRequest, notFound, forbidden, conflict } from '../errors.js';
import { projectSchema, nicheSchema, scheduleSchema, parseBody } from '../validation.js';
import {
  createProject, projectView, listPosts, postView, approvePost, schedulePost,
  retryPublication, refreshPostStatus, syncAccountsForPost, createAutopilotProject,
  queuePostPublications, createPostForProject,
} from '../services/projects.js';
import { generateAutopilotTopic } from '../ai.js';
import { computeNextRun, createSchedule } from '../services/scheduler.js';
import { PLATFORMS } from '../constants.js';
import { providerStatus } from '../config.js';

const patchProjectSchema = z.object({
  title: z.string().trim().min(2).max(220).optional(),
  archived: z.boolean().optional(),
});
const scheduledAtSchema = z.object({ scheduledAt: z.string().datetime({ offset: true }) });
const topicSchema = z.object({ topic: z.string().trim().min(3).max(500).optional() });

function slugify(value) {
  const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  return slug || `niche-${newId('').slice(0, 6)}`;
}

export function scheduleView(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, frequency: row.frequency, timeOfDay: row.time_of_day,
    timezone: row.timezone, weekdays: parseJson(row.weekdays, []), cronExpression: row.cron_expression,
    intervalMinutes: number(row.interval_minutes, 1440), nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
    active: bool(row.active), autopilot: bool(row.autopilot), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function nicheView(row) {
  if (!row) return null;
  const schedule = row.schedule_id ? scheduleView(await db('schedules').where({ id: row.schedule_id }).first()) : null;
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description,
    config: parseJson(row.config, {}), schedule, autopilot: bool(row.autopilot),
    reviewRequired: bool(row.review_required), postingLimitPerDay: number(row.posting_limit_per_day, 2),
    active: bool(row.active), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function ownedProject(req, id, adminToo = true) {
  const project = await db('projects').where({ id }).first();
  if (!project) throw notFound('Project not found.');
  if (project.user_id !== req.user.id && !(adminToo && req.user.role === 'admin')) throw forbidden();
  return project;
}
async function ownedPost(req, id) {
  const post = await db('posts').where({ id }).first();
  if (!post) throw notFound('Post not found.');
  if (post.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  return post;
}
async function ownedPublication(req, id) {
  const publication = await db('publications').where({ id }).first();
  if (!publication) throw notFound('Publication not found.');
  if (publication.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  return publication;
}

function camelSchedule(row) {
  const view = scheduleView(row);
  return view || {};
}

export function contentRouter() {
  const router = express.Router();
  router.use(requireAuth);

  // Projects
  router.get('/projects', asyncHandler(async (req, res) => {
    let query = db('projects').where({ user_id: req.user.id });
    if (req.query.status) query = query.where({ status: String(req.query.status) });
    if (req.query.search) query = query.where('topic', 'like', `%${String(req.query.search).slice(0, 100)}%`);
    const rows = await query.orderBy('created_at', 'desc').limit(200);
    res.json({ projects: rows.map(projectView).filter((project) => !project.metadata?.archived) });
  }));

  router.post('/projects', asyncHandler(async (req, res) => {
    const data = parseBody(projectSchema, req.body);
    if (req.body.reviewRequired === undefined) data.reviewRequired = await getSetting('default_review_required', true);
    const supported = await getSetting('supported_platforms', Object.keys(PLATFORMS));
    data.platforms = data.platforms.filter((platform) => supported.includes(platform));
    if (!data.platforms.length) throw badRequest('No supported publishing platforms are selected.');
    const status = providerStatus();
    const unconfigured = data.platforms.filter((platform) => !status.integrations[platform]?.configured);
    const result = await createProject(req.user, data);
    if (unconfigured.length) {
      await db('notifications').insert({
        id: newId('ntf_'), user_id: req.user.id, type: 'attention',
        title: 'Server integration setup required',
        body: `${unconfigured.join(', ')} ${unconfigured.length === 1 ? 'is' : 'are'} not configured on this server. The video will render, but publishing needs admin OAuth credentials.`,
        action_url: '/app/settings', metadata: '{}', created_at: now(),
      });
    }
    res.status(202).json(result);
  }));

  router.get('/projects/:id', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id);
    const post = await db('posts').where({ project_id: project.id }).first();
    res.json({
      project: projectView(project),
      post: post ? await postView(post, true) : null,
    });
  }));

  router.get('/projects/:id/events', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id);
    const summary = parseJson(project.provider_summary, {});
    res.json({ stages: summary.stages || [], currentStage: summary.currentStage || project.stage, error: project.error, providerSummary: summary });
  }));

  router.post('/projects/:id/create-post', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id, false);
    if (project.status !== 'completed') throw conflict('The video must finish rendering before preparing a post.');
    const existing = await db('posts').where({ project_id: project.id }).first();
    if (existing) throw conflict('This project already has a post.');
    const config = parseJson(project.config, {});
    const body = req.body || {};
    const input = {
      ...config,
      autoPublish: body.autoPublish !== false,
      reviewRequired: body.reviewRequired !== false,
      platforms: Array.isArray(body.platforms) && body.platforms.length ? body.platforms : (config.platforms || ['sandbox']),
      scheduledAt: body.scheduledAt || now(),
    };
    const postId = await createPostForProject(project, req.user, input);
    if (input.autoPublish && !input.reviewRequired) await queuePostPublications(postId, { reason: 'manual-post-created' });
    res.status(201).json({ post: await postView(await db('posts').where({ id: postId }).first(), true) });
  }));

  router.patch('/projects/:id', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id, false);
    const data = parseBody(patchProjectSchema, req.body);
    const metadata = { ...parseJson(project.metadata, {}) };
    if (data.archived !== undefined) metadata.archived = data.archived;
    await db('projects').where({ id: project.id }).update({
      title: data.title || project.title, metadata: json(metadata), updated_at: now(),
    });
    res.json({ project: projectView(await db('projects').where({ id: project.id }).first()) });
  }));

  router.post('/projects/:id/regenerate', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id, false);
    if (project.status !== 'failed') throw conflict('Only failed projects can be regenerated.');
    const active = await db('jobs').where({ type: 'generate_video', status: 'running' }).where('payload', 'like', `%${project.id}%`).first();
    if (active) throw conflict('A generation job is already running for this project.');
    await db('projects').where({ id: project.id }).update({
      status: 'queued', stage: 'queued', progress: 0, error: null, updated_at: now(),
      provider_summary: json({ stages: [{ stage: 'queued', label: 'Queued for retry', progress: 0, at: now() }], retriedAt: now() }),
    });
    const jobId = await addJob('generate_video', { projectId: project.id, userId: req.user.id, reason: 'manual-retry' }, {
      dedupeKey: `generate:${project.id}:retry:${Date.now()}`, priority: 8,
    });
    res.status(202).json({ ok: true, jobId, project: projectView(await db('projects').where({ id: project.id }).first()) });
  }));

  router.post('/projects/:id/duplicate', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id, false);
    const data = parseBody(topicSchema, req.body || {});
    const config = parseJson(project.config, {});
    const result = await createProject(req.user, {
      ...config,
      nicheId: project.niche_id,
      niche: config.niche || project.niche || 'custom',
      topic: data.topic || project.topic,
      title: `${project.title} (copy)`,
      autoPublish: false,
      reviewRequired: true,
      scheduledAt: null,
    });
    res.status(202).json(result);
  }));

  router.delete('/projects/:id', asyncHandler(async (req, res) => {
    const project = await ownedProject(req, req.params.id, false);
    const posts = await db('posts').where({ project_id: project.id });
    for (const post of posts) {
      const published = await db('publications').where({ post_id: post.id, status: 'published' }).first();
      if (published) throw conflict('Published projects cannot be deleted. Archive them instead.');
    }
    for (const post of posts) await db('publications').where({ post_id: post.id }).del();
    await db('posts').where({ project_id: project.id }).del();
    await db('projects').where({ id: project.id }).del();
    await logAudit({ userId: req.user.id, action: 'project.delete', entityType: 'project', entityId: project.id });
    res.json({ ok: true });
  }));

  // Posts and publications
  router.get('/posts', asyncHandler(async (req, res) => {
    const posts = await listPosts(req.user.id, {
      status: req.query.status ? String(req.query.status) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: Number(req.query.limit) || 150,
    });
    res.json({ posts });
  }));
  router.get('/posts/:id', asyncHandler(async (req, res) => {
    const post = await ownedPost(req, req.params.id);
    res.json({ post: await postView(post, true) });
  }));
  router.post('/posts/:id/approve', asyncHandler(async (req, res) => {
    await ownedPost(req, req.params.id);
    res.json(await approvePost(req.params.id, req.user.id, req.user.role));
  }));
  router.post('/posts/:id/schedule', asyncHandler(async (req, res) => {
    await ownedPost(req, req.params.id);
    const data = parseBody(scheduledAtSchema, req.body);
    res.json(await schedulePost(req.params.id, req.user.id, data.scheduledAt, req.user.role));
  }));
  router.post('/posts/:id/refresh-accounts', asyncHandler(async (req, res) => {
    const post = await ownedPost(req, req.params.id);
    const metadata = parseJson(post.metadata, {});
    const project = await db('projects').where({ id: post.project_id }).first();
    const platforms = metadata.platforms || parseJson(project?.config, {}).platforms || [];
    const created = await syncAccountsForPost(post.id, req.user.id, platforms, post.status);
    if (['scheduled', 'processing'].includes(post.status)) await queuePostPublications(post.id, { reason: 'accounts-refreshed' });
    res.json({ ok: true, created: created.length });
  }));
  router.delete('/posts/:id', asyncHandler(async (req, res) => {
    const post = await ownedPost(req, req.params.id);
    const published = await db('publications').where({ post_id: post.id, status: 'published' }).first();
    if (published) throw conflict('Published posts cannot be deleted.');
    await db('publications').where({ post_id: post.id }).del();
    await db('posts').where({ id: post.id }).del();
    res.json({ ok: true });
  }));
  router.get('/publications/:id', asyncHandler(async (req, res) => {
    const publication = await ownedPublication(req, req.params.id);
    const account = await db('accounts').where({ id: publication.account_id }).first();
    const { publicationView } = await import('../services/projects.js');
    res.json({ publication: publicationView(publication, account) });
  }));
  router.post('/publications/:id/retry', asyncHandler(async (req, res) => {
    await ownedPublication(req, req.params.id);
    res.json(await retryPublication(req.params.id, req.user.id, req.user.role));
  }));
  router.post('/publications/:id/skip', asyncHandler(async (req, res) => {
    const publication = await ownedPublication(req, req.params.id);
    if (publication.status === 'published') throw conflict('Published posts cannot be skipped.');
    await db('publications').where({ id: publication.id }).update({ status: 'skipped', updated_at: now(), next_attempt_at: null });
    await refreshPostStatus(publication.post_id);
    res.json({ ok: true });
  }));

  // Niches
  router.get('/niches', asyncHandler(async (req, res) => {
    const rows = await db('niches').where({ user_id: req.user.id }).orderBy('created_at', 'desc');
    res.json({ niches: await Promise.all(rows.map(nicheView)) });
  }));
  router.post('/niches', asyncHandler(async (req, res) => {
    const data = parseBody(nicheSchema, req.body);
    const baseSlug = slugify(data.name);
    const existing = await db('niches').where({ user_id: req.user.id, slug: baseSlug }).first();
    const slug = existing ? `${baseSlug}-${newId('').slice(0, 5)}` : baseSlug;
    const timestamp = now();
    let scheduleId = null;
    if (data.schedule) {
      const schedule = await createSchedule(req.user.id, { ...data.schedule, name: `${data.name} schedule`, autopilot: data.autopilot });
      scheduleId = schedule.id;
    }
    const config = {
      defaultTopic: data.defaultTopic,
      style: data.style || 'cinematic',
      language: data.language || 'en',
      voice: data.voice || 'nova',
      aspectRatio: data.aspectRatio || '9:16',
      duration: data.duration || 45,
      captions: true,
      music: true,
      research: false,
      platforms: data.platforms || ['sandbox'],
      tone: 'documentary',
    };
    const id = newId('nic_');
    await db('niches').insert({
      id, user_id: req.user.id, name: data.name, slug, description: data.description,
      config: json(config), autopilot: Boolean(data.autopilot), review_required: Boolean(data.reviewRequired),
      posting_limit_per_day: data.postingLimitPerDay, schedule_id: scheduleId, active: true,
      created_at: timestamp, updated_at: timestamp,
    });
    await logAudit({ userId: req.user.id, action: 'niche.create', entityType: 'niche', entityId: id });
    res.status(201).json({ niche: await nicheView(await db('niches').where({ id }).first()) });
  }));
  router.patch('/niches/:id', asyncHandler(async (req, res) => {
    const niche = await db('niches').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!niche) throw notFound('Niche not found.');
    const data = parseBody(nicheSchema.partial(), req.body);
    const config = { ...parseJson(niche.config, {}) };
    for (const key of ['defaultTopic', 'style', 'language', 'voice', 'aspectRatio', 'duration', 'platforms']) {
      if (data[key] !== undefined) config[key] = data[key];
    }
    const update = {
      name: data.name || niche.name,
      description: data.description !== undefined ? data.description : niche.description,
      config: json(config),
      autopilot: data.autopilot !== undefined ? Boolean(data.autopilot) : bool(niche.autopilot),
      review_required: data.reviewRequired !== undefined ? Boolean(data.reviewRequired) : bool(niche.review_required),
      posting_limit_per_day: data.postingLimitPerDay !== undefined ? data.postingLimitPerDay : number(niche.posting_limit_per_day, 2),
      active: true,
      updated_at: now(),
    };
    if (data.schedule) {
      let scheduleRow = niche.schedule_id ? await db('schedules').where({ id: niche.schedule_id }).first() : null;
      const merged = { ...camelSchedule(scheduleRow), ...data.schedule, name: data.schedule.name || `${update.name} schedule` };
      const nextRunAt = computeNextRun({
        frequency: merged.frequency || 'daily',
        time_of_day: merged.timeOfDay || '09:00',
        timezone: merged.timezone || 'UTC',
        weekdays: merged.weekdays || [1, 2, 3, 4, 5],
        cron_expression: merged.cronExpression || null,
        interval_minutes: merged.intervalMinutes || 1440,
      }, new Date());
      if (scheduleRow) {
        await db('schedules').where({ id: scheduleRow.id }).update({
          name: merged.name,
          frequency: merged.frequency || scheduleRow.frequency,
          time_of_day: merged.timeOfDay || scheduleRow.time_of_day,
          timezone: merged.timezone || scheduleRow.timezone,
          weekdays: json(merged.weekdays || parseJson(scheduleRow.weekdays, [])),
          cron_expression: merged.cronExpression !== undefined ? merged.cronExpression : scheduleRow.cron_expression,
          interval_minutes: merged.intervalMinutes || number(scheduleRow.interval_minutes, 1440),
          active: data.schedule.active !== undefined ? data.schedule.active : bool(scheduleRow.active),
          autopilot: data.schedule.autopilot !== undefined ? data.schedule.autopilot : update.autopilot,
          next_run_at: nextRunAt,
          updated_at: now(),
        });
      } else {
        const created = await createSchedule(req.user.id, { ...merged, frequency: merged.frequency || 'daily', timeOfDay: merged.timeOfDay || '09:00', timezone: merged.timezone || 'UTC', autopilot: update.autopilot });
        update.schedule_id = created.id;
      }
    }
    if (data.autopilot === false && niche.schedule_id) {
      await db('schedules').where({ id: niche.schedule_id }).update({ autopilot: false, active: false, updated_at: now() });
    }
    await db('niches').where({ id: niche.id }).update(update);
    res.json({ niche: await nicheView(await db('niches').where({ id: niche.id }).first()) });
  }));
  router.delete('/niches/:id', asyncHandler(async (req, res) => {
    const niche = await db('niches').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!niche) throw notFound('Niche not found.');
    await db('niches').where({ id: niche.id }).update({ active: false, autopilot: false, updated_at: now() });
    if (niche.schedule_id) await db('schedules').where({ id: niche.schedule_id }).update({ active: false, autopilot: false, updated_at: now() });
    res.json({ ok: true });
  }));
  router.post('/niches/:id/generate-now', asyncHandler(async (req, res) => {
    const niche = await db('niches').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!niche) throw notFound('Niche not found.');
    if (!bool(niche.active)) throw badRequest('Activate this niche before generating content.');
    const data = parseBody(topicSchema, req.body || {});
    const config = parseJson(niche.config, {});
    const topic = data.topic || await generateAutopilotTopic({ ...niche, defaultTopic: config.defaultTopic, description: niche.description });
    const result = await createProject(req.user, {
      ...config,
      nicheId: niche.id,
      niche: niche.name,
      topic,
      title: topic.slice(0, 120),
      autoPublish: true,
      reviewRequired: bool(niche.review_required),
      scheduledAt: now(),
      autopilot: true,
    }, { priority: 4 });
    res.status(202).json(result);
  }));

  // Schedules
  router.get('/schedules', asyncHandler(async (req, res) => {
    const rows = await db('schedules').where({ user_id: req.user.id }).orderBy('created_at', 'desc');
    res.json({ schedules: rows.map(scheduleView) });
  }));
  router.post('/schedules', asyncHandler(async (req, res) => {
    const data = parseBody(scheduleSchema, req.body);
    const row = await createSchedule(req.user.id, data);
    res.status(201).json({ schedule: scheduleView(row) });
  }));
  router.patch('/schedules/:id', asyncHandler(async (req, res) => {
    const row = await db('schedules').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!row) throw notFound('Schedule not found.');
    const data = parseBody(scheduleSchema.partial(), req.body);
    const merged = { ...camelSchedule(row), ...data };
    const nextRunAt = computeNextRun({
      frequency: merged.frequency,
      time_of_day: merged.timeOfDay,
      timezone: merged.timezone,
      weekdays: merged.weekdays,
      cron_expression: merged.cronExpression,
      interval_minutes: merged.intervalMinutes,
    }, new Date());
    await db('schedules').where({ id: row.id }).update({
      name: merged.name, frequency: merged.frequency, time_of_day: merged.timeOfDay,
      timezone: merged.timezone, weekdays: json(merged.weekdays || []),
      cron_expression: merged.cronExpression || null, interval_minutes: merged.intervalMinutes || 1440,
      active: merged.active, autopilot: merged.autopilot, next_run_at: nextRunAt, updated_at: now(),
    });
    res.json({ schedule: scheduleView(await db('schedules').where({ id: row.id }).first()) });
  }));
  router.delete('/schedules/:id', asyncHandler(async (req, res) => {
    const row = await db('schedules').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!row) throw notFound('Schedule not found.');
    await db('schedules').where({ id: row.id }).update({ active: false, autopilot: false, updated_at: now() });
    res.json({ ok: true });
  }));

  return router;
}
