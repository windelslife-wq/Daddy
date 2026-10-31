# Film Club Lens

**Website:** https://filmclublens.com

A full-stack, production-oriented AI **filmmaking and social media automation** platform. It creates short dramas, long dramas, episodic series and movies scene by scene with real AI video providers, assembles them into playable MP4 films with voices, subtitles and music, and also supports the original faceless-video workflow: scripts, original visuals, narration, rendering, scheduling and official social publishing.

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
| Frontend | Responsive React global website, public/auth/app pages, four appearance themes, generated footer links, studio, calendar, publishing, analytics, admin, settings |
| AI filmmaking | Short drama, long drama, movie and episodic-series projects; story bibles; recurring cast with wardrobe/voice/reference images; scene-by-scene real AI video jobs with pause/resume/cancel/retry; bounded concurrency; sound effects; segmented FFmpeg assembly; subtitles; credits ledger; installable PWA |

---

## AI Filmmaking Studio

`/app/films` is a professional, resumable film production workspace — **not a demo and not a basic one-shot video generator**.

- **Four formats in one ecosystem:** Short Drama, Long Drama & Movie Studio, Series & Episodes, plus standalone AI Script Writer, Character Studio, Scene Generator, Voice & Audio Studio, Movie Editor, My Projects, My Media, Published Movies and Credits & Subscriptions.
- **Workflow:** idea or reference image → format → genre/language/duration/style/platform → screenplay & dialogue → characters with visual references → real AI scene clips → voices/SFX/music/subtitles → scene arrangement & editing → preview → export/download/save/publish. Every step persists, so you can resume a saved project at any time.
- **Long-form is scene-by-scene.** AI video models produce short clips (default 10s max). A 1–60 minute film is planned as `ceil(duration / clip length)` scenes — 360 clips for a 60-minute cut — and assembled from those real clips into one MP4. Scene count and clip length are configurable (`FILM_MAX_SCENES`, `FILM_MAX_SCENE_SECONDS`), and an over-limit request fails with exact numbers instead of being silently shortened. No request pretends to generate a feature-length film in one call.
- **Describe it once, then approve the spend.** The **AI Production Agent** (`/app/films/agent`) parses a written brief, writes the screenplay, casts the characters, saves the locations and directs every shot for free, then stops and asks before scene generation or assembly. It only reports a production as complete when a real rendered MP4 exists; a missing provider is reported as a blocked run with the exact failing scene numbers, never as fake footage.
- **Storyboard, voices and edits before you spend on video.** Ten production steps now include storyboard stills (real PNGs, procedural offline or model-drawn), per-scene voice takes with measured duration, and a timeline with trims and fades that FFmpeg applies at render time. A **Creative Canvas** chains text → screenplay → stills → voice → credit-metered scene clips, and **Models & Providers** shows live readiness and prices for every provider — with no fake activation switches.
- **Direct every shot, not just the scene.** Shot size, camera angle, lens, camera movement, lighting, colour grade and composition are closed vocabularies validated by the API and translated into the real provider prompt. A reusable **locations library** keeps production design identical across scenes and episodes, and `GET /api/films/:id/qc` audits clips, cast references, shot direction, location links, runtime, TTS readiness and render status before export. See [docs/FILM-STUDIO-AUDIT.md](docs/FILM-STUDIO-AUDIT.md).
- **Review and regenerate only the scenes you dislike.** Failed jobs, provider errors, progress and remaining credits are always visible. Credits are estimated before expensive work, reserved before a job, and refunded automatically on failure or cancellation. A whole production run can be paused, resumed or cancelled; the canvas supports 16:9, 9:16 and 1:1.
- **Crash-safe runs.** Generation state lives in the database, so a worker that dies mid-run resumes the same provider predictions on restart (measured 509 ms after `SIGKILL`). Credits are reserved per attempt and refunded exactly once — never twice.
- **Verify a live provider in one command.** `npm run verify:provider -- --provider=replicate` generates, downloads and FFmpeg-probes one real clip with your key. What is and is not production-verified is recorded in **[docs/PRODUCTION-ACCEPTANCE.md](docs/PRODUCTION-ACCEPTANCE.md)**.
- **Requires real providers for real AI video.** Set `FILM_VIDEO_PROVIDER=replicate|fal|veo` plus its server-side key. With `FILM_VIDEO_PROVIDER=none`, scene generation is disabled with a clear `503` — the platform never fabricates a clip or simulates provider progress. See **[docs/FILMMAKING.md](docs/FILMMAKING.md)** for provider setup, model overrides, generation limits, commercial-use notes, credit pricing, the full API, PWA/mobile scope and features needing paid services.

Quick start:

```bash
# 1. Configure ONE real AI video provider (server-side only)
FILM_VIDEO_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
# 2. Optional: genuine AI screenwriting instead of a labelled local template
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
# 3. Start the app (worker must be enabled)
npm run dev
```

Then open **Film Studio Hub → New project**, or go straight to **AI Script Writer**.

---

## Global professional website

The root URL is a complete public product website, not a login redirect. Every public page is available in every appearance theme and is linked from the shared menu and generated footer.

| Area | Pages |
|---|---|
| Product | Home, Features, AI Filmmaking, Solutions, Pricing, Integrations |
| Resources | Documentation, Help Center, Service Status, Security, Changelog, Sitemap |
| Company | About, Contact, Careers, Press |
| Legal & trust | Privacy, Terms, Cookies, Acceptable Use, Data Processing |
| Account access | Dedicated `/login` and `/signup` pages |
| Workspace | All existing `/app/*` application pages |

`src/config/site.js` is the single source of truth for page metadata, header menus, the mobile menu, footer link generation, the sitemap, document titles, and route smoke tests. The sitemap also lists the authenticated filmmaking tools. `src/context/ThemeContext.jsx` provides **System**, **Midnight**, **Daylight**, and **Aurora** themes. The chosen appearance is stored in local storage and applies consistently to marketing pages, authentication pages, application pages, and the footer. A theme switcher is available in the public header and footer, auth header and footer, and app topbar, sidebar, and profile menu.

The public contact form is functional, not decorative. `POST /api/contact` validates and rate-limits submissions, applies a honeypot, stores messages in the `contact_messages` table, writes an audit event, and notifies active administrators. Administrators can review, mark reviewed, archive, or reply from **Admin → Messages**.

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
Creator: creator@filmclublens.local / StudioDemo2026!
Admin:   admin@filmclublens.local   / AdminStudio2026!
```

> Change or disable seeded accounts before exposing a deployment. Set `SEED_DEMO=false` and provide `ADMIN_EMAIL` / `ADMIN_PASSWORD` deliberately.

Production-style single-process start (builds the frontend first):

```bash
npm run build
npm start
```

For a multi-process deployment, run one or more dedicated workers with the same database and `WORKER_ENABLED=true`; use PostgreSQL via `DATABASE_URL`.

### Previewing behind an HTTPS tunnel or sandbox URL

The dev server (`npm run dev`) serves the frontend through Vite middleware and keeps hot
reloading on a websocket. Many tunnels and sandbox previews do not forward that websocket,
which leaves the browser retrying a socket it can never reach. Two supported ways to preview:

```bash
# Recommended for previews: serve the built bundle (no HMR websocket at all)
npm start            # = vite build + NODE_ENV=production node server/index.js

# Or keep dev mode and point HMR at the tunnel
HMR_CLIENT_PORT=443 HMR_PROTOCOL=wss npm run dev
HMR=off npm run dev  # dev mode with hot reload disabled entirely
```

Set `PUBLIC_BASE_URL` (and `APP_URL`) to the tunnel origin so cookies, OAuth redirects and
absolute media URLs use the host the browser actually visits.

---

## Activating external integrations

Every module is implemented and contract-tested offline. The remaining work is
**activation** — adding credentials, obtaining provider approval, and deploying
infrastructure. The setup wizard walks through those modules one by one without
ever contacting a provider or printing a secret:

```bash
npm run setup                            # status table, then pick a module
npm run setup -- --list                  # all 15 modules and their status
npm run setup -- --check                 # offline preflight report
npm run --silent setup -- --check --json # machine-readable report
npm run setup -- --next                  # open the first unfinished module
npm run setup -- --module facebook-pages # open a specific module
npm run setup -- --generate-key          # generate APP_ENCRYPTION_KEY
npm run setup -- --set KEY=VALUE         # non-interactive value entry
npm run setup -- --verify                # live-verify all configured credentials
npm run setup -- --verify stripe         # live-verify one module
npm run setup -- --work 1                # one-by-one: live state + exact next actions
npm run setup -- --work all --record     # verify all 15 and record the results
npm run setup -- --work all --record --progress  # regenerate the live progress tracker
npm run setup -- --confirm smtp --note "SPF/DKIM verified, ticket 4471"
npm run setup -- --unconfirm smtp        # undo a mistaken attestation
npm run activate -- --list               # remaining modules, dependency order
KEY=value npm run activate -- smtp       # one-by-one: configure, verify, record
npm run deploy:check -- --origin https://filmclublens.com
npm run db:bootstrap                     # real Postgres + two-worker claim proof
```

`--work <id|number|all>` is the one-by-one completion runner: it merges offline
preflight, live verification and the completion audit into a single work item
showing which criteria are met, **who owns each remaining one** (this repo,
server environment, deployment, provider console, or real production usage),
the exact environment keys, callback URLs and commands. `--record` persists the
verification result in the app DB and audit-logs it. `--confirm` is a human
**attestation** that the external console/deploy steps were genuinely done — it
requires a note, is audit-logged, and is never run automatically. The live
per-module tracker is **[docs/ACTIVATION_PROGRESS.md](docs/ACTIVATION_PROGRESS.md)**.

`--verify` is the only networked command: it makes read-only, app-level calls
to configured providers (Meta client-credentials, Google token endpoint,
X app-only token, Stripe `/v1/account`, OpenAI/Anthropic/Gemini model lists,
Brave/Tavily, Replicate, ElevenLabs, the public health endpoint, a signed
webhook ping, SMTP, and PostgreSQL). Unconfigured modules are skipped; module
15 stays `MANUAL` because only a provider reviewer can approve it. No secret is
ever printed, and provider error text is scrubbed of configured values. The
same data is exposed at **Admin → Activation** (`GET /api/admin/activation`,
`POST /api/admin/activation/:id/verify`), with a Verify button per module.

### Knowing when a module is actually done

`GET /api/admin/activation/audit` (and **Admin → Activation → Completion
criteria**) gives each module an explicit definition of done, checked against
real application state rather than environment variables alone:

- local configuration, and a **recorded successful verification**;
- **evidence**: connected accounts with the required scopes, published posts
  with remote links, non-simulated official metrics, Stripe Price IDs on every
  paid plan, processed signed webhooks, generated provider output, and stored
  credentials that still decrypt with the current key;
- **manual steps confirmed** — Meta App Review, Google consent screen, X API
  tier, Stripe activation and DNS/TLS cannot be verified from code, so an admin
  ticks them off via `POST /api/admin/activation/:id/confirm`.

Verification results and manual confirmations persist in application settings
and are audit-logged. Module 15 stays manual until a live post from a non-team
account has produced official metrics.

For each module the wizard prints the exact callback URLs, required
permissions/scopes, provider-console steps, deployment steps, and verification
checklist, then prompts for the environment values with input hidden for
secrets. Values are format-validated before being written to a gitignored
`.env` (mode `0600`); comments in an existing file are preserved and duplicate
keys are never created. The wizard refuses to write a value that `dotenv`
cannot read back exactly, rather than silently corrupting a secret.

The full, generated checklist lives in **[docs/ACTIVATION.md](docs/ACTIVATION.md)**
(regenerate with `npm run setup:runbooks`), and the live state of every module
is in **[docs/ACTIVATION_PROGRESS.md](docs/ACTIVATION_PROGRESS.md)** (regenerate
with `npm run --silent setup -- --work all --record --progress`). Recommended
dependency order:

1. `encryption-key` — can be completed entirely offline (`--generate-key`).
2. `public-https-origin`, `postgres` — deployment infrastructure; OAuth and
   Instagram publishing depend on the HTTPS origin.
3. `ai-providers`, `research`, `image-providers`, `tts-providers` — optional
   upgrades; already `READY` with the offline `local` / `none` / `procedural` /
   `mespeak` defaults, and their verifiers pass offline.
4. `smtp`, `notification-webhook` — delivery channels.
5. `facebook-pages`, `instagram-reels`, `youtube`, `x`, `stripe` — credentials
   plus provider-console approval plus live publishing evidence.
6. `app-review` — the final, external approval gate (Meta, Google, X, Stripe).

**Why the last five cannot be finished from this repository:** each needs real
third-party credentials, a public HTTPS deployment, provider reviewer
decisions, a connected non-team account and at least one live published post
with official metrics. The code, adapters, tests and audit criteria are all in
place; the remaining criteria are deliberately owned by a human so the
completion audit cannot be faked.

`npm run doctor` remains the deployment-readiness report; the wizard is the
step-by-step path to getting there. Simulator test results are never presented
as live provider posts — finish with a real smoke test using an account that is
**not** an app admin/developer/tester.

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

`npm test` also validates the shared site map, menu coverage, generated footer coverage, and document titles. `npm run test:visual` builds the production frontend, checks all public pages plus login/signup in Daylight and Aurora themes, submits the real contact form, creates a real signup account, signs in, checks major workspace routes and the app theme switcher, and verifies mobile overflow and browser errors. Screenshots are written to `test-artifacts/`.

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
- `SMTP_URL` enables email notification delivery. `NOTIFICATION_WEBHOOK_URL` posts notification events to your webhook; set `NOTIFICATION_WEBHOOK_SECRET` to verify the HMAC `X-Film-Club-Lens-Signature` (`sha256=HMAC(secret, "timestamp.rawBody")`). In-app notifications work without either.

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
- `server/routes/contact.js`: validated public contact endpoint, rate limiting, honeypot, message storage, and admin notifications.
- `server/oauth/*`: OAuth 2.0 / OAuth 1.0a flows and encrypted account storage.
- `src/config/site.js`: shared public site map used by menus, footer, sitemap, titles, and route QA.
- `src/context/ThemeContext.jsx`: persistent System / Midnight / Daylight / Aurora appearance themes.
- `src/components/PublicLayout.jsx`, `Footer.jsx`, `ThemeSwitcher.jsx`: professional global header, generated footer, mobile menu, and theme controls.
- `src/pages/public/*`: product, resource, company, legal, pricing, contact, status, docs, and sitemap pages.
- `src/pages/AuthPage.jsx`: dedicated login and signup experience with validation and password strength feedback.
- `src/*`: responsive React application dashboard, studio, admin, and public sandbox viewer.

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
9. Monitor `/api/meta/health`, job failures, Admin → Overview production warnings, Admin → Integrations readiness, and Admin → Messages for contact-form submissions.
10. Respect platform automation, copyright, community, and rate-limit rules. Review factual niches before enabling full autopilot.

### Ready-to-run production stack

**[deploy/README.md](deploy/README.md)** implements activation modules 12 and 13
with a real `Dockerfile`, `docker-compose.yml` (API + `--scale worker=2` +
PostgreSQL + Caddy automatic HTTPS), `deploy/Caddyfile`, a dedicated
`server/worker-standalone.js`, and two verification commands:

```bash
cp .env.example .env && chmod 600 .env      # set DOMAIN, POSTGRES_PASSWORD, APP_ENCRYPTION_KEY
docker compose up -d --build --scale worker=2
npm run db:bootstrap                        # real Postgres schema + two-worker claim proof
npm run deploy:check -- --origin https://filmclublens.com --json
```

`deploy:check` runs from **outside** the host and performs a real DNS lookup,
TLS handshake (CN/issuer/expiry), public `/api/meta/health` probe, secure-cookie
inspection, signed-media fetch and callback-route probe. It never fakes a
result and exits non-zero on any failure.

---

## Important limitations

- Official publishing code paths are now contract-tested end to end against a local simulator, but **live** publishing still requires external OAuth apps, approved permissions, paid/eligible API tiers, and real account access. The local sandbox publisher verifies the full credential-free workflow as well; simulator results are never presented as live provider posts.
- Instagram requires a public HTTPS `PUBLIC_BASE_URL`; local HTTP is intentionally rejected.
- Official platform APIs may change scopes, app review requirements, quotas, or tier availability. `providerStatus()` and Admin → Integrations expose current configuration; publication errors surface provider messages and codes.
- SQLite is suitable for local/single-node use. PostgreSQL is recommended when running multiple API/worker processes.
- Local TTS and procedural visuals are functional but intentionally simpler than paid generative models.
- No distributed transaction can atomically commit an external post and a local database row; idempotency keys, reference codes, provider-side duplicate scans, and conditional claims minimize duplicate risk.
- **AI filmmaking needs a paid video provider.** With `FILM_VIDEO_PROVIDER=none`, no AI clip can be produced; the platform refuses rather than fabricating one. Provider models, queues, regional access, watermarking and commercial rights are controlled by Replicate, Fal.ai and Google — review their current terms before distributing content.
- Long movies are assembled from many short clips. Character identity across clips is best-effort via consistent appearance prompts; guaranteed identity locking is not claimed. Picture-in-picture overlays, brand logos, speed ramps, VFX looks and timed text overlays are burned in by FFmpeg, and every completed render also writes separate voice/SFX/music stems. Lip-sync has a dedicated `POST /api/films/:id/scenes/:sceneId/lipsync` path (clip + voice take required) and motion transfer animates a storyboard still, but both need `FILM_LIPSYNC_PROVIDER` / `FILM_MOTION_PROVIDER`, a Replicate/fal key and an explicit model id; without them the API answers 503 and the buttons stay disabled. Local VFX looks, speed ramps and timed text overlays are plain FFmpeg and always available.
- The mobile experience is an **installable responsive PWA**, not a native App Store / Play Store app. Native wrappers, push notifications and in-app purchases are not implemented.
- Purchasable credit packs are not implemented: signup grants follow the subscription plan; Stripe billing manages plans. Adding paid credit top-ups requires Price IDs and a webhook → ledger integration.
