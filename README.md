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
npm test                   # unit + provider contract + PostgreSQL/worker tests
npm run test:integrations   # official platform and external-service simulator suites
npm run test:e2e           # full credential-free generation → sandbox publishing workflow
npm run test:visual        # real Chromium QA on the production build
npm run test:all           # all of the above
npm run doctor             # deployment / app-review readiness report
npm run doctor -- --probe  # also checks the public health URL
npm run doctor -- --json   # machine-readable readiness report
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

Additional verification suites cover the modules that previously required external accounts. They start a local HTTP/SMTP simulator and point only server-side API roots at it; no real social, AI, billing, or email account is contacted:

- `tests/provider-integrations.test.js`: Meta/Facebook/Instagram, Google/YouTube, and X OAuth connect → encrypted account → official upload/publish → metrics → provider-side revoke, including duplicate suppression.
- `tests/external-services.test.js`: OpenAI/Anthropic/Gemini scripts, Brave/Tavily research, OpenAI/Replicate images, OpenAI/ElevenLabs TTS, Stripe checkout/signature-verified webhooks, SMTP delivery, and signed notification webhooks.
- `tests/analytics-adapters.test.js`: YouTube Analytics watch time/shares, YouTube Reporting thumbnail impressions, and X video views/quartile-based watch-time estimates.
- `tests/postgres-multiprocess.test.js`: PostgreSQL schema/seeding via `pg-mem` and two real worker processes claiming jobs without duplicates.
- `tests/visual.js`: production login, nine workspace routes, desktop/mobile screenshots, overflow checks, and console/page/network error checks. Screenshots are written to ignored `test-artifacts/`.

`npm run doctor` and **Admin → Integrations → Deployment readiness** show the exact callback URLs, HTTPS/media/worker/database checks, production warnings, and the provider app-review checklist without exposing secrets.

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
| Facebook Pages | `/api/oauth/facebook/connect` | `META_APP_ID`, `META_APP_SECRET` | Manageable Facebook Page; Facebook Login for Business permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`; app review / Business Verification may be required |
| Instagram Reels | same Meta flow | `META_APP_ID`, `META_APP_SECRET`, public HTTPS `PUBLIC_BASE_URL` | Professional Instagram account linked to the selected Facebook Page; Facebook Login permissions `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_read_engagement`; public HTTPS media URL. Apps using **Instagram Login** instead need the separate `instagram_business_*` permission family and host |
| YouTube | `/api/oauth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube Data API v3, Analytics API, and Reporting API enabled; verified consent screen/test users; `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, and `yt-analytics.readonly` scopes; sufficient API quota |
| X | `/api/oauth/x/connect` | `X_CONSUMER_KEY`, `X_CONSUMER_SECRET` | OAuth 1.0a user context, read/write app permissions, API tier allowing v1.1 media upload, v2 post creation, and private media metrics for full video analytics |
| Sandbox | `/api/oauth/sandbox/connect` | none | Built-in local HTTP publisher; **not an external social network** |

OAuth callback URLs to whitelist:

```text
{PUBLIC_BASE_URL}/api/oauth/facebook/callback
{PUBLIC_BASE_URL}/api/oauth/google/callback
{PUBLIC_BASE_URL}/api/oauth/x/callback
{PUBLIC_BASE_URL}/api/oauth/sandbox/callback
{PUBLIC_BASE_URL}/api/billing/webhook
```

`npm run doctor` prints the exact resolved URLs for the current `PUBLIC_BASE_URL`.

### Provider app review / Business Verification

These steps happen in provider consoles and cannot be completed from this repository:

1. **Meta:** create a Facebook Login for Business app, request Advanced Access for the permissions above, complete Business Verification, add test Pages/Professional Instagram accounts, and submit a screencast of the OAuth → review → publish flow. Instagram Reels media must be reachable over public HTTPS.
2. **Google:** enable YouTube Data API v3, YouTube Analytics API, and YouTube Reporting API; configure the OAuth consent screen; publish it or add verified test users; reconnect existing channels after adding `yt-analytics.readonly`. Bulk thumbnail-impression reports can take up to 48 hours to appear after the reporting job is created.
3. **X:** configure OAuth 1.0a with read/write permissions, the exact callback URL, media upload access, and an API tier that permits post creation and private playback metrics.
4. **Stripe:** create recurring Prices, store each Price ID in Admin → Plans, register the webhook URL above, and subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.

Admin → Integrations keeps these items visible with `EXTERNAL` status until you confirm them in each provider console.

`PUBLIC_BASE_URL` must be a public HTTPS origin for real OAuth and Instagram. Instagram’s container API needs to download the video from an HMAC-signed public media URL; the platform refuses to pretend an `http://localhost` URL is sufficient.

Official docs used for the adapters:

- Meta: https://developers.facebook.com/docs/video-api/guides/publishing/ and https://developers.facebook.com/docs/instagram-api/guides/video-publishing/
- YouTube: https://developers.google.com/youtube/v3/docs/videos/insert
- X: https://developer.x.com/en/docs/x-api/v1/media/upload-media/uploading-media/media-best-practices
- Stripe: https://docs.stripe.com/api/checkout/sessions

### Billing, email, and webhooks

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: enable paid subscription checkout and signed webhooks.
- Each paid plan needs a real Stripe `price_...` ID in Admin → Plans. Without it, checkout returns `stripe_price_missing`; no fake charge is attempted.
- `SMTP_URL` enables email notification delivery. `NOTIFICATION_WEBHOOK_URL` posts notification events to your webhook; set `NOTIFICATION_WEBHOOK_SECRET` to verify the HMAC `X-Faceless-Signature` (`sha256=HMAC(secret, "timestamp.rawBody")`). In-app notifications work without either.

---

## Using the platform

### 1. Connect an account

Open **Accounts → Connect sandbox channel** for a credential-free end-to-end test. The consent screen creates an encrypted random bearer token and a local HTTP channel. For official accounts, configure environment variables first, then use the matching Connect button and provider OAuth consent flow.

The account list shows status, scopes, token expiry, active/autopilot toggles, a real **Test** button that calls the provider verification endpoint, and **Disconnect** which clears stored encrypted tokens immediately. Google, Meta, and X provider-side revocation is attempted where the official API supports it; otherwise revoke app access in the provider’s security settings.

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

**Analytics** shows real metrics returned by official APIs: YouTube Data API engagement plus YouTube Analytics watch time/shares and YouTube Reporting thumbnail impressions; X post impressions, video views, and an explicitly estimated watch time from private playback quartiles; and Meta video insights where the approved scopes/tier allow them. Sandbox metrics are deterministic and explicitly labeled simulated; they are excluded from data-backed recommendations. The recommendations worker uses measured official metrics when at least three snapshots are available; otherwise it provides clearly labeled baseline guidance. Optional LLM recommendations activate only when an external AI provider is configured.

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
- `server/services/integrationReadiness.js`: deployment doctor, exact callback URLs, and provider app-review checklist.
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
8. Run `npm run build`, `npm run test:all`, and `npm run doctor -- --probe` in CI. The simulator suites verify official adapters without live credentials; they do not replace a final smoke test with approved real accounts.
9. Monitor `/api/meta/health`, job failures, Admin → Overview production warnings, and Admin → Integrations readiness.
10. Respect platform automation, copyright, community, and rate-limit rules. Review factual niches before enabling full autopilot.

---

## Important limitations

- Official publishing code paths are now contract-tested end to end against a local simulator, but **live** publishing still requires external OAuth apps, approved permissions, paid/eligible API tiers, and real account access. The local sandbox publisher verifies the full credential-free workflow as well; simulator results are never presented as live provider posts.
- Instagram requires a public HTTPS `PUBLIC_BASE_URL`; local HTTP is intentionally rejected.
- Official platform APIs may change scopes, app review requirements, quotas, or tier availability. `providerStatus()` and Admin → Integrations expose current configuration; publication errors surface provider messages and codes.
- SQLite is suitable for local/single-node use. PostgreSQL is recommended when running multiple API/worker processes.
- Local TTS and procedural visuals are functional but intentionally simpler than paid generative models.
- No distributed transaction can atomically commit an external post and a local database row; idempotency keys, reference codes, provider-side duplicate scans, and conditional claims minimize duplicate risk.
