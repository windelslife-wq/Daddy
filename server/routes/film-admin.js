/**
 * Administrator controls for the film studio.
 *
 * These are the only privilege-gated film endpoints: provider enable/disable,
 * queue health and failed-job recovery. They never expose credentials.
 */
import express from 'express';
import { db, number, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { listModels } from '../film/models.js';
import { setProviderEnabled, disabledProviders } from '../film/providerGuard.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { asyncHandler as h } from '../errors.js';

export function filmAdminRouter() {
  const router = express.Router();
  router.use(requireAuth, requireAdmin);

  router.get('/ops', h(async (req, res) => {
    const models = listModels();
    const disabled = await disabledProviders();
    const queueRows = await db('jobs')
      .select('type', 'status')
      .count('* as count')
      .whereIn('type', ['film_generate_scene', 'film_assemble', 'film_storyboard_batch', 'film_voice_batch', 'film_lipsync', 'film_motion', 'film_dispatch_scenes', 'film_production_run'])
      .groupBy('type', 'status');
    const queue = {};
    for (const row of queueRows) {
      queue[row.type] = queue[row.type] || {};
      queue[row.type][row.status] = number(row.count);
    }
    const failed = await db('jobs')
      .whereIn('type', ['film_generate_scene', 'film_assemble', 'film_storyboard_batch', 'film_voice_batch', 'film_lipsync', 'film_motion', 'film_production_run'])
      .where({ status: 'failed' })
      .orderBy('updated_at', 'desc')
      .limit(10)
      .select('id', 'type', 'attempts', 'max_attempts', 'last_error', 'updated_at');
    const productions = await db('film_productions').select('status').count('* as count').groupBy('status');
    const renders = await db('film_projects').whereNotNull('final_video_path').count('* as count').first();
    const scenes = await db('film_scenes').select('status').count('* as count').groupBy('status');
    res.json({
      providers: {
        video: models.video.items.map((item) => ({ ...item, disabled: disabled.includes(item.id) })),
        disabled,
      },
      queue,
      failed: failed.map((job) => ({ ...job, payload: undefined, attempts: number(job.attempts), maxAttempts: number(job.max_attempts) })),
      productions: Object.fromEntries(productions.map((row) => [row.status, number(row.count)])),
      scenes: Object.fromEntries(scenes.map((row) => [row.status, number(row.count)])),
      renderedFilms: number(renders?.count),
      worker: { enabled: true },
    });
  }));

  router.post('/providers/:providerId', h(async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') throw new AppError(400, 'invalid_enabled', 'enabled must be true or false.');
    res.json(await setProviderEnabled(req.params.providerId, enabled, req.user.id));
  }));

  router.post('/jobs/retry-failed', h(async (req, res) => {
    const type = req.body?.type ? String(req.body.type) : null;
    const types = ['film_generate_scene', 'film_assemble', 'film_storyboard_batch', 'film_voice_batch', 'film_lipsync', 'film_motion', 'film_production_run'];
    if (type && !types.includes(type)) throw new AppError(400, 'unknown_job_type', 'Unknown film job type.');
    const query = db('jobs').whereIn('type', type ? [type] : types).where({ status: 'failed' });
    const rows = await query.select('id');
    if (rows.length) {
      await db('jobs').whereIn('id', rows.map((row) => row.id)).update({
        status: 'queued', attempts: 0, run_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null,
        updated_at: new Date().toISOString(),
      });
    }
    res.json({ requeued: rows.length });
  }));

  /**
   * Live provider reachability. Only providers with credentials are contacted;
   * everything else reports `checked: false` with the reason. Results are
   * recorded as observed, never assumed.
   */
  router.get('/health', h(async (req, res) => {
    const models = listModels();
    const roots = {
      replicate: process.env.REPLICATE_API_ROOT || 'https://api.replicate.com',
      fal: process.env.FAL_API_ROOT || 'https://fal.run',
      veo: process.env.GOOGLE_VEO_API_ROOT || 'https://generativelanguage.googleapis.com',
    };
    const checks = {
      replicate: { url: `${roots.replicate}/v1/account`, headers: { Authorization: `Bearer ${config.film.replicateToken}` } },
      fal: { url: `${roots.fal}/`, headers: { Authorization: `Key ${config.film.falKey}` } },
      veo: { url: `${roots.veo}/v1beta/models?key=${encodeURIComponent(config.film.veoKey || '')}`, headers: {} },
    };
    const results = await Promise.all(models.video.items.map(async (item) => {
      const check = checks[item.id];
      if (!item.configured || !check) {
        return { id: item.id, checked: false, reachable: null, reason: item.configured ? 'No health endpoint for this provider.' : 'No credential configured.' };
      }
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(check.url, { headers: check.headers, signal: controller.signal });
        return {
          id: item.id, checked: true, reachable: response.status < 500,
          status: response.status, latencyMs: Date.now() - started,
        };
      } catch (error) {
        const reason = error.name === 'AbortError' ? 'Timed out after 4s.' : error.message;
        logger.warn({ provider: item.id, reason }, 'Provider health check failed');
        return { id: item.id, checked: true, reachable: false, status: null, latencyMs: Date.now() - started, reason };
      } finally {
        clearTimeout(timer);
      }
    }));
    res.json({ checkedAt: new Date().toISOString(), providers: results });
  }));

  router.get('/providers', h(async (req, res) => {
    const models = listModels();
    const disabled = await disabledProviders();
    res.json({ providers: models.video.items.map((item) => ({ ...item, disabled: disabled.includes(item.id) })) });
  }));

  return router;
}

export { parseJson };
