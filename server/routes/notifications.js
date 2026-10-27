import express from 'express';
import { db, now, parseJson } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, notFound } from '../errors.js';

function view(row) {
  return {
    id: row.id, type: row.type, title: row.title, body: row.body,
    actionUrl: row.action_url, readAt: row.read_at, createdAt: row.created_at,
    metadata: parseJson(row.metadata, {}),
  };
}

export function notificationsRouter() {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', asyncHandler(async (req, res) => {
    const rows = await db('notifications').where({ user_id: req.user.id }).orderBy('created_at', 'desc').limit(100);
    res.json({ notifications: rows.map(view), unread: rows.filter((row) => !row.read_at).length });
  }));
  router.post('/:id/read', asyncHandler(async (req, res) => {
    const row = await db('notifications').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!row) throw notFound('Notification not found.');
    await db('notifications').where({ id: row.id }).update({ read_at: row.read_at || now() });
    res.json({ ok: true });
  }));
  router.post('/read-all', asyncHandler(async (req, res) => {
    await db('notifications').where({ user_id: req.user.id }).whereNull('read_at').update({ read_at: now() });
    res.json({ ok: true });
  }));
  return router;
}
