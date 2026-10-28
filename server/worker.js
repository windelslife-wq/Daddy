import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config.js';
import { db, now, parseJson, json, addJob, logger } from './db.js';
import { generateProjectVideo } from './media/pipeline.js';
import { publishPublication, syncPublicationMetrics, markPublicationFailure } from './publishers/index.js';
import { generateRecommendations } from './services/analytics.js';
import { tickScheduler } from './services/scheduler.js';
import { createAutopilotProject } from './services/projects.js';
import { generateAutopilotTopic } from './ai.js';
import { processFilmSceneJob, processFilmAssemblyJob } from './film/scenes.js';

const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
let interval = null;
let schedulerInterval = null;
let running = 0;
let stopped = false;
let started = false;

function isRetryable(error, job, handled = null) {
  if (handled?.final) return false;
  if (error?.retryable === false) return false;
  const status = Number(error?.status || 0);
  if ([400, 401, 402, 403, 404, 409, 422].includes(status) && status !== 429) return false;
  return job.attempts < job.max_attempts;
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - config.worker.jobTimeoutMs).toISOString();
  const stale = await db('jobs').where({ status: 'running' }).where('locked_at', '<', staleBefore);
  for (const job of stale) {
    if (job.attempts >= job.max_attempts) {
      await db('jobs').where({ id: job.id }).update({ status: 'failed', locked_at: null, last_error: 'Job exceeded its timeout.', completed_at: now(), updated_at: now() });
    } else {
      await db('jobs').where({ id: job.id }).update({ status: 'queued', run_at: now(), locked_at: null, last_error: 'Recovered after worker timeout.', updated_at: now() });
    }
    logger.warn({ jobId: job.id, type: job.type, attempts: job.attempts }, 'Recovered stale job');
  }
  const stalePublications = await db('publications').where({ status: 'publishing' }).where('updated_at', '<', staleBefore);
  for (const publication of stalePublications) {
    await db('publications').where({ id: publication.id }).update({ status: 'queued', updated_at: now(), next_attempt_at: now() });
  }
}

async function claimJobs(limit) {
  const candidates = await db('jobs')
    .where({ status: 'queued' })
    .where('run_at', '<=', now())
    .orderBy('priority', 'desc')
    .orderBy('run_at', 'asc')
    .limit(Math.max(limit * 3, 3))
    .select('id');
  const claimed = [];
  const timestamp = now();
  for (const candidate of candidates) {
    if (claimed.length >= limit) break;
    const changed = await db('jobs')
      .where({ id: candidate.id, status: 'queued' })
      .where('run_at', '<=', timestamp)
      .update({
        status: 'running',
        attempts: db.raw('attempts + 1'),
        locked_at: timestamp,
        locked_by: workerId,
        last_error: null,
        updated_at: timestamp,
      });
    if (changed > 0) claimed.push(await db('jobs').where({ id: candidate.id }).first());
  }
  return claimed;
}

async function completeJob(job, result = null) {
  await db('jobs').where({ id: job.id }).update({
    status: 'completed', locked_at: null, locked_by: null,
    completed_at: now(), updated_at: now(), last_error: null,
  });
  logger.info({ jobId: job.id, type: job.type, attempts: job.attempts, result }, 'Job completed');
}

async function failJob(job, error, handled = null) {
  const message = String(error?.message || error).slice(0, 3000);
  const retryable = isRetryable(error, job, handled);
  const backoffMs = Math.min(30 * 60 * 1000, Math.max(15 * 1000, 2 ** Math.max(0, job.attempts - 1) * 30 * 1000));
  if (retryable) {
    await db('jobs').where({ id: job.id }).update({
      status: 'queued', run_at: new Date(Date.now() + backoffMs).toISOString(),
      locked_at: null, locked_by: null, last_error: message, updated_at: now(),
    });
  } else {
    await db('jobs').where({ id: job.id }).update({
      status: 'failed', locked_at: null, locked_by: null,
      last_error: message, completed_at: now(), updated_at: now(),
    });
  }
  logger.error({ jobId: job.id, type: job.type, attempts: job.attempts, retryable, error: message }, 'Job failed');
}

async function cleanupJob() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  await db('jobs').where({ status: 'completed' }).where('completed_at', '<', cutoff).del();
  await db('jobs').where({ status: 'failed' }).where('completed_at', '<', cutoff).del();
  await db('notifications').whereNotNull('read_at').where('created_at', '<', cutoff).del();
  await db('oauth_states').where('expires_at', '<', now()).del();
  await db('sessions').where('expires_at', '<', now()).del();
  return { cutoff };
}

async function processJob(job) {
  const payload = parseJson(job.payload, {});
  switch (job.type) {
    case 'generate_video':
      return generateProjectVideo(payload.projectId, async (stage, progress) => {
        if (progress % 10 === 0) logger.debug({ jobId: job.id, projectId: payload.projectId, stage, progress }, 'Generation progress');
      });
    case 'publish_post':
    case 'finalize_instagram':
    case 'finalize_x':
      return publishPublication(payload.publicationId, job.attempts);
    case 'sync_metrics':
      return syncPublicationMetrics(payload.publicationId);
    case 'generate_recommendations':
      return generateRecommendations(payload.userId);
    case 'film_generate_scene':
      return processFilmSceneJob(payload);
    case 'film_assemble':
      return processFilmAssemblyJob(payload);
    case 'autopilot_generate': {
      const niche = await db('niches').where({ id: payload.nicheId }).first();
      const topic = niche ? await generateAutopilotTopic({ ...niche, config: parseJson(niche.config, {}) }) : null;
      return createAutopilotProject(payload.nicheId, topic);
    }
    case 'scheduler_tick':
      return tickScheduler();
    case 'cleanup':
      return cleanupJob();
    default: {
      const error = new Error(`Unknown job type "${job.type}".`);
      error.retryable = false;
      throw error;
    }
  }
}

async function handleJob(job) {
  const payload = parseJson(job.payload, {});
  try {
    const result = await processJob(job);
    await completeJob(job, result && typeof result === 'object' ? { ok: true, keys: Object.keys(result).slice(0, 8) } : result);
  } catch (error) {
    let handled = null;
    if (['publish_post', 'finalize_instagram', 'finalize_x'].includes(job.type) && payload.publicationId) {
      try { handled = await markPublicationFailure(payload.publicationId, error, job.attempts, job.max_attempts); }
      catch (markError) { logger.error({ markError: markError.message, jobId: job.id }, 'Unable to record publication failure'); }
    }
    await failJob(job, error, handled);
  }
}

async function tick() {
  if (stopped) return;
  try {
    await recoverStaleJobs();
    const available = Math.max(0, config.worker.concurrency - running);
    if (available > 0) {
      const jobs = await claimJobs(available);
      for (const job of jobs) {
        running += 1;
        handleJob(job).catch((error) => logger.error({ error: error.message, jobId: job.id }, 'Unhandled worker error')).finally(() => { running -= 1; });
      }
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Worker tick failed');
  }
}

export function startWorker() {
  if (started || !config.worker.enabled) return () => {};
  started = true;
  stopped = false;
  interval = setInterval(tick, config.worker.pollMs);
  schedulerInterval = setInterval(() => {
    tickScheduler().catch((error) => logger.error({ error: error.message }, 'Scheduler tick failed'));
  }, 30000);
  tick();
  tickScheduler().catch((error) => logger.warn({ error: error.message }, 'Initial scheduler tick failed'));
  logger.info({ workerId, concurrency: config.worker.concurrency, pollMs: config.worker.pollMs }, 'Background worker started');
  return stopWorker;
}

export function stopWorker() {
  stopped = true;
  started = false;
  if (interval) clearInterval(interval);
  if (schedulerInterval) clearInterval(schedulerInterval);
  interval = null;
  schedulerInterval = null;
  logger.info({ workerId }, 'Background worker stopped');
}

export async function enqueueSchedulerTick() {
  return addJob('scheduler_tick', {}, { dedupeKey: `scheduler:${new Date().toISOString().slice(0, 13)}`, priority: 0 });
}
