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
import { FILM_PAGES, PUBLIC_PAGES } from '../src/config/site.js';

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
const httpErrors = [];

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
async function setTheme(label) {
  await page.locator('.theme-trigger').first().click();
  const option = page.getByRole('menuitemradio', { name: new RegExp(label, 'i') });
  await option.waitFor({ timeout: 5000 });
  await option.click();
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, label.toLowerCase(), { timeout: 5000 });
}
async function assertNoHorizontalOverflow(where) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.innerWidth + 2,
    `${where} has horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
}
async function screenshot(name, width = 1440) {
  const target = path.join(artifactDir, name);
  await page.screenshot({ path: target, fullPage: true });
  const metadata = await sharp(target).metadata();
  assert.equal(metadata.width, width, `${name} has unexpected width`);
  return target;
}

before(async () => {
  await fsp.mkdir(artifactDir, { recursive: true });
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
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
  page.on('response', (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
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

test('professional global website, themes, authentication, workspace, and responsiveness', async (t) => {
  await t.test('public home renders with a complete menu and generated footer', async () => {
    const response = await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { level: 1, name: /Turn one idea into a complete publishing workflow/i }).waitFor();
    await assertNoHorizontalOverflow('home desktop');
    await screenshot('home-desktop.png');

    await page.locator('.desktop-nav .nav-dropdown > summary').click();
    const menuText = await page.locator('.mega-menu').innerText();
    for (const item of PUBLIC_PAGES.filter((item) => item.path !== '/')) {
      assert.ok(menuText.includes(item.label), `Explore menu is missing ${item.label}`);
    }
    assert.equal(await page.getByRole('menuitemradio').count(), 0);
    assert.equal(await page.locator('.theme-option').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.desktop-nav .nav-dropdown').evaluate((element) => element.open), false);

    const footerText = await page.locator('.site-footer').innerText();
    for (const item of PUBLIC_PAGES.filter((item) => item.path !== '/')) {
      assert.ok(footerText.includes(item.label), `Footer is missing ${item.label}`);
    }
    assert.ok(await page.locator('.site-footer .footer-column a').count() >= PUBLIC_PAGES.length - 1);
  });

  await t.test('contact form submits through the real backend endpoint', async () => {
    await page.goto(`${base}/contact`, { waitUntil: 'networkidle' });
    await page.getByLabel('Your name').fill('Visual QA');
    await page.getByLabel('Email address').fill('visual-qa@faceless.local');
    await page.getByLabel('What is this about?').selectOption('support');
    await page.getByLabel('Message').fill('Please verify that the public contact form stores a real message and returns a reference.');
    await page.getByRole('button', { name: /Send message/i }).click();
    await page.getByRole('heading', { name: /Message received/i }).waitFor({ timeout: 10000 });
    await page.getByText(/Reference:/i).waitFor();
    await assertNoHorizontalOverflow('contact desktop');
  });

  await t.test('every public page and auth page works in Midnight, Daylight and Aurora themes', async () => {
    const routes = [...PUBLIC_PAGES.map((item) => item.path), '/login', '/signup'];
    const themes = [
      { label: 'Midnight', value: 'midnight' },
      { label: 'Daylight', value: 'daylight' },
      { label: 'Aurora', value: 'aurora' },
    ];
    assert.ok(PUBLIC_PAGES.length >= 20);
    for (const theme of themes) {
      await page.goto(base, { waitUntil: 'networkidle' });
      await setTheme(theme.label);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme.value);
      for (const route of routes) {
        const response = await page.goto(base + route, { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200, `${route} returned ${response.status()} in ${theme.label}`);
        await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 8000 });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme.value, `${route} lost ${theme.label} theme`);
        await assertNoHorizontalOverflow(`${route} in ${theme.label}`);
        const text = await page.locator('body').innerText();
        assert.ok(text.length > 200, `${route} rendered too little content in ${theme.label}`);
        assert.doesNotMatch(text, /Application error|Something went wrong|Page wandered off-script/i, `${route} showed an error in ${theme.label}`);
        if (route === '/pricing' && theme.value === 'daylight') await screenshot('pricing-daylight.png');
        if (route === '/signup' && theme.value === 'aurora') await screenshot('signup-aurora.png');
      }
    }
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await setTheme('Midnight');
  });

  await t.test('sitemap includes every filmmaking tool and authentication preserves the requested destination', async () => {
    await page.goto(`${base}/sitemap`, { waitUntil: 'networkidle' });
    for (const item of FILM_PAGES) assert.equal(await page.locator(`.sitemap-app-grid a[href="${item.path}"]`).count(), 1, `Missing ${item.path}`);
    await page.goto(`${base}/app/films?view=all`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/login');
    await page.locator('.auth-tabs').getByRole('link', { name: /Create account/i }).click();
    assert.equal(new URL(page.url()).searchParams.get('next'), '/app/films?view=all');
    await page.locator('.auth-tabs').getByRole('link', { name: /Sign in/i }).click();
    assert.equal(new URL(page.url()).searchParams.get('next'), '/app/films?view=all');
    await page.setViewportSize({ width: 390, height: 844 });
    const formPosition = await page.locator('.auth-form').boundingBox();
    assert.ok(formPosition.y < 550, `Mobile form starts too far down: ${formPosition.y}`);
    await assertNoHorizontalOverflow('mobile auth');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await t.test('signup creates a real account and reaches the workspace', async () => {
    await page.goto(`${base}/signup`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Create your workspace/i }).waitFor();
    const email = `visual-signup-${Date.now()}@faceless.local`;
    await page.getByLabel('Full name').fill('Visual QA User');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Create password', { exact: true }).fill('StudioSignup2026!');
    await page.getByLabel('Confirm password').fill('StudioSignup2026!');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Create free account/i }).click();
    await page.waitForURL('**/app', { timeout: 15000 });
    await page.getByText(/Good to see you/i).waitFor({ timeout: 15000 });
    await page.evaluate(async () => {
      await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
    });
    // Leave the authenticated app shell immediately so its notification poller
    // cannot issue an unauthenticated request before the next navigation.
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  });

  await t.test('login page renders and seeded demo account signs in', async () => {
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Sign in to your studio/i }).waitFor();
    await assertNoHorizontalOverflow('login desktop');
    await screenshot('login-desktop.png');
    await page.locator('input[type="email"]').fill(env.DEMO_EMAIL);
    await page.locator('input[type="password"]').fill(env.DEMO_PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/ }).click();
    await page.waitForURL('**/app', { timeout: 15000 });
    await page.getByText(/Good to see you/i).waitFor({ timeout: 15000 });
    await page.getByText(/Videos generated/i).waitFor();
    await screenshot('dashboard-desktop.png');
  });

  await t.test('major workspace routes mount and the app theme switcher works', async () => {
    const routes = ['/app', '/app/studio', '/app/projects', '/app/accounts', '/app/calendar', '/app/publishing', '/app/analytics', '/app/automation', '/app/settings', '/app/billing'];
    for (const route of routes) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, `${route} returned ${response.status()}`);
      const text = await page.locator('body').innerText();
      assert.ok(text.length > 200, `${route} rendered too little content`);
      assert.doesNotMatch(text, /Something went wrong|Page wandered off-script|Application error/i, `${route} showed an error state`);
      await assertNoHorizontalOverflow(route);
    }
    await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
    for (const label of ['Daylight', 'Aurora']) {
      await page.locator('.topbar .theme-trigger').click();
      await page.getByRole('menuitemradio', { name: new RegExp(label, 'i') }).click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), label.toLowerCase());
      await assertNoHorizontalOverflow(`workspace ${label}`);
    }
    await page.locator('.topbar .theme-trigger').click();
    await page.getByRole('menuitemradio', { name: /Midnight/i }).click();
  });

  await t.test('mobile home, login, and dashboard have no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/', '/login', '/signup', '/pricing', '/app']) {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 8000 });
      await assertNoHorizontalOverflow(`mobile ${route}`);
    }
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.mobile-nav-toggle').click();
    await page.locator('.mobile-nav-panel').waitFor();
    const mobileMenu = await page.locator('.mobile-nav-panel').innerText();
    for (const item of PUBLIC_PAGES.filter((item) => item.path !== '/')) {
      assert.ok(mobileMenu.includes(item.label), `Mobile menu is missing ${item.label}`);
    }
    await page.locator('.mobile-nav-toggle').click();
    await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
    await page.getByText(/Good to see you/i).waitFor({ timeout: 15000 });
    await screenshot('dashboard-mobile.png', 390);
  });

  await t.test('browser reports no uncaught page errors or unexpected failed requests', async () => {
    assert.deepEqual(pageErrors, []);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/favicon\.ico|ERR_ABORTED/i.test(message));
    assert.deepEqual(unexpectedConsoleErrors, [], `Unexpected console errors. HTTP errors: ${httpErrors.join(' | ') || 'none'}`);
    const unexpectedFailedRequests = failedRequests.filter((message) => !/favicon\.ico|ERR_ABORTED/i.test(message));
    assert.deepEqual(unexpectedFailedRequests, [], `Unexpected failed requests. HTTP errors: ${httpErrors.join(' | ') || 'none'}`);
    assert.deepEqual(httpErrors, [], `Unexpected HTTP error responses: ${httpErrors.join(' | ')}`);
    console.log(JSON.stringify({
      visualQa: 'passed',
      publicPages: PUBLIC_PAGES.length,
      themes: ['midnight', 'daylight', 'aurora', 'system'],
      artifacts: [
        'test-artifacts/home-desktop.png',
        'test-artifacts/pricing-daylight.png',
        'test-artifacts/signup-aurora.png',
        'test-artifacts/login-desktop.png',
        'test-artifacts/dashboard-desktop.png',
        'test-artifacts/dashboard-mobile.png',
      ],
    }, null, 2));
  });
});
