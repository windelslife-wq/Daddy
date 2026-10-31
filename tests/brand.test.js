/**
 * Brand identity checks.
 *
 * The logo exists in four places that must never disagree: the vector sources in
 * `public/brand`, the rasterised favicon/PWA icons, the `index.html` head, and the
 * inline `BrandMark` component used in the app chrome. These tests pin the geometry
 * to one definition and fail if any surface drifts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

/** Read width/height straight out of the PNG IHDR chunk — no image library needed. */
function pngSize(file) {
  const buffer = fs.readFileSync(path.join(root, file));
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('logo and icon files exist at their conventional paths', () => {
  const expected = {
    'public/favicon.svg': null,
    'public/favicon.ico': null,
    'public/favicon-16.png': 16,
    'public/favicon-32.png': 32,
    'public/apple-touch-icon.png': 180,
    'public/icons/icon-192.png': 192,
    'public/icons/icon-512.png': 512,
    'public/icons/icon-maskable-512.png': 512,
    'public/brand/logo-mark.svg': null,
    'public/brand/logo-mark-transparent.svg': null,
    'public/brand/logo-mark-violet.svg': null,
    'public/brand/logo-mark-1024.png': 1024,
    'public/brand/logo-lockup.svg': null,
    'public/brand/logo-lockup-inverse.svg': null,
    'public/brand/logo-lockup.png': null,
    'public/brand/logo-lockup-inverse.png': null,
    'public/brand/og-image.png': null,
  };
  for (const [file, size] of Object.entries(expected)) {
    assert.ok(exists(file), `${file} is missing — run npm run brand:assets`);
    if (size) {
      const actual = pngSize(file);
      assert.equal(actual.width, size, `${file} should be ${size}px wide`);
      assert.equal(actual.height, size, `${file} should be ${size}px tall`);
    }
  }
  assert.deepEqual(pngSize('public/brand/logo-lockup.png'), { width: 1440, height: 320 });
  assert.deepEqual(pngSize('public/brand/logo-lockup-inverse.png'), { width: 1440, height: 320 });
  assert.deepEqual(pngSize('public/brand/og-image.png'), { width: 1200, height: 630 });
});

test('favicon.ico is a valid single-image icon container', () => {
  const buffer = fs.readFileSync(path.join(root, 'public/favicon.ico'));
  assert.equal(buffer.readUInt16LE(0), 0, 'reserved header field');
  assert.equal(buffer.readUInt16LE(2), 1, 'icon type');
  assert.equal(buffer.readUInt16LE(4), 1, 'image count');
  assert.equal(buffer.readUInt8(6), 32, 'icon width');
  assert.equal(buffer.readUInt32LE(18), 22, 'payload offset');
  assert.equal(buffer.readUInt32LE(14), buffer.length - 22, 'declared payload length');
});

test('the vector mark carries the aperture geometry in brand colours', () => {
  const badge = read('public/favicon.svg');
  assert.match(badge, /viewBox="0 0 64 64"/);
  assert.match(badge, /#8b7cff/, 'violet gradient start');
  assert.match(badge, /#5138d8/, 'deep violet gradient end');
  assert.match(badge, /#42d9d0/, 'cyan lens core');
  assert.match(badge, /<path d="M/, 'hexagonal iris is drawn as a path');
  assert.match(badge, /stroke-linejoin="round"/);

  const lockup = read('public/brand/logo-lockup-inverse.svg');
  assert.match(lockup, /Film Club Lens/);
  assert.match(lockup, /CREATE ONCE\. PUBLISH EVERYWHERE\./);
  assert.match(read('public/brand/logo-lockup.svg'), /Film Club Lens/);
});

test('the inline BrandMark mirrors the generated favicon geometry', () => {
  const component = read('src/components/BrandMark.jsx');
  const script = read('scripts/brand-assets.mjs');
  for (const value of ['16.4', '3.6', '8.1', '3.2', '3.5']) {
    assert.ok(component.includes(value), `BrandMark is missing geometry value ${value}`);
    assert.ok(script.includes(value), `brand-assets.mjs is missing geometry value ${value}`);
  }
  assert.match(component, /#42d9d0/);
  assert.match(script, /#42d9d0/);
  // The small-size stroke override must stay in step between the two definitions.
  assert.match(component, /16\.6/);
  assert.match(script, /16\.6/);
  assert.ok(read('package.json').includes('"brand:assets": "node scripts/brand-assets.mjs"'));
});

test('the document head links real icon files instead of an inline data URI', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<link rel="icon"[^>]*href="data:/, 'inline data-URI favicon must be removed');
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon.svg"/);
  assert.match(html, /sizes="32x32" href="\/favicon-32\.png"/);
  assert.match(html, /sizes="16x16" href="\/favicon-16\.png"/);
  assert.match(html, /href="\/favicon\.ico"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
  assert.match(html, /property="og:image" content="https:\/\/filmclublens\.com\/brand\/og-image\.png"/);

  const referenced = [...html.matchAll(/(?:href|content)="\/((?:brand|icons)\/[^"]+|favicon[^"]*|apple-touch-icon\.png)"/g)]
    .map((match) => match[1]);
  assert.ok(referenced.length >= 5, 'head should reference the whole icon set');
  for (const file of referenced) {
    assert.ok(exists(path.join('public', file)), `index.html references missing file /${file}`);
  }
});

test('every brand mark in the app chrome renders the logo, not a generic glyph', () => {
  const files = [
    'src/components/Layout.jsx',
    'src/components/PublicLayout.jsx',
    'src/components/Footer.jsx',
    'src/pages/AuthPage.jsx',
    'src/pages/SandboxConsent.jsx',
    'src/pages/SandboxPost.jsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /BrandMark/, `${file} should import BrandMark`);
    for (const line of source.split('\n').filter((item) => item.includes('"brand-mark"'))) {
      assert.match(line, /<BrandMark/, `${file} still renders a placeholder inside .brand-mark: ${line.trim()}`);
    }
  }
});

test('the press page offers downloadable brand assets', () => {
  const press = read('src/pages/public/Resources.jsx');
  assert.match(press, /Brand assets/);
  for (const file of ['logo-mark.svg', 'logo-lockup-inverse.svg', 'logo-mark-1024.png', 'og-image.png']) {
    assert.ok(press.includes(`/brand/${file}`), `press page should link /brand/${file}`);
  }
  const css = read('src/styles.css');
  for (const rule of ['.brand-kit-grid', '.brand-kit-card', '.brand-kit-preview']) {
    assert.ok(css.includes(rule), `missing ${rule} styles`);
  }
});
