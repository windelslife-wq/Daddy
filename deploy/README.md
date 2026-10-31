# Production deployment (activation modules 12 & 13)

This stack supplies the two things the app could not provide from inside the
repository: a **real public HTTPS origin** and a **real PostgreSQL database
with multiple worker processes**. It is the concrete implementation of the
deployment steps listed in `docs/ACTIVATION.md` §12 and §13.

```
Internet ──HTTPS──▶ Caddy (80/443, Let's Encrypt)
                       │  X-Forwarded-Proto/Host
                       ▼
                  app (API + built React/PWA, port 3000)
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   worker × 2     PostgreSQL      named volumes
 (conditional     (private        (data, storage,
  job claims)      network)        certificates)
```

## 1. Prerequisites

- A host with Docker Engine + Compose v2, ports **80** and **443** open.
- A DNS **A/AAAA** record pointing `filmclublens.com` at that host.
- A `.env` on the host (gitignored — never commit it).

```bash
cp .env.example .env
chmod 600 .env
```

Set these in `.env`. **Replace the development admin credentials in
`.env.example`**: copying the example unchanged would otherwise use a publicly
known password. Do not use the local preview's database or encryption key as a
production secret. Keep `.env` out of backups intended for broad access.

| Variable | Value |
|---|---|
| `DOMAIN` | `filmclublens.com` (hostname only, no scheme) |
| `POSTGRES_PASSWORD` | long random password |
| `APP_ENCRYPTION_KEY` | `npm run setup -- --generate-key` (writes it for you) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | real admin credentials |
| `SEED_DEMO` | `false` |
| `NODE_ENV` | `production` |
| `SECURE_COOKIES` | `true` |

Compose sets `APP_URL` and `PUBLIC_BASE_URL` to `https://$DOMAIN`, as well as
`DATABASE_URL`, `TRUST_PROXY=true` and the worker flags. It also disables demo
credential exposure. Use a URL-safe random PostgreSQL password (for example,
hexadecimal characters) because it is embedded in a connection URL; URL-reserved
characters must be percent-encoded there. Keep `APP_ENCRYPTION_KEY` stable — rotating it
makes stored OAuth tokens unreadable (the setup wizard refuses to rotate
silently).

### Prepare module 14: credential encryption key

Do not generate a production key in a temporary development workspace. Once the
production host and secret storage are chosen:

1. If you already have encrypted credentials that must be retained, recover
   and use their existing key. A newly generated key cannot decrypt them.
2. Otherwise, on the production host, run `npm run setup -- --generate-key`
   from the repository root. This requires the project dependencies to be
   installed and writes the key to the gitignored `.env`. Do not print it,
   commit it, or share it in chat.
3. Store the same key in your deployment's secret manager and make a secure,
   separate backup. Ensure the app and every worker receive the **same** key
   and that it survives restarts and redeployments. For the Compose stack,
   provide it in the host environment or the host's protected `.env` file.
4. After deployment, run `npm run setup -- --work encryption-key --record`
   in an environment connected to the deployment database and configured with
   that same key. Restart the service and test existing connected accounts.
5. Only after verifying the secret storage, backup, and deployment steps,
   record the human attestation with:

   ```bash
   npm run activate -- encryption-key --attest "<completed deployment steps>"
   ```

   Check the module audit rather than assuming that generating a key alone
   completes the module.

If the key is lost or replaced, existing encrypted OAuth credentials cannot be
recovered with the new key; affected accounts must be reconnected. Preserve
and protect the original key alongside the relevant database backup.

## 2. Deploy

```bash
docker compose up -d --build --scale worker=2
docker compose logs -f app
```

`app` waits for the Postgres healthcheck, creates/migrates every table on
startup, serves the built frontend, and has a real `/api/meta/health`
healthcheck. Workers wait for the app to become healthy before starting, avoiding
a first-boot schema initialization race. The one-shot `db-bootstrap` service
is in the `tools` profile and does not run during a normal `up`.
`worker` runs `server/worker-standalone.js` — a dedicated
worker-only process. Scaling it to 2+ is safe because `server/worker.js`
claims jobs with a conditional `UPDATE … WHERE status = 'queued'`.

## 3. Verify module 13 (PostgreSQL)

```bash
npm run db:bootstrap                      # on the host, with DATABASE_URL set
# or
docker compose run --rm db-bootstrap     # inside the network
```

It connects with the real `pg` driver, creates/verifies all 27 tables, then
races two independent connections to claim one probe job and asserts **exactly
one** wins. It deletes the probe job afterwards. Equivalent to
`tests/postgres-multiprocess.test.js`, but against your real database.

## 4. Verify module 12 (public HTTPS origin)

Run this **from outside the host** (your laptop or CI), not on the server —
that is the point of the check:

```bash
npm run deploy:check -- --origin https://filmclublens.com
npm run deploy:check -- --origin https://filmclublens.com \
  --email admin@example.com --password '…' \
  --media-url 'https://filmclublens.com/api/…signed…'
```

It performs a real DNS lookup, a real TLS handshake (reporting CN, issuer and
days to expiry), a real HTTPS `GET /api/meta/health`, checks the public API is
routed, inspects `Secure`/`HttpOnly` on the session cookie when credentials
are supplied, fetches a signed media URL with a byte range, and probes every
OAuth/webhook callback path. `--json` gives machine-readable output; exit code
is `0` only when all required checks pass.

Then record the verification in the app DB:

```bash
npm run activate -- public-https-origin --verify-only
npm run setup -- --work public-https-origin --record
npm run doctor -- --probe
```

## 5. Register the exact callback URLs

`npm run deploy:check` prints these. They are derived from `PUBLIC_BASE_URL`
and must match **exactly** (no trailing slash):

```
https://filmclublens.com/api/oauth/facebook/callback   Meta (FB + IG)
https://filmclublens.com/api/oauth/google/callback     Google / YouTube
https://filmclublens.com/api/oauth/x/callback          X
https://filmclublens.com/api/oauth/sandbox/callback    local sandbox only
https://filmclublens.com/api/billing/webhook           Stripe
```

## 6. Finish the modules one by one

```bash
npm run activate -- --list             # 10 remaining modules in dependency order
npm run activate -- postgres           # see exactly what it needs
npm run activate -- smtp --attest "SPF/DKIM configured, ticket 4471"
npm run setup -- --work all --record --progress
```

`npm run activate` reads credentials from the process environment (preferred —
a secret manager or CI), format-validates them, writes them to the gitignored
`.env`, runs the real live verifier, records it, and prints the remaining
criteria. `--attest` is an explicit human declaration and is audit-logged.

## 7. Security checklist

- [x] TLS terminated at the edge with a CA-signed certificate (Caddy/Let's Encrypt)
- [x] `X-Forwarded-Proto`/`Host` forwarded, `TRUST_PROXY=true`
- [x] `SECURE_COOKIES=true`, `NODE_ENV=production`
- [x] Seeded demo accounts disabled (`SEED_DEMO=false`)
- [x] Postgres never published to the internet; least-privilege role
- [x] `APP_ENCRYPTION_KEY` in a gitignored `.env` (move to a managed secret store before scale)
- [ ] Whitelist all five callback URLs in the provider consoles
- [ ] Confirm a signed media URL is fetchable while signed out
- [ ] Back up Postgres and `APP_ENCRYPTION_KEY` off-host

## 8. Backups

```bash
docker compose exec postgres pg_dump -U filmclublens -d filmclublens > backup.sql
```

Store the dump and `APP_ENCRYPTION_KEY` in separate secret stores. SQLite data
does **not** migrate automatically — export/import deliberately if you have
existing local data.
