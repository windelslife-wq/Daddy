import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db, now, newId, json, parseJson, number } from '../db.js';
import { config } from '../config.js';
import { safeParseCredentials, signValue, verifySignedValue } from '../security.js';
import { unauthorized, notFound, badRequest, asyncHandler } from '../errors.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 2 } });

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function requireSandboxToken(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized('Sandbox bearer token required.');
    const accounts = await db('accounts').where({ platform: 'sandbox', active: true, status: 'connected' });
    let matched = null;
    for (const account of accounts) {
      try {
        const credentials = safeParseCredentials(account.credentials);
        if (safeEqual(credentials.accessToken, token)) { matched = { account, credentials }; break; }
      } catch {}
    }
    if (!matched) throw unauthorized('Invalid sandbox access token.');
    req.sandboxAccount = matched.account;
    next();
  } catch (error) { next(error); }
}

function sandboxFilePath(remoteId, ext = '.mp4') {
  return path.join(config.storageDir, 'sandbox', `${remoteId}${ext}`);
}
function viewToken(remoteId) {
  return signValue({ postId: remoteId }, 'sandbox-view', 7 * 86400);
}
function verifyViewToken(token, remoteId) {
  let value;
  try { value = verifySignedValue(token, 'sandbox-view'); }
  catch { throw unauthorized('Invalid or expired sandbox view token.'); }
  if (!value?.postId || value.postId !== remoteId) throw unauthorized('Invalid sandbox view token.');
  return value;
}

function simulatedMetrics(row) {
  const ageMinutes = Math.max(1, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 60000));
  const seed = parseInt(crypto.createHash('sha256').update(row.remote_id).digest('hex').slice(0, 8), 16);
  const views = ageMinutes * (3 + (seed % 7)) + (seed % 29);
  const likes = Math.floor(views * 0.064) + (seed % 5);
  const comments = Math.floor(likes * 0.12) + (seed % 3);
  const shares = Math.floor(likes * 0.18) + (seed % 4);
  const impressions = Math.floor(views * 2.7) + (seed % 11);
  const watchSeconds = Math.floor(views * 0.42);
  return { views, likes, comments, shares, impressions, watchSeconds };
}

export function sandboxRouter() {
  const router = express.Router();

  router.get('/verify', requireSandboxToken, (req, res) => {
    res.json({ ok: true, accountId: req.sandboxAccount.id, mode: 'local-http', note: 'This is a local test publisher, not a social network.' });
  });

  router.post('/posts', requireSandboxToken, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), asyncHandler(async (req, res) => {
    const refCode = String(req.body.refCode || '').trim();
    const title = String(req.body.title || 'Untitled sandbox post').slice(0, 220);
    const caption = String(req.body.caption || '').slice(0, 6000);
    if (!refCode) throw badRequest('refCode is required for duplicate protection.');
    const video = req.files?.video?.[0];
    if (!video) throw badRequest('A video file is required.');
    const existing = await db('sandbox_posts').where({ ref_code: refCode }).first();
    if (existing) {
      const token = viewToken(existing.remote_id);
      return res.json({ remoteId: existing.remote_id, url: `/sandbox/posts/${existing.remote_id}?token=${encodeURIComponent(token)}`, duplicate: true, simulated: true });
    }
    const remoteId = newId('sbx_');
    await fsp.mkdir(path.dirname(sandboxFilePath(remoteId)), { recursive: true });
    const videoPath = sandboxFilePath(remoteId, '.mp4');
    await fsp.writeFile(videoPath, video.buffer);
    let thumbnailPath = null;
    const thumbnail = req.files?.thumbnail?.[0];
    if (thumbnail) {
      thumbnailPath = sandboxFilePath(remoteId, '.jpg');
      await fsp.writeFile(thumbnailPath, thumbnail.buffer);
    }
    const timestamp = now();
    try {
      await db('sandbox_posts').insert({
        id: newId('spt_'), account_id: req.sandboxAccount.id, remote_id: remoteId, ref_code: refCode,
        caption, metadata: json({ title, publicationId: req.body.publicationId || null, thumbnailPath, simulated: true }),
        video_path: videoPath, created_at: timestamp,
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE') || String(error.message).includes('unique')) {
        const duplicate = await db('sandbox_posts').where({ ref_code: refCode }).first();
        if (duplicate) {
          const token = viewToken(duplicate.remote_id);
          return res.json({ remoteId: duplicate.remote_id, url: `/sandbox/posts/${duplicate.remote_id}?token=${encodeURIComponent(token)}`, duplicate: true, simulated: true });
        }
      }
      throw error;
    }
    const token = viewToken(remoteId);
    res.status(201).json({
      remoteId,
      url: `/sandbox/posts/${remoteId}?token=${encodeURIComponent(token)}`,
      duplicate: false,
      simulated: true,
      note: 'Published to the local sandbox HTTP endpoint. No external social network was contacted.',
    });
  }));

  router.get('/posts/:id/metrics', requireSandboxToken, asyncHandler(async (req, res) => {
    const row = await db('sandbox_posts').where({ remote_id: req.params.id, account_id: req.sandboxAccount.id }).first();
    if (!row) throw notFound('Sandbox post not found.');
    const metrics = simulatedMetrics(row);
    await db('sandbox_posts').where({ id: row.id }).update({
      views: metrics.views, likes: metrics.likes, comments: metrics.comments, shares: metrics.shares,
    });
    res.json({
      ...metrics,
      simulated: true,
      note: 'Deterministic sandbox metrics for integration testing. They are not real audience data.',
      fetchedAt: now(),
    });
  }));

  router.get('/posts/:id/public', asyncHandler(async (req, res) => {
    verifyViewToken(String(req.query.token || ''), req.params.id);
    const row = await db('sandbox_posts').where({ remote_id: req.params.id }).first();
    if (!row) throw notFound('Sandbox post not found.');
    const metadata = parseJson(row.metadata, {});
    const token = encodeURIComponent(String(req.query.token));
    res.json({
      id: row.remote_id,
      title: metadata.title || 'Sandbox post',
      caption: row.caption,
      createdAt: row.created_at,
      simulated: true,
      metrics: { views: number(row.views), likes: number(row.likes), comments: number(row.comments), shares: number(row.shares) },
      videoUrl: `/api/sandbox/v1/posts/${row.remote_id}/video?token=${token}`,
    });
  }));

  router.get('/posts/:id/video', asyncHandler(async (req, res) => {
    verifyViewToken(String(req.query.token || ''), req.params.id);
    const row = await db('sandbox_posts').where({ remote_id: req.params.id }).first();
    if (!row?.video_path || !fs.existsSync(row.video_path)) throw notFound('Sandbox video not found.');
    const stat = await fsp.stat(row.video_path);
    const range = req.get('range');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
        return res.end();
      }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      return fs.createReadStream(row.video_path, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', String(stat.size));
    return fs.createReadStream(row.video_path).pipe(res);
  }));

  return router;
}
