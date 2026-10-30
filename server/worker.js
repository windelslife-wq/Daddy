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
import { processFilmSceneJob, processFilmAssemblyJob, dispatchPlannedScenes, sweepFilmGenerations, handleSceneJobFailure } from './film/scenes.js';

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

/**
 * Is the process that owns a job lock still alive? Locks are written as
 * `hostname:pid:random`. A lock from another host cannot be checked here, so it
 * is treated as alive and left to the JOB_TIMEOUT_MS fallback.
 */
function lockOwnerAlive(lockedBy) {
  const [host, pidText] = String(lockedBy || '').split(':');
  if (!host || host !== os.hostname()) return true;
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/**
 * Recover jobs a worker can no longer finish: the lock holder process is gone
 * (crash, OOM kill, `kill -9`, container restart) or the lock aged past
 * JOB_TIMEOUT_MS. Without the first check a restarted worker would leave the
 * job "running" for up to 20 minutes, and a film scene would sit in
 * "processing" with nobody polling the provider handle it already persisted.
 */
async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - config.worker.jobTimeoutMs).toISOString();
  const running = await db('jobs').where({ status: 'running' });
  for (const job of running) {
    const abandoned = Boolean(job.locked_by) && !lockOwnerAlive(job.locked_by);
    const timedOut = Boolean(job.locked_at) && job.locked_at < staleBefore;
    if (!abandoned && !timedOut) continue;
    const reason = abandoned ? 'Requeued: the worker process holding it exited.' : 'Recovered after worker timeout.';
    const payload = parseJson(job.payload, {});
    if (job.attempts >= job.max_attempts) {
      await db('jobs').where({ id: job.id }).update({ status: 'failed', locked_at: null, locked_by: null, last_error: abandoned ? 'The worker process exited before this job finished.' : 'Job exceeded its timeout.', completed_at: now(), updated_at: now() });
      // A scene whose last attempt died with its worker must be failed and
      // refunded, never left "processing" with no job watching it.
      if (job.type === 'film_generate_scene') {
        await handleSceneJobFailure(payload, new Error(abandoned ? 'The worker process exited before this job finished.' : 'The scene job exceeded its timeout.')).catch((error) => logger.error({ error: error.message, jobId: job.id }, 'Unable to record scene job failure'));
      }
    } else {
      await db('jobs').where({ id: job.id }).update({ status: 'queued', run_at: now(), locked_at: null, locked_by: null, last_error: reason, updated_at: now() });
    }
    logger.warn({ jobId: job.id, type: job.type, attempts: job.attempts, abandoned, timedOut }, 'Recovered interrupted job');
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
  return { retryable };
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
    case 'film_dispatch_scenes':
      return dispatchPlannedScenes(payload.filmId);
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
  // Long film renders and provider polling can outlive the stale-job timeout.
  // A heartbeat keeps the lock fresh so another worker never re-claims live work.
  const heartbeat = setInterval(() => {
    db('jobs').where({ id: job.id, status: 'running' })
      .update({ locked_at: now() })
      .catch((error) => logger.warn({ error: error.message, jobId: job.id }, 'Job heartbeat failed'));
  }, 20000);
  heartbeat.unref?.();
  try {
    const result = await processJob(job);
    await completeJob(job, result && typeof result === 'object' ? { ok: true, keys: Object.keys(result).slice(0, 8) } : result);
  } catch (error) {
    let handled = null;
    if (['publish_post', 'finalize_instagram', 'finalize_x'].includes(job.type) && payload.publicationId) {
      try { handled = await markPublicationFailure(payload.publicationId, error, job.attempts, job.max_attempts); }
      catch (markError) { logger.error({ markError: markError.message, jobId: job.id }, 'Unable to record publication failure'); }
    }
    const outcome = await failJob(job, error, handled);
    if (job.type === 'film_generate_scene' && !outcome?.retryable) {
      try { await handleSceneJobFailure(payload, error); }
      catch (markError) { logger.error({ markError: markError.message, jobId: job.id }, 'Unable to record scene job failure'); }
    }
  } finally {
    clearInterval(heartbeat);
  }
}

let lastFilmSweep = 0;

async function tick() {
  if (stopped) return;
  try {
    await recoverStaleJobs();
    // Keep queued scenes moving without depending on a completion event (e.g.
    // after a worker restart while a film still has planned scenes).
    if (Date.now() - lastFilmSweep > 5000) {
      lastFilmSweep = Date.now();
      sweepFilmGenerations().catch((error) => logger.warn({ error: error.message }, 'Film generation sweep failed'));
    }
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
