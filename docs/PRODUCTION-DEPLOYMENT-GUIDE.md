# Film Club Lens: production deployment and operations guide

This guide is for the repository's **single-VPS Docker Compose deployment**. It takes you from planning through launch, operations and recovery. It is not proof that a particular deployment is production-ready: complete the acceptance checklist against your own server and services before opening it to users.

## 1. Architecture and scope

```text
Internet -> DNS -> Caddy (HTTPS :443, HTTP :80) -> Node app (private :3000)
                                                       |
                                          PostgreSQL + worker processes
                                          persistent Docker volumes
```

The app serves its built React frontend and API. PostgreSQL stores application data; workers process queued work; shared storage holds media. Caddy obtains and renews TLS certificates. The provided Compose stack runs these on one VPS; it is **not highly available**, and the VPS and its local disks are single points of failure.

Your existing shared cPanel plan is not the target for this guide. You can keep it for other websites or email. A VPS running cPanel can conflict with Caddy on ports 80/443; use a separate VPS for the simplest setup, or have an administrator design and test the reverse-proxy integration. Do not run two public web servers on the same ports.

## 2. Before buying or deploying

- **Server:** Ubuntu LTS VPS with sudo access, a public IPv4 address, Docker Engine and Compose v2. Start planning around 2 vCPUs, 4 GB RAM and 80 GB SSD; this is a starting estimate, not a performance guarantee. Concurrent rendering and generated video can require considerably more CPU, RAM and storage. Load-test the actual workload and budget for provider usage and backups.
- **Domain:** a hostname you control, such as `app.example.com`. Keep DNS access available. Use that exact hostname consistently for the application, OAuth callbacks and webhooks.
- **Network:** allow inbound TCP 80 and 443 for Caddy and SSH from trusted IPs where practical. UDP 443 enables HTTP/3 but is not essential. Do not publicly expose PostgreSQL or the app's internal port. Ensure outbound HTTPS, DNS and email-provider connectivity as needed.
- **Credentials:** a unique administrator email and strong password, a random PostgreSQL password, and a stable 32-byte base64 application encryption key. Store these in a secret manager; never send them in chat or commit them.
- **Providers:** obtain only those needed at launch (AI/video, social networks, Stripe, SMTP). Provider approvals, usage limits and charges are separate from hosting.
- **Backups and responsibility:** choose encrypted off-host storage, a retention policy, and someone responsible for monitoring and testing restores. Define acceptable data loss and recovery time.

Possible VPS providers include Hetzner, DigitalOcean and Vultr. Compare current pricing, server location, backup terms and support directly; none is required by this project.

## 3. Prepare and secure the VPS

1. Provision the VPS, update its operating system, set the time correctly, and configure a non-root administrator with SSH key authentication. Test access before restricting password login. Enable security updates and configure provider and host firewalls.
2. Install Docker Engine and the Docker Compose plugin using the official instructions for your OS. Docker group membership grants root-equivalent access; give it only to trusted administrators.
3. Confirm the tools and free capacity:

   ```bash
   docker --version
   docker compose version
   df -h
   free -h
   ```

4. Point the chosen hostname's DNS A record at the VPS public IPv4 address. Add an AAAA record only if the VPS has working public IPv6 and the firewall allows it. Allow time for DNS propagation. Do not proxy traffic through another CDN until the direct deployment is working and its proxy/trust settings are reviewed.
5. Obtain a trusted copy of the repository on the server through your approved release process. Run the commands below from the repository root. Deploy a reviewed, tested revision—not an unreviewed working tree. Record the Git commit ID for rollback.

## 4. Configure production secrets

On the server, in the project directory:

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

Edit `.env` with a private editor. Replace, do not reuse, the example's **known development administrator credentials**. Set at least:

```dotenv
DOMAIN=app.example.com
POSTGRES_PASSWORD=<long-random-url-safe-password>
APP_ENCRYPTION_KEY=<base64-encoded-32-byte-random-key>
ADMIN_EMAIL=<your-admin-email>
ADMIN_PASSWORD=<strong-unique-admin-password>
NODE_ENV=production
SEED_DEMO=false
SECURE_COOKIES=true
```

Angle-bracket values above are descriptions, not usable values. The Compose file explicitly sets the production environment, URLs, secure cookies, worker mode and demo settings; its values override conflicting `.env` defaults. `APP_URL` and `PUBLIC_BASE_URL` become `https://DOMAIN`. Use a hostname only for `DOMAIN`—no scheme, path or trailing slash. The application, workers and tools must share the same key and database.

Generate secrets privately, using e.g. a password manager for the administrator password, `openssl rand -hex 32` for a URL-safe PostgreSQL password, and `openssl rand -base64 32` for a new encryption key. Enter them in `.env` without exposing terminal output or history to others. Alternatively, the setup wizard can generate the encryption key when Node dependencies are installed; see `deploy/README.md`. Make a secure, separate off-host backup of the key. **Never replace an existing production key without a migration plan:** stored encrypted provider credentials cannot be decrypted with a new key. A new key is appropriate only for a fresh installation.

The example file contains other development defaults. Review all values, including `LOG_LEVEL`, before launch. Use a URL-safe database password because Compose embeds it in `DATABASE_URL`; reserved URL characters require encoding. Do not expose `.env`, Docker configuration output containing interpolated secrets, shell history or logs to untrusted users.

`ADMIN_EMAIL` and `ADMIN_PASSWORD` seed an administrator when the account does not exist. Changing those environment values later is **not** a password-rotation procedure for an existing account; use the application's supported account management process and verify access. Restrict administrator access and use a unique password.

## 5. Build and launch

After DNS resolves to the VPS and ports 80/443 are reachable:

```bash
docker compose up -d --build --scale worker=2
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 worker
docker compose logs --tail=100 caddy
```

The app waits for PostgreSQL and initializes the schema. Workers wait for the app's health check. The database is private to the Compose network, and persistent data, media and Caddy certificates use named volumes. Worker containers do not have the app's HTTP health check; monitor their process state, logs and actual job completion. The database bootstrap is a one-shot tool, not a normal long-running service.

Check logs for errors without publishing secrets. Caddy needs public DNS and inbound port 80/443 for certificate issuance. On first startup allow time for the image build, database initialization and TLS issuance. If ports are already in use, resolve the conflict rather than exposing the app directly.

**Maintenance:** schema initialization occurs on startup. Stop traffic and workers before schema-changing upgrades and take tested backups. Multi-worker conditional claims do not prove that arbitrary simultaneous schema migrations, multiple hosts or every external publication side effect are safe.

## 6. Acceptance checks before launch

Perform these against the deployed revision. A simulated integration test is not a substitute for a live provider test.

### Local project checks

On a development/CI machine with Node 22+ and dependencies installed:

```bash
npm ci
npm run build
npm test
npm run test:e2e
npm run test:visual
npm audit --omit=dev
```

Investigate failures and dependency advisories before launch. At the last local audit, production dependencies reported **one high and two moderate** advisories; reassess the current audit and fix or formally accept the risks. Do not blindly run a forced major-version upgrade. Run integration and visual tests in an environment with their prerequisites.

### VPS and external checks

1. Check `docker compose ps` and logs. The app and PostgreSQL should be healthy and workers running. Create a real test job and verify that it completes, not merely that a process exists.
2. From outside the VPS, open `https://app.example.com` and confirm a valid certificate, the expected site and `https://app.example.com/api/meta/health`. Confirm that port 3000 and PostgreSQL are not exposed publicly.
3. Run the project's external checker **from a separate machine** with the repository, Node 22+ and dependencies installed:

   ```bash
   npm run deploy:check -- --origin https://app.example.com
   ```

   Review skipped/optional checks as well as the exit status. For the cookie check, log in via the browser and inspect `Secure`, `HttpOnly`, and `SameSite` attributes. Avoid passing production passwords as command-line arguments: they can leak through shell history or process listings. For media, obtain a signed URL and verify access and byte-range playback externally without a session; treat the signed URL itself as a secret.
4. On the VPS run the real PostgreSQL and worker-claim check:

   ```bash
   docker compose run --rm db-bootstrap
   docker compose exec app npm run doctor
   ```

   The bootstrap check writes and removes a temporary probe job and can initialize schema; run it in a controlled window. The doctor report identifies warnings and external checks; resolve those relevant to enabled features. Review `deploy/README.md` and `docs/ACTIVATION.md` for activation and attestation steps. Do not attest to anything that has not actually been verified.
5. Test registration/login/logout, authorization boundaries, admin access, a complete media generation job, playback, scheduled work, and any enabled payment, email and publishing flows with real test accounts. Verify failures and retries, and inspect for duplicate side effects.
6. Test restore of an encrypted off-host backup to an **isolated** environment before accepting live data. Confirm database records, media playback and decryption of existing provider credentials using the backed-up key.

Real AI film generation is **not yet production-verified** in this repository. For a live vendor test, follow `docs/PRODUCTION-ACCEPTANCE.md` and `docs/FILMMAKING.md`; tests can incur charges. Validate commercial rights, quotas and spending limits before enabling it.

## 7. Configure integrations only when needed

Configure credentials privately in `.env` or the application's admin provider settings, according to `.env.example`, `docs/PROVIDERS.md` and the relevant provider's instructions. Restart/recreate containers after changing environment values, then repeat the relevant checks. Keep provider secrets server-side.

| Capability | What is needed | Production check |
|---|---|---|
| Scripts, images, voices and research | Select supported providers and supply their corresponding keys, or intentionally use local defaults | Generate and inspect representative output; check costs and limits. |
| AI film clips | Set `FILM_VIDEO_PROVIDER` and the matching vendor key | Run the real-provider and film acceptance procedures in `docs/PRODUCTION-ACCEPTANCE.md`. With `none`, real scene generation is disabled. |
| Facebook / Instagram, YouTube, X | Provider apps, credentials, permissions, approval and real connected accounts | Register exact callbacks below; test connect, publish, metrics and disconnect on approved test accounts. |
| Payments | Stripe secret, webhook secret and plan price IDs | Use Stripe test mode first; verify signatures, subscription lifecycle and idempotency before live mode. |
| Email | `SMTP_URL` and an approved sending domain | Verify SPF/DKIM and delivery; test on real inboxes. Without SMTP, email delivery is not configured. |
| Notification webhooks | Endpoint and signing secret | Verify signature handling and failures on the recipient side. |

Replace `app.example.com` with your actual hostname when registering exact URLs:

```text
https://app.example.com/api/oauth/facebook/callback
https://app.example.com/api/oauth/google/callback
https://app.example.com/api/oauth/x/callback
https://app.example.com/api/billing/webhook
```

The sandbox callback `/api/oauth/sandbox/callback` is for sandbox testing, not a real social provider. Provider-side app review, public HTTPS, available scopes and provider access are external requirements. Never assume a configured key means an integration has been approved or works in production.

## 8. Backups and restore

Back up **all three**: PostgreSQL, the `app-storage` media volume, and the original encryption key. Keep encrypted copies off-host, with restricted access and separate key storage. Consider also preserving the deployment `.env` securely (it contains secrets), the release commit, provider settings and DNS configuration. Local Docker volumes or a VPS snapshot alone are not sufficient off-host disaster recovery. SQLite from the preview is not automatically migrated to PostgreSQL.

The following is a **manual, offline backup example** with downtime. First schedule a maintenance window, stop traffic, let jobs finish if possible and prevent further writes. The current worker shutdown does not guarantee active jobs drain; stopping during work may interrupt jobs, which can later retry. Account for possible external side effects.

```bash
# From the production repository, as a trusted operator, using Bash.
# Stop on errors, including failures on the left side of a pipeline.
set -e -o pipefail
umask 077
mkdir -p ~/filmclub-backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose stop worker app
# Use the configured database/user inside the Postgres container.
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$HOME/filmclub-backups/db-$stamp.sql.gz"
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/storage -czf - . > "$HOME/filmclub-backups/media-$stamp.tar.gz"
docker compose up -d --scale worker=2
```

Check each command and backup archive for errors and nonzero size; a shell pipeline can otherwise hide a failed `pg_dump`. For this example, use Bash with `set -o pipefail` before running the pipeline. If any step fails, investigate and restart the services when safe. Encrypt and transfer the files off-host, verify transfer integrity, and apply your retention and deletion policy. Automate and alert on backup failures only after testing the workflow.

**Restore drill:** use a separate VPS or isolated Compose project with its own network and empty volumes, a matching release, and the original encryption key. Disable external publishing and integrations to prevent duplicate posts, payments or emails. Restore the database dump into an empty compatible PostgreSQL database and the archive into its empty `/app/storage` volume, preserving paths. Validate record counts, admin login, media, decrypted connections and a safe test job. Document timings and any manual steps. Never import a dump or extract media into a live production environment without an approved recovery plan; doing so can overwrite data. For an actual recovery, stop writes, preserve the failed volumes, select a matching backup set and restore under operator supervision.

## 9. Monitoring and routine operations

- Alert on public HTTPS health, certificate expiry, app/database availability, worker job completion and queue age, failed jobs, provider errors, disk usage, memory, CPU, backup failures and restore-test age. The HTTP health endpoint alone does not prove workers, providers or media are working.
- Review `docker compose logs --tail=100 app`, `worker`, `postgres`, and `caddy`; use central log rotation and avoid collecting secrets or sensitive user content unnecessarily.
- Keep Docker, the host OS, base images and dependencies patched. Review `npm audit --omit=dev` and upstream advisories regularly; test upgrades before deployment.
- Limit administrator access; protect provider accounts with MFA where available; rotate compromised credentials and revoke sessions or provider grants as appropriate. Back up the application encryption key separately and keep it stable.
- Set provider spending limits where available, monitor usage, and plan media retention and disk cleanup. Apply applicable privacy, consent and retention requirements to user data.

## 10. Updates and rollback

1. In staging, run tests, build the new release, check dependency advisories and exercise enabled providers. Record the old and new commit IDs and image versions.
2. Schedule a maintenance window; stop traffic and jobs and take verified database and media backups as above. Save the current configuration and encryption key securely.
3. Deploy the reviewed new revision via your normal release process. Rebuild and start with `docker compose up -d --build --scale worker=2`; inspect status/logs and rerun smoke checks.
4. If rollback is needed, assess schema and data compatibility first. Deploy the prior tested code/image only if it supports the current database; otherwise restore the matching database and media backup in a controlled window. Rollback to an older backup loses writes after that backup. Recheck external side effects before retrying jobs.

## 11. Go-live checklist

- [ ] Tested release and dependency audit reviewed; unresolved risks accepted by an owner.
- [ ] Real VPS configured, DNS correct, valid public TLS, firewall and SSH access verified.
- [ ] Production `.env` protected; example passwords replaced; demo account disabled; stable encryption key securely backed up.
- [ ] PostgreSQL check passes; app healthy; workers complete real jobs; media and disk capacity verified.
- [ ] External HTTPS, cookies, authorization, signed media and user workflows verified.
- [ ] Every enabled integration tested with the correct provider environment, permissions and callbacks; costs and approvals understood.
- [ ] Off-host encrypted database and media backups exist; isolated restore with the same encryption key has succeeded.
- [ ] Monitoring, alerting, incident contacts, retention and rollback plan assigned.

Reference: `deploy/README.md`, `.env.example`, `docs/ACTIVATION.md`, `docs/PROVIDERS.md`, `docs/FILMMAKING.md`, and `docs/PRODUCTION-ACCEPTANCE.md`.
