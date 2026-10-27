import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-readiness-'));
const script = "const { buildIntegrationReadiness } = await import('./server/services/integrationReadiness.js'); console.log(JSON.stringify(await buildIntegrationReadiness()));";

function baseEnv(suffix) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    SKIP_FRONTEND: 'true',
    SEED_DEMO: 'false',
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
    DATABASE_URL: '',
    PUBLIC_BASE_URL: 'http://localhost:8787',
    APP_URL: 'http://localhost:8787',
    DATA_DIR: path.join(tempRoot, suffix, 'data'),
    STORAGE_DIR: path.join(tempRoot, suffix, 'storage'),
    SQLITE_PATH: path.join(tempRoot, suffix, 'app.sqlite3'),
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    WORKER_ENABLED: 'false',
    META_APP_ID: '',
    META_APP_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    X_CONSUMER_KEY: '',
    X_CONSUMER_SECRET: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    SMTP_URL: '',
    NOTIFICATION_WEBHOOK_URL: '',
    NOTIFICATION_WEBHOOK_SECRET: '',
  };
}

function runReadiness(env) {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1));
}

test('readiness report exposes exact callbacks and provider approval requirements', () => {
  const report = runReadiness(baseEnv('local'));
  assert.equal(report.callbacks.facebook, 'http://localhost:8787/api/oauth/facebook/callback');
  assert.equal(report.callbacks.google, 'http://localhost:8787/api/oauth/google/callback');
  assert.equal(report.callbacks.x, 'http://localhost:8787/api/oauth/x/callback');
  assert.equal(report.callbacks.stripeWebhook, 'http://localhost:8787/api/billing/webhook');
  assert.equal(report.publicBaseUrl.https, false);
  assert.equal(report.checks.find((item) => item.id === 'public-base-url').status, 'warn');
  assert.equal(report.providerApproval.length, 4);

  const meta = report.providerApproval.find((item) => item.id === 'meta');
  assert.ok(meta.requiredPermissions.includes('instagram_manage_insights'));
  assert.match(meta.appReview, /Advanced Access/i);
  assert.match(meta.accountRequirements, /public HTTPS/i);

  const google = report.providerApproval.find((item) => item.id === 'google');
  assert.ok(google.requiredScopes.some((scope) => scope.endsWith('yt-analytics.readonly')));
  assert.match(google.conditionalPermissions, /48 hours/);

  const stripe = report.providerApproval.find((item) => item.id === 'stripe');
  assert.ok(stripe.requiredEvents.includes('customer.subscription.deleted'));
});

test('production-ready configuration reports no blocking checks and keeps external approval explicit', () => {
  const env = {
    ...baseEnv('production'),
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://studio.example.com',
    APP_URL: 'https://studio.example.com',
    DATABASE_URL: 'postgresql://faceless:secret@db.example.com:5432/faceless',
    WORKER_ENABLED: 'true',
    META_APP_ID: 'meta-app',
    META_APP_SECRET: 'meta-secret',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    X_CONSUMER_KEY: 'x-key',
    X_CONSUMER_SECRET: 'x-secret',
    STRIPE_SECRET_KEY: 'sk_live_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SMTP_URL: 'smtp://smtp.example.com:587',
    NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com/notifications',
    NOTIFICATION_WEBHOOK_SECRET: 'webhook-secret',
  };
  const report = runReadiness(env);
  assert.deepEqual(report.productionWarnings, []);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.checks.find((item) => item.id === 'public-base-url').status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'database').status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'api-endpoints').status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'stripe').status, 'external');
  assert.equal(report.checks.find((item) => item.id === 'facebook-credentials').status, 'external');
  assert.equal(report.overall, 'attention-required');
  assert.match(report.note, /cannot be completed from code/);
});

test.after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
});
