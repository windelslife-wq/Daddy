import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import sharp from 'sharp';
import chromium, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const artifactDir = path.join(root, 'test-artifacts');
const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'faceless-visual-'));
let env;
let base;
let serverProcess;
let serverLogs = '';
let exitCode = null;
let browser;
let context;
let page;
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function poll(label, fn, timeoutMs = 30000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

before(async () => {
  await fsp.mkdir(artifactDir, { recursive: true });
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  }
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  env = {
    ...process.env,
    NODE_ENV: 'production',
    SKIP_FRONTEND: 'false',
    SEED_DEMO: 'true',
    EXPOSE_DEMO_CREDENTIALS: 'true',
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
    DEMO_EMAIL: 'visual@faceless.local',
    DEMO_PASSWORD: 'VisualQA2026!',
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: base,
    APP_URL: base,
    DATA_DIR: path.join(tempDir, 'data'),
    STORAGE_DIR: path.join(tempDir, 'storage'),
    SQLITE_PATH: path.join(tempDir, 'app.sqlite3'),
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    WORKER_ENABLED: 'false',
    API_RATE_LIMIT_PER_MINUTE: '5000',
    TRUST_PROXY: 'false',
    SECURE_COOKIES: 'false',
    LOG_LEVEL: 'warn',
    AI_PROVIDER: 'local',
    SEARCH_PROVIDER: 'none',
    IMAGE_PROVIDER: 'procedural',
    TTS_PROVIDER: 'mespeak',
  };
  await fsp.mkdir(env.DATA_DIR, { recursive: true });
  await fsp.mkdir(env.STORAGE_DIR, { recursive: true });

  serverProcess = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.on('exit', (code) => { exitCode = code; });
  await poll('visual QA server health', async () => {
    if (exitCode !== null) throw new Error(`Server exited early with ${exitCode}: ${serverLogs.slice(-4000)}`);
    try { return (await fetch(`${base}/api/meta/health`)).ok; } catch { return false; }
  }, 30000, 200);

  await chromium.executablePath();
  await inflate(path.join(root, 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br'));
  setupLambdaEnvironment(path.join(os.tmpdir(), 'al2023', 'lib'));
  browser = await playwrightChromium.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: true,
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`));
});

after(async () => {
  if (browser) await browser.close();
  if (serverProcess && exitCode === null) {
    serverProcess.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), wait(5000)]);
    if (exitCode === null) serverProcess.kill('SIGKILL');
  }
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test('production frontend renders, authenticates, navigates, and remains responsive', async (t) => {
  await t.test('login page renders at desktop size without runtime errors', async () => {
    const response = await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { name: /Turn one idea into a complete faceless video campaign/i }).waitFor();
    assert.equal(await page.locator('input[type="email"]').count(), 1);
    const loginScreenshot = path.join(artifactDir, 'login-desktop.png');
    await page.screenshot({ path: loginScreenshot, fullPage: true });
    const metadata = await sharp(loginScreenshot).metadata();
    assert.equal(metadata.width, 1440);
    assert.ok(metadata.height >= 900);
  });

  await t.test('seeded demo account signs in and the dashboard renders', async () => {
    await page.locator('input[type="email"]').fill(env.DEMO_EMAIL);
    await page.locator('input[type="password"]').fill(env.DEMO_PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/ }).click();
    await page.waitForURL('**/app', { timeout: 15000 });
    await page.getByText(/Good to see you/i).waitFor({ timeout: 15000 });
    await page.getByText(/Videos generated/i).waitFor();
    const dashboardScreenshot = path.join(artifactDir, 'dashboard-desktop.png');
    await page.screenshot({ path: dashboardScreenshot, fullPage: true });
    const metadata = await sharp(dashboardScreenshot).metadata();
    assert.equal(metadata.width, 1440);
    assert.ok(metadata.height >= 900);
  });

  await t.test('major workspace routes mount without uncaught errors', async () => {
    const routes = ['/app', '/app/studio', '/app/projects', '/app/accounts', '/app/calendar', '/app/publishing', '/app/analytics', '/app/settings', '/app/billing'];
    for (const route of routes) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, `${route} returned ${response.status()}`);
      const text = await page.locator('body').innerText();
      assert.ok(text.length > 200, `${route} rendered too little content`);
      assert.doesNotMatch(text, /Something went wrong|Page not found|Application error/i, `${route} showed an error state`);
    }
    await page.goto(`${base}/app/studio`, { waitUntil: 'networkidle' });
    await page.getByText('Create a faceless video campaign').waitFor();
  });

  await t.test('mobile dashboard has no horizontal overflow and captures a screenshot', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
    await page.getByText(/Good to see you/i).waitFor({ timeout: 15000 });
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
    }));
    assert.ok(dimensions.scrollWidth <= dimensions.innerWidth + 2, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
    const mobileScreenshot = path.join(artifactDir, 'dashboard-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    const metadata = await sharp(mobileScreenshot).metadata();
    assert.equal(metadata.width, 390);
    assert.ok(metadata.height >= 844);
  });

  await t.test('browser reports no uncaught page errors or unexpected failed requests', async () => {
    assert.deepEqual(pageErrors, []);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/favicon\.ico/i.test(message));
    assert.deepEqual(unexpectedConsoleErrors, []);
    const unexpectedFailedRequests = failedRequests.filter((message) => !/favicon\.ico/i.test(message));
    assert.deepEqual(unexpectedFailedRequests, []);
    console.log(JSON.stringify({ visualQa: 'passed', artifacts: ['test-artifacts/login-desktop.png', 'test-artifacts/dashboard-desktop.png', 'test-artifacts/dashboard-mobile.png'] }, null, 2));
  });
});
