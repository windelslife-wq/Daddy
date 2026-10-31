import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, assertProductionSecrets } from './config.js';
import { initDb, logger } from './db.js';
import { requestLogger } from './logger.js';
import { authRouter, sameOriginGuard } from './auth.js';
import { errorMiddleware, asyncHandler } from './errors.js';
import { metaRouter } from './routes/meta.js';
import { oauthRouter } from './oauth/router.js';
import { sandboxRouter } from './routes/sandbox.js';
import { mediaRouter } from './routes/media.js';
import { contentRouter } from './routes/content.js';
import { accountsRouter } from './routes/accounts.js';
import { notificationsRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';
import { analyticsRouter } from './routes/analytics.js';
import { billingRouter, stripeWebhookHandler } from './routes/billing.js';
import { adminRouter } from './routes/admin.js';
import { filmAdminRouter } from './routes/film-admin.js';
import { contactRouter } from './routes/contact.js';
import { filmRouter } from './routes/films.js';

const distDir = path.join(config.root, 'dist');

/**
 * HMR settings for the dev server. When we are served through an HTTPS tunnel the
 * browser can only reach the websocket on 443/wss, so the client port must be
 * overridden; otherwise Vite's client tries the local port and hammers a closed
 * socket. Set HMR=off to disable the websocket entirely (some sandbox previews do
 * not forward websocket upgrades at all).
 */
function hmrSettings() {
  const flag = (process.env.HMR || '').toLowerCase();
  if (['off', 'false', '0', 'none', 'disabled'].includes(flag)) return false;
  const proxiedHttps = config.publicBaseUrl.startsWith('https://');
  const clientPort = Number(process.env.HMR_CLIENT_PORT || (proxiedHttps ? 443 : 0)) || undefined;
  const protocol = process.env.HMR_PROTOCOL || (proxiedHttps ? 'wss' : undefined);
  if (!clientPort && !protocol) return true;
  return { ...(clientPort ? { clientPort } : {}), ...(protocol ? { protocol } : {}) };
}

export async function createApp() {
  await initDb();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.security.trustProxy ? 1 : false);
  app.use(requestLogger);
  app.use(helmet({
    contentSecurityPolicy: config.isProduction ? {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'media-src': ["'self'", 'blob:', 'data:', 'https:'],
        'font-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", 'ws:', 'wss:', 'https:'],
        'form-action': ["'self'", 'https:'],
        'frame-ancestors': ['*'],
        'upgrade-insecure-requests': null,
      },
    } : false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.publicBaseUrl.startsWith('https://'),
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(cookieParser());
  app.use(sameOriginGuard);

  // Stripe requires the exact raw request body for signature verification.
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '2mb' }), asyncHandler(stripeWebhookHandler));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.apiRateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many API requests. Please slow down.' } },
  });
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter());
  app.use('/api/oauth', oauthRouter());
  app.use('/api/sandbox/v1', sandboxRouter());
  app.use('/api/media', mediaRouter());
  app.use('/api/meta', metaRouter());
  app.use('/api/accounts', accountsRouter());
  app.use('/api/notifications', notificationsRouter());
  app.use('/api/settings', settingsRouter());
  app.use('/api/analytics', analyticsRouter());
  app.use('/api/billing', billingRouter());
  // The film admin router is mounted first: its paths live under /api/admin/film
  // and must not be shadowed by the general admin gate.
  app.use('/api/admin/film', filmAdminRouter());
  app.use('/api/admin', adminRouter());
  app.use('/api/contact', contactRouter());
  app.use('/api/films', filmRouter());
  app.use('/api', contentRouter());

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'API endpoint not found.' } }));

  if (!config.skipFrontend && !config.isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: config.root,
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        allowedHosts: true,
        // Behind an HTTPS tunnel/proxy the browser reaches HMR through 443/wss,
        // not through the local port. HMR_CLIENT_PORT / HMR_PROTOCOL / HMR=off
        // let any preview host adjust this without code changes.
        hmr: hmrSettings(),
      },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', asyncHandler(async (req, res) => {
      const template = await fs.readFile(path.join(config.root, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    }));
  } else if (!config.skipFrontend) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('*', asyncHandler(async (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      try { await fs.access(indexPath); } catch {
        return res.status(503).type('text/plain').send('Frontend build not found. Run npm run build.');
      }
      return res.sendFile(indexPath);
    }));
  }

  app.use(errorMiddleware);
  if (config.isProduction) {
    for (const warning of assertProductionSecrets()) logger.warn({ warning }, 'Production configuration warning');
  }
  logger.info({ database: config.databaseUrl ? 'postgres' : 'sqlite', port: config.port }, 'Application initialized');
  return app;
}
