import express from 'express';
import { providerStatus } from '../config.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, AppError } from '../errors.js';
import { oauthFailure } from './helpers.js';
import {
  startFacebook, handleFacebook, startGoogle, handleGoogle,
  startX, handleX, startSandbox, authorizeSandbox, handleSandbox,
} from './providers.js';

const starts = {
  facebook: startFacebook,
  instagram: startFacebook,
  youtube: startGoogle,
  google: startGoogle,
  x: startX,
  sandbox: startSandbox,
};
const callbacks = {
  facebook: handleFacebook,
  google: handleGoogle,
  x: handleX,
  sandbox: handleSandbox,
};

function browserHandler(provider, fn) {
  return asyncHandler(async (req, res) => {
    try { await fn(req, res); }
    catch (error) { oauthFailure(res, provider, error); }
  });
}

export function oauthRouter() {
  const router = express.Router();
  router.get('/status', (_req, res) => res.json(providerStatus()));
  router.get('/:provider/connect', requireAuth, asyncHandler(async (req, res) => {
    const provider = req.params.provider;
    const fn = starts[provider];
    if (!fn) throw new AppError(404, 'unsupported_provider', `Unknown OAuth provider "${provider}".`);
    try { await fn(req, res); }
    catch (error) { oauthFailure(res, provider, error); }
  }));
  router.get('/:provider/callback', asyncHandler(async (req, res) => {
    const provider = req.params.provider;
    const fn = callbacks[provider];
    if (!fn) throw new AppError(404, 'unsupported_provider', `Unknown OAuth callback "${provider}".`);
    try { await fn(req, res); }
    catch (error) { oauthFailure(res, provider, error); }
  }));
  router.post('/sandbox/authorize', asyncHandler(authorizeSandbox));
  return router;
}
