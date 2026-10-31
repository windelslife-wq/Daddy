/**
 * Developer surface.
 *
 * Public (no session):
 *   GET /api/developer/spec          machine-readable catalogue the docs page renders
 *   GET /api/developer/openapi.json  OpenAPI 3.1 document for client generators
 *
 * Session-authenticated (the account that owns the keys):
 *   GET    /api/developer/keys
 *   POST   /api/developer/keys       returns the plaintext token exactly once
 *   DELETE /api/developer/keys/:id   revokes (the row is kept for audit)
 */
import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, notFound } from '../errors.js';
import { apiSpec, openApiDocument, SCOPES } from '../api/catalog.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../api/keys.js';

const keySchema = z.object({
  name: z.string().trim().min(2, 'Give the key a name with at least 2 characters.').max(80),
  scopes: z.array(z.enum(SCOPES.map((scope) => scope.id))).min(1, 'Select at least one scope.').optional(),
});

export function developerRouter() {
  const router = express.Router();
  const meta = () => ({
    baseUrl: config.publicBaseUrl,
    keyRateLimit: config.api.keyRateLimitPerMinute,
    appName: config.appName,
    version: config.version,
  });

  router.get('/spec', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(apiSpec(meta()));
  });

  router.get('/openapi.json', (_req, res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.json(openApiDocument(meta()));
  });

  router.get('/keys', requireAuth, asyncHandler(async (req, res) => {
    res.json({
      keys: await listApiKeys(req.user.id),
      scopes: SCOPES,
      limits: { maxKeys: 10, requestsPerMinute: config.api.keyRateLimitPerMinute },
      baseUrl: config.publicBaseUrl,
      specUrl: '/api/developer/spec',
    });
  }));

  router.post('/keys', requireAuth, asyncHandler(async (req, res) => {
    const data = keySchema.safeParse(req.body || {});
    if (!data.success) {
      return res.status(400).json({
        error: {
          code: 'bad_request',
          message: 'Please correct the highlighted fields.',
          details: data.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          requestId: req.id,
        },
      });
    }
    const { token, key } = await createApiKey(req.user.id, data.data);
    res.status(201).json({
      key,
      token,
      warning: 'Copy this key now. Only a hash is stored, so it cannot be shown again.',
    });
  }));

  router.delete('/keys/:id', requireAuth, asyncHandler(async (req, res) => {
    const key = await revokeApiKey(req.user.id, req.params.id);
    if (!key) throw notFound('API key not found.');
    res.json({ key, revoked: true });
  }));

  return router;
}
