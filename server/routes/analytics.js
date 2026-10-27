import express from 'express';
import crypto from 'node:crypto';
import { db, now, addJob } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, notFound } from '../errors.js';
import { getAnalyticsSummary, requestMetricsSync } from '../services/analytics.js';

export function analyticsRouter() {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await getAnalyticsSummary(req.user.id));
  }));

  router.post('/sync', asyncHandler(async (req, res) => {
    const result = await requestMetricsSync(req.user.id, req.user.role);
    res.status(202).json({ ...result, message: `${result.queued} metrics sync job(s) queued.` });
  }));

  router.post('/recommendations/generate', asyncHandler(async (req, res) => {
    const nonce = crypto.randomUUID().slice(0, 8);
    const jobId = await addJob('generate_recommendations', { userId: req.user.id, reason: 'manual' }, {
      dedupeKey: `recommendations:${req.user.id}:manual:${nonce}`,
      priority: 7,
    });
    res.status(202).json({ ok: true, jobId, message: 'Recommendation analysis queued.' });
  }));

  router.post('/recommendations/:id/dismiss', asyncHandler(async (req, res) => {
    const row = await db('recommendations').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!row) throw notFound('Recommendation not found.');
    await db('recommendations').where({ id: row.id }).update({ dismissed_at: row.dismissed_at || now() });
    res.json({ ok: true });
  }));

  return router;
}
