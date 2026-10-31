# Film Club Lens installation guide

This guide explains how to install Film Club Lens locally for evaluation and how to install the included Docker stack on a VPS. For launch approval, security, monitoring, backup and recovery procedures, also complete the [production deployment guide](PRODUCTION-DEPLOYMENT-GUIDE.md).

> **Production status:** Installation alone does not make the application production-ready. The real server, database, backups, worker jobs and any enabled external providers must be tested. Real AI video generation has not yet been verified with a live provider in this repository; see [production acceptance](PRODUCTION-ACCEPTANCE.md).

## 1. Choose an installation

| Installation | Best for | Requirements |
|---|---|---|
| Local development | Trying the UI and developing on one computer | Node.js 22+, npm and available local disk space |
| VPS with Docker Compose | Intended production installation | VPS with Docker Engine, Compose v2, domain, public HTTPS and persistent storage |
| Shared cPanel | Only if the host can support a custom deployment | Node 22+, persistent worker, FFmpeg, database and sufficient resources; **no supported cPanel-specific installer is included** |

Shared cPanel plans frequently restrict long-running workers and video rendering. Ask the host before attempting it. The VPS instructions below assume a dedicated VPS without cPanel already occupying ports 80 and 443. Do not try to install this Docker stack into a typical shared cPanel account.

## 2. Local installation

### 2.1 Prerequisites

- Node.js **22 or later** and npm; check with `node --version` and `npm --version`.
- Git, if cloning the repository.
- Permission to write to the project directory. Node native dependencies such as `better-sqlite3` may need Python, a C/C++ compiler, build tools and Node headers if a prebuilt binary is unavailable. A system FFmpeg installation is not normally required for the local defaults; the project includes an FFmpeg package.
- macOS, Linux, or Windows with an appropriate Node/native build environment. The commands below assume a Unix-like shell; on Windows, use WSL or equivalent commands.

### 2.2 Obtain the code

If you already have a checkout, open a terminal in that directory. Otherwise, obtain the repository using an authorized GitHub account:

```bash
git clone https://github.com/windelslife-wq/Daddy.git
cd Daddy
```

For a private repository, use your organization's existing GitHub authentication method. Do not put tokens in the URL or share credentials. Deploy only a reviewed revision appropriate for your environment.

### 2.3 Install and configure

```bash
npm ci
cp .env.example .env
```

`npm ci` installs the versions in `package-lock.json`. The example configuration starts the application with local SQLite, local development defaults and a background worker. `.env` is ignored by Git: keep it private, and never commit real credentials. Do not overwrite an existing `.env` without first backing it up securely.

For local development, the application creates `data/` and `storage/` as needed and generates a local encryption key in `data/development.key`. Keep this key if you need to retain locally encrypted credentials across restarts. Local data and the local key are not a production backup and are not automatically migrated to PostgreSQL.

### 2.4 Start the application

```bash
npm run dev
```

Open **http://localhost:8787** on the same computer. The development server serves both the frontend and API; you do not need to start Vite separately. Keep the terminal open. Stop it with `Ctrl+C`.

With the unmodified development example, the initial accounts are:

| Account | Email | Password |
|---|---|---|
| Creator | `creator@filmclublens.local` | `StudioDemo2026!` |
| Administrator | `admin@filmclublens.local` | `AdminStudio2026!` |

These are **publicly known development credentials**. Never expose them on a public server. Changing environment variables later does not automatically update an already-seeded account's password.

### 2.5 Verify the local installation

In a second terminal, from the project directory:

```bash
curl -i http://localhost:8787/api/meta/health
npm run doctor
```

Open the site, sign in, and check that a local job completes. Doctor warnings for a local URL or missing optional services are expected; read them rather than treating them as evidence of a production failure or success. The local defaults do not configure a real AI video provider: with `FILM_VIDEO_PROVIDER=none`, real scene generation is disabled. Other features requiring provider credentials are also unavailable until configured.

For repository checks, run:

```bash
npm run build
npm test
```

Additional end-to-end, integration and visual test commands are documented in the root `README.md`. Some tests require extra runtime prerequisites or longer execution time.

### 2.6 HTTPS preview tunnels

When using an HTTPS tunnel, set `APP_URL` and `PUBLIC_BASE_URL` to the exact externally accessible HTTPS origin. For a proxy that does not support the development hot-reload websocket, start with:

```bash
HMR=off npm run dev
```

A tunnel is a development convenience, not a replacement for the production setup and security checklist. Do not expose the seeded development accounts to the public.

## 3. VPS production installation

### 3.1 Gather the prerequisites

1. A Linux VPS with sudo access and a public IPv4 address. A starting estimate is 2 vCPUs, 4 GB RAM and 80 GB SSD; actual video workloads may require much more. Plan for data growth and provider charges.
2. A domain or subdomain you control, such as `app.example.com`.
3. Docker Engine and Docker Compose **v2** installed according to Docker's official instructions for the VPS operating system. Check with:

   ```bash
   docker --version
   docker compose version
   ```

4. An SSH key and a trusted administrator account. Patch the host, restrict SSH access, enable a firewall and keep Docker access limited to trusted administrators; Docker group access is effectively root access.
5. Allow inbound TCP ports 80 and 443 to the VPS. UDP 443 is optional for HTTP/3. Do not expose the internal Node or PostgreSQL ports to the internet. Ensure DNS and outbound HTTPS work.
6. A secure location for production credentials and encrypted off-host backups.

The Compose stack contains PostgreSQL, Caddy, the Node application, worker processes and named volumes. It runs on a single host and is not highly available.

### 3.2 Connect DNS

At your DNS provider, create an **A record** for the chosen hostname pointing to the VPS public IPv4 address. Add an AAAA record only if IPv6 is configured and reachable on the VPS. Wait for DNS to resolve publicly before requesting the TLS certificate. If a CDN or another proxy is in use, validate its TLS and forwarded-header behavior; begin with direct DNS when practical.

If this VPS also runs cPanel or another web server, port 80/443 conflicts must be resolved through an intentionally designed reverse proxy. The included Caddy configuration assumes it owns those ports; a separate VPS is the simpler installation.

### 3.3 Get the application onto the server

SSH into the VPS using your authorized account. Clone the repository using your organization's approved Git access, or deploy a reviewed release artifact:

```bash
git clone https://github.com/windelslife-wq/Daddy.git
cd Daddy
```

Use a reviewed, tested revision and record its commit ID using `git rev-parse HEAD`. Docker builds the image from the checked-out files; uncommitted changes are included unless excluded by `.dockerignore`. Do not assume an arbitrary branch or revision has been approved for release.

### 3.4 Create the production configuration

From the project root, **only if `.env` does not already exist**:

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

Open `.env` with a private editor and edit the existing entries; do not leave duplicate definitions. Add uncommented entries for the Compose-specific variables where necessary:

| Setting | What to enter |
|---|---|
| `DOMAIN` | Your hostname only, e.g. `app.example.com`; no `https://`, path or trailing slash. |
| `POSTGRES_PASSWORD` | A unique, long URL-safe random password; a hex value avoids URL-reserved characters. |
| `APP_ENCRYPTION_KEY` | A stable base64-encoded 32-byte random key, generated for this installation. |
| `ADMIN_EMAIL` | Your administrator's real email address. |
| `ADMIN_PASSWORD` | A strong, unique administrator password; **replace the example password**. |
| `NODE_ENV` | `production`. |
| `SEED_DEMO` | `false`. |
| `SECURE_COOKIES` | `true`. |

For a new installation, `openssl rand -hex 32` can generate a database password and `openssl rand -base64 32` can generate the encryption key. Run these privately and place the values in `.env` without sharing them or putting them into shell history. Existing installations must retain their existing encryption key; changing it makes previously encrypted credentials unreadable. Back it up separately and securely off-host.

Compose overrides several `.env` values to enforce production settings, disable demo credentials, use the private PostgreSQL service and set `APP_URL` and `PUBLIC_BASE_URL` to `https://` plus `DOMAIN`. Review the remaining `.env.example` settings, especially external providers and logging. The example is for development; copying it unchanged is unsafe. Do not run `docker compose config` into a public log: its interpolated output can contain secrets.

Set real provider credentials only for the features you intend to use. See `.env.example`, [providers](PROVIDERS.md), and [filmmaking](FILMMAKING.md). Never put keys into frontend code or commit `.env`.

### 3.5 Build and start

```bash
docker compose up -d --build --scale worker=2
docker compose ps
```

The first build may take several minutes. PostgreSQL must become healthy before the application starts. The application initializes its database schema; workers start after the app becomes healthy. Caddy requests a TLS certificate for your domain.

Check status and logs:

```bash
docker compose logs --tail=100 app
docker compose logs --tail=100 worker
docker compose logs --tail=100 postgres
docker compose logs --tail=100 caddy
```

Do not share logs without reviewing them for sensitive data. Workers do not have an HTTP health endpoint; a running container alone does not prove jobs complete.

### 3.6 Verify installation

1. From **outside** the VPS, open `https://app.example.com` and verify the correct site and a valid certificate. Check `https://app.example.com/api/meta/health`.
2. Sign in as the production administrator; verify the session cookie is secure and that access controls work. The administrator credentials seed an account when it does not already exist. Changing `.env` is not a substitute for changing an existing account's password.
3. Run the PostgreSQL check on the VPS:

   ```bash
   docker compose run --rm db-bootstrap
   docker compose exec app npm run doctor
   ```

   The bootstrap tool can initialize schema and creates and removes a temporary probe job. Run it in a controlled window and inspect its results. Doctor identifies warnings; it does not substitute for live end-to-end testing.
4. From a separate machine with Node 22+, this repository and its dependencies, run:

   ```bash
   npm run deploy:check -- --origin https://app.example.com
   ```

   Review optional and skipped checks as well as failures. Avoid passing production passwords on the command line because they may be exposed in process listings or shell history. Test secure cookies in the browser and signed media playback from outside the server.
5. Create a test project and verify a job is processed by a worker. Test enabled integrations with appropriate provider test accounts, permissions, callbacks and budgets. Live AI video verification can incur charges; follow [production acceptance](PRODUCTION-ACCEPTANCE.md).
6. Complete the backup, restore and go-live checklist in the [production deployment guide](PRODUCTION-DEPLOYMENT-GUIDE.md). Until those checks pass, do not describe the deployment as production-verified.

## 4. Integration setup

Integrations are optional for installation but required for their respective features. Configuration examples and exact provider requirements are in `.env.example` and [providers](PROVIDERS.md). Register callback URLs under your own `https://` hostname, configure the necessary permissions, and complete any provider app-review process. Stripe needs webhook configuration and price IDs; SMTP needs a working mail server and sending-domain setup. Real AI film scenes need a supported video provider and its key. Test with real provider accounts; local simulators do not verify provider approval or live behavior.

After updating environment variables, recreate the services so they receive the changes:

```bash
docker compose up -d --scale worker=2
```

Review service logs and repeat the appropriate tests. Be careful not to rotate the application encryption key accidentally.

## 5. Common problems

| Problem | What to check |
|---|---|
| `npm ci` fails compiling a native module | Confirm Node 22+, native build tools, Python and locally available matching Node headers; check network access to the npm registry and build dependencies. |
| Local site does not open | Confirm `npm run dev` is still running and port 8787 is available; inspect terminal output and `PORT` in `.env`. |
| Compose reports a missing variable | Check `DOMAIN`, `POSTGRES_PASSWORD`, `APP_ENCRYPTION_KEY`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the protected `.env`. Avoid printing secret values in support requests. |
| HTTPS certificate is not issued | Confirm public DNS points to the VPS, ports 80/443 are reachable, no other service owns them, and check Caddy logs. Remove a broken AAAA record. |
| App does not start or worker waits | Check `docker compose ps` and PostgreSQL/app logs; ensure adequate disk and memory, and that PostgreSQL initialized successfully. |
| Jobs remain queued | Check worker containers and logs, provider credentials, network access, resource limits and job errors. An app health check does not test workers. |
| Real AI video is unavailable | Configure a supported video provider and key; `FILM_VIDEO_PROVIDER=none` intentionally disables real scene generation. Check provider access, quotas and outbound connectivity. |
| Social connection or media fetch fails | Verify the exact public HTTPS origin and provider callbacks, permissions and app approval; test a signed media URL externally. |
| Existing connected accounts fail after a restore | Confirm the original `APP_ENCRYPTION_KEY` was restored with the matching database. A different key cannot decrypt old credentials. |

## 6. Stop, restart and uninstall

For a local development server, press `Ctrl+C`. On a VPS:

```bash
docker compose stop
# Start the existing installation again:
docker compose up -d --scale worker=2
```

Stopping during active jobs may interrupt them; review their status and potential external side effects before retrying. `docker compose down` removes containers and the network but normally preserves named volumes. **Do not use `docker compose down -v` unless you intend to permanently delete the database, media and certificate volumes and have verified backups.**

For updates, backups, restoration, incident response and launch approval, use the [production deployment guide](PRODUCTION-DEPLOYMENT-GUIDE.md) and `deploy/README.md`.
