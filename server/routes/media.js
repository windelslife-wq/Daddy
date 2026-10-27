import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db, parseJson } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, notFound, forbidden, badRequest } from '../errors.js';
import { resolveSignedMedia } from '../media/urls.js';
import { contentType } from '../media/utils.js';

async function streamFile(req, res, filePath, filename, { download = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) throw notFound('Media file not found.');
  const stat = await fsp.stat(filePath);
  const type = contentType(filename);
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename).replace(/["\r\n]/g, '')}"`);
  const range = req.get('range');
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
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', String(stat.size));
  return fs.createReadStream(filePath).pipe(res);
}

export function mediaRouter() {
  const router = express.Router();

  router.get('/public/:token/:filename', asyncHandler(async (req, res) => {
    let resolved;
    try { resolved = resolveSignedMedia(req.params.token, req.params.filename); }
    catch (error) { throw forbidden(error.message); }
    await streamFile(req, res, resolved.path, resolved.filename);
  }));

  router.get('/projects/:projectId/:asset', requireAuth, asyncHandler(async (req, res) => {
    const project = await db('projects').where({ id: req.params.projectId }).first();
    if (!project) throw notFound('Project not found.');
    if (project.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
    const asset = req.params.asset;
    const download = req.query.download === '1';
    if (asset === 'script') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (download) res.setHeader('Content-Disposition', 'attachment; filename="script.txt"');
      return res.send(project.script || '');
    }
    if (asset === 'scenes' || asset === 'metadata' || asset === 'sources') {
      const key = { scenes: 'scenes', metadata: 'metadata', sources: 'sources' }[asset];
      return res.json(parseJson(project[key], asset === 'sources' ? [] : {}));
    }
    const map = {
      video: project.video_path,
      thumbnail: project.thumbnail_path,
      captions: project.caption_path,
      audio: project.audio_path,
    };
    const filePath = map[asset];
    if (!filePath) throw badRequest('Unknown media asset.');
    return streamFile(req, res, filePath, path.basename(filePath), { download: download || asset !== 'video' && asset !== 'thumbnail' });
  }));

  return router;
}
