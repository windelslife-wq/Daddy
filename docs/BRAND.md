# Brand assets

The Film Club Lens mark is an **aperture**: a lens ring, a flat-top hexagonal iris
and a cyan lens core on the product's violet gradient. It is defined exactly once,
as geometry in [`scripts/brand-assets.mjs`](../scripts/brand-assets.mjs), and every
icon, favicon and press file is rasterised from that definition.

```bash
npm run brand:assets
```

The generated files are committed, so a plain `git clone` needs no generation step.
Run the command only after changing the geometry, then commit the new binaries.

## What is generated

| File | Size | Used for |
| --- | --- | --- |
| `public/favicon.svg` | vector | `rel="icon"` in the document head |
| `public/favicon.ico` | 32 px | legacy browsers that request `/favicon.ico` |
| `public/favicon-16.png` | 16 px | first `rel="icon"` PNG fallback |
| `public/favicon-32.png` | 32 px | standard `rel="icon"` PNG fallback |
| `public/apple-touch-icon.png` | 180 px | iOS home screen (full bleed, iOS applies its own mask) |
| `public/icons/icon-192.png` | 192 px | PWA manifest, Android home screen |
| `public/icons/icon-512.png` | 512 px | PWA manifest, splash screens |
| `public/icons/icon-maskable-512.png` | 512 px | maskable icon, glyph inside the 80 % safe zone |
| `public/brand/logo-mark.svg` | vector | the badge, for any surface |
| `public/brand/logo-mark-transparent.svg` | vector | the glyph alone in white |
| `public/brand/logo-mark-violet.svg` | vector | the glyph alone in `#6e6aff` |
| `public/brand/logo-mark-1024.png` | 1024 px | decks, avatars, store listings |
| `public/brand/logo-lockup.svg` / `.png` | 1440 × 320 | horizontal lockup, dark ink on light backgrounds |
| `public/brand/logo-lockup-inverse.svg` / `.png` | 1440 × 320 | horizontal lockup for dark backgrounds |
| `public/brand/og-image.png` | 1200 × 630 | Open Graph / Twitter share card |

## Where it appears in the app

- `index.html` links the SVG favicon first, then the 32/16 px PNGs, the ICO
  fallback, the Apple touch icon, and the social card.
- `src/components/BrandMark.jsx` draws the same geometry inline for the sidebar,
  the marketing header and footer, the auth page and the sandbox consent/post
  screens. Below 24 px it uses a slightly heavier stroke, exactly like the 16 px
  favicon, so the aperture survives anti-aliasing.
- `.brand-mark` supplies the violet gradient tile. It keeps brand colours in every
  theme rather than following the theme accent.
- `/press` offers the four public downloads and the palette.

## Using the mark

- Use the files as supplied. Do not recolour, rotate, outline or add effects.
- Keep clear space of at least half the badge width on every side.
- Do not place the dark-ink lockup on a dark background — use the inverse lockup.
- Do not recolour the cyan lens core (`#42d9d0`).
- Minimum sizes: 16 px for the badge, 96 px wide for the lockup.
- Do not imply endorsement or partnership in a headline.

### Palette

| Token | Hex |
| --- | --- |
| Violet (logo) | `#8b7cff` |
| Deep violet | `#5138d8` |
| Strong violet | `#6e6aff` |
| Cyan lens core | `#42d9d0` |
| Ink | `#0b1020` |
| Night (app background) | `#070a14` |

## Verification

`tests/brand.test.js` pins the geometry across the generator, the inline component
and the document head, checks every raster size by reading the PNG header, and
validates the ICO container. `tests/visual.js` loads the built site, asserts the
head links real files, fetches each icon over HTTP, and checks that all four press
downloads render.
