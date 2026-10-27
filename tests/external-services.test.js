import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startProviderSimulator } from './helpers/providerSimulator.js';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-external-services-'));
let simulator;
let serverProcess;
let serverLogs = '';
let exitCode = null;
let base;
let env;
let client;
let db;
let closeDb;
let json;
let ai;
let config;
let images;
let audio;
let userId;
let userEmail;

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function poll(label, fn, timeoutMs = 15000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
function makeClient() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(routePath, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.cookie = cookie;
      let body = options.body;
      if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string' && !Buffer.isBuffer(body)) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(body);
      }
      const response = await fetch(base + routePath, { ...options, body, headers, redirect: options.redirect || 'follow' });
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
      for (const item of setCookies) {
        const pair = item.split(';')[0];
        if (pair.startsWith('fs_session=')) cookie = pair;
      }
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
      if (!response.ok && options.allowFailure !== true) throw new Error(`${options.method || 'GET'} ${routePath} failed (${response.status}): ${JSON.stringify(data)}`);
      return { response, data };
    },
  };
}
function stripeSignature(raw, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

before(async () => {
  simulator = await startProviderSimulator();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  env = {
    ...process.env,
    ...simulator.envOverrides,
    NODE_ENV: 'test',
    SKIP_FRONTEND: 'true',
    SEED_DEMO: 'false',
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
    DATABASE_URL: '',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: path.join(tempDir, 'data'),
    STORAGE_DIR: path.join(tempDir, 'storage'),
    SQLITE_PATH: path.join(tempDir, 'app.sqlite3'),
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    WORKER_ENABLED: 'false',
    API_RATE_LIMIT_PER_MINUTE: '5000',
    TRUST_PROXY: 'false',
    SECURE_COOKIES: 'false',
    AI_PROVIDER: 'local',
    SEARCH_PROVIDER: 'none',
    IMAGE_PROVIDER: 'procedural',
    TTS_PROVIDER: 'mespeak',
  };
  await fs.mkdir(env.DATA_DIR, { recursive: true });
  await fs.mkdir(env.STORAGE_DIR, { recursive: true });

  serverProcess = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.on('exit', (code) => { exitCode = code; });
  await poll('external service test server', async () => {
    if (exitCode !== null) throw new Error(`Server exited early with ${exitCode}: ${serverLogs.slice(-4000)}`);
    try { return (await fetch(`${base}/api/meta/health`)).ok; } catch { return false; }
  }, 30000, 200);

  Object.assign(process.env, env);
  ({ config } = await import('../server/config.js'));
  ai = await import('../server/ai.js');
  images = await import('../server/media/images.js');
  audio = await import('../server/media/audio.js');
  const dbModule = await import('../server/db.js');
  ({ db, closeDb, json } = dbModule);

  client = makeClient();
  userEmail = `external-${Date.now()}@example.com`;
  const register = await client.request('/api/auth/register', { method: 'POST', body: { name: 'External Tester', email: userEmail, password: 'ExternalE2E2026!' } });
  userId = register.data.user.id;
  await db('plans').where({ id: 'creator' }).update({ stripe_price_id: 'price_simulated_creator' });
});

after(async () => {
  if (serverProcess && exitCode === null) {
    serverProcess.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), wait(5000)]);
    if (exitCode === null) serverProcess.kill('SIGKILL');
  }
  if (closeDb) await closeDb();
  if (simulator) await simulator.close();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

const planInput = {
  topic: 'A simulated observatory', niche: 'education', style: 'cinematic', language: 'en',
  duration: 15, aspectRatio: '16:9', platforms: ['sandbox'], tone: 'documentary',
};

test('external service modules work against simulated official APIs', async (t) => {
  await t.test('OpenAI, Anthropic, and Gemini script providers produce validated plans', async () => {
    for (const provider of ['openai', 'anthropic', 'gemini']) {
      config.ai.provider = provider;
      const plan = await ai.generateContentPlan(planInput);
      assert.equal(plan.title, 'Simulated provider story');
      assert.equal(plan.scenes.length, 3);
      assert.equal(plan.providerSummary.scriptProvider, provider);
      assert.equal(plan.providerSummary.aiGenerated, true);
      assert.ok(plan.captions.sandbox.title);
    }
    config.ai.provider = 'local';
  });

  await t.test('Brave and Tavily research providers return normalized, validated sources', async () => {
    for (const provider of ['brave', 'tavily']) {
      config.ai.researchProvider = provider;
      config.ai.researchApiKey = env.SEARCH_API_KEY;
      const result = await ai.researchTopic('simulated research', 'education');
      assert.equal(result.provider, provider);
      assert.equal(result.sources.length, 1);
      assert.match(result.sources[0].url, /^https:\/\//);
    }
    config.ai.researchProvider = 'none';
  });

  await t.test('OpenAI and Replicate image providers generate real PNG scene assets', async () => {
    const plan = { scenes: [{ visualPrompt: 'Original simulated landscape', narration: 'A scene', caption: 'A scene' }] };
    for (const provider of ['openai', 'replicate']) {
      config.media.imageProvider = provider;
      const result = await images.generateSceneImages({
        projectId: `prj-images-${provider}`, plan,
        input: { ...planInput, aspectRatio: '16:9' },
      });
      assert.equal(result.paths.length, 1);
      assert.equal(result.buffers.length, 1);
      assert.equal(result.buffers[0].subarray(1, 4).toString('ascii'), 'PNG');
      assert.match(result.provider, new RegExp(provider));
    }
    config.media.imageProvider = 'procedural';
  });

  await t.test('OpenAI and ElevenLabs TTS providers create narration audio and SRT captions', async () => {
    const plan = { scenes: [{ visualPrompt: 'Scene', narration: 'This is a simulated narration for provider verification.', caption: 'Simulated narration for verification' }] };
    for (const provider of ['openai', 'elevenlabs']) {
      config.media.ttsProvider = provider;
      const result = await audio.buildNarrationAudio({
        projectId: `prj-audio-${provider}`, plan,
        input: { ...planInput, duration: 8, captions: true, music: false },
      });
      await fs.access(result.audioPath);
      await fs.access(result.srtPath);
      assert.match(await fs.readFile(result.srtPath, 'utf8'), /-->/);
      assert.ok(result.ttsCharacters > 10);
      assert.match(result.provider, new RegExp(provider));
    }
    config.media.ttsProvider = 'mespeak';
  });

  await t.test('AI recommendations use the configured external LLM', async () => {
    config.ai.provider = 'openai';
    const recommendations = await ai.llmRecommendations({ views: 1000, engagementRate: 0.05 });
    assert.equal(recommendations.length, 1);
    assert.equal(recommendations[0].title, 'Post earlier');
    config.ai.provider = 'local';
  });

  await t.test('Stripe checkout creates a session and paid session lookup upgrades the plan', async () => {
    const checkout = await client.request('/api/billing/checkout', { method: 'POST', body: { planId: 'creator' } });
    assert.match(checkout.data.url, /checkout\.stripe\.com/);
    assert.equal(checkout.data.sessionId, 'cs_simulated_1');
    const lookup = await client.request('/api/billing/checkout-session/cs_simulated_1');
    assert.equal(lookup.data.paymentStatus, 'paid');
    assert.equal(lookup.data.plan.id, 'creator');
    const user = await db('users').where({ id: userId }).first();
    assert.equal(user.plan_id, 'creator');
    assert.ok(simulator.requests.some((request) => request.path === '/stripe/v1/checkout/sessions' && request.method === 'POST'));
  });

  await t.test('Stripe webhook signature verification, plan changes, and replay protection work', async () => {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    const event = {
      id: 'evt_simulated_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_simulated_1', client_reference_id: userId, metadata: { userId, planId: 'scale' }, payment_status: 'paid', status: 'complete' } },
    };
    const raw = JSON.stringify(event);
    const invalid = await fetch(`${base}/api/billing/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, body: raw,
    });
    assert.equal(invalid.status, 400);
    const valid = await fetch(`${base}/api/billing/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(raw, secret) }, body: raw,
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).received, true);
    let user = await db('users').where({ id: userId }).first();
    assert.equal(user.plan_id, 'scale');
    const replay = await fetch(`${base}/api/billing/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(raw, secret) }, body: raw,
    });
    assert.equal((await replay.json()).duplicate, true);

    const deleted = { id: 'evt_simulated_2', type: 'customer.subscription.deleted', data: { object: { metadata: { userId } } } };
    const deletedRaw = JSON.stringify(deleted);
    const deletedResponse = await fetch(`${base}/api/billing/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(deletedRaw, secret) }, body: deletedRaw,
    });
    assert.equal(deletedResponse.status, 200);
    user = await db('users').where({ id: userId }).first();
    assert.equal(user.plan_id, 'free');
  });

  await t.test('SMTP email and signed notification webhooks are delivered for in-app notifications', async () => {
    const result = await client.request('/api/settings/test-notification', { method: 'POST', body: {} });
    assert.equal(result.data.ok, true);
    const email = await poll('SMTP email', () => simulator.emails.find((item) => item.envelope.to.includes(userEmail)));
    assert.ok(email);
    assert.match(email.message, /Faceless Studio|Notification|Test/i);
    const webhook = await poll('signed notification webhook', () => simulator.webhookEvents.at(-1));
    const timestamp = String(webhook.headers['x-faceless-timestamp']);
    const expected = `sha256=${crypto.createHmac('sha256', env.NOTIFICATION_WEBHOOK_SECRET).update(`${timestamp}.${JSON.stringify(webhook.body)}`).digest('hex')}`;
    assert.equal(webhook.headers['x-faceless-signature'], expected);
    assert.equal(webhook.headers['x-faceless-event'], 'notification.created');
  });
});
