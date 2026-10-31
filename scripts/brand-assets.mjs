/**
 * Brand asset generator for Film Club Lens.
 *
 * The mark is an aperture: an outer lens ring, a flat-top iris and a cyan lens core
 * in the product's violet gradient. It is defined once here as geometry, then
 * rasterised for the favicon, PWA icons and press kits, so every size is consistent.
 *
 *   npm run brand:assets
 *
 * Outputs (all committed, so a plain `git clone` needs no generation step):
 *   public/favicon.svg, favicon.ico, favicon-16.png, favicon-32.png, apple-touch-icon.png
 *   public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
 *   public/brand/logo-mark.svg, logo-mark-1024.png, logo-mark-transparent.svg
 *   public/brand/logo-mark-violet.svg, logo-lockup.svg, logo-lockup-inverse.svg
 *   public/brand/logo-lockup.png, logo-lockup-inverse.png, og-image.png
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(root, 'public');
const BRAND = path.join(PUBLIC, 'brand');
const ICONS = path.join(PUBLIC, 'icons');

const INK = '#0b1020';
const PRIMARY = '#8b7cff';
const PRIMARY_DEEP = '#5138d8';
const PRIMARY_STRONG = '#6e6aff';
const PRIMARY_SOFT = '#a99dff';
const CYAN = '#42d9d0';

/** Flat-top hexagon path, radius r around (32, 32). */
function hexPath(r) {
  const points = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index);
    points.push([32 + r * Math.cos(angle), 32 + r * Math.sin(angle)]);
  }
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`;
}

/**
 * The aperture, drawn in whatever colour the surrounding context provides.
 *
 * `compact` thickens every stroke by ~25% for 16–32 px renders, where hairlines
 * disappear into anti-aliasing and the iris would otherwise blur into the ring.
 * It is the same geometry, just sized for pixels.
 */
function glyph({ stroke = 'currentColor', core = CYAN, ring = 16.4, iris = 8.1, compact = false } = {}) {
  if (compact) {
    return `<circle cx="32" cy="32" r="16.6" fill="none" stroke="${stroke}" stroke-width="4.6"/>
  <path d="${hexPath(8.6)}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="4" fill="${core}"/>`;
  }
  return `<circle cx="32" cy="32" r="${ring}" fill="none" stroke="${stroke}" stroke-width="3.6"/>
  <path d="${hexPath(iris)}" fill="none" stroke="${stroke}" stroke-width="3.2" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="3.5" fill="${core}"/>`;
}

const gradientDefs = (id = 'badge') => `<linearGradient id="${id}" x1="4" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse">
    <stop stop-color="${PRIMARY}"/><stop offset="1" stop-color="${PRIMARY_DEEP}"/>
  </linearGradient>
  <radialGradient id="sheen" cx="16" cy="10" r="36" gradientUnits="userSpaceOnUse">
    <stop stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>`;

/** Square badge (app icon, favicon, social avatar). radius 0 = full bleed. */
function badgeSvg({ radius = 15, scale = 1, compact = false, background = true } = {}) {
  const inner = scale === 1 ? glyph({ stroke: '#ffffff', compact })
    : `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${glyph({ stroke: '#ffffff', compact })}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>${gradientDefs()}</defs>
  <rect width="64" height="64" rx="${radius}" fill="url(#badge)"/>
  ${background ? '' : ''}<rect width="64" height="64" rx="${radius}" fill="url(#sheen)"/>
  ${inner}
</svg>`;
}

/** Glyph only — for placing on an existing surface without the badge. */
function glyphSvg({ stroke, core, background = 'none' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  ${background !== 'none' ? `<rect width="64" height="64" rx="15" fill="${background}"/>` : ''}
  ${glyph({ stroke, core })}
</svg>`;
}

/** Horizontal lockup: badge + wordmark + tagline. */
function lockupSvg({ dark = false } = {}) {
  const name = dark ? '#ffffff' : INK;
  const tagline = dark ? PRIMARY_SOFT : PRIMARY_STRONG;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" width="720" height="160">
  <defs>${gradientDefs()}</defs>
  <g transform="translate(12 32)">
    <rect width="96" height="96" rx="22.5" fill="url(#badge)"/>
    <rect width="96" height="96" rx="22.5" fill="url(#sheen)"/>
    <g transform="translate(0 0) scale(1.5)">${glyph({ stroke: '#ffffff' })}</g>
  </g>
  <text x="132" y="88" fill="${name}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="46" font-weight="700" letter-spacing="-1.4">Film Club Lens</text>
  <text x="134" y="119" fill="${tagline}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="15" font-weight="600" letter-spacing="3.1">CREATE ONCE. PUBLISH EVERYWHERE.</text>
</svg>`;
}

/** Single-image ICO wrapping the 32 px PNG — legacy browsers still ask for /favicon.ico. */
async function ico(pngBuffer, size = 32) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  header.writeUInt8(size, 6); // width
  header.writeUInt8(size, 7); // height
  header.writeUInt8(0, 8); // palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(22, 18); // payload offset
  return Buffer.concat([header, pngBuffer]);
}

/** 1200×630 social card: the inverse lockup on the product's deep navy. */
async function writeSocialCard(file) {
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <radialGradient id="glow" cx="600" cy="300" r="540" gradientUnits="userSpaceOnUse">
      <stop stop-color="${PRIMARY}" stop-opacity=".4"/>
      <stop offset=".55" stop-color="${PRIMARY_DEEP}" stop-opacity=".18"/>
      <stop offset="1" stop-color="#070a14" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#070a14"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x=".5" y=".5" width="1199" height="629" fill="none" stroke="${PRIMARY}" stroke-opacity=".18"/>
</svg>`);
  const mark = await sharp(Buffer.from(lockupSvg({ dark: true }))).resize({ width: 860 }).png().toBuffer();
  await sharp(backdrop).composite([{ input: mark, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(file);
  return `${path.relative(root, file)} 1200×630`;
}

async function write(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

async function raster(svg, size, file, { height } = {}) {
  const image = sharp(Buffer.from(svg)).resize(size, height || size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await image.png({ compressionLevel: 9 }).toFile(file);
  const meta = await sharp(file).metadata();
  return `${path.relative(root, file)} ${meta.width}×${meta.height}`;
}

async function main() {
  const report = [];

  // --- vector sources -------------------------------------------------------
  const badge = badgeSvg();
  await write(path.join(PUBLIC, 'favicon.svg'), badge);
  await write(path.join(BRAND, 'logo-mark.svg'), badge);
  await write(path.join(BRAND, 'logo-mark-transparent.svg'), glyphSvg({ stroke: '#ffffff' }));
  await write(path.join(BRAND, 'logo-mark-violet.svg'), glyphSvg({ stroke: PRIMARY_STRONG }));
  await write(path.join(BRAND, 'logo-lockup.svg'), lockupSvg({ dark: false }));
  await write(path.join(BRAND, 'logo-lockup-inverse.svg'), lockupSvg({ dark: true }));
  report.push('public/favicon.svg', 'public/brand/logo-mark.svg', 'public/brand/logo-mark-transparent.svg',
    'public/brand/logo-mark-violet.svg', 'public/brand/logo-lockup.svg', 'public/brand/logo-lockup-inverse.svg');

  // --- favicons and PWA icons ----------------------------------------------
  // At 16 px the hairlines need the compact stroke weight or the iris dissolves;
  // from 32 px up the standard geometry keeps its hexagonal silhouette.
  const tinyBadge = badgeSvg({ compact: true });
  report.push(await raster(tinyBadge, 16, path.join(PUBLIC, 'favicon-16.png')));
  report.push(await raster(badge, 32, path.join(PUBLIC, 'favicon-32.png')));
  const png32 = await sharp(Buffer.from(tinyBadge)).resize(32, 32).png().toBuffer();
  await write(path.join(PUBLIC, 'favicon.ico'), await ico(png32));
  report.push('public/favicon.ico 32×32');
  // iOS applies its own mask, so this one is a full-bleed square.
  report.push(await raster(badgeSvg({ radius: 0 }), 180, path.join(PUBLIC, 'apple-touch-icon.png')));
  report.push(await raster(badge, 192, path.join(ICONS, 'icon-192.png')));
  report.push(await raster(badge, 512, path.join(ICONS, 'icon-512.png')));
  // Maskable icons need the mark inside the 80% safe zone.
  report.push(await raster(badgeSvg({ radius: 0, scale: 0.62 }), 512, path.join(ICONS, 'icon-maskable-512.png')));

  // --- press kit rasters ----------------------------------------------------
  report.push(await raster(badge, 1024, path.join(BRAND, 'logo-mark-1024.png')));
  report.push(await raster(lockupSvg({ dark: false }), 1440, path.join(BRAND, 'logo-lockup.png'), { height: 320 }));
  report.push(await raster(lockupSvg({ dark: true }), 1440, path.join(BRAND, 'logo-lockup-inverse.png'), { height: 320 }));
  report.push(await writeSocialCard(path.join(BRAND, 'og-image.png')));

  console.log(`Brand assets written (${report.length} files):`);
  for (const line of report) console.log('  ' + line);
}

await main();
