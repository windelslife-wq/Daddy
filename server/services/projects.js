import crypto from 'node:crypto';
import { db, now, newId, json, parseJson, bool, number, addJob, checkQuota, getPlan, notify, logAudit, incrementUsage } from '../db.js';
import { config } from '../config.js';
import { shortRef } from '../security.js';
import { badRequest, notFound, forbidden } from '../errors.js';
import { PLATFORMS } from '../constants.js';
import { sendNotification } from '../notifications.js';

function normalizeInput(input) {
  const platforms = [...new Set((input.platforms || ['sandbox']).filter((platform) => PLATFORMS[platform]))];
  return {
    nicheId: input.nicheId || null,
    niche: input.niche || 'education',
    topic: input.topic,
    title: input.title || `${String(input.topic).slice(0, 80)} — AI short`,
    style: input.style || 'cinematic',
    language: input.language || 'en',
    voice: input.voice || 'nova',
    aspectRatio: input.aspectRatio || '9:16',
    duration: Number(input.duration) || 45,
    captions: input.captions !== false,
    music: input.music !== false,
    research: Boolean(input.research),
    autoPublish: Boolean(input.autoPublish),
    reviewRequired: input.reviewRequired !== false,
    platforms: platforms.length ? platforms : ['sandbox'],
    scheduledAt: input.scheduledAt || null,
    tone: input.tone || 'documentary',
    autopilot: Boolean(input.autopilot),
  };
}

export function projectView(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    nicheId: row.niche_id,
    title: row.title,
    topic: row.topic,
    niche: row.niche || parseJson(row.config, {}).niche || 'custom',
    status: row.status,
    stage: row.stage,
    progress: number(row.progress),
    config: parseJson(row.config, {}),
    script: row.script,
    scenes: parseJson(row.scenes, []),
    metadata: parseJson(row.metadata, {}),
    sources: parseJson(row.sources, []),
    providerSummary: parseJson(row.provider_summary, {}),
    videoPath: row.video_path,
    thumbnailPath: row.thumbnail_path,
    captionPath: row.caption_path,
    audioPath: row.audio_path,
    hasVideo: Boolean(row.video_path),
    durationSeconds: number(row.duration_seconds),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function publicationView(row, account = null) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    accountId: row.account_id,
    status: row.status,
    attempts: number(row.attempts),
    maxAttempts: number(row.max_attempts),
    refCode: row.ref_code,
    remoteId: row.remote_id,
    remoteUrl: row.remote_url,
    lastError: row.last_error,
    errorCode: row.error_code,
    nextAttemptAt: row.next_attempt_at,
    publishedAt: row.published_at,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    account: account ? {
      id: account.id, platform: account.platform, displayName: account.display_name,
      handle: account.handle, status: account.status, active: bool(account.active),
      automationEnabled: bool(account.automation_enabled),
    } : null,
  };
}

export async function postView(row, details = false) {
  const project = await db('projects').where({ id: row.project_id }).first();
  const publications = await db('publications').where({ post_id: row.id }).orderBy('created_at', 'asc');
  const accountIds = publications.map((p) => p.account_id);
  const accounts = accountIds.length ? await db('accounts').whereIn('id', accountIds) : [];
  const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    title: project?.title || 'Untitled project',
    topic: project?.topic || '',
    projectStatus: project?.status || 'unknown',
    scheduledAt: row.scheduled_at,
    status: row.status,
    reviewRequired: bool(row.review_required),
    reviewedAt: row.reviewed_at,
    captions: details ? parseJson(row.captions, {}) : undefined,
    hashtags: parseJson(row.hashtags, {}),
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publications: publications.map((p) => publicationView(p, accountMap[p.account_id])),
  };
}

export async function listPosts(userId, { status, limit = 100, from, to } = {}) {
  let query = db('posts').where({ user_id: userId });
  if (status) query = query.where({ status });
  if (from) query = query.where('scheduled_at', '>=', from);
  if (to) query = query.where('scheduled_at', '<=', to);
  const rows = await query.orderBy('scheduled_at', 'desc').limit(Math.min(500, Math.max(1, limit)));
  return Promise.all(rows.map((row) => postView(row)));
}

export async function createProject(user, rawInput, options = {}) {
  const input = normalizeInput(rawInput);
  await checkQuota(user.id, 'videos', 1);
  const plan = await getPlan(user.plan_id);
  const projectCount = await db('projects').where({ user_id: user.id }).count({ count: '*' }).first();
  if (number(projectCount?.count) >= number(plan.max_projects)) {
    const error = new Error(`Your ${plan.name} plan allows ${plan.max_projects} projects. Archive old projects or upgrade.`);
    error.status = 402;
    error.code = 'quota_exceeded';
    throw error;
  }
  const timestamp = now();
  const projectId = newId('prj_');
  const projectRow = {
    id: projectId,
    user_id: user.id,
    niche_id: input.nicheId,
    title: input.title,
    topic: input.topic,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    config: json(input),
    script: null,
    scenes: '[]',
    metadata: json({ captions: {}, sources: [], safetyNotes: '' }),
    sources: '[]',
    provider_summary: json({ stages: [] }),
    duration_seconds: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await db('projects').insert(projectRow);

  let postId = null;
  if (input.autoPublish || options.createPost) {
    postId = await createPostForProject(projectRow, user, input);
  }
  const jobId = await addJob('generate_video', { projectId, userId: user.id }, { dedupeKey: `generate:${projectId}`, priority: options.priority || 0 });
  await logAudit({ userId: user.id, action: 'project.create', entityType: 'project', entityId: projectId, details: { topic: input.topic, niche: input.niche, platforms: input.platforms, autopilot: input.autopilot } });
  return { project: projectView(projectRow), postId, jobId };
}

export async function createPostForProject(project, user, input = null) {
  const configInput = input || parseJson(project.config, {});
  const existing = await db('posts').where({ project_id: project.id }).first();
  if (existing) return existing.id;
  const timestamp = now();
  const scheduledAt = configInput.scheduledAt || timestamp;
  const status = !configInput.autoPublish ? 'draft' : configInput.reviewRequired ? 'needs_review' : 'scheduled';
  const postId = newId('pst_');
  await db('posts').insert({
    id: postId,
    user_id: user.id,
    project_id: project.id,
    scheduled_at: scheduledAt,
    status,
    review_required: Boolean(configInput.reviewRequired),
    captions: '{}',
    hashtags: '{}',
    metadata: json({ platforms: configInput.platforms || ['sandbox'], autoPublish: Boolean(configInput.autoPublish) }),
    created_at: timestamp,
    updated_at: timestamp,
  });
  await syncAccountsForPost(postId, user.id, configInput.platforms || ['sandbox'], status);
  return postId;
}

export async function syncAccountsForPost(postId, userId, platforms, postStatus = 'draft') {
  const wanted = [...new Set((platforms || []).filter((platform) => PLATFORMS[platform]))];
  if (!wanted.length) return [];
  const accounts = await db('accounts')
    .where({ user_id: userId, active: true, automation_enabled: true, status: 'connected' })
    .whereIn('platform', wanted);
  const existing = await db('publications').where({ post_id: postId });
  const existingAccountIds = new Set(existing.map((row) => row.account_id));
  const created = [];
  for (const account of accounts) {
    if (existingAccountIds.has(account.id)) continue;
    const id = newId('pub_');
    const timestamp = now();
    await db('publications').insert({
      id, post_id: postId, account_id: account.id, user_id: userId,
      status: postStatus === 'needs_review' ? 'pending_review' : 'awaiting_media',
      attempts: 0, max_attempts: config.worker.maxAttempts,
      idempotency_key: crypto.randomUUID(), ref_code: shortRef(`${postId}:${account.id}`),
      remote_data: '{}', metadata: '{}', created_at: timestamp, updated_at: timestamp,
    }).onConflict(['post_id', 'account_id']).ignore();
    created.push(id);
  }
  if (!accounts.length) {
    await notify(userId, {
      type: 'attention',
      title: 'Connect a publishing account',
      body: `No active account is connected for ${wanted.join(', ')}. The video will still be generated, but publishing needs a connection.`,
      actionUrl: '/app/accounts',
    });
  }
  return created;
}

export async function queuePublication(publicationId, { runAt = now(), reason = 'auto', priority = 5 } = {}) {
  const publication = await db('publications').where({ id: publicationId }).first();
  if (!publication) throw notFound('Publication not found.');
  if (publication.remote_id || ['published', 'skipped', 'processing', 'publishing'].includes(publication.status)) return null;
  const post = await db('posts').where({ id: publication.post_id }).first();
  const project = post ? await db('projects').where({ id: post.project_id }).first() : null;
  if (!post || !project || project.status !== 'completed') return null;
  if (bool(post.review_required) || ['draft', 'needs_review'].includes(post.status)) return null;
  const dedupeKey = `publish:${publicationId}:${reason}:${publication.attempts}:${post.scheduled_at}`;
  const existingJob = await db('jobs').where({ dedupe_key: dedupeKey }).first();
  if (existingJob && ['running', 'queued'].includes(existingJob.status)) return existingJob.id;
  if (existingJob && ['completed', 'failed'].includes(existingJob.status)) return existingJob.id;
  await db('publications').where({ id: publicationId }).update({
    status: post.scheduled_at > now() ? 'scheduled' : 'queued',
    updated_at: now(),
    last_error: null,
    error_code: null,
  });
  return addJob('publish_post', { publicationId, userId: publication.user_id, reason }, {
    dedupeKey,
    runAt,
    priority,
    maxAttempts: publication.max_attempts,
  });
}

export async function queuePostPublications(postId, options = {}) {
  const post = await db('posts').where({ id: postId }).first();
  if (!post) return [];
  const publications = await db('publications').where({ post_id: postId });
  const runAt = post.scheduled_at > now() ? post.scheduled_at : now();
  const jobs = [];
  for (const publication of publications) {
    const jobId = await queuePublication(publication.id, { runAt, reason: options.reason || 'auto', priority: options.priority || 5 });
    if (jobId) jobs.push(jobId);
  }
  return jobs;
}

export async function approvePost(postId, userId, userRole = 'user') {
  const post = await db('posts').where({ id: postId }).first();
  if (!post) throw notFound('Post not found.');
  if (post.user_id !== userId && userRole !== 'admin') throw forbidden();
  const project = await db('projects').where({ id: post.project_id }).first();
  if (!project || project.status !== 'completed') throw badRequest('Approve the post after its video has finished rendering.');
  await db('posts').where({ id: postId }).update({ review_required: false, reviewed_at: now(), status: 'scheduled', updated_at: now() });
  await db('publications').where({ post_id: postId }).whereIn('status', ['pending_review', 'awaiting_media']).update({ status: 'awaiting_media', updated_at: now() });
  const jobs = await queuePostPublications(postId, { reason: 'approved' });
  await sendNotification(post.user_id, { type: 'success', title: 'Post approved', body: 'Your reviewed content has been added to the publishing queue.', actionUrl: '/app/publishing' });
  return { ok: true, jobs };
}

export async function schedulePost(postId, userId, scheduledAt, userRole = 'user') {
  const post = await db('posts').where({ id: postId }).first();
  if (!post) throw notFound('Post not found.');
  if (post.user_id !== userId && userRole !== 'admin') throw forbidden();
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) throw badRequest('Provide a valid ISO date and time.');
  await db('posts').where({ id: postId }).update({
    scheduled_at: date.toISOString(), status: 'scheduled', review_required: false, updated_at: now(),
  });
  await db('publications').where({ post_id: postId }).whereIn('status', ['pending_review', 'awaiting_media', 'draft']).update({ status: 'awaiting_media', updated_at: now() });
  const jobs = await queuePostPublications(postId, { reason: `scheduled:${date.toISOString()}` });
  return { ok: true, jobs, scheduledAt: date.toISOString() };
}

export async function retryPublication(publicationId, userId, userRole = 'user') {
  const publication = await db('publications').where({ id: publicationId }).first();
  if (!publication) throw notFound('Publication not found.');
  if (publication.user_id !== userId && userRole !== 'admin') throw forbidden();
  if (publication.remote_id || publication.status === 'published') throw badRequest('This publication already succeeded. Create a new post instead.');
  const nonce = crypto.randomUUID();
  await db('publications').where({ id: publicationId }).update({
    status: 'queued', attempts: 0, last_error: null, error_code: null,
    next_attempt_at: null, updated_at: now(),
    metadata: json({ ...parseJson(publication.metadata, {}), retryNonce: nonce }),
  });
  const post = await db('posts').where({ id: publication.post_id }).first();
  if (post && ['draft', 'needs_review', 'failed'].includes(post.status)) await db('posts').where({ id: post.id }).update({ status: 'scheduled', review_required: false, updated_at: now() });
  const jobId = await addJob('publish_post', { publicationId, userId: publication.user_id, reason: `manual:${nonce}` }, {
    dedupeKey: `publish:${publicationId}:manual:${nonce}`,
    priority: 10,
    maxAttempts: publication.max_attempts,
  });
  return { ok: true, jobId };
}

export async function refreshPostStatus(postId) {
  const publications = await db('publications').where({ post_id: postId });
  if (!publications.length) return;
  const statuses = publications.map((row) => row.status);
  let status = 'scheduled';
  if (statuses.every((s) => s === 'published')) status = 'published';
  else if (statuses.every((s) => ['failed', 'skipped'].includes(s))) status = 'failed';
  else if (statuses.some((s) => s === 'published') && statuses.some((s) => ['failed', 'skipped'].includes(s))) status = 'partial';
  else if (statuses.some((s) => ['queued', 'publishing', 'processing', 'scheduled'].includes(s))) status = 'processing';
  await db('posts').where({ id: postId }).update({ status, updated_at: now() });
}

export async function createAutopilotProject(nicheId, topic = null) {
  const niche = await db('niches').where({ id: nicheId, active: true, autopilot: true }).first();
  if (!niche) return null;
  const user = await db('users').where({ id: niche.user_id, status: 'active' }).first();
  if (!user) return null;
  const nicheConfig = parseJson(niche.config, {});
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const createdToday = await db('projects').where({ user_id: user.id, niche_id: niche.id }).where('created_at', '>=', todayStart.toISOString()).count({ count: '*' }).first();
  if (number(createdToday?.count) >= number(niche.posting_limit_per_day, 2)) return null;
  const generatedTopic = topic || `${niche.name}: ${nicheConfig.defaultTopic || 'an overlooked story'}`;
  return createProject(user, {
    nicheId: niche.id,
    niche: niche.name,
    topic: generatedTopic,
    style: nicheConfig.style || 'cinematic',
    language: nicheConfig.language || 'en',
    voice: nicheConfig.voice || 'nova',
    aspectRatio: nicheConfig.aspectRatio || '9:16',
    duration: nicheConfig.duration || 45,
    platforms: nicheConfig.platforms || ['sandbox'],
    captions: nicheConfig.captions !== false,
    music: nicheConfig.music !== false,
    research: Boolean(nicheConfig.research),
    autoPublish: true,
    reviewRequired: bool(niche.review_required),
    review: bool(niche.review_required),
    scheduledAt: now(),
    autopilot: true,
    tone: nicheConfig.tone || 'documentary',
  }, { priority: 2 });
}

export async function recordProjectCompletionUsage(userId, durationSeconds, ttsCharacters, aiRequests = 0) {
  return incrementUsage(userId, {
    videos: 1,
    render_seconds: Math.ceil(durationSeconds),
    tts_characters: Math.ceil(ttsCharacters),
    ai_requests: aiRequests,
  });
}
