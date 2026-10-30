# Activation progress — module by module

Generated from the live preflight report, live verification results and the
completion audit. Regenerate with:

```bash
npm run --silent setup -- --work all --record --progress
```

Generated: 2026-10-30T09:24:24.785Z

| Metric | Value |
|---|---|
| Modules fully complete | 0 / 15 |
| In progress | 6 |
| Not started | 9 |
| Criteria met | 16 / 70 |
| Local preflight ready | 5 |

> **Honesty rule.** A module is complete only when every criterion is backed
> by real state: valid configuration, a recorded live verification, a
> human attestation for provider-console steps, and real evidence (connected
> account, live post, official metrics, processed webhook). Nothing here is
> auto-confirmed and no credentials are printed.

## Recommended working order

Infrastructure and security first, then offline-verifiable providers, then
notification channels, then publishing integrations, then app review.

## One-by-one driver

```bash
npm run activate -- --list                       # remaining modules in dependency order
KEY=value npm run activate -- <id>               # supply a credential from a secret manager
npm run activate -- <id> --attest "what you did" # human attestation (audit-logged)
npm run setup:runbooks                          # regenerate docs/ACTIVATION.md
```

`npm run activate` reads credentials from the process environment or
`--set KEY=VALUE`, format-validates them, writes them to a gitignored `.env`,
runs the **real** live verifier, records it, and prints the remaining
criteria. It never invents credentials and never auto-attests.

**Modules 12 and 13** are deployment work. The repository now ships a real
production stack — [deploy/README.md](../deploy/README.md) — with a Dockerfile,
Compose (API + 2 workers + PostgreSQL + Caddy TLS), a dedicated worker
process, `npm run db:bootstrap` (real Postgres + two-worker claim proof) and
`npm run deploy:check` (real external DNS/TLS/health/cookie/media probe).

## Module index

| # | Module | Preflight | Verification | Audit | Status |
|---|---|---|---|---|---|
| 14 | [Production credential encryption key](#14-production-credential-encryption-key) | ready | verified | 3/4 | ⬜ |
| 12 | [Public HTTPS origin, callbacks & signed media](#12-public-https-origin-callbacks--signed-media) | incomplete | unconfigured | 0/5 | ⬜ |
| 13 | [Production database (PostgreSQL)](#13-production-database-postgresql) | incomplete | unconfigured | 1/4 | ⬜ |
| 8 | [External AI script providers](#8-external-ai-script-providers) | ready | verified | 3/4 | ⬜ |
| 9 | [Research providers (Brave / Tavily)](#9-research-providers-brave--tavily) | ready | verified | 3/4 | ⬜ |
| 10 | [External image providers (OpenAI Images / Replicate)](#10-external-image-providers-openai-images--replicate) | ready | verified | 3/4 | ⬜ |
| 11 | [External TTS providers (OpenAI TTS / ElevenLabs)](#11-external-tts-providers-openai-tts--elevenlabs) | ready | verified | 3/4 | ⬜ |
| 6 | [SMTP email notifications](#6-smtp-email-notifications) | incomplete | unconfigured | 0/4 | ⬜ |
| 7 | [Signed notification webhooks](#7-signed-notification-webhooks) | incomplete | unconfigured | 0/4 | ⬜ |
| 1 | [Facebook Pages publishing](#1-facebook-pages-publishing) | incomplete | unconfigured | 0/6 | ⬜ |
| 2 | [Instagram Business / Reels publishing](#2-instagram-business--reels-publishing) | incomplete | unconfigured | 0/7 | ⬜ |
| 3 | [YouTube publishing & analytics](#3-youtube-publishing--analytics) | incomplete | unconfigured | 0/7 | ⬜ |
| 4 | [X publishing & analytics](#4-x-publishing--analytics) | incomplete | unconfigured | 0/5 | ⬜ |
| 5 | [Stripe billing (checkout + webhooks)](#5-stripe-billing-checkout--webhooks) | incomplete | unconfigured | 0/5 | ⬜ |
| 15 | [Provider app review / Business Verification](#15-provider-app-review--business-verification) | external | unsupported | 0/3 | ⬜ |

---
## 14. Production credential encryption key

`id: encryption-key` · category: `security` · type: `config` · **UNFINISHED**

AES-256-GCM encryption for stored OAuth credentials. Development auto-generates data/development.key; production needs a stable base64 32-byte key. This module can be completed entirely offline.

| Check | Value |
|---|---|
| Offline preflight | ready (1/1) |
| Live verification | verified — 2026-10-30T09:24:24.637Z |
| Completion audit | 3/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ✅ pass | You — server environment | Done |
| Live verification passed | ✅ pass | This repository (automatable) | Done |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Stored credentials decrypt with the current key | ✅ pass | You — deployment / infrastructure | Done |

### What can be done from this repository now

- Live verification PASSED. Persist it with `npm run setup -- --work encryption-key --record` (audit-logged).

### What only you can do

- Complete 3 deployment step(s).

### Deployment steps

1. **Store in a secret manager.** Keep this value in your platform secret store, not in a committed .env file.
2. **Never rotate casually.** Rotating the key makes existing encrypted OAuth tokens unreadable — reconnect accounts after a rotation.
3. **Back it up securely.** Losing the key means losing access to all stored account credentials.

### Verify it works

1. **Restart the server.** Existing connected accounts should still decrypt and pass the "Test" button.
2. **Check doctor.** npm run doctor should report "Credential encryption key" as PASS.

### Commands for this module

```bash
npm run activate -- encryption-key                # one-by-one: configure, verify, record, report
npm run setup -- --work encryption-key             # inspect this module's live state
npm run setup -- --work encryption-key --record    # run + record live verification
npm run setup -- --module encryption-key           # interactive value entry
npm run setup -- --verify encryption-key           # read-only credential probe
npm run activate -- encryption-key --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 12. Public HTTPS origin, callbacks & signed media

`id: public-https-origin` · category: `infrastructure` · type: `hybrid` · **UNFINISHED**

The deployment itself. OAuth providers and Instagram require a real public HTTPS origin; signed media URLs must be fetchable by Meta. Also covers production cookie/security hardening.

| Check | Value |
|---|---|
| Offline preflight | incomplete (2/3) |
| Live verification | unconfigured — 2026-10-30T09:24:24.636Z |
| Completion audit | 0/5 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module public-https-origin` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Public HTTPS origin | ⬜ pending | You — deployment / infrastructure | Deploy behind HTTPS with a valid certificate and set PUBLIC_BASE_URL. |
| Secure session cookies | ⬜ pending | You — deployment / infrastructure | Set NODE_ENV=production and SECURE_COOKIES=true. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `PUBLIC_BASE_URL` | no | Exact origin registered with every OAuth provider and Stripe, e.g. https://studio.example.com | `npm run setup -- --set PUBLIC_BASE_URL=<VALUE>` |
| `NODE_ENV` | no | Set to production for a real deployment. | `npm run setup -- --set NODE_ENV=<VALUE>` |
| `SECURE_COOKIES` | no | Set to true when served over HTTPS. | `npm run setup -- --set SECURE_COOKIES=<VALUE>` |

### Callback / webhook URLs

Derived from `PUBLIC_BASE_URL=https://YOUR-DOMAIN`. Register these **exactly** (no trailing slash).

- **Facebook / Instagram OAuth callback** — `https://YOUR-DOMAIN/api/oauth/facebook/callback`
- **Google / YouTube OAuth callback** — `https://YOUR-DOMAIN/api/oauth/google/callback`
- **X OAuth callback** — `https://YOUR-DOMAIN/api/oauth/x/callback`
- **Sandbox OAuth callback (local testing)** — `https://YOUR-DOMAIN/api/oauth/sandbox/callback`
- **Stripe webhook endpoint** — `https://YOUR-DOMAIN/api/billing/webhook`

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work public-https-origin --record`.

### What only you can do

- Supply 3 environment value(s): `PUBLIC_BASE_URL`, `NODE_ENV`, `SECURE_COOKIES`.
- Complete 7 deployment step(s).

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

### Commands for this module

```bash
npm run activate -- public-https-origin                # one-by-one: configure, verify, record, report
npm run setup -- --work public-https-origin             # inspect this module's live state
npm run setup -- --work public-https-origin --record    # run + record live verification
npm run setup -- --module public-https-origin           # interactive value entry
npm run setup -- --verify public-https-origin           # read-only credential probe
npm run activate -- public-https-origin --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 13. Production database (PostgreSQL)

`id: postgres` · category: `infrastructure` · type: `hybrid` · **UNFINISHED**

Knex already supports PostgreSQL via DATABASE_URL, including schema creation, seeding, and conditional job claims verified with two real worker processes (pg-mem tests). Needs a real instance for multi-process production.

| Check | Value |
|---|---|
| Offline preflight | incomplete (0/1) |
| Live verification | unconfigured — 2026-10-30T09:24:24.636Z |
| Completion audit | 1/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module postgres` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Background worker enabled | ✅ pass | You — deployment / infrastructure | Done |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `DATABASE_URL` | no | postgresql://user:password@host:5432/faceless_studio?sslmode=require — include the database name. | `npm run setup -- --set DATABASE_URL=<VALUE>` |

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work postgres --record`.

### What only you can do

- Supply 1 environment value(s): `DATABASE_URL`.
- Complete 7 deployment step(s).

### Deployment steps

1. **Create the database.** Use a managed PostgreSQL with TLS — Neon, Supabase, Railway, RDS/Aurora, Cloud SQL, or your own server. Create an empty database (for example faceless_studio); the app creates and migrates every table on first start. A free tier is sufficient to activate this module.
2. **Copy the direct connection URL.** Copy the direct/session string (port 5432), not a transaction pooler, for bootstrap and migrations. It must include the database name, and on managed providers append ?sslmode=require. Format: postgresql://USER:PASSWORD@HOST:5432/faceless_studio?sslmode=require
3. **Store it as a secret.** Set DATABASE_URL in your deployment secret store, or in the host .env with mode 0600. It contains the database password — never commit it.
4. **Prove the connection and schema.** With DATABASE_URL set, run npm run db:bootstrap (or npm run activate -- postgres). It connects with the real pg driver, creates and verifies every table, and proves two concurrent workers cannot claim the same job.
5. **Use a least-privilege role.** Grant only the schema privileges the app needs and keep superuser out of the runtime role.
6. **Run multiple workers.** Start one or more dedicated processes with WORKER_ENABLED=true and the same DATABASE_URL. Conditional job claims prevent duplicate work.
7. **Back up before migrating.** SQLite data does not automatically transfer to PostgreSQL. Export/import deliberately if you have existing local data.

### Verify it works

1. **Run the bootstrap proof.** DATABASE_URL=postgresql://… npm run db:bootstrap should report PASS for connection, schema, tables, two-worker claim and single execution. Then npm run activate -- postgres --verify-only re-checks the server version, TLS and schema readiness.
2. **Start two workers.** Confirm both processes claim jobs without duplicates (see tests/postgres-multiprocess.test.js).
3. **Check doctor.** npm run doctor should report "Production database" as PASS.

### Official documentation

- [Knex PostgreSQL](https://knexjs.org/guide/query-builder.html)

### Commands for this module

```bash
npm run activate -- postgres                # one-by-one: configure, verify, record, report
npm run setup -- --work postgres             # inspect this module's live state
npm run setup -- --work postgres --record    # run + record live verification
npm run setup -- --module postgres           # interactive value entry
npm run setup -- --verify postgres           # read-only credential probe
npm run activate -- postgres --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 8. External AI script providers

`id: ai-providers` · category: `ai` · type: `config` · **UNFINISHED**

OpenAI, Anthropic, and Gemini adapters for scripts, scene plans, captions and hashtags. Optional — the built-in local multilingual engine works offline and is the default.

| Check | Value |
|---|---|
| Offline preflight | ready (4/4) |
| Live verification | verified — 2026-10-30T09:24:24.635Z |
| Completion audit | 3/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ✅ pass | You — server environment | Done |
| Live verification passed | ✅ pass | This repository (automatable) | Done |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| AI provider active | ✅ pass | You — server environment | Done |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `AI_PROVIDER` | no | Choose local (offline), openai, anthropic, or gemini. | `npm run setup -- --set AI_PROVIDER=<VALUE>` |

### What can be done from this repository now

- Live verification PASSED. Persist it with `npm run setup -- --work ai-providers --record` (audit-logged).

### What only you can do

- Supply 1 environment value(s): `AI_PROVIDER`.
- Complete 1 provider-console step(s).

### Provider console steps

1. **Set billing limits.** External AI usage incurs provider charges. Set a hard monthly spend cap in the provider console.

### Verify it works

1. **Check provider status.** Admin → Integrations should show the selected AI provider as configured.
2. **Generate a video.** Create a project; the provider summary should name the external model. A failure must surface ai_provider_error, never a silent local fallback.

### Commands for this module

```bash
npm run activate -- ai-providers                # one-by-one: configure, verify, record, report
npm run setup -- --work ai-providers             # inspect this module's live state
npm run setup -- --work ai-providers --record    # run + record live verification
npm run setup -- --module ai-providers           # interactive value entry
npm run setup -- --verify ai-providers           # read-only credential probe
npm run activate -- ai-providers --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 9. Research providers (Brave / Tavily)

`id: research` · category: `ai` · type: `config` · **UNFINISHED**

Optional web research that feeds sourced context into script generation. Default is none (offline).

| Check | Value |
|---|---|
| Offline preflight | ready (1/1) |
| Live verification | verified — 2026-10-30T09:24:24.635Z |
| Completion audit | 3/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ✅ pass | You — server environment | Done |
| Live verification passed | ✅ pass | This repository (automatable) | Done |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Research provider active | ✅ pass | You — server environment | Done |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `SEARCH_PROVIDER` | no | Choose none, brave, or tavily. | `npm run setup -- --set SEARCH_PROVIDER=<VALUE>` |

### What can be done from this repository now

- Live verification PASSED. Persist it with `npm run setup -- --work research --record` (audit-logged).

### What only you can do

- Supply 1 environment value(s): `SEARCH_PROVIDER`.
- Complete 1 provider-console step(s).

### Provider console steps

1. **Choose a plan.** Both providers require a paid plan for sustained automated research; check quota limits.

### Verify it works

1. **Create a researched project.** Enable research mode in AI Studio and confirm sources appear on the project detail page.

### Commands for this module

```bash
npm run activate -- research                # one-by-one: configure, verify, record, report
npm run setup -- --work research             # inspect this module's live state
npm run setup -- --work research --record    # run + record live verification
npm run setup -- --module research           # interactive value entry
npm run setup -- --verify research           # read-only credential probe
npm run activate -- research --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 10. External image providers (OpenAI Images / Replicate)

`id: image-providers` · category: `media` · type: `config` · **UNFINISHED**

Optional generative scene images. The default procedural SVG engine creates original art offline with no credentials.

| Check | Value |
|---|---|
| Offline preflight | ready (3/3) |
| Live verification | verified — 2026-10-30T09:24:24.636Z |
| Completion audit | 3/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ✅ pass | You — server environment | Done |
| Live verification passed | ✅ pass | This repository (automatable) | Done |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| image provider active | ✅ pass | You — server environment | Done |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `IMAGE_PROVIDER` | no | Choose procedural, openai, or replicate. | `npm run setup -- --set IMAGE_PROVIDER=<VALUE>` |

### What can be done from this repository now

- Live verification PASSED. Persist it with `npm run setup -- --work image-providers --record` (audit-logged).

### What only you can do

- Supply 1 environment value(s): `IMAGE_PROVIDER`.
- Complete 1 provider-console step(s).

### Provider console steps

1. **Accept per-image costs.** Generative images are billed per request and multiply by scene count (MAX_SCENES).

### Verify it works

1. **Generate a project.** Scene art should come from the chosen provider; check provider logs on the project detail page.

### Commands for this module

```bash
npm run activate -- image-providers                # one-by-one: configure, verify, record, report
npm run setup -- --work image-providers             # inspect this module's live state
npm run setup -- --work image-providers --record    # run + record live verification
npm run setup -- --module image-providers           # interactive value entry
npm run setup -- --verify image-providers           # read-only credential probe
npm run activate -- image-providers --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 11. External TTS providers (OpenAI TTS / ElevenLabs)

`id: tts-providers` · category: `media` · type: `config` · **UNFINISHED**

Optional higher-quality narration. The default offline mespeak engine supports ten languages with voice presets.

| Check | Value |
|---|---|
| Offline preflight | ready (3/3) |
| Live verification | verified — 2026-10-30T09:24:24.636Z |
| Completion audit | 3/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ✅ pass | You — server environment | Done |
| Live verification passed | ✅ pass | This repository (automatable) | Done |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| TTS provider active | ✅ pass | You — server environment | Done |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `TTS_PROVIDER` | no | Choose mespeak, openai, or elevenlabs. | `npm run setup -- --set TTS_PROVIDER=<VALUE>` |

### What can be done from this repository now

- Live verification PASSED. Persist it with `npm run setup -- --work tts-providers --record` (audit-logged).

### What only you can do

- Supply 1 environment value(s): `TTS_PROVIDER`.
- Complete 1 provider-console step(s).

### Provider console steps

1. **Check character quotas.** TTS billing is per character; long scripts consume quota quickly.

### Verify it works

1. **Render a video.** Confirm narration audio length matches the SRT captions in the rendered MP4.

### Commands for this module

```bash
npm run activate -- tts-providers                # one-by-one: configure, verify, record, report
npm run setup -- --work tts-providers             # inspect this module's live state
npm run setup -- --work tts-providers --record    # run + record live verification
npm run setup -- --module tts-providers           # interactive value entry
npm run setup -- --verify tts-providers           # read-only credential probe
npm run activate -- tts-providers --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 6. SMTP email notifications

`id: smtp` · category: `notifications` · type: `config` · **UNFINISHED**

Nodemailer transport that mirrors in-app notifications to email. Fully implemented; only the SMTP connection URL is missing. No provider approval needed.

| Check | Value |
|---|---|
| Offline preflight | incomplete (1/2) |
| Live verification | unconfigured — 2026-10-30T09:24:24.635Z |
| Completion audit | 0/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module smtp` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| SMTP transport configured | ⬜ pending | You — server environment | Set SMTP_URL in the server environment. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `SMTP_URL` | yes | e.g. smtps://user:password@smtp.example.com:465. URL-encode special characters in the password. | `npm run setup -- --set SMTP_URL=<VALUE>` |

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work smtp --record`.

### What only you can do

- Supply 1 environment value(s): `SMTP_URL`.
- Complete 2 provider-console step(s).

### Provider console steps

1. **Create an SMTP credential.** Use your mail provider's app password / SMTP user. Avoid personal account passwords.
2. **Verify the sender domain.** Configure SPF, DKIM and DMARC for the From domain to avoid spam filtering.

### Verify it works

1. **Trigger a notification.** Any billing/plan change or broadcast sends an email. Check the server log for "Email notification failed" if nothing arrives.

### Official documentation

- [Nodemailer SMTP](https://nodemailer.com/smtp/)

### Commands for this module

```bash
npm run activate -- smtp                # one-by-one: configure, verify, record, report
npm run setup -- --work smtp             # inspect this module's live state
npm run setup -- --work smtp --record    # run + record live verification
npm run setup -- --module smtp           # interactive value entry
npm run setup -- --verify smtp           # read-only credential probe
npm run activate -- smtp --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 7. Signed notification webhooks

`id: notification-webhook` · category: `notifications` · type: `config` · **UNFINISHED**

Outbound notification events with HMAC-SHA256 X-Faceless-Signature, 3-attempt retry with backoff, and timeout. Needs a receiver URL and a shared secret.

| Check | Value |
|---|---|
| Offline preflight | incomplete (0/2) |
| Live verification | unconfigured — 2026-10-30T09:24:24.635Z |
| Completion audit | 0/4 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module notification-webhook` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Signed webhook receiver configured | ⬜ pending | You — server environment | Set NOTIFICATION_WEBHOOK_URL and NOTIFICATION_WEBHOOK_SECRET. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `NOTIFICATION_WEBHOOK_URL` | no | Absolute HTTPS URL of your receiver (http allowed for local testing only). | `npm run setup -- --set NOTIFICATION_WEBHOOK_URL=<VALUE>` |
| `NOTIFICATION_WEBHOOK_SECRET` | yes | At least 16 random characters; used to sign "timestamp.rawBody". | `npm run setup -- --set NOTIFICATION_WEBHOOK_SECRET=<VALUE>` |

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work notification-webhook --record`.

### What only you can do

- Supply 2 environment value(s): `NOTIFICATION_WEBHOOK_URL`, `NOTIFICATION_WEBHOOK_SECRET`.
- Complete 4 provider-console step(s).

### Provider console steps

1. **Generate a shared secret.** e.g. openssl rand -hex 24. Store the same value in your receiver.
2. **Verify the signature.** Compute sha256 HMAC over "<x-faceless-timestamp>.<raw body>" and compare with a constant-time comparison against X-Faceless-Signature (sha256=…).
3. **Enforce a timestamp window.** Reject events older than 5 minutes to prevent replay.
4. **Deduplicate by event id.** Delivery retries (3 attempts) can repeat the same notification.

### Verify it works

1. **Trigger a broadcast.** Admin → Broadcast; your receiver should get notification.created with a valid signature.
2. **Test retry behaviour.** Return a 503 from the receiver and confirm three attempts in the server log.

### Commands for this module

```bash
npm run activate -- notification-webhook                # one-by-one: configure, verify, record, report
npm run setup -- --work notification-webhook             # inspect this module's live state
npm run setup -- --work notification-webhook --record    # run + record live verification
npm run setup -- --module notification-webhook           # interactive value entry
npm run setup -- --verify notification-webhook           # read-only credential probe
npm run activate -- notification-webhook --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 1. Facebook Pages publishing

`id: facebook-pages` · category: `publishing` · type: `hybrid` · **UNFINISHED**

Official Meta OAuth connect and video publishing to Facebook Pages. Adapters, token exchange/refresh, metrics and revoke are implemented; activation needs a Meta app with approved permissions.

| Check | Value |
|---|---|
| Offline preflight | incomplete (1/5) |
| Live verification | unconfigured — 2026-10-30T09:24:24.634Z |
| Completion audit | 0/6 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module facebook-pages` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Connected, active Facebook Page account | ⬜ pending | You — real production usage | Use Accounts → Connect Facebook Page and approve the OAuth consent screen. |
| Facebook publishing permissions granted | ⬜ pending | You — real production usage | Disconnect and reconnect the account, granting every requested scope (and request Advanced Access in the provider console). |
| Live published post on Facebook | ⬜ pending | You — real production usage | Publish one real short video and confirm the remote permalink resolves while signed out. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `META_APP_ID` | no | Numeric App ID from the Meta app dashboard (Settings → Basic). | `npm run setup -- --set META_APP_ID=<VALUE>` |
| `META_APP_SECRET` | yes | App Secret from Settings → Basic. Never put this in frontend code. | `npm run setup -- --set META_APP_SECRET=<VALUE>` |

### Callback / webhook URLs

Derived from `PUBLIC_BASE_URL=https://YOUR-DOMAIN`. Register these **exactly** (no trailing slash).

- **Facebook / Instagram OAuth callback** — `https://YOUR-DOMAIN/api/oauth/facebook/callback`

### Required scopes / permissions / events

- `public_profile`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `business_management`

### Depends on

- #12 Public HTTPS origin, callbacks & signed media — **not complete**

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work facebook-pages --record`.

### What only you can do

- Supply 2 environment value(s): `META_APP_ID`, `META_APP_SECRET`.
- First finish: #12 Public HTTPS origin, callbacks & signed media.
- Complete 6 provider-console step(s).
- Complete 1 deployment step(s).
- Produce real evidence: connect an account and publish at least one live post, then sync metrics.

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

### Commands for this module

```bash
npm run activate -- facebook-pages                # one-by-one: configure, verify, record, report
npm run setup -- --work facebook-pages             # inspect this module's live state
npm run setup -- --work facebook-pages --record    # run + record live verification
npm run setup -- --module facebook-pages           # interactive value entry
npm run setup -- --verify facebook-pages           # read-only credential probe
npm run activate -- facebook-pages --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 2. Instagram Business / Reels publishing

`id: instagram-reels` · category: `publishing` · type: `hybrid` · **UNFINISHED**

Reels publishing via the Meta Graph container API. Shares the Facebook OAuth app and additionally requires a publicly reachable HTTPS media URL — Meta downloads the video from the signed URL.

| Check | Value |
|---|---|
| Offline preflight | incomplete (0/5) |
| Live verification | unconfigured — 2026-10-30T09:24:24.635Z |
| Completion audit | 0/7 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module instagram-reels` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Connected, active Instagram account | ⬜ pending | You — real production usage | Use Accounts → Connect Instagram and approve the OAuth consent screen. |
| Instagram publishing permissions granted | ⬜ pending | You — real production usage | Disconnect and reconnect the account, granting every requested scope (and request Advanced Access in the provider console). |
| Public media URL available | ⬜ pending | You — deployment / infrastructure | Generate a video, then verify the signed media URL from outside your network. |
| Live published post on Instagram | ⬜ pending | You — real production usage | Publish one real short video and confirm the remote permalink resolves while signed out. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `META_APP_ID` | no | Same app as Facebook Pages (module 1). | `npm run setup -- --set META_APP_ID=<VALUE>` |
| `META_APP_SECRET` | yes | Same app secret as module 1. | `npm run setup -- --set META_APP_SECRET=<VALUE>` |
| `PUBLIC_BASE_URL` | no | Must be publicly reachable over HTTPS so Meta can fetch the rendered MP4. | `npm run setup -- --set PUBLIC_BASE_URL=<VALUE>` |

### Callback / webhook URLs

Derived from `PUBLIC_BASE_URL=https://YOUR-DOMAIN`. Register these **exactly** (no trailing slash).

- **Facebook / Instagram OAuth callback** — `https://YOUR-DOMAIN/api/oauth/facebook/callback`

### Required scopes / permissions / events

- `instagram_basic`
- `instagram_content_publish`
- `instagram_manage_insights`
- `pages_read_engagement`

### Depends on

- #1 Facebook Pages publishing — **not complete**
- #12 Public HTTPS origin, callbacks & signed media — **not complete**

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work instagram-reels --record`.

### What only you can do

- Supply 3 environment value(s): `META_APP_ID`, `META_APP_SECRET`, `PUBLIC_BASE_URL`.
- First finish: #1 Facebook Pages publishing, #12 Public HTTPS origin, callbacks & signed media.
- Complete 4 provider-console step(s).
- Complete 2 deployment step(s).
- Produce real evidence: connect an account and publish at least one live post, then sync metrics.

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

### Commands for this module

```bash
npm run activate -- instagram-reels                # one-by-one: configure, verify, record, report
npm run setup -- --work instagram-reels             # inspect this module's live state
npm run setup -- --work instagram-reels --record    # run + record live verification
npm run setup -- --module instagram-reels           # interactive value entry
npm run setup -- --verify instagram-reels           # read-only credential probe
npm run activate -- instagram-reels --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 3. YouTube publishing & analytics

`id: youtube` · category: `publishing` · type: `hybrid` · **UNFINISHED**

Resumable uploads, captions, Data API engagement, Analytics API watch time/shares, and Reporting API thumbnail impressions. Needs a Google OAuth client with verified scopes.

| Check | Value |
|---|---|
| Offline preflight | incomplete (0/4) |
| Live verification | unconfigured — 2026-10-30T09:24:24.635Z |
| Completion audit | 0/7 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module youtube` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Connected, active YouTube account | ⬜ pending | You — real production usage | Use Accounts → Connect YouTube and approve the OAuth consent screen. |
| YouTube API permissions granted | ⬜ pending | You — real production usage | Disconnect and reconnect the account, granting every requested scope (and request Advanced Access in the provider console). |
| Live published post on YouTube | ⬜ pending | You — real production usage | Publish one real short video and confirm the remote permalink resolves while signed out. |
| Official YouTube metrics synced | ⬜ pending | You — real production usage | Run a metrics sync on a published YouTube video after it has views. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | no | From Google Cloud → APIs & Services → Credentials (Web application). | `npm run setup -- --set GOOGLE_CLIENT_ID=<VALUE>` |
| `GOOGLE_CLIENT_SECRET` | yes | From the same OAuth client entry. | `npm run setup -- --set GOOGLE_CLIENT_SECRET=<VALUE>` |

### Callback / webhook URLs

Derived from `PUBLIC_BASE_URL=https://YOUR-DOMAIN`. Register these **exactly** (no trailing slash).

- **Google / YouTube OAuth callback** — `https://YOUR-DOMAIN/api/oauth/google/callback`

### Required scopes / permissions / events

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.force-ssl`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

### Depends on

- #12 Public HTTPS origin, callbacks & signed media — **not complete**

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work youtube --record`.

### What only you can do

- Supply 2 environment value(s): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- First finish: #12 Public HTTPS origin, callbacks & signed media.
- Complete 6 provider-console step(s).
- Complete 1 deployment step(s).
- Produce real evidence: connect an account and publish at least one live post, then sync metrics.

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

### Commands for this module

```bash
npm run activate -- youtube                # one-by-one: configure, verify, record, report
npm run setup -- --work youtube             # inspect this module's live state
npm run setup -- --work youtube --record    # run + record live verification
npm run setup -- --module youtube           # interactive value entry
npm run setup -- --verify youtube           # read-only credential probe
npm run activate -- youtube --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 4. X publishing & analytics

`id: x` · category: `publishing` · type: `hybrid` · **UNFINISHED**

OAuth 1.0a user-context connect, chunked v1.1 media upload, v2 post creation, public metrics, and private playback quartile estimates. Needs an approved read/write app and a sufficient API tier.

| Check | Value |
|---|---|
| Offline preflight | incomplete (0/4) |
| Live verification | unconfigured — 2026-10-30T09:24:24.635Z |
| Completion audit | 0/5 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module x` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Connected, active X account | ⬜ pending | You — real production usage | Use Accounts → Connect X and approve the OAuth consent screen. |
| Live published post on X | ⬜ pending | You — real production usage | Publish one real short video and confirm the remote permalink resolves while signed out. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `X_CONSUMER_KEY` | no | From the developer portal → your App → Keys and tokens. | `npm run setup -- --set X_CONSUMER_KEY=<VALUE>` |
| `X_CONSUMER_SECRET` | yes | From the same Keys and tokens page. | `npm run setup -- --set X_CONSUMER_SECRET=<VALUE>` |

### Callback / webhook URLs

Derived from `PUBLIC_BASE_URL=https://YOUR-DOMAIN`. Register these **exactly** (no trailing slash).

- **X OAuth callback** — `https://YOUR-DOMAIN/api/oauth/x/callback`

### Required scopes / permissions / events

- `Read and write app permissions`
- `Media upload access`
- `Exact callback URL match`

### Depends on

- #12 Public HTTPS origin, callbacks & signed media — **not complete**

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work x --record`.

### What only you can do

- Supply 2 environment value(s): `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`.
- First finish: #12 Public HTTPS origin, callbacks & signed media.
- Complete 4 provider-console step(s).
- Complete 1 deployment step(s).
- Produce real evidence: connect an account and publish at least one live post, then sync metrics.

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

### Commands for this module

```bash
npm run activate -- x                # one-by-one: configure, verify, record, report
npm run setup -- --work x             # inspect this module's live state
npm run setup -- --work x --record    # run + record live verification
npm run setup -- --module x           # interactive value entry
npm run setup -- --verify x           # read-only credential probe
npm run activate -- x --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 5. Stripe billing (checkout + webhooks)

`id: stripe` · category: `billing` · type: `hybrid` · **UNFINISHED**

Subscription checkout, signature-verified webhooks, idempotent event storage, and plan assignment. Needs Stripe keys, real recurring Price IDs, and a registered webhook endpoint.

| Check | Value |
|---|---|
| Offline preflight | incomplete (0/4) |
| Live verification | unconfigured — 2026-10-30T09:24:24.635Z |
| Completion audit | 0/5 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Local configuration | ⬜ pending | You — server environment | Run `npm run setup -- --module stripe` and fill the missing values. |
| Live verification passed | ⬜ pending | This repository (automatable) | Click Verify once the credentials are in place. |
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Stripe Price IDs on every paid plan | ⬜ pending | You — server environment | Create a recurring Price in Stripe and paste its price_… ID into Admin → Plans. |
| Signed Stripe webhook processed | ⬜ pending | You — real production usage | Register /api/billing/webhook in Stripe and replay a test checkout.session.completed event. |

### Values you must supply

Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).

| Variable | Secret | What it is | Command |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Test with sk_test_…, go live with sk_live_… only after replay tests pass. | `npm run setup -- --set STRIPE_SECRET_KEY=<VALUE>` |
| `STRIPE_WEBHOOK_SECRET` | yes | The whsec_… value shown for your webhook endpoint, not the API key. | `npm run setup -- --set STRIPE_WEBHOOK_SECRET=<VALUE>` |

### Callback / webhook URLs

Derived from `PUBLIC_BASE_URL=https://YOUR-DOMAIN`. Register these **exactly** (no trailing slash).

- **Stripe webhook endpoint** — `https://YOUR-DOMAIN/api/billing/webhook`

### Required scopes / permissions / events

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

### Depends on

- #12 Public HTTPS origin, callbacks & signed media — **not complete**

### What can be done from this repository now

- Verification is blocked until the credentials above are set. Then run `npm run setup -- --work stripe --record`.

### What only you can do

- Supply 2 environment value(s): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- First finish: #12 Public HTTPS origin, callbacks & signed media.
- Complete 6 provider-console step(s).
- Complete 1 deployment step(s).
- Produce real evidence: connect an account and publish at least one live post, then sync metrics.

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

### Commands for this module

```bash
npm run activate -- stripe                # one-by-one: configure, verify, record, report
npm run setup -- --work stripe             # inspect this module's live state
npm run setup -- --work stripe --record    # run + record live verification
npm run setup -- --module stripe           # interactive value entry
npm run setup -- --verify stripe           # read-only credential probe
npm run activate -- stripe --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---

## 15. Provider app review / Business Verification

`id: app-review` · category: `compliance` · type: `external` · **UNFINISHED**

The four provider-console approval workflows (Meta, Google, X, Stripe). These cannot be automated from the repository — they require screencasts, business documents, scope justification, and reviewer decisions. Tracked as EXTERNAL until you confirm them.

| Check | Value |
|---|---|
| Offline preflight | external (0/5) |
| Live verification | unsupported — 2026-10-30T09:24:24.637Z |
| Completion audit | 0/3 criteria |

### Completion criteria

| Criterion | Status | Owner | Next action |
|---|---|---|---|
| Provider / deployment steps confirmed | ⬜ pending | You — provider console | Finish the checklist in the provider console, then click "Mark steps done". |
| Live post published with a non-team account | ⬜ pending | You — real production usage | Publish one real short video using an account that is not an app admin/developer/tester — Standard Access hides permission problems for team members. |
| Official metrics received | ⬜ pending | You — real production usage | Sync metrics on a live official post and confirm they are not labelled simulated. |

### Depends on

- #1 Facebook Pages publishing — **not complete**
- #2 Instagram Business / Reels publishing — **not complete**
- #3 YouTube publishing & analytics — **not complete**
- #4 X publishing & analytics — **not complete**
- #5 Stripe billing (checkout + webhooks) — **not complete**

### What can be done from this repository now

- No automated verifier exists for this module — it requires a human attestation plus real evidence.

### What only you can do

- First finish: #1 Facebook Pages publishing, #2 Instagram Business / Reels publishing, #3 YouTube publishing & analytics, #4 X publishing & analytics, #5 Stripe billing (checkout + webhooks).
- Complete 4 provider-console step(s).
- Produce real evidence: connect an account and publish at least one live post, then sync metrics.

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

### Commands for this module

```bash
npm run activate -- app-review                # one-by-one: configure, verify, record, report
npm run setup -- --work app-review             # inspect this module's live state
npm run setup -- --work app-review --record    # run + record live verification
npm run setup -- --module app-review           # interactive value entry
npm run setup -- --verify app-review           # read-only credential probe
npm run activate -- app-review --attest "..."  # ONLY after doing the human steps
```

<details><summary>Why the confirm command matters</summary>

`--confirm` is a human attestation that the provider-console / deployment
steps above were genuinely completed. It is audit-logged. Do not run it for
steps you have not done — the audit must stay truthful.

</details>

[↑ Back to index](#module-index)

---
