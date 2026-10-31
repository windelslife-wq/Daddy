/**
 * Generates the activation runbook (docs/ACTIVATION.md) from the module
 * registry. Run `npm run setup -- --runbooks` to regenerate.
 */
import { ACTIVATION_MODULES, CALLBACK_LABELS, callbackUrlsFor } from './modules.js';

const mdEscape = (text) => String(text ?? '').replace(/\|/g, '\\|');
// Match GitHub's heading-anchor algorithm: strip punctuation, then replace each
// remaining space with a hyphen (so " / " correctly becomes "--", not "-").
const slug = (text) => String(text).toLowerCase()
  .replace(/[^\w\s-]/g, '')
  .trim()
  .replace(/\s/g, '-');
const moduleSlug = (module) => slug(`${module.number}. ${module.name}`);

function envTable(module) {
  if (!module.env.length) return '_No environment variables — this module is completed entirely in provider consoles._\n';
  const rows = [
    '| Variable | Secret | Required when | Purpose |',
    '|---|---|---|---|',
  ];
  for (const spec of module.env) {
    let condition = 'Always';
    if (spec.requiredWhen) condition = Object.entries(spec.requiredWhen).map(([k, v]) => `\`${k}=${v}\``).join(' & ');
    else if (spec.requiredWhenAny) condition = spec.requiredWhenAny.map((r) => Object.entries(r).map(([k, v]) => `\`${k}=${v}\``).join(' & ')).join(' or ');
    else if (spec.optional) condition = 'Optional';
    else if (spec.defaultValue !== undefined) condition = `Recommended (default \`${spec.defaultValue}\`)`;
    rows.push(`| \`${spec.key}\` | ${spec.secret ? 'yes' : 'no'} | ${mdEscape(condition)} | ${mdEscape(spec.description || '')} |`);
  }
  return `${rows.join('\n')}\n`;
}

function numbered(items) {
  if (!items?.length) return '';
  return items.map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}`).join('\n');
}

function callbacksSection(module) {
  if (!module.callbacks?.length) return '';
  const urls = callbackUrlsFor('https://YOUR-DOMAIN');
  const lines = module.callbacks.map((key) => `- **${CALLBACK_LABELS[key] || key}** — \`${urls[key]}\``);
  return `### Callback URLs

Replace \`https://YOUR-DOMAIN\` with your exact \`PUBLIC_BASE_URL\` (no trailing slash).

${lines.join('\n')}\n`;
}

function permissionsSection(module) {
  if (!module.permissions?.length) return '';
  return `### Required permissions / scopes / events

${module.permissions.map((p) => `- \`${p}\``).join('\n')}\n`;
}

function docsSection(module) {
  if (!module.docs?.length) return '';
  return `### Official documentation

${module.docs.map((d) => `- [${d.label}](${d.url})`).join('\n')}\n`;
}

export function renderModuleRunbook(module) {
  const parts = [
    `## ${module.number}. ${module.name}`,
    '',
    `\`id: ${module.id}\` · category: \`${module.category}\` · type: \`${module.kind}\``,
    '',
    module.summary,
    '',
    '### Environment variables',
    '',
    envTable(module),
  ];
  if (module.dependsOn?.length) {
    parts.push(`**Depends on:** ${module.dependsOn.map((id) => `\`#${ACTIVATION_MODULES.find((m) => m.id === id)?.number || '?'} ${id}\``).join(', ')}\n`);
  }
  const cb = callbacksSection(module); if (cb) parts.push(cb);
  const perms = permissionsSection(module); if (perms) parts.push(perms);
  if (module.consoleSteps?.length) parts.push('### Provider console steps', '', numbered(module.consoleSteps), '');
  if (module.deploySteps?.length) parts.push('### Deployment steps', '', numbered(module.deploySteps), '');
  if (module.verify?.length) parts.push('### Verify it works', '', numbered(module.verify), '');
  const docs = docsSection(module); if (docs) parts.push(docs);
  parts.push(
    '<details><summary>Finish this module with the wizard</summary>',
    '',
    '```bash',
    `npm run setup -- --module ${module.id}`,
    '```',
    '',
    'The wizard shows this module\'s checklist, prompts for each value with input',
    'hidden for secrets, validates the format, writes `.env`, and re-runs the',
    'preflight check.',
    '',
    '</details>',
    '',
  );
  parts.push('[↑ Back to index](#module-index)', '', '---', '');
  return parts.join('\n');
}

export function renderRunbooks() {
  const header = `# Activation runbook

Every module below is **already implemented in code**. The Film Club Lens test
suite covers the OAuth flows, publishing adapters, Stripe webhooks,
provider adapters, and analytics against a local simulator. What remains is
**activation**: adding credentials, obtaining provider approval, and deploying
infrastructure. Those steps cannot be automated from inside this repository.

This document is generated from \`server/services/activation/modules.js\`.
Regenerate it with:

\`\`\`bash
npm run setup -- --runbooks
\`\`\`

## Quick start

\`\`\`bash
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
npm run deploy:check -- --origin https://filmclublens.com  # real external TLS/health check
npm run db:bootstrap     # real PostgreSQL schema + two-worker claim proof
\`\`\`

Production deployment (modules 12 & 13) is documented in
[deploy/README.md](../deploy/README.md): Dockerfile, Compose with API + two
worker processes + PostgreSQL + Caddy TLS, exact callback URLs and backups.

### Work the modules one by one

\`\`\`bash
npm run setup -- --work 1                          # live state + exact next actions for module 1
npm run setup -- --work 1 --json                  # machine-readable work item
npm run setup -- --work all --record              # verify every module and record the results
npm run setup -- --work all --record --progress   # regenerate docs/ACTIVATION_PROGRESS.md
npm run setup -- --confirm smtp --note "SPF/DKIM verified, ticket 4471"
npm run setup -- --unconfirm smtp                # undo a mistaken attestation
\`\`\`

\`--work\` merges offline preflight, live verification and the completion audit
into one work item: which criteria are met, who owns each remaining one, the
exact environment keys, callback URLs and commands. \`--record\` persists the
verification result (audit-logged). \`--confirm\` is a **human attestation** that
the provider-console / deployment steps were genuinely completed — it is never
run automatically. See
[docs/ACTIVATION_PROGRESS.md](ACTIVATION_PROGRESS.md) for the live per-module
tracker.

Recommended order respects dependencies: encryption key → HTTPS origin →
PostgreSQL → offline-verifiable AI/image/TTS/research providers → SMTP and
webhooks → Facebook/Instagram/YouTube/X/Stripe → provider app review.

The wizard writes values to a gitignored \`.env\` (mode 0600), validates their
format, preserves comments in your existing file, and never prints secrets back
to the terminal. Configuration commands never contact a provider. The explicit
\`--verify\` command is the only networked operation: it makes read-only,
app-level calls to the providers you have configured, skips everything else,
and never prints a secret.

### Live verification statuses

| Status | Meaning |
|---|---|
| \`VERIFIED\` | The provider accepted the configured app-level credentials. |
| \`INVALID\` | The provider rejected them; the message explains what to fix. |
| \`UNREACHABLE\` | This host could not reach the provider (network egress / firewall). |
| \`NOT CONFIGURED\` | Credentials are missing, so nothing was contacted. |
| \`MANUAL\` | Only a provider-console reviewer can confirm this (module 15). |

Verification is also available from **Admin → Activation → Verify** and through
\`GET /api/admin/activation\` / \`POST /api/admin/activation/:id/verify\`.

## Definition of done

Configuration and verification are necessary but not sufficient. Each module
also has explicit **completion criteria** backed by real application state —
\`GET /api/admin/activation/audit\` and the **Admin → Activation** tab show them
one by one. A module is \`COMPLETE\` only when every criterion passes:

| Criterion | What it proves |
|---|---|
| \`local-config\` | All required environment/dependency checks pass (offline preflight). |
| \`live-verified\` | A recorded, successful credential verification. |
| Module-specific evidence | Connected accounts with the right scopes, published posts with remote links, non-simulated official metrics, Stripe Price IDs on every paid plan, processed webhooks, generated provider output, decryptable stored credentials. |
| \`manual-steps\` | You confirmed the provider-console / deployment checklist (Meta App Review, Google consent screen, X tier, Stripe activation, DNS/TLS). |

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
`;
  const rows = ACTIVATION_MODULES.map((m) => {
    const blockers = [];
    if (m.env.length) blockers.push('credentials');
    if (m.consoleSteps?.length) blockers.push('provider console');
    if (m.deploySteps?.length) blockers.push('deployment');
    return `| ${m.number} | [${m.name}](#${moduleSlug(m)}) | \`${m.kind}\` | ${blockers.join(' + ') || 'confirmation only'} |`;
  });
  const global = `
## Global prerequisites

1. **Node.js 22+** and npm. Run \`npm install\` first.
2. **A server environment variable store.** All secrets stay server-side; no key
   is ever read by the React/Vite frontend.
3. **A public HTTPS domain** for any OAuth or publishing module (see module 12).
4. **Keep \`.env\` out of Git.** The repository \`.gitignore\` already covers
   \`.env\` and \`.env.*\` (except \`.env.example\`). The wizard checks this.
5. **Run offline verification first.** \`npm test\` and
   \`npm run test:integrations\` exercise every adapter against a simulator, so
   you can be confident the code works before spending time on credentials.

### Status meanings

| Status | Meaning |
|---|---|
| \`READY\` | All local configuration is present and valid. External console steps may still remain. |
| \`NEEDS WORK\` | One or more environment values are missing or malformed. |
| \`EXTERNAL\` | No local configuration exists; the work happens in provider consoles. |

---

`;
  const footer = `
## After activation

\`\`\`bash
npm run doctor -- --json     # machine-readable readiness
npm test                     # offline contract tests
npm run test:e2e             # full sandbox generation -> publishing workflow
\`\`\`

Then perform a **live smoke test** with a real external account that is *not*
an app admin/developer/tester — provider "Standard Access" hides permission
problems for app team members. Publish one real short video to each approved
platform, confirm the permalink, and verify official metrics arrive and are not
labelled simulated.

Simulator results are never presented as live provider posts. Sandbox metrics
are deterministic, explicitly labelled simulated, and excluded from
data-backed recommendations.
`;
  return `${header}${rows.join('\n')}\n${global}${ACTIVATION_MODULES.map(renderModuleRunbook).join('\n')}${footer}`;
}
