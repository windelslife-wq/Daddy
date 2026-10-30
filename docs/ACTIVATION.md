# Activation runbook

Every module below is **already implemented in code**. The Faceless Studio test
suite covers the OAuth flows, publishing adapters, Stripe webhooks,
provider adapters, and analytics against a local simulator. What remains is
**activation**: adding credentials, obtaining provider approval, and deploying
infrastructure. Those steps cannot be automated from inside this repository.

This document is generated from `server/services/activation/modules.js`.
Regenerate it with:

```bash
npm run setup -- --runbooks
```

## Quick start

```bash
npm install
npm run setup              # interactive: shows status, pick a module, enter values
npm run setup -- --list    # see all modules and their current status
npm run setup -- --check   # offline preflight report
npm run --silent setup -- --check --json   # machine-readable report
npm run setup -- --next    # work on the first unfinished module
npm run setup -- --module facebook-pages
npm run setup -- --verify               # live-verify all configured credentials
npm run setup -- --verify stripe        # live-verify one module
npm run doctor -- --probe # deployment readiness + public health probe
npm run deploy:check -- --origin https://studio.example.com  # real external TLS/health check
npm run db:bootstrap     # real PostgreSQL schema + two-worker claim proof
```

Production deployment (modules 12 & 13) is documented in
[deploy/README.md](../deploy/README.md): Dockerfile, Compose with API + two
worker processes + PostgreSQL + Caddy TLS, exact callback URLs and backups.

### Work the modules one by one

```bash
npm run setup -- --work 1                          # live state + exact next actions for module 1
npm run setup -- --work 1 --json                  # machine-readable work item
npm run setup -- --work all --record              # verify every module and record the results
npm run setup -- --work all --record --progress   # regenerate docs/ACTIVATION_PROGRESS.md
npm run setup -- --confirm smtp --note "SPF/DKIM verified, ticket 4471"
npm run setup -- --unconfirm smtp                # undo a mistaken attestation
```

`--work` merges offline preflight, live verification and the completion audit
into one work item: which criteria are met, who owns each remaining one, the
exact environment keys, callback URLs and commands. `--record` persists the
verification result (audit-logged). `--confirm` is a **human attestation** that
the provider-console / deployment steps were genuinely completed — it is never
run automatically. See
[docs/ACTIVATION_PROGRESS.md](ACTIVATION_PROGRESS.md) for the live per-module
tracker.

Recommended order respects dependencies: encryption key → HTTPS origin →
PostgreSQL → offline-verifiable AI/image/TTS/research providers → SMTP and
webhooks → Facebook/Instagram/YouTube/X/Stripe → provider app review.

The wizard writes values to a gitignored `.env` (mode 0600), validates their
format, preserves comments in your existing file, and never prints secrets back
to the terminal. Configuration commands never contact a provider. The explicit
`--verify` command is the only networked operation: it makes read-only,
app-level calls to the providers you have configured, skips everything else,
and never prints a secret.

### Live verification statuses

| Status | Meaning |
|---|---|
| `VERIFIED` | The provider accepted the configured app-level credentials. |
| `INVALID` | The provider rejected them; the message explains what to fix. |
| `UNREACHABLE` | This host could not reach the provider (network egress / firewall). |
| `NOT CONFIGURED` | Credentials are missing, so nothing was contacted. |
| `MANUAL` | Only a provider-console reviewer can confirm this (module 15). |

Verification is also available from **Admin → Activation → Verify** and through
`GET /api/admin/activation` / `POST /api/admin/activation/:id/verify`.

## Definition of done

Configuration and verification are necessary but not sufficient. Each module
also has explicit **completion criteria** backed by real application state —
`GET /api/admin/activation/audit` and the **Admin → Activation** tab show them
one by one. A module is `COMPLETE` only when every criterion passes:

| Criterion | What it proves |
|---|---|
| `local-config` | All required environment/dependency checks pass (offline preflight). |
| `live-verified` | A recorded, successful credential verification. |
| Module-specific evidence | Connected accounts with the right scopes, published posts with remote links, non-simulated official metrics, Stripe Price IDs on every paid plan, processed webhooks, generated provider output, decryptable stored credentials. |
| `manual-steps` | You confirmed the provider-console / deployment checklist (Meta App Review, Google consent screen, X tier, Stripe activation, DNS/TLS). |

Verification results and manual confirmations are persisted in application
settings, so progress survives restarts. Use **Mark steps done** in
Admin → Activation after finishing a provider console; **Undo** reverses it.
The admin actions are written to the audit log.

Module 15 is the final gate. It has no live verifier (no code can produce a
reviewer decision) and is complete only after a live post from a non-team
account, official metrics, and your confirmation of all four provider checklists.

> **Order matters.** Work through the modules in numbered order. Modules 12–14
> are infrastructure and should be done before or alongside the publishing
> modules. Module 15 is the final provider-approval gate.

## Module index

| # | Module | Type | What blocks it |
|---|---|---|---|
| 1 | [Facebook Pages publishing](#1-facebook-pages-publishing) | `hybrid` | credentials + provider console + deployment |
| 2 | [Instagram Business / Reels publishing](#2-instagram-business--reels-publishing) | `hybrid` | credentials + provider console + deployment |
| 3 | [YouTube publishing & analytics](#3-youtube-publishing--analytics) | `hybrid` | credentials + provider console + deployment |
| 4 | [X publishing & analytics](#4-x-publishing--analytics) | `hybrid` | credentials + provider console + deployment |
| 5 | [Stripe billing (checkout + webhooks)](#5-stripe-billing-checkout--webhooks) | `hybrid` | credentials + provider console + deployment |
| 6 | [SMTP email notifications](#6-smtp-email-notifications) | `config` | credentials + provider console |
| 7 | [Signed notification webhooks](#7-signed-notification-webhooks) | `config` | credentials + provider console |
| 8 | [External AI script providers](#8-external-ai-script-providers) | `config` | credentials + provider console |
| 9 | [Research providers (Brave / Tavily)](#9-research-providers-brave--tavily) | `config` | credentials + provider console |
| 10 | [External image providers (OpenAI Images / Replicate)](#10-external-image-providers-openai-images--replicate) | `config` | credentials + provider console |
| 11 | [External TTS providers (OpenAI TTS / ElevenLabs)](#11-external-tts-providers-openai-tts--elevenlabs) | `config` | credentials + provider console |
| 12 | [Public HTTPS origin, callbacks & signed media](#12-public-https-origin-callbacks--signed-media) | `hybrid` | credentials + deployment |
| 13 | [Production database (PostgreSQL)](#13-production-database-postgresql) | `hybrid` | credentials + deployment |
| 14 | [Production credential encryption key](#14-production-credential-encryption-key) | `config` | credentials + deployment |
| 15 | [Provider app review / Business Verification](#15-provider-app-review--business-verification) | `external` | provider console |

## Global prerequisites

1. **Node.js 22+** and npm. Run `npm install` first.
2. **A server environment variable store.** All secrets stay server-side; no key
   is ever read by the React/Vite frontend.
3. **A public HTTPS domain** for any OAuth or publishing module (see module 12).
4. **Keep `.env` out of Git.** The repository `.gitignore` already covers
   `.env` and `.env.*` (except `.env.example`). The wizard checks this.
5. **Run offline verification first.** `npm test` and
   `npm run test:integrations` exercise every adapter against a simulator, so
   you can be confident the code works before spending time on credentials.

### Status meanings

| Status | Meaning |
|---|---|
| `READY` | All local configuration is present and valid. External console steps may still remain. |
| `NEEDS WORK` | One or more environment values are missing or malformed. |
| `EXTERNAL` | No local configuration exists; the work happens in provider consoles. |

---

## 1. Facebook Pages publishing

`id: facebook-pages` · category: `publishing` · type: `hybrid`

Official Meta OAuth connect and video publishing to Facebook Pages. Adapters, token exchange/refresh, metrics and revoke are implemented; activation needs a Meta app with approved permissions.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `META_APP_ID` | no | Always | Numeric App ID from the Meta app dashboard (Settings → Basic). |
| `META_APP_SECRET` | yes | Always | App Secret from Settings → Basic. Never put this in frontend code. |
| `META_GRAPH_VERSION` | no | Optional | Pinned Graph API version, e.g. v26.0. |

**Depends on:** `#12 public-https-origin`

### Callback URLs

Replace `https://YOUR-DOMAIN` with your exact `PUBLIC_BASE_URL` (no trailing slash).

- **Facebook / Instagram OAuth callback** — `https://YOUR-DOMAIN/api/oauth/facebook/callback`

### Required permissions / scopes / events

- `public_profile`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `business_management`

### Provider console steps

1. **Create a Meta app.** In developers.facebook.com create a Business-type app and add "Facebook Login for Business".
2. **Request Advanced Access.** Ask for Advanced Access on every permission listed above. Standard Access only works for app admins/developers/testers.
3. **Complete Business Verification.** Submit your business documents in Business Settings → Security Centre. Required before external users can connect.
4. **Whitelist the callback URL.** Facebook Login → Settings → Valid OAuth Redirect URIs. Paste the exact callback URL shown above (HTTPS, no trailing slash).
5. **Add test assets.** Add at least one Facebook Page where you have CREATE_CONTENT / MANAGE task permission, plus app roles for testers.
6. **Submit App Review.** Provide a screencast of the OAuth → review → publish flow and explain the automated posting use case.

### Deployment steps

1. **Set App Secret in the server environment only.** The value belongs in the server process environment or a secret manager, never in .env committed to Git and never in Vite/React code.

### Verify it works

1. **Connect.** Accounts → Connect Facebook. The consent screen should list your Page, and the account row should show "connected".
2. **Test token.** Click "Test" on the connected account — it calls the provider verification endpoint.
3. **Publish.** Create a short sandbox video first, then publish a real one to the Page and confirm the remote link resolves.

### Official documentation

- [Meta video publishing](https://developers.facebook.com/docs/video-api/guides/publishing/)
- [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/guides/)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module facebook-pages
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 2. Instagram Business / Reels publishing

`id: instagram-reels` · category: `publishing` · type: `hybrid`

Reels publishing via the Meta Graph container API. Shares the Facebook OAuth app and additionally requires a publicly reachable HTTPS media URL — Meta downloads the video from the signed URL.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `META_APP_ID` | no | Always | Same app as Facebook Pages (module 1). |
| `META_APP_SECRET` | yes | Always | Same app secret as module 1. |
| `PUBLIC_BASE_URL` | no | Always | Must be publicly reachable over HTTPS so Meta can fetch the rendered MP4. |

**Depends on:** `#1 facebook-pages`, `#12 public-https-origin`

### Callback URLs

Replace `https://YOUR-DOMAIN` with your exact `PUBLIC_BASE_URL` (no trailing slash).

- **Facebook / Instagram OAuth callback** — `https://YOUR-DOMAIN/api/oauth/facebook/callback`

### Required permissions / scopes / events

- `instagram_basic`
- `instagram_content_publish`
- `instagram_manage_insights`
- `pages_read_engagement`

### Provider console steps

1. **Use a Professional account.** Convert the target Instagram account to Professional (Business or Creator) and link it to the Facebook Page from module 1.
2. **Choose the right login family.** This app uses Facebook Login for Business, so it requests instagram_basic / instagram_content_publish / instagram_manage_insights. Apps built on Instagram Login instead need the separate instagram_business_* family and a different host.
3. **Request Advanced Access.** Advanced Access for the Instagram permissions, plus Instagram app review with a publishing screencast.
4. **Whitelist the shared callback.** Same Facebook Login OAuth redirect URI as module 1.

### Deployment steps

1. **Serve media over public HTTPS.** The server signs and serves video at /api/media/public/:token/:filename. Deploy behind HTTPS with a real certificate; localhost or self-signed URLs fail silently at the container stage.
2. **Generate one real video before connecting.** Create at least one completed project so a signed media URL can be tested before you rely on autopilot.

### Verify it works

1. **Confirm container upload.** Publish a test Reel and watch the publication status move through processing → published. A stuck "processing" state usually means Meta could not fetch the media URL.
2. **Check the remote link.** Open the returned permalink while signed out to verify the Reel is public.

### Official documentation

- [Instagram video publishing](https://developers.instagram.com/docs/instagram-platform/content-publishing/)
- [IG Reels API](https://developers.facebook.com/docs/instagram-api/guides/video-publishing/)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module instagram-reels
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 3. YouTube publishing & analytics

`id: youtube` · category: `publishing` · type: `hybrid`

Resumable uploads, captions, Data API engagement, Analytics API watch time/shares, and Reporting API thumbnail impressions. Needs a Google OAuth client with verified scopes.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | no | Always | From Google Cloud → APIs & Services → Credentials (Web application). |
| `GOOGLE_CLIENT_SECRET` | yes | Always | From the same OAuth client entry. |

**Depends on:** `#12 public-https-origin`

### Callback URLs

Replace `https://YOUR-DOMAIN` with your exact `PUBLIC_BASE_URL` (no trailing slash).

- **Google / YouTube OAuth callback** — `https://YOUR-DOMAIN/api/oauth/google/callback`

### Required permissions / scopes / events

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.force-ssl`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

### Provider console steps

1. **Enable three APIs.** In the Google Cloud project enable YouTube Data API v3, YouTube Analytics API, and YouTube Reporting API.
2. **Configure the consent screen.** Set app name, support email, and authorized domain. Add all four scopes listed above.
3. **Handle verification.** Either publish the consent screen (Google verification for sensitive/restricted scopes) or add every publishing account as a verified test user.
4. **Whitelist the callback URL.** Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs. Use the exact /api/oauth/google/callback URL.
5. **Budget upload quota.** Each upload consumes YouTube Data API units. Request a quota increase if autopilot will post many videos per day.
6. **Reconnect existing channels.** After adding yt-analytics.readonly, disconnect and reconnect YouTube accounts so the refresh token carries the new scope.

### Deployment steps

1. **Allow 48h for reach reports.** Thumbnail-impression reports begin generating within ~48 hours after a channel_reach_basic_a1 reporting job is created. Missing impressions before then is expected.

### Verify it works

1. **Connect and check scopes.** Accounts → Connect YouTube. Confirm the consent screen shows all four scopes.
2. **Upload a short video.** Publish a real short video and confirm it appears in YouTube Studio with the generated caption track.
3. **Sync metrics.** Run a metrics sync; watch time and shares should come from the Analytics API once the video has views.

### Official documentation

- [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [YouTube Analytics reports](https://developers.google.com/youtube/analytics/reference/reports/query)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module youtube
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 4. X publishing & analytics

`id: x` · category: `publishing` · type: `hybrid`

OAuth 1.0a user-context connect, chunked v1.1 media upload, v2 post creation, public metrics, and private playback quartile estimates. Needs an approved read/write app and a sufficient API tier.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `X_CONSUMER_KEY` | no | Always | From the developer portal → your App → Keys and tokens. |
| `X_CONSUMER_SECRET` | yes | Always | From the same Keys and tokens page. |

**Depends on:** `#12 public-https-origin`

### Callback URLs

Replace `https://YOUR-DOMAIN` with your exact `PUBLIC_BASE_URL` (no trailing slash).

- **X OAuth callback** — `https://YOUR-DOMAIN/api/oauth/x/callback`

### Required permissions / scopes / events

- `Read and write app permissions`
- `Media upload access`
- `Exact callback URL match`

### Provider console steps

1. **Create a Project + App.** In the X developer portal create a Project and App with an approved use case for automated posting.
2. **Set read/write permissions.** App settings → User authentication settings: enable OAuth 1.0a, set App permissions to Read and write, and provide the exact callback URL.
3. **Regenerate tokens after changes.** Changing permissions invalidates existing user tokens — reconnect accounts afterwards.
4. **Confirm the API tier.** Post creation, v1.1 media upload, and private media metrics may require a paid or elevated tier.

### Deployment steps

1. **Keep consumer keys server-side.** OAuth 1.0a signing happens on the server. Never expose consumer keys or user token secrets to the browser.

### Verify it works

1. **Connect with 3-legged flow.** Accounts → Connect X; approve and confirm the account row shows connected.
2. **Post a short video.** Publish and confirm the remote URL resolves to your tweet.
3. **Check metrics tier.** If private playback quartiles are unavailable the adapter uses public metrics and labels watch time as estimated.

### Official documentation

- [X OAuth 1.0a](https://docs.x.com/fundamentals/authentication/api-reference)
- [Chunked media upload](https://developer.x.com/en/docs/x-api/v1/media/upload-media/uploading-media/media-best-practices)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module x
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 5. Stripe billing (checkout + webhooks)

`id: stripe` · category: `billing` · type: `hybrid`

Subscription checkout, signature-verified webhooks, idempotent event storage, and plan assignment. Needs Stripe keys, real recurring Price IDs, and a registered webhook endpoint.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Always | Test with sk_test_…, go live with sk_live_… only after replay tests pass. |
| `STRIPE_WEBHOOK_SECRET` | yes | Always | The whsec_… value shown for your webhook endpoint, not the API key. |

**Depends on:** `#12 public-https-origin`

### Callback URLs

Replace `https://YOUR-DOMAIN` with your exact `PUBLIC_BASE_URL` (no trailing slash).

- **Stripe webhook endpoint** — `https://YOUR-DOMAIN/api/billing/webhook`

### Required permissions / scopes / events

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

### Provider console steps

1. **Create recurring Prices.** For every paid plan create a recurring Price in Stripe and copy its price_… ID.
2. **Set Price IDs in Admin → Plans.** Paste each price_… ID into the matching plan row and save. Without it checkout returns stripe_price_missing and no charge is attempted.
3. **Register the webhook endpoint.** Developers → Webhooks → Add endpoint. Paste the /api/billing/webhook URL shown above.
4. **Subscribe to four events.** checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
5. **Copy the signing secret.** Use the endpoint-specific whsec_… value. It is different from the account API key.
6. **Activate and go live.** Activate the Stripe account, then repeat Price IDs and webhook registration with live-mode keys.

### Deployment steps

1. **Webhook body must stay raw.** The route uses express.raw before express.json. Do not put a global JSON body parser in front of it or signature verification will fail.

### Verify it works

1. **Replay a test event.** Use Stripe CLI or the dashboard to send checkout.session.completed and confirm the plan changes and a webhook_events row is recorded.
2. **Check signature rejection.** Send an unsigned request — it must return 400 stripe_signature_missing/invalid.
3. **Complete a test checkout.** Use card 4242 4242 4242 4242 and confirm the success page assigns the plan.

### Official documentation

- [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions)
- [Webhook signatures](https://docs.stripe.com/webhooks)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module stripe
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 6. SMTP email notifications

`id: smtp` · category: `notifications` · type: `config`

Nodemailer transport that mirrors in-app notifications to email. Fully implemented; only the SMTP connection URL is missing. No provider approval needed.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `SMTP_URL` | yes | Always | e.g. smtps://user:password@smtp.example.com:465. URL-encode special characters in the password. |
| `NOTIFICATION_FROM` | no | Optional | e.g. "Faceless Studio <notifications@example.com>". |

### Provider console steps

1. **Create an SMTP credential.** Use your mail provider's app password / SMTP user. Avoid personal account passwords.
2. **Verify the sender domain.** Configure SPF, DKIM and DMARC for the From domain to avoid spam filtering.

### Verify it works

1. **Trigger a notification.** Any billing/plan change or broadcast sends an email. Check the server log for "Email notification failed" if nothing arrives.

### Official documentation

- [Nodemailer SMTP](https://nodemailer.com/smtp/)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module smtp
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 7. Signed notification webhooks

`id: notification-webhook` · category: `notifications` · type: `config`

Outbound notification events with HMAC-SHA256 X-Faceless-Signature, 3-attempt retry with backoff, and timeout. Needs a receiver URL and a shared secret.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `NOTIFICATION_WEBHOOK_URL` | no | Always | Absolute HTTPS URL of your receiver (http allowed for local testing only). |
| `NOTIFICATION_WEBHOOK_SECRET` | yes | Always | At least 16 random characters; used to sign "timestamp.rawBody". |

### Provider console steps

1. **Generate a shared secret.** e.g. openssl rand -hex 24. Store the same value in your receiver.
2. **Verify the signature.** Compute sha256 HMAC over "<x-faceless-timestamp>.<raw body>" and compare with a constant-time comparison against X-Faceless-Signature (sha256=…).
3. **Enforce a timestamp window.** Reject events older than 5 minutes to prevent replay.
4. **Deduplicate by event id.** Delivery retries (3 attempts) can repeat the same notification.

### Verify it works

1. **Trigger a broadcast.** Admin → Broadcast; your receiver should get notification.created with a valid signature.
2. **Test retry behaviour.** Return a 503 from the receiver and confirm three attempts in the server log.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module notification-webhook
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 8. External AI script providers

`id: ai-providers` · category: `ai` · type: `config`

OpenAI, Anthropic, and Gemini adapters for scripts, scene plans, captions and hashtags. Optional — the built-in local multilingual engine works offline and is the default.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `AI_PROVIDER` | no | Recommended (default `local`) | Choose local (offline), openai, anthropic, or gemini. |
| `OPENAI_API_KEY` | yes | `AI_PROVIDER=openai` | Required when AI_PROVIDER=openai. |
| `OPENAI_MODEL` | no | Optional | e.g. gpt-4o-mini. |
| `ANTHROPIC_API_KEY` | yes | `AI_PROVIDER=anthropic` | Required when AI_PROVIDER=anthropic. |
| `ANTHROPIC_MODEL` | no | Optional | e.g. claude-3-5-haiku-latest. |
| `GEMINI_API_KEY` | yes | `AI_PROVIDER=gemini` | Required when AI_PROVIDER=gemini. |
| `GEMINI_MODEL` | no | Optional | e.g. gemini-2.0-flash. |

### Provider console steps

1. **Set billing limits.** External AI usage incurs provider charges. Set a hard monthly spend cap in the provider console.

### Verify it works

1. **Check provider status.** Admin → Integrations should show the selected AI provider as configured.
2. **Generate a video.** Create a project; the provider summary should name the external model. A failure must surface ai_provider_error, never a silent local fallback.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module ai-providers
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 9. Research providers (Brave / Tavily)

`id: research` · category: `ai` · type: `config`

Optional web research that feeds sourced context into script generation. Default is none (offline).

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `SEARCH_PROVIDER` | no | Recommended (default `none`) | Choose none, brave, or tavily. |
| `SEARCH_API_KEY` | yes | `SEARCH_PROVIDER=brave` or `SEARCH_PROVIDER=tavily` | Brave Search API key or Tavily API key. |

### Provider console steps

1. **Choose a plan.** Both providers require a paid plan for sustained automated research; check quota limits.

### Verify it works

1. **Create a researched project.** Enable research mode in AI Studio and confirm sources appear on the project detail page.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module research
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 10. External image providers (OpenAI Images / Replicate)

`id: image-providers` · category: `media` · type: `config`

Optional generative scene images. The default procedural SVG engine creates original art offline with no credentials.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `IMAGE_PROVIDER` | no | Recommended (default `procedural`) | Choose procedural, openai, or replicate. |
| `OPENAI_API_KEY` | yes | `IMAGE_PROVIDER=openai` | Required when IMAGE_PROVIDER=openai. |
| `OPENAI_IMAGE_MODEL` | no | Optional | e.g. gpt-image-1. |
| `REPLICATE_API_TOKEN` | yes | `IMAGE_PROVIDER=replicate` | Required when IMAGE_PROVIDER=replicate. |
| `REPLICATE_IMAGE_MODEL` | no | Optional | e.g. black-forest-labs/flux-schnell. |

### Provider console steps

1. **Accept per-image costs.** Generative images are billed per request and multiply by scene count (MAX_SCENES).

### Verify it works

1. **Generate a project.** Scene art should come from the chosen provider; check provider logs on the project detail page.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module image-providers
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 11. External TTS providers (OpenAI TTS / ElevenLabs)

`id: tts-providers` · category: `media` · type: `config`

Optional higher-quality narration. The default offline mespeak engine supports ten languages with voice presets.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `TTS_PROVIDER` | no | Recommended (default `mespeak`) | Choose mespeak, openai, or elevenlabs. |
| `OPENAI_API_KEY` | yes | `TTS_PROVIDER=openai` | Required when TTS_PROVIDER=openai. |
| `OPENAI_TTS_MODEL` | no | Optional | e.g. gpt-4o-mini-tts. |
| `ELEVENLABS_API_KEY` | yes | `TTS_PROVIDER=elevenlabs` | Required when TTS_PROVIDER=elevenlabs. |
| `ELEVENLABS_VOICE_ID` | no | Optional | Voice preset ID, e.g. 21m00Tcm4TlvDq8ikWAM. |

### Provider console steps

1. **Check character quotas.** TTS billing is per character; long scripts consume quota quickly.

### Verify it works

1. **Render a video.** Confirm narration audio length matches the SRT captions in the rendered MP4.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module tts-providers
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 12. Public HTTPS origin, callbacks & signed media

`id: public-https-origin` · category: `infrastructure` · type: `hybrid`

The deployment itself. OAuth providers and Instagram require a real public HTTPS origin; signed media URLs must be fetchable by Meta. Also covers production cookie/security hardening.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `PUBLIC_BASE_URL` | no | Always | Exact origin registered with every OAuth provider and Stripe, e.g. https://studio.example.com |
| `NODE_ENV` | no | Recommended (default `production`) | Set to production for a real deployment. |
| `SECURE_COOKIES` | no | Recommended (default `true`) | Set to true when served over HTTPS. |

### Callback URLs

Replace `https://YOUR-DOMAIN` with your exact `PUBLIC_BASE_URL` (no trailing slash).

- **Facebook / Instagram OAuth callback** — `https://YOUR-DOMAIN/api/oauth/facebook/callback`
- **Google / YouTube OAuth callback** — `https://YOUR-DOMAIN/api/oauth/google/callback`
- **X OAuth callback** — `https://YOUR-DOMAIN/api/oauth/x/callback`
- **Sandbox OAuth callback (local testing)** — `https://YOUR-DOMAIN/api/oauth/sandbox/callback`
- **Stripe webhook endpoint** — `https://YOUR-DOMAIN/api/billing/webhook`

### Deployment steps

1. **Deploy behind HTTPS.** Terminate TLS at a reverse proxy or platform edge with a valid CA certificate. No self-signed certs for OAuth callbacks.
2. **Point DNS at the app.** PUBLIC_BASE_URL must match the external origin exactly — scheme, host, and port. No trailing slash.
3. **Forward the correct headers.** Set X-Forwarded-Proto/Host and keep TRUST_PROXY=true so Express builds correct redirect and callback URLs.
4. **Enable secure cookies.** Set SECURE_COOKIES=true, NODE_ENV=production, and a stable APP_ENCRYPTION_KEY (module 14).
5. **Disable seeded demo accounts.** Set SEED_DEMO=false and provide ADMIN_EMAIL / ADMIN_PASSWORD deliberately, or rotate the seeded credentials immediately.
6. **Whitelist all callback URLs.** Copy the exact URLs above into the Meta app, Google OAuth client, X app, and Stripe webhook settings.
7. **Verify signed media is public.** Generate a video, copy its signed media URL, and fetch it from outside your network.

### Verify it works

1. **Health probe.** npm run doctor -- --probe should report the public health endpoint as reachable.
2. **Cookie check.** Sign in and confirm the session cookie has Secure and HttpOnly flags.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module public-https-origin
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 13. Production database (PostgreSQL)

`id: postgres` · category: `infrastructure` · type: `hybrid`

Knex already supports PostgreSQL via DATABASE_URL, including schema creation, seeding, and conditional job claims verified with two real worker processes (pg-mem tests). Needs a real instance for multi-process production.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `DATABASE_URL` | no | Always | postgresql://user:password@host:5432/faceless_studio?sslmode=require — include the database name. |

### Deployment steps

1. **Create the database.** Use a managed PostgreSQL with TLS — Neon, Supabase, Railway, RDS/Aurora, Cloud SQL, or your own server. Create an empty database (for example faceless_studio); the app creates and migrates every table on first start. A free tier is sufficient to activate this module.
2. **Copy the direct connection URL.** Copy the direct/session string (port 5432), not a transaction pooler, for bootstrap and migrations. It must include the database name, and on managed providers append ?sslmode=require. Format: postgresql://USER:PASSWORD@HOST:5432/faceless_studio?sslmode=require
3. **Store it as a secret.** Set DATABASE_URL in your deployment secret store, or in the host .env with mode 0600. It contains the database password — never commit it.
4. **Prove the connection and schema.** With DATABASE_URL set, run npm run db:bootstrap (or npm run activate -- postgres). It connects with the real pg driver, creates and verifies every table, and proves two concurrent workers cannot claim the same job.
5. **Use a least-privilege role.** Grant only the schema privileges the app needs and keep superuser out of the runtime role.
6. **Run multiple workers.** Start one or more dedicated processes with WORKER_ENABLED=true and the same DATABASE_URL. Conditional job claims prevent duplicate work.
7. **Back up before migrating.** SQLite data does not automatically transfer to PostgreSQL. Export/import deliberately if you have existing local data.

### Verify it works

1. **Run the bootstrap proof.** DATABASE_URL=postgresql://… npm run db:bootstrap should report PASS for connection, schema, tables, two-worker claim and single execution.
2. **Start two workers.** Confirm both processes claim jobs without duplicates (see tests/postgres-multiprocess.test.js).
3. **Check doctor.** npm run doctor should report "Production database" as PASS.

### Official documentation

- [Knex PostgreSQL](https://knexjs.org/guide/query-builder.html)

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module postgres
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 14. Production credential encryption key

`id: encryption-key` · category: `security` · type: `config`

AES-256-GCM encryption for stored OAuth credentials. Development auto-generates data/development.key; production needs a stable base64 32-byte key. This module can be completed entirely offline.

### Environment variables

| Variable | Secret | Required when | Purpose |
|---|---|---|---|
| `APP_ENCRYPTION_KEY` | yes | Always | Generate with: openssl rand -base64 32. The wizard can generate one for you. |

### Deployment steps

1. **Store in a secret manager.** Keep this value in your platform secret store, not in a committed .env file.
2. **Never rotate casually.** Rotating the key makes existing encrypted OAuth tokens unreadable — reconnect accounts after a rotation.
3. **Back it up securely.** Losing the key means losing access to all stored account credentials.

### Verify it works

1. **Restart the server.** Existing connected accounts should still decrypt and pass the "Test" button.
2. **Check doctor.** npm run doctor should report "Credential encryption key" as PASS.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module encryption-key
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## 15. Provider app review / Business Verification

`id: app-review` · category: `compliance` · type: `external`

The four provider-console approval workflows (Meta, Google, X, Stripe). These cannot be automated from the repository — they require screencasts, business documents, scope justification, and reviewer decisions. Tracked as EXTERNAL until you confirm them.

### Environment variables

_No environment variables — this module is completed entirely in provider consoles._

**Depends on:** `#1 facebook-pages`, `#2 instagram-reels`, `#3 youtube`, `#4 x`, `#5 stripe`

### Provider console steps

1. **Meta App Review + Business Verification.** Request Advanced Access for all Facebook and Instagram permissions, submit a screencast of OAuth → review → publish, complete Business Verification, and add test Pages/Professional accounts.
2. **Google consent screen verification.** Publish the OAuth consent screen or add verified test users; justify youtube.upload and yt-analytics.readonly as sensitive scopes; enable all three YouTube APIs.
3. **X app permission review.** Configure OAuth 1.0a with read/write permissions, exact callback URL, media upload access, and an approved automated-posting use case; confirm the tier covers private playback metrics.
4. **Stripe account activation.** Activate the account, create live recurring Prices, register the live webhook endpoint and its four events, and replay test events before enabling live keys.

### Verify it works

1. **Connect a real external user.** Test with an account that is NOT an app admin/developer/tester — Standard Access hides failures here.
2. **Publish live.** Perform at least one real post to each approved platform and confirm the remote URL.
3. **Confirm metrics.** Verify official metrics arrive and are not labelled simulated.
4. **Re-run doctor.** npm run doctor -- --probe; all EXTERNAL items should now be confirmed in the provider consoles.

<details><summary>Finish this module with the wizard</summary>

```bash
npm run setup -- --module app-review
```

The wizard shows this module's checklist, prompts for each value with input
hidden for secrets, validates the format, writes `.env`, and re-runs the
preflight check.

</details>

[↑ Back to index](#module-index)

---

## After activation

```bash
npm run doctor -- --json     # machine-readable readiness
npm test                     # offline contract tests
npm run test:e2e             # full sandbox generation -> publishing workflow
```

Then perform a **live smoke test** with a real external account that is *not*
an app admin/developer/tester — provider "Standard Access" hides permission
problems for app team members. Publish one real short video to each approved
platform, confirm the permalink, and verify official metrics arrive and are not
labelled simulated.

Simulator results are never presented as live provider posts. Sandbox metrics
are deterministic, explicitly labelled simulated, and excluded from
data-backed recommendations.
