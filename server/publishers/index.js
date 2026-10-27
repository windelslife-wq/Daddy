import crypto from 'node:crypto';
import { db, now, json, parseJson, number, bool } from '../db.js';
import { logger } from '../logger.js';
import { resolveAccountCredentials } from './tokens.js';
import { PublishError } from './errors.js';
import {
  loadPublicationContext, claimPublicationForPublish, markPublicationPending,
  markPublicationPublished, markPublicationFailure, updatePublicationMetadata,
} from './context.js';
import { publishSandbox, fetchSandboxMetrics, verifySandboxAccount } from './sandbox.js';
import { publishFacebook, publishInstagram, fetchMetaMetrics, verifyMetaAccount } from './meta.js';
import { publishYouTube, fetchYouTubeMetrics, verifyYouTubeAccount } from './youtube.js';
import { publishX, fetchXMetrics, verifyXAccount } from './x.js';

export { markPublicationFailure };

export async function publishPublication(publicationId, attempts = 1) {
  const ctx = await loadPublicationContext(publicationId);
  if (ctx.alreadyPublished) {
    const result = await markPublicationPublished(ctx, {
      remoteId: ctx.publication.remote_id,
      remoteUrl: ctx.publication.remote_url,
      raw: parseJson(ctx.publication.remote_data, {}),
      duplicate: true,
    });
    return { ...result, alreadyPublished: true };
  }
  const claimed = await claimPublicationForPublish(publicationId, attempts);
  if (!claimed) {
    logger.warn({ publicationId }, 'Publication was already claimed or completed; skipping duplicate work');
    return { skipped: true, reason: 'already_claimed' };
  }
  ctx.publication.attempts = attempts;
  let result;
  switch (ctx.account.platform) {
    case 'sandbox': result = await publishSandbox(ctx); break;
    case 'facebook': result = await publishFacebook(ctx); break;
    case 'instagram': result = await publishInstagram(ctx); break;
    case 'youtube': result = await publishYouTube(ctx); break;
    case 'x': result = await publishX(ctx); break;
    default: throw new PublishError(`Unsupported platform "${ctx.account.platform}".`, { code: 'unsupported_platform', retryable: false, status: 400 });
  }
  if (result.pending) {
    await markPublicationPending(ctx, result);
    return { pending: true, platform: ctx.account.platform, status: 'processing' };
  }
  const published = await markPublicationPublished(ctx, result);
  return { ...published, platform: ctx.account.platform, duplicate: Boolean(result.duplicate) };
}

async function loadMetricsContext(publicationId) {
  const publication = await db('publications').where({ id: publicationId }).first();
  if (!publication) throw new PublishError('Publication not found.', { code: 'publication_missing', retryable: false, status: 404 });
  if (publication.status !== 'published' || !publication.remote_id) {
    throw new PublishError('Metrics can only be synced for published posts.', { code: 'metrics_not_published', retryable: false, status: 409 });
  }
  const [post, account] = await Promise.all([
    db('posts').where({ id: publication.post_id }).first(),
    db('accounts').where({ id: publication.account_id }).first(),
  ]);
  const project = post ? await db('projects').where({ id: post.project_id }).first() : null;
  if (!account || !project) throw new PublishError('Metrics context is incomplete.', { code: 'metrics_context_missing', retryable: false, status: 404 });
  const credentials = await resolveAccountCredentials(account);
  return { publication, post, project, account, credentials };
}

export async function syncPublicationMetrics(publicationId) {
  const ctx = await loadMetricsContext(publicationId);
  const remoteId = ctx.publication.remote_id;
  let metrics;
  switch (ctx.account.platform) {
    case 'sandbox': metrics = await fetchSandboxMetrics(ctx, remoteId); break;
    case 'facebook':
    case 'instagram': metrics = await fetchMetaMetrics(ctx, remoteId); break;
    case 'youtube': metrics = await fetchYouTubeMetrics(ctx, remoteId); break;
    case 'x': metrics = await fetchXMetrics(ctx, remoteId); break;
    default: throw new PublishError(`Metrics are not implemented for ${ctx.account.platform}.`, { code: 'metrics_unsupported', retryable: false, status: 400 });
  }
  const views = Math.max(0, number(metrics.views));
  const engagement = Math.max(0, number(metrics.likes) + number(metrics.comments) + number(metrics.shares));
  const engagementRate = views > 0 ? Math.round((engagement / views) * 10000) / 100 : 0;
  const fetchedAt = now();
  const row = {
    id: `met_${crypto.randomUUID()}`,
    publication_id: publicationId,
    views,
    likes: Math.max(0, number(metrics.likes)),
    comments: Math.max(0, number(metrics.comments)),
    shares: Math.max(0, number(metrics.shares)),
    impressions: Math.max(0, number(metrics.impressions)),
    watch_seconds: Math.max(0, number(metrics.watchSeconds)),
    engagement_rate: engagementRate,
    raw: json(metrics.raw || {}),
    fetched_at: fetchedAt,
  };
  await db('post_metrics').insert(row);
  await updatePublicationMetadata(publicationId, { metricsLastSyncedAt: fetchedAt, metricsAvailable: true, metricsLastError: null });
  logger.info({ publicationId, platform: ctx.account.platform, views, engagementRate }, 'Synced publication metrics');
  return { ...row, raw: metrics.raw || {}, platform: ctx.account.platform };
}

export async function verifyAccountConnection(accountId) {
  const account = await db('accounts').where({ id: accountId }).first();
  if (!account) throw new PublishError('Account not found.', { code: 'account_missing', retryable: false, status: 404 });
  const credentials = await resolveAccountCredentials(account);
  let result;
  switch (account.platform) {
    case 'sandbox': result = await verifySandboxAccount(credentials); break;
    case 'facebook':
    case 'instagram': result = await verifyMetaAccount(account, credentials); break;
    case 'youtube': result = await verifyYouTubeAccount(account, credentials); break;
    case 'x': result = await verifyXAccount(account, credentials); break;
    default: throw new PublishError(`Verification is not implemented for ${account.platform}.`, { code: 'verification_unsupported', retryable: false, status: 400 });
  }
  if (result.ok) {
    await db('accounts').where({ id: accountId }).update({ status: 'connected', last_error: null, last_verified_at: now(), updated_at: now() });
  }
  return { ...result, accountId, platform: account.platform };
}
