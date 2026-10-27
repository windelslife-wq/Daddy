# Faceless Studio

A full-stack, production-oriented AI **faceless video creation and social media automation** platform. It creates original short-form videos from a niche or custom topic, renders a real MP4, generates narration/captions/music/thumbnails, schedules platform-specific posts, publishes through official APIs when configured, retries safely, and measures results.

This is **not a clickable UI demo**. The local preview works end to end without paid services: a persistent job worker generates scripts, original procedural scene art, local TTS, SRT subtitles, an FFmpeg-rendered H.264/AAC MP4, a thumbnail, platform captions, and a post to a built-in local HTTP sandbox publisher. Official Facebook, Instagram, YouTube, and X publishing adapters are implemented and **activate only when valid server credentials are configured**.

---

## What works out of the box

| Capability | Local behavior |
|---|---|
| AI script, hook, scenes, visual prompts, captions, hashtags | Built-in multilingual original outline engine (`AI_PROVIDER=local`) |
| Visual styles | Comic, creepy comic, modern cartoon, cinematic, animated, 3D via original procedural SVG art |
| Narration | Offline `mespeak` TTS with 10 language voice files and voice presets |
| Music | Original procedural ambient soundtrack generated locally |
| Captions | Burned-in caption frames plus downloadable `.srt` subtitle files |
| Editing / rendering | FFmpeg via `@ffmpeg-installer/ffmpeg`; H.264 `yuv420p` MP4 + AAC audio |
| Thumbnails | Sharp-generated JPEG thumbnails |
| Publishing test | Built-in **Sandbox** account and authenticated local HTTP publisher |
| Scheduling / autopilot | Daily, weekly, custom cron, per-niche daily limits, review gates, retry jobs |
| Metrics | Official adapters where available; sandbox metrics are explicitly labeled simulated |
| Auth / security | Sessions, scrypt hashes, encrypted OAuth credentials, RBAC, quotas, same-origin checks |
| Billing | Real server-side plan limits; Stripe checkout only when configured |
| Frontend | Responsive React dashboard, studio, calendar, publishing, analytics, admin, settings |

---

## Quick start

Requirements: Node.js 22+, npm. No system FFmpeg or espeak is required; npm packages provide them.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:8787`.

Preview credentials seeded in development:

```text
Creator: creator@faceless.local / StudioDemo2026!
Admin:   admin@faceless.local   / AdminStudio2026!
```

> Change or disable seeded accounts before exposing a deployment. Set `SEED_DEMO=false` and provide `ADMIN_EMAIL` / `ADMIN_PASSWORD` deliberately.

Production-style single-process start (builds the frontend first):

```bash
npm run build
npm start
```

For a multi-process deployment, run one or more dedicated workers with the same database and `WORKER_ENABLED=true`; use PostgreSQL via `DATABASE_URL`.

---

## Test the entire workflow

```bash
npm test          # unit tests: crypto, AI plans, media helpers, WAV, scheduler
npm run test:e2e  # full workflow test on an isolated SQLite DB and port
```

The end-to-end test starts its own server and worker, verifies:

1. registration, session cookie, provider status, and explicit OAuth configuration errors;
2. sandbox OAuth connect → consent → callback → encrypted credentials;
3. daily/weekly/custom schedule calculation;
4. AI script → scenes → procedural images → local TTS → SRT → real MP4 render;
5. automatic publishing to the sandbox channel;
6. review → schedule → approval → delayed publishing;
7. signed public media URLs and range-streamed video;
8. duplicate-post prevention using a stable `Ref:` code and a unique constraint;
9. metrics sync, baseline recommendations, calendar, settings, billing config errors;
10. admin endpoints and audit logs;
11. account toggles, verification, and secure disconnect.

The E2E test uses temporary data and storage directories and removes them afterward.

---

## External services and credentials

**No secret is ever placed in frontend code.** All API keys are read from server environment variables (see `.env.example`). The Admin → Integrations screen reports configuration status and required variable names but never displays secret values.

### AI and media providers

| Feature | Local default | Optional external providers | Required environment |
|---|---|---|---|
| Script / metadata | `local` | OpenAI, Anthropic, Gemini | `AI_PROVIDER` + `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` |
| Research sources | `none` | Brave, Tavily | `SEARCH_PROVIDER` + `SEARCH_API_KEY` |
| Scene images | `procedural` | OpenAI Images, Replicate | `IMAGE_PROVIDER` + `OPENAI_API_KEY` or `REPLICATE_API_TOKEN` |
| Voice-over | `mespeak` | OpenAI TTS, ElevenLabs | `TTS_PROVIDER` + `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` |
| Music | procedural | — | none |
| Rendering | bundled FFmpeg | system FFmpeg | optional `FFMPEG_PATH` |

If an external script provider is selected but fails, generation fails with a clear `ai_provider_error`; it does **not** silently claim AI success. Local generation uses original templates and avoids unverified factual claims. External AI/image/TTS usage may incur provider charges.

### Official social publishing

| Platform | OAuth path | Required server variables | Account requirements |
|---|---|---|---|
| Facebook Pages | `/api/oauth/facebook/connect` | `META_APP_ID`, `META_APP_SECRET` | Manageable Facebook Page, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`; app review / Business Verification may be required |
| Instagram Reels | same Meta flow | `META_APP_ID`, `META_APP_SECRET`, public HTTPS `PUBLIC_BASE_URL` | Professional/Business Instagram account linked to a selected Facebook Page; `instagram_business_basic`, `instagram_business_content_publish`; public HTTPS media URL |
| YouTube | `/api/oauth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube Data API v3 enabled, OAuth consent screen/test users, `youtube.upload` scope, sufficient API quota |
| X | `/api/oauth/x/connect` | `X_CONSUMER_KEY`, `X_CONSUMER_SECRET` | OAuth 1.0a user context, read/write app permissions, API tier allowing media upload and tweet creation |
| Sandbox | `/api/oauth/sandbox/connect` | none | Built-in local HTTP publisher; **not an external social network** |

OAuth callback URLs to whitelist:

```text
{PUBLIC_BASE_URL}/api/oauth/facebook/callback
{PUBLIC_BASE_URL}/api/oauth/google/callback
{PUBLIC_BASE_URL}/api/oauth/x/callback
```

`PUBLIC_BASE_URL` must be a public HTTPS origin for real OAuth and Instagram. Instagram’s container API needs to download the video from an HMAC-signed public media URL; the platform refuses to pretend an `http://localhost` URL is sufficient.

Official docs used for the adapters:

- Meta: https://developers.facebook.com/docs/video-api/guides/publishing/ and https://developers.facebook.com/docs/instagram-api/guides/video-publishing/
- YouTube: https://developers.google.com/youtube/v3/docs/videos/insert
- X: https://developer.x.com/en/docs/x-api/v1/media/upload-media/uploading-media/media-best-practices
- Stripe: https://docs.stripe.com/api/checkout/sessions

### Billing, email, and webhooks

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: enable paid subscription checkout and signed webhooks.
- Each paid plan needs a real Stripe `price_...` ID in Admin → Plans. Without it, checkout returns `stripe_price_missing`; no fake charge is attempted.
- `SMTP_URL` enables email notification delivery. `NOTIFICATION_WEBHOOK_URL` posts notification events to your webhook. In-app notifications work without either.

---

## Using the platform

### 1. Connect an account

Open **Accounts → Connect sandbox channel** for a credential-free end-to-end test. The consent screen creates an encrypted random bearer token and a local HTTP channel. For official accounts, configure environment variables first, then use the matching Connect button and provider OAuth consent flow.

The account list shows status, scopes, token expiry, active/autopilot toggles, a real **Test** button that calls the provider verification endpoint, and **Disconnect** which clears stored encrypted tokens immediately. Google and Meta revocation is attempted where the official API supports it; otherwise revoke app access in the provider’s security settings.

### 2. Create a video

**AI Studio** is a four-step wizard:

1. niche or custom niche, topic, tone, research mode;
2. style, language, voice, aspect ratio, duration, captions, music;
3. platforms, publish now / schedule / draft, review gate;
4. review all inputs and provider status, then create.

A 202 response means the long-running job is queued. The project detail page polls live stages, plays the MP4, shows burned-in captions/SRT, scene art prompts, research sources, provider logs, and platform captions.

### 3. Review, schedule, publish

- **Review required**: post stays `needs_review`; publications are `pending_review` until approved.
- **Full autopilot**: after rendering completes, publications are queued for the scheduled time.
- **Scheduler**: daily, weekly, and cron schedules create autopilot jobs for niches with daily posting limits.
- **Publishing**: shows per-account status, errors, retry attempts, reference codes, remote links, skip, refresh accounts, and delete-draft actions.
- **Calendar**: month view of scheduled, published, and failed posts.
- **Retries**: exponential backoff, max attempts, expired-token detection, rate-limit handling, and clear failure reasons.

Duplicate prevention is enforced at several layers: unique `publications.idempotency_key`, unique `(post_id, account_id)`, unique `jobs.dedupe_key`, a conditional publication claim, and a short `Ref:` marker in published descriptions/captions. Sandbox and Meta/X adapters also check for existing posts before publishing.

### 4. Analytics

**Analytics** shows real metrics returned by official APIs. Sandbox metrics are deterministic and explicitly labeled simulated; they are excluded from data-backed recommendations. The recommendations worker uses measured official metrics when at least three snapshots are available; otherwise it provides clearly labeled baseline guidance. Optional LLM recommendations activate only when an external AI provider is configured.

### 5. Admin

Log in as the seeded admin and open **Admin** to manage:

- users, roles, plans, and account status;
- plan quotas and Stripe Price IDs;
- global settings: signups, maintenance mode, review defaults, autopilot, retry limits, metrics interval, supported languages/platforms, content policy;
- background jobs (retry/cancel), publishing failures, audit logs, and provider readiness;
- in-app broadcast notifications and cleanup jobs.

Secrets remain environment-only; the admin UI cannot read or write API keys.

---

## Architecture

```text
React + Vite dashboard  ──same-origin cookies──> Express API
                                               ├── Auth / RBAC / quotas
                                               ├── OAuth routers (server-side secrets)
                                               ├── Project/post/publication services
                                               ├── Persistent worker + scheduler
                                               ├── AI orchestration + research
                                               ├── Procedural/AI images + TTS + music
                                               ├── FFmpeg renderer + platform variants
                                               ├── Official publisher adapters
                                               └── Knex → SQLite or PostgreSQL
```

Key implementation details:

- `server/config.js`: environment-driven provider and OAuth configuration, `providerStatus()`, production warnings.
- `server/db.js`: schema, plans, settings, quotas, usage, jobs, notifications, audit, sandbox storage.
- `server/security.js`: scrypt hashes, AES-256-GCM credentials, HMAC signed media/view tokens, redaction.
- `server/ai.js`: local multilingual content engine, LLM adapters, research adapters, recommendations prompt.
- `server/media/*`: original SVG scene generator, external image providers, TTS, procedural music, SRT, FFmpeg render, signed media URLs, platform variants.
- `server/publishers/*`: sandbox, Meta/Facebook/Instagram, YouTube, X adapters, token refresh, metrics, duplicate recovery.
- `server/worker.js`: persistent job worker with conditional claims, stale recovery, retries, scheduler ticks.
- `server/oauth/*`: OAuth 2.0 / OAuth 1.0a flows and encrypted account storage.
- `src/*`: responsive React dashboard and public sandbox viewer.

Databases and generated files are stored under `data/` and `storage/` by default and are ignored by Git.

---

## Production checklist

1. Set `NODE_ENV=production`, a stable base64 `APP_ENCRYPTION_KEY`, and public HTTPS `PUBLIC_BASE_URL`.
2. Use `DATABASE_URL` with PostgreSQL for multi-process deployments.
3. Disable `SEED_DEMO`, or rotate seeded credentials immediately.
4. Configure provider secrets in the server environment, never in the frontend.
5. Whitelist the exact OAuth callback URLs in each provider console.
6. Complete Meta App Review / Business Verification, Google OAuth consent verification, and X app permission review as required.
7. Configure Stripe Price IDs and `STRIPE_WEBHOOK_SECRET`; point the Stripe webhook to `/api/billing/webhook`.
8. Run `npm run build`, `npm test`, and `npm run test:e2e` in CI.
9. Monitor `/api/meta/health`, job failures, and Admin → Overview production warnings.
10. Respect platform automation, copyright, community, and rate-limit rules. Review factual niches before enabling full autopilot.

---

## Important limitations

- Official publishing cannot be tested in this repository without external OAuth apps, approved permissions, and account access. The local sandbox publisher exists to verify the full workflow without pretending those integrations are live.
- Instagram requires a public HTTPS `PUBLIC_BASE_URL`; local HTTP is intentionally rejected.
- Official platform APIs may change scopes, app review requirements, quotas, or tier availability. `providerStatus()` and Admin → Integrations expose current configuration; publication errors surface provider messages and codes.
- SQLite is suitable for local/single-node use. PostgreSQL is recommended when running multiple API/worker processes.
- Local TTS and procedural visuals are functional but intentionally simpler than paid generative models.
- No distributed transaction can atomically commit an external post and a local database row; idempotency keys, reference codes, provider-side duplicate scans, and conditional claims minimize duplicate risk.
