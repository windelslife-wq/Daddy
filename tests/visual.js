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
    DEMO_EMAIL: 'visual@filmclublens.local',
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
    await page.getByLabel('Email address').fill('visual-qa@filmclublens.local');
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

  await t.test('the developer API reference renders the live catalogue', async () => {
    await page.goto(base + '/developers', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('details.api-endpoint').first().waitFor({ timeout: 15000 });
    const endpointCount = await page.locator('details.api-endpoint').count();
    assert.ok(endpointCount >= 14, `expected the live API catalogue, rendered ${endpointCount} endpoints`);
    const methods = await page.locator('details.api-endpoint > summary .api-method').allTextContents();
    assert.ok(methods.includes('POST') && methods.includes('GET'), 'documented methods are rendered');
    await page.locator('details.api-endpoint').first().locator('summary').click();
    assert.equal(await page.locator('details.api-endpoint').first().evaluate((el) => el.open), true, 'endpoint details expand');
    assert.ok((await page.locator('.api-docs-main .code-shell').count()) >= 20, 'request and response samples render');
    await screenshot('api-docs-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/developers', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
    await assertNoHorizontalOverflow('mobile /developers');
    await screenshot('api-docs-mobile.png', 390);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await t.test('signup creates a real account and reaches the workspace', async () => {
    await page.goto(`${base}/signup`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Create your workspace/i }).waitFor();
    const email = `visual-signup-${Date.now()}@filmclublens.local`;
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

  await t.test('film studio locations, shot direction and QC screens work end to end', async () => {
    // Create a real project through the same API the UI uses, then drive the UI.
    const project = await page.evaluate(async () => {
      const headers = { 'content-type': 'application/json' };
      const created = await (await fetch('/api/films', {
        method: 'POST', headers,
        body: JSON.stringify({
          type: 'cinematic_scene', title: 'Visual director test', genre: 'family_drama',
          style: 'cinematic', aspectRatio: '16:9', targetPlatform: 'youtube', targetDurationSeconds: 60,
        }),
      })).json();
      await fetch(`/api/films/${created.film.id}/screenplay`, {
        method: 'POST', headers,
        body: JSON.stringify({ idea: 'A city wakes up at dawn and a family makes a choice', allowTemplate: true }),
      });
      return created.film;
    });
    assert.ok(project?.id, 'project must be created through the API');

    await page.goto(`${base}/app/films/project/${project.id}?step=locations`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Production locations/i }).waitFor({ timeout: 15000 });
    await page.locator('input[placeholder="Amara\'s apartment"]').fill('Rooftop at dawn');
    await page.locator('textarea[placeholder^="Small Lagos apartment"]').fill('Concrete rooftop, water tanks, skyline haze');
    await page.getByRole('button', { name: /Save location/i }).click();
    await page.getByText('Rooftop at dawn').first().waitFor({ timeout: 15000 });
    await screenshot('film-locations-desktop.png');
    await assertNoHorizontalOverflow('film locations');

    await page.goto(`${base}/app/films/project/${project.id}?step=scenes`, { waitUntil: 'networkidle' });
    await page.getByText(/Storyboard/i).first().waitFor({ timeout: 15000 });
    await page.getByText('Shot size').first().waitFor();
    await page.getByText('Camera angle').first().waitFor();
    await page.getByText('Colour grade').first().waitFor();
    assert.ok(await page.locator('.film-scene-card').count() > 0, 'scenes must render');
    await screenshot('film-director-desktop.png');

    await page.goto(`${base}/app/films/project/${project.id}?step=render`, { waitUntil: 'networkidle' });
    await page.getByText(/Quality control/i).first().waitFor({ timeout: 15000 });
    await page.getByText(/Every scene has a real generated clip/i).first().waitFor();
    await screenshot('film-qc-desktop.png');

    // The same three screens must fit a phone viewport without horizontal scrolling.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const step of ['locations', 'scenes', 'render']) {
      await page.goto(`${base}/app/films/project/${project.id}?step=${step}`, { waitUntil: 'networkidle' });
      await page.locator('.film-steps').waitFor({ timeout: 15000 });
      await assertNoHorizontalOverflow(`mobile film ${step}`);
    }
  });

  await t.test('the production agent writes a real screenplay then stops at the paid gate', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/app/films/agent`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /AI Production Agent/i }).waitFor({ timeout: 15000 });
    await page.locator('textarea[placeholder^="A 20-minute Nigerian family drama"]').fill(
      'A 2-minute Nigerian family drama with three main characters, set in a warm Abuja apartment and a rooftop at dusk.',
    );
    await page.getByRole('button', { name: /Start production/i }).click();
    await page.waitForURL(/\/app\/films\/agent\?film=/, { timeout: 30000 });
    await page.getByText('Generate scene clips').first().waitFor({ timeout: 20000 });

    // The free stages really ran: the screenplay, cast, locations and direction exist.
    for (const label of ['Understand the brief', 'Write the screenplay', 'Cast the characters', 'Build the locations', 'Direct every shot']) {
      await page.getByText(new RegExp(label, 'i')).first().waitFor();
    }
    const approve = page.getByRole('button', { name: /Approve scene generation/i });
    await approve.waitFor({ timeout: 15000 });
    await screenshot('film-agent-desktop.png');
    assert.ok(!(await page.getByText(/Preview & export/i).count()), 'a production without clips must not offer export');
    await assertNoHorizontalOverflow('film agent desktop');

    // Approving with no provider configured must fail honestly and stay blocked.
    await approve.click();
    await page.getByText(/Real AI video generation is not configured/i).first().waitFor({ timeout: 20000 });
    await page.getByText(/blocked at this stage/i).first().waitFor();
    assert.ok(!(await page.getByText(/Preview & export/i).count()), 'a blocked production never claims completion');
    await screenshot('film-agent-blocked-desktop.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText(/Generate scene clips/i).first().waitFor({ timeout: 15000 });
    await assertNoHorizontalOverflow('mobile film agent');
  });

  await t.test('storyboard, voice, timeline, canvas and model pages work end to end', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const project = await page.evaluate(async () => {
      const headers = { 'content-type': 'application/json' };
      const created = await (await fetch('/api/films', {
        method: 'POST', headers,
        body: JSON.stringify({
          type: 'short_drama', title: 'Visual panels test', genre: 'family_drama',
          style: 'cinematic', aspectRatio: '9:16', targetPlatform: 'tiktok', targetDurationSeconds: 30,
        }),
      })).json();
      await fetch(`/api/films/${created.film.id}/screenplay`, {
        method: 'POST', headers,
        body: JSON.stringify({ idea: 'A sister finds a letter on a rooftop at dawn', allowTemplate: true }),
      });
      return created.film;
    });
    assert.ok(project?.id, 'project must be created through the API');

    // 5. Storyboard — procedural stills are rendered and displayed.
    await page.goto(`${base}/app/films/project/${project.id}?step=storyboard`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Render missing stills/i }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Render missing stills/i }).click();
    await page.locator('.film-storyboard-card img').first().waitFor({ timeout: 45000 });
    assert.ok(await page.locator('.film-storyboard-card').count() > 0, 'storyboard cards must render');
    await screenshot('film-storyboard-desktop.png');
    await assertNoHorizontalOverflow('film storyboard');

    // 7. Voice — real local takes appear as playable audio.
    await page.goto(`${base}/app/films/project/${project.id}?step=voice`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Record missing takes/i }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Record missing takes/i }).click();
    await page.locator('audio').first().waitFor({ timeout: 45000 });
    assert.ok(await page.locator('audio').count() > 0, 'voice takes must be playable');
    await screenshot('film-voice-desktop.png');

    // 8. Timeline — a transition is applied and persisted.
    await page.goto(`${base}/app/films/project/${project.id}?step=timeline`, { waitUntil: 'networkidle' });
    await page.locator('.film-timeline-controls select').first().waitFor({ timeout: 15000 });
    await page.locator('.film-timeline-controls select').first().selectOption('fade_black');
    await page.getByRole('button', { name: /^Apply$/ }).first().click();
    await page.getByText(/applied to the next render/i).first().waitFor({ timeout: 15000 });

    // Multi-track: expand the track editor, choose a look and apply it.
    await page.locator('.film-track-editor > summary').first().click();
    await page.locator('.film-track-editor select').first().selectOption('vignette');
    await page.locator('.film-track-editor input[type="number"]').first().fill('0.5');
    await page.locator('.film-track-editor').first().getByRole('button', { name: /Apply track/i }).click();
    await page.getByText(/speed, look and overlay saved/i).first().waitFor({ timeout: 15000 });
    await screenshot('film-timeline-desktop.png');

    // 4. Creative canvas — a real flow executes through the UI.
    const flow = await page.evaluate(async (filmId) => {
      const headers = { 'content-type': 'application/json' };
      const created = await (await fetch('/api/films/flows', {
        method: 'POST', headers,
        body: JSON.stringify({
          name: 'Visual canvas', filmId,
          graph: {
            nodes: [
              { id: 'brief', type: 'text', config: { text: 'A rooftop at dawn, a sister holding a letter.' } },
              { id: 'frame', type: 'image', config: { aspectRatio: '9:16' } },
              { id: 'line', type: 'voice', config: { voice: 'nova' } },
            ],
            edges: [{ from: 'brief', to: 'frame' }, { from: 'frame', to: 'line' }],
          },
        }),
      })).json();
      return created.flow;
    }, project.id);
    assert.ok(flow?.id, 'flow must be created through the API');
    await page.goto(`${base}/app/films/canvas?flow=${flow.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Run flow/i }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Run flow/i }).click();
    await page.locator('.film-flow-result.done').first().waitFor({ timeout: 45000 });
    await page.locator('.film-flow-node img').first().waitFor({ timeout: 15000 });
    await page.locator('.film-flow-node audio').first().waitFor({ timeout: 15000 });
    await screenshot('film-canvas-desktop.png');

    // 12. Model registry — readiness comes from the server, no fake activation.
    await page.goto(`${base}/app/films/models`, { waitUntil: 'networkidle' });
    await page.getByText(/Needs a video key/i).first().waitFor({ timeout: 15000 });
    await page.getByText(/Local stills/i).first().waitFor();
    await page.getByText(/meSpeak \(local\)/i).first().waitFor();
    await screenshot('film-models-desktop.png');

    // 8. Ad Studio — brand kit form and campaign picker are real controls.
    await page.goto(`${base}/app/films/ads`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Ad & Marketing Studio/i }).waitFor({ timeout: 15000 });
    await page.getByText(/New brand kit/i).first().waitFor();
    await page.getByRole('button', { name: /Save brand kit/i }).waitFor();
    await screenshot('film-ads-desktop.png');

    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [`/app/films/project/${project.id}?step=storyboard`, `/app/films/project/${project.id}?step=voice`, `/app/films/project/${project.id}?step=timeline`, '/app/films/models', '/app/films/ads']) {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
      await assertNoHorizontalOverflow(`mobile ${route}`);
    }
  });

  await t.test('mobile home, login, and dashboard have no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/', '/login', '/signup', '/pricing', '/developers', '/app']) {
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
    const expectedConsole = httpErrors.some((line) => /^503 .*\/production\/advance$/.test(line))
      ? [/Failed to load resource: the server responded with a status of 503/i]
      : [];
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/favicon\.ico|ERR_ABORTED/i.test(message)
      && !expectedConsole.some((pattern) => pattern.test(message)));
    assert.deepEqual(unexpectedConsoleErrors, [], `Unexpected console errors. HTTP errors: ${httpErrors.join(' | ') || 'none'}`);
    const unexpectedFailedRequests = failedRequests.filter((message) => !/favicon\.ico|ERR_ABORTED/i.test(message));
    assert.deepEqual(unexpectedFailedRequests, [], `Unexpected failed requests. HTTP errors: ${httpErrors.join(' | ') || 'none'}`);
    // The production-agent test deliberately approves generation without a provider:
    // the server rejects that with a documented 503 instead of fabricating a clip.
    const honestRejections = [/^503 .*\/production\/advance$/];
    const unexpectedHttpErrors = httpErrors.filter((line) => !honestRejections.some((pattern) => pattern.test(line)));
    assert.deepEqual(unexpectedHttpErrors, [], `Unexpected HTTP error responses: ${httpErrors.join(' | ')}`);
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
