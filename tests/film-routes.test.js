/** Static consistency checks for the filmmaking UI, nav and PWA shell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FILM_PAGES } from '../src/config/site.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('every film navigation destination has a real route', () => {
  const app = read('src/App.jsx');
  assert.ok(FILM_PAGES.length >= 13);
  assert.equal(new Set(FILM_PAGES.map((p) => p.path)).size, FILM_PAGES.length, 'paths must be unique');
  for (const page of FILM_PAGES) {
    const relative = page.path.replace(/^\/app\//, '');
    assert.ok(app.includes(`path="${relative}"`), `missing route for ${page.path}`);
  }
  assert.ok(app.includes('films/project/:id'), 'project workspace route missing');
});

test('every film nav icon resolves in the shared Icon component', () => {
  const icons = read('src/components/Icon.jsx');
  for (const page of FILM_PAGES) {
    assert.match(icons, new RegExp(`['"]?${page.icon}['"]?\\s*:`), `icon "${page.icon}" missing from Icon.jsx`);
  }
});

test('the film navigation is rendered in the authenticated sidebar', () => {
  const layout = read('src/components/Layout.jsx');
  assert.match(layout, /FILM_PAGES/);
  assert.match(layout, /AI Filmmaking/);
});

test('PWA manifest, icons and service worker are complete and honest', async () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/app/films');
  assert.ok(manifest.icons.length >= 3);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, 'public', icon.src.replace(/^\//, ''))), `missing ${icon.src}`);
  }
  assert.ok(manifest.shortcuts.length >= 2);
  for (const shortcut of manifest.shortcuts) {
      assert.ok(FILM_PAGES.some((p) => p.path === shortcut.url), `shortcut ${shortcut.url} has no page`);
  }
  const sw = read('public/sw.js');
  assert.match(sw, /\/api\//, 'service worker must explicitly exclude API traffic');
  assert.match(sw, /never cached|NEVER cached/i);
  const html = read('index.html');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /name="viewport"/);
  assert.match(read('src/main.jsx'), /serviceWorker\.register/);
});

test('film configuration and docs cover providers, limits and commercial terms', () => {
  const env = read('.env.example');
  for (const key of ['FILM_VIDEO_PROVIDER', 'REPLICATE_API_TOKEN', 'FAL_API_KEY', 'GOOGLE_VEO_API_KEY', 'FILM_MAX_SCENES', 'FILM_CREDIT_PER_VIDEO_SECOND']) {
    assert.ok(env.includes(key), `${key} missing from .env.example`);
  }
  const docs = read('docs/FILMMAKING.md');
  for (const phrase of ['replicate', 'fal', 'veo', 'SynthID', 'commercial', 'PWA', 'native', 'credit', 'scene-by-scene']) {
    assert.ok(docs.toLowerCase().includes(phrase.toLowerCase()), `docs should mention ${phrase}`);
  }
  const readme = read('README.md');
  assert.match(readme, /AI Filmmaking Studio/);
  assert.match(readme, /docs\/FILMMAKING\.md/);
  assert.match(readme, /not a native App Store/i);
});

test('film provider readiness is exposed in the global status report', async () => {
  process.env.NODE_ENV = 'test';
  const { providerStatus } = await import('../server/config.js');
  const status = providerStatus();
  assert.ok(status.film, 'global providerStatus must include film readiness');
  assert.ok(['none', 'replicate', 'fal', 'veo'].includes(status.film.active));
  assert.equal(typeof status.film.configured, 'boolean');
  assert.ok(status.film.maxSceneSeconds > 0);
});
