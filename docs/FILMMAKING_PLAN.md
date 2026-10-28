# AI Filmmaking Platform — Implementation Plan

**Project:** Faceless Studio → AI Filmmaking Studio
**Scope:** Short drama, long drama, episodic series, and movie production in one
unified platform (Web, Android, iOS).
**Status of this document:** original architecture + phased plan, kept for
design history. **Phase 1 is now implemented.** For current, authoritative
setup instructions, provider configuration, generation limits, credit
accounting, commercial-use notes, the API reference and PWA/mobile scope, see
[docs/FILMMAKING.md](FILMMAKING.md).

---

## 1. Audit of the existing codebase

The repository is **not a demo**. It is a working full-stack application:

| Layer | Existing capability we extend |
|---|---|
| API | Express 4, session auth, RBAC, zod validation, same-origin guard, rate limiting, structured errors, audit log |
| Data | Knex over SQLite (dev) / PostgreSQL (prod), 21 tables, plans/settings/usage quotas, encrypted OAuth credentials |
| Jobs | Durable `jobs` table with conditional claims, stale-job recovery, retries/backoff, multi-process safe (pg-mem test) |
| AI | `callLLM` (OpenAI / Anthropic / Gemini), research adapters, structured `planSchema`, `local` template engine |
| Media | Scene images (procedural SVG / OpenAI / Replicate), TTS (mespeak / OpenAI / ElevenLabs), procedural music, SRT, FFmpeg H.264/AAC render, thumbnails, platform variants |
| Publishing | Sandbox + official Meta / Instagram / YouTube / X adapters, metrics, scheduling |
| Frontend | React 18 + Vite, responsive dashboard, 4 themes, shared UI kit, route-driven nav from `src/config/site.js` |
| Activation | 15-module registry, offline preflight, live credential verification, completion audit (95 tests) |

**Decision:** extend, do not replace. New film tables live beside the existing
`projects`/`posts`/`publications` tables. The existing worker, `addJob`,
`checkQuota`, `ffmpeg`, TTS, SRT, and signed-media code are reused. The existing
faceless-video workflow remains untouched and its tests still pass.

### Gaps found

1. No drama data model — no characters, dialogue, story bible, episodes, or timelines.
2. No AI **video** generation — only still images + TTS + slideshow render.
3. No credit economy — only monthly quotas; no pre-job cost estimate, reservation, or refund.
4. No per-scene regenerate / staged generation for long projects.
5. No film workspace UI; no installable mobile experience (web app is responsive but not a PWA).

---

## 2. Target architecture

```text
Idea / reference image
        │
        ▼
FilmProject (short_drama | long_drama | movie | episode)
        │  screenplay (LLM or labelled template draft)
        ▼
Characters (appearance prompt + reference image + voice preset)   ◄── reusable library
        │
        ▼
FilmScene[] (ordinal, location, camera, dialogue[], visual prompt, duration)
        │  one durable job per scene  →  real AI video provider (Replicate / Fal / Veo)
        ▼
Scene clips (MP4 in secure storage)  ── per-scene dialogue TTS + SRT
        │
        ▼
Assembly job (FFmpeg concat + subtitles + music) → final MP4 + thumbnail
        │
        ▼
Preview · download · publish through the existing publishing adapters
```

Series are `film_series` → `film_episodes` → `film_projects`, so an episode is a
normal film project with a continuity link. A story bible and recurring
characters are passed into each new episode's screenplay prompt.

### New tables

`film_projects`, `film_characters`, `film_scenes`, `film_series`,
`film_episodes`, `credit_accounts`, `credit_ledger`.

### New server modules

| File | Responsibility |
|---|---|
| `server/film/credits.js` | Balance, estimate, idempotent reserve/refund/grant, ledger |
| `server/film/screenplay.js` | Structured story/screenplay/scene breakdown with continuity |
| `server/film/videoProviders.js` | Real async AI-video adapters + provider capability matrix |
| `server/film/scenes.js` | Per-scene generation, regeneration, reorder, status |
| `server/film/assembly.js` | FFmpeg assembly into a playable MP4 |
| `server/film/series.js` | Series, seasons, episodes, continuity |
| `server/routes/films.js` | REST API (auth + ownership + zod) |
| `server/worker.js` | `film_generate_scene`, `film_assemble` handlers |

---

## 3. Real AI providers — capabilities, limits, commercial terms

> **Hard rule:** production code never fabricates a video, a URL, or a progress
> percentage. If a provider is not configured, scene generation fails with
> `video_provider_not_configured` and the reserved credits are refunded. Tests
> use an injected HTTP double; that double exists only inside the test suite and
> is never used by a running server.

| Provider | Endpoint family | Typical max clip | Notes / commercial use |
|---|---|---|---|
| **Replicate** | `POST /v1/models/{model}/predictions`, `GET /v1/predictions/{id}` | 5–10 s per generation (model-dependent) | Pay-per-second prediction billing. Model licences vary — check each model page (e.g. Kling, Minimax, Wan) for commercial-use rights. Requires `REPLICATE_API_TOKEN`. |
| **Fal.ai** | `POST https://queue.fal.run/{model}`, `GET /queue/requests/{id}/status`, `GET /queue/requests/{id}` | 5–10 s | Queue-based async; per-output billing. Model-specific licences. Requires `FAL_API_KEY`. |
| **Google Veo** | `POST ...:predictLongRunning`, `GET /v1beta/{operation}` | 4–8 s | Requires a Google Cloud project with Veo access and often an allowlist. Generated video may carry SynthID watermarking. Requires `GOOGLE_VEO_API_KEY` (or `GEMINI_API_KEY`). |
| Scripts / dialogue | OpenAI, Anthropic, Gemini via existing `callLLM` | n/a | Existing provider terms apply. |
| Voices | mespeak (offline), OpenAI TTS, ElevenLabs | n/a | ElevenLabs/OpenAI commercial terms are governed by your own account tier. |
| Reference images | OpenAI Images / Replicate (existing), or user upload | n/a | Uploaded reference images must be rights-cleared by the user. |

**Generation limits are enforced in code:** `FILM_MAX_SCENE_SECONDS` (default 10),
`FILM_MAX_SCENES` (default 120), `FILM_MAX_PROJECT_SECONDS` (default 3600), and
`FILM_MAX_REFERENCE_IMAGE_MB` (default 10). A long movie is therefore produced
by **many short clips assembled into one timeline** — never by one request. The
API returns an explicit `estimatedScenes` count and a warning when the requested
duration exceeds what a single provider clip can deliver.

**Lip-sync** is provider/model dependent. The platform marks it as
`supported: false` unless the configured model declares it; it never claims a
lip-synced result it did not produce.

---

## 4. Credit & cost accounting

- `credit_accounts` holds a balance; `credit_ledger` is append-only with a
  **unique idempotency key** so retries cannot double-charge.
- `POST /api/films/estimate` returns a full breakdown **before** any job starts:
  video credits (per second × provider rate), TTS credits (per 1k chars),
  assembly credits, and the user's current balance.
- Scene generation **reserves** credits atomically. On final failure the worker
  **refunds** them. Regenerating one scene charges only that scene.
- Progress is reported as discrete real stages (`queued`, `submitting`,
  `provider_processing`, `downloading`, `completed`, `failed`) — never a fake
  percentage.

---

## 5. Web, Android and iOS

The app is a responsive React SPA. This change adds:

- a **PWA manifest + service worker** (`public/manifest.webmanifest`,
  `public/sw.js`) so it is installable on Android (Chrome) and iOS (Safari,
  Add to Home Screen) with a standalone display, theme colour and icon;
- responsive film workspace with touch-friendly controls, no horizontal
  overflow (covered by the existing `npm run test:visual` overflow checks);
- API calls are all relative same-origin URLs, so the installed app works
  through the same proxy as the website.

**Honest limitation:** these are installable **web** apps, not native
Android/iOS binaries. Shipping to the stores requires a Capacitor/React Native
wrapper, native signing, and store review — a separate phase. No native project
is generated here, and no store build is claimed.

---

## 6. Phased delivery

| Phase | Content | State |
|---|---|---|
| **1 (this change)** | Audit + plan; film schema; credits; screenplay with continuity; characters; scenes; series/episodes; real Replicate/Fal/Veo adapters; per-scene jobs; FFmpeg assembly; full REST API; film workspace UI with all requested sections; PWA; tests; provider/config docs | **Implemented** |
| 2 | Configure real provider credentials, run live generation + assembly smoke test, tune model IDs and rates | Requires your API keys |
| 3 | Character reference-image training / identity fine-tuning, provider-side lip-sync, SFX library, non-linear timeline transitions | Requires paid services |
| 4 | Native Android/iOS wrappers (Capacitor), store builds, push notifications | Requires native toolchains + store accounts |

---

## 7. Acceptance criteria — how to verify

| Criterion | Verification |
|---|---|
| Create a short drama | `POST /api/films` → `POST /api/films/:id/screenplay` → scenes created; UI wizard |
| Create a longer multi-scene drama | `targetDurationSeconds` drives `estimatedScenes`; `FILM_MAX_SCENES` guard; per-scene jobs |
| Save and continue a series | `film_series` / `film_episodes`; `POST /api/films/series/:id/episodes` reuses story bible + characters; all state in DB |
| Generate real AI video clips | `POST /api/films/:id/scenes/:sceneId/generate` → real provider HTTP call; fails honestly when unconfigured; no fabricated output |
| Assemble scenes | `POST /api/films/:id/assemble` → FFmpeg concat + SRT + audio → playable MP4 |
| Export playable video | `GET /api/films/:id/download` streams signed media; file verified by size/header |
| Web + mobile | `npm run test:visual` (desktop + mobile overflow/console errors); PWA manifest + SW |

**Sandbox limitation:** this environment can only reach `github.com`,
`codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`, and
`files.pythonhosted.org`. Live calls to Replicate/Fal/Veo/OpenAI therefore cannot
be executed from here. The adapters are contract-tested against an injected HTTP
double; a live smoke test must be run on a host with egress and valid keys
(`npm run setup -- --verify` plus a real scene generation).
