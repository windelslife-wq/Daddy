import { db, now, json, parseJson, bool, addJob, incrementUsage, checkQuota } from '../db.js';
import { PLATFORMS } from '../constants.js';
import { refreshPostStatus } from '../services/projects.js';
import { sendNotification } from '../notifications.js';
import { platformVideoPath } from '../media/variants.js';
import { resolveAccountCredentials, markAccountExpired } from './tokens.js';
import { PublishError } from './errors.js';

function truncate(value, max) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function appendRef(text, refCode, max) {
  const marker = `Ref: ${refCode}`;
  if (String(text || '').includes(refCode)) return truncate(text, max);
  const separator = String(text || '').endsWith('\n') ? '\n' : '\n\n';
  return truncate(`${text || ''}${separator}${marker}`, max);
}

export function captionForPublication({ publication, post, project, account }) {
  const platform = account.platform;
  const spec = PLATFORMS[platform] || PLATFORMS.sandbox;
  const allCaptions = parseJson(post.captions, {});
  const item = allCaptions[platform] || allCaptions.sandbox || {};
  const title = truncate(item.title || project.title || project.topic, platform === 'youtube' ? 100 : 160);
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags.slice(0, 10) : [];
  const baseDescription = item.description || `${project.title}\n${project.topic}`;
  const description = platform === 'x'
    ? truncate(`${baseDescription} ${publication.ref_code}`, spec.maxCaption)
    : appendRef(baseDescription, publication.ref_code, spec.maxCaption);
  return {
    title,
    description,
    hashtags,
    refCode: publication.ref_code,
    text: platform === 'x' ? description : `${title}\n${description}`,
  };
}

export async function loadPublicationContext(publicationId) {
  const publication = await db('publications').where({ id: publicationId }).first();
  if (!publication) throw new PublishError('Publication not found.', { code: 'publication_missing', retryable: false, status: 404 });
  const post = await db('posts').where({ id: publication.post_id }).first();
  const [project, account] = await Promise.all([
    post ? db('projects').where({ id: post.project_id }).first() : Promise.resolve(null),
    db('accounts').where({ id: publication.account_id }).first(),
  ]);
  if (!post || !project || !account) throw new PublishError('Publication references a missing post, project, or account.', { code: 'publication_context_missing', retryable: false, status: 404 });
  if (!bool(account.active) || !bool(account.automation_enabled)) {
    throw new PublishError(`Automation is disabled for ${account.display_name}. Enable the account before publishing.`, { code: 'account_disabled', retryable: false, status: 409 });
  }
  if (project.status !== 'completed' || !project.video_path) {
    throw new PublishError('The project video is not ready yet.', { code: 'media_not_ready', retryable: false, status: 409 });
  }
  try { await checkQuota(publication.user_id, 'posts', 1); }
  catch (error) { throw new PublishError(error.message, { code: 'quota_exceeded', retryable: false, status: 402 }); }
  const credentials = await resolveAccountCredentials(account);
  const caption = captionForPublication({ publication, post, project, account });
  const videoPath = await platformVideoPath(project, account.platform, publication.id);
  return { publication, post, project, account, credentials, caption, videoPath, alreadyPublished: Boolean(publication.remote_id) };
}

export async function updatePublicationMetadata(publicationId, patch = {}) {
  const row = await db('publications').where({ id: publicationId }).first();
  const metadata = { ...parseJson(row?.metadata, {}), ...patch };
  await db('publications').where({ id: publicationId }).update({ metadata: json(metadata), updated_at: now() });
  return metadata;
}

export async function claimPublicationForPublish(publicationId, attempts, additionalStatuses = []) {
  const allowed = [...new Set([
    'scheduled', 'queued', 'awaiting_media', 'pending_review', 'failed', 'processing', ...additionalStatuses,
  ])];
  const changed = await db('publications')
    .where({ id: publicationId })
    .whereNull('remote_id')
    .whereIn('status', allowed)
    .update({ status: 'publishing', attempts, last_error: null, error_code: null, updated_at: now() });
  return changed > 0;
}

export async function markPublicationPending(ctx, result) {
  const metadata = await updatePublicationMetadata(ctx.publication.id, result.metadataPatch || {});
  await db('publications').where({ id: ctx.publication.id }).update({
    status: 'processing', last_error: null, error_code: null, next_attempt_at: null,
    remote_data: json(result.raw || {}), updated_at: now(),
  });
  if (result.jobType) {
    const delay = Math.max(3000, Number(result.delayMs) || 30000);
    const runAt = new Date(Date.now() + delay).toISOString();
    await addJob(result.jobType, { publicationId: ctx.publication.id, userId: ctx.publication.user_id }, {
      dedupeKey: `${result.jobType}:${ctx.publication.id}:${result.jobKey || ''}:${Number(metadata.pollCount || 0)}`,
      runAt, priority: 9, maxAttempts: ctx.publication.max_attempts,
    });
  }
  return { pending: true };
}

export async function markPublicationPublished(ctx, result) {
  const existingMetadata = parseJson(ctx.publication.metadata, {});
  const metadata = await updatePublicationMetadata(ctx.publication.id, { ...(result.metadataPatch || {}), publishedVia: ctx.account.platform });
  await db('publications').where({ id: ctx.publication.id }).update({
    status: 'published',
    remote_id: String(result.remoteId),
    remote_url: result.remoteUrl || null,
    remote_data: json(result.raw || {}),
    last_error: null,
    error_code: null,
    next_attempt_at: null,
    published_at: ctx.publication.published_at || now(),
    updated_at: now(),
  });
  if (!existingMetadata.usageCounted) {
    await incrementUsage(ctx.publication.user_id, { posts: 1 });
    await updatePublicationMetadata(ctx.publication.id, { usageCounted: true });
  }
  await refreshPostStatus(ctx.post.id);
  await addJob('sync_metrics', { publicationId: ctx.publication.id, userId: ctx.publication.user_id }, {
    runAt: new Date(Date.now() + 60 * 1000).toISOString(),
    dedupeKey: `metrics:${ctx.publication.id}:initial`,
    priority: 2,
  });
  const day = new Date().toISOString().slice(0, 10);
  await addJob('generate_recommendations', { userId: ctx.publication.user_id }, {
    runAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    dedupeKey: `recommendations:${ctx.publication.user_id}:${day}`,
    priority: 1,
  });
  await sendNotification(ctx.publication.user_id, {
    type: 'success',
    title: `Published to ${PLATFORMS[ctx.account.platform]?.name || ctx.account.platform}`,
    body: `${ctx.project.title} was published${result.duplicate ? ' (recovered from an earlier attempt)' : ''}.`,
    actionUrl: '/app/publishing',
    metadata: { publicationId: ctx.publication.id, remoteUrl: result.remoteUrl },
  });
  return { published: true, remoteId: result.remoteId, remoteUrl: result.remoteUrl };
}

export async function markPublicationFailure(publicationId, error, attempts, maxAttempts) {
  const retryable = error?.retryable !== false && error?.status !== 401 && error?.status !== 402 && error?.status !== 409;
  const final = !retryable || attempts >= maxAttempts;
  const backoffMs = Math.min(30 * 60 * 1000, Math.max(30 * 1000, 2 ** Math.max(0, attempts - 1) * 30 * 1000));
  const nextAttemptAt = final ? null : new Date(Date.now() + backoffMs).toISOString();
  const publication = await db('publications').where({ id: publicationId }).first();
  await db('publications').where({ id: publicationId }).update({
    status: final ? 'failed' : 'queued',
    attempts,
    last_error: String(error?.message || error).slice(0, 2000),
    error_code: error?.code || 'publish_error',
    next_attempt_at: nextAttemptAt,
    updated_at: now(),
  });
  if (error?.code === 'meta_token_expired' || error?.code === 'google_token_expired' || error?.code === 'x_authentication_failed') {
    const account = publication ? await db('accounts').where({ id: publication.account_id }).first() : null;
    if (account) await markAccountExpired(account, error.message);
  }
  if (final && publication) {
    await refreshPostStatus(publication.post_id);
    await sendNotification(publication.user_id, {
      type: 'error',
      title: 'Publishing failed',
      body: String(error?.message || error).slice(0, 500),
      actionUrl: '/app/publishing',
      metadata: { publicationId, code: error?.code || 'publish_error' },
    });
  }
  return { final, retryable, nextAttemptAt };
}
