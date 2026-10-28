/**
 * One-by-one module completion workflow.
 *
 * This is intentionally PURE (no database import). The CLI passes in the
 * preflight report, live verification results and the completion audit; this
 * module merges them into a concrete, copy-pasteable work item per module.
 *
 * It never marks a module complete and never invents evidence. Criteria that
 * can only be satisfied by a human (credentials, provider consoles, real
 * deployments, live posts) are labelled with an explicit owner and the exact
 * command or UI action needed.
 */
import {
  ACTIVATION_MODULES, getModule, callbackUrlsFor, CALLBACK_LABELS,
} from './modules.js';

/** Who can satisfy a given audit criterion. */
export const OWNERS = {
  code: 'This repository (automatable)',
  credential: 'You — server environment',
  infrastructure: 'You — deployment / infrastructure',
  'provider-console': 'You — provider console',
  evidence: 'You — real production usage',
};

const OWNER_BY_CRITERION = {
  'local-config': 'credential',
  'live-verified': 'code',
  'manual-steps': 'provider-console',
  'connected-account': 'evidence',
  'granted-scopes': 'evidence',
  'live-post': 'evidence',
  'live-smoke-test': 'evidence',
  'official-metrics': 'evidence',
  'provider-evidence': 'evidence',
  'research-evidence': 'evidence',
  'webhook-events': 'evidence',
  'price-ids': 'credential',
  'smtp-config': 'credential',
  'webhook-config': 'credential',
  'provider-active': 'credential',
  'research-active': 'credential',
  'stored-credentials': 'infrastructure',
  'https-origin': 'infrastructure',
  'secure-cookies': 'infrastructure',
  'public-media': 'infrastructure',
  'worker-enabled': 'infrastructure',
};

export function ownerForCriterion(id) {
  return OWNER_BY_CRITERION[id] || 'credential';
}

/** Exact command that resolves a criterion where one exists. */
export function commandForCriterion(id, moduleId, envKeys = []) {
  switch (id) {
    case 'local-config':
    case 'price-ids':
    case 'smtp-config':
    case 'webhook-config':
    case 'https-origin':
    case 'secure-cookies':
    case 'worker-enabled':
    case 'provider-active':
    case 'research-active':
      return envKeys.length
        ? `npm run setup -- --module ${moduleId} --set ${envKeys.map((k) => `${k}=<VALUE>`).join(' --set ')}`
        : `npm run setup -- --module ${moduleId}`;
    case 'live-verified':
      return `npm run setup -- --work ${moduleId} --record`;
    case 'manual-steps':
      return `npm run setup -- --confirm ${moduleId} --note "<what you did and where>"`;
    case 'stored-credentials':
      return 'Reconnect affected accounts in Admin → Accounts (or restore the previous APP_ENCRYPTION_KEY).';
    default:
      return null;
  }
}

/**
 * Build a work item for one activation module.
 * @param {string} moduleId
 * @param {{preflight: object, verifications: object, audit: object, env: object}} context
 */
export function buildWorkItem(moduleId, context = {}) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown activation module: ${moduleId}`);
  const { preflight, verifications = {}, audit, env = {} } = context;
  const pf = preflight?.modules?.find((m) => m.id === moduleId) || null;
  const verification = verifications[moduleId] || null;
  const auditModule = audit?.modules?.find((m) => m.id === moduleId) || null;

  // Environment values still needed. Never include a value, only the key.
  const failingEnvKeys = (pf?.checks || [])
    .filter((c) => c.status === 'fail' && c.id.startsWith('env:'))
    .map((c) => c.id.slice('env:'.length));
  const missingEnv = (pf?.envSpecs || [])
    .filter((spec) => !spec.set && !spec.optional)
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      description: spec.description,
      secret: spec.secret,
      choices: spec.choices,
      defaultValue: spec.defaultValue,
      generator: spec.generator,
      failing: failingEnvKeys.includes(spec.key),
      command: spec.generator
        ? 'npm run setup -- --generate-key'
        : `npm run setup -- --set ${spec.key}=<VALUE>`,
    }));

  const origin = env.PUBLIC_BASE_URL || 'https://YOUR-DOMAIN';
  const urls = callbackUrlsFor(origin);
  const callbacks = (module.callbacks || []).map((key) => ({
    key, label: CALLBACK_LABELS[key] || key, url: urls[key],
  }));

  const failingChecks = (pf?.checks || []).filter((c) => c.status === 'fail');
  const dependencies = (module.dependsOn || []).map((id) => {
    const dep = getModule(id);
    const depState = audit?.modules?.find((m) => m.id === id);
    return { id, number: dep?.number || null, name: dep?.name || id, complete: Boolean(depState?.complete) };
  });

  const criteria = (auditModule?.checks || []).map((c) => {
    const owner = ownerForCriterion(c.id);
    return {
      id: c.id, label: c.label, status: c.status, detail: c.detail, action: c.action,
      owner, ownerLabel: OWNERS[owner],
      command: c.status === 'pass' ? null : commandForCriterion(c.id, moduleId, missingEnv.map((e) => e.key)),
    };
  });
  const pending = criteria.filter((c) => c.status === 'pending');

  const automatable = [];
  if (auditModule?.complete) {
    automatable.push('All criteria are met — this module is COMPLETE. No further action needed.');
  } else if (verification?.status === 'verified') {
    automatable.push(`Live verification PASSED. Persist it with \`npm run setup -- --work ${moduleId} --record\` (audit-logged).`);
  } else if (!verification) {
    automatable.push(`Run the live verifier: \`npm run setup -- --work ${moduleId} --record\`.`);
  } else if (verification.status === 'unconfigured') {
    automatable.push(`Verification is blocked until the credentials above are set. Then run \`npm run setup -- --work ${moduleId} --record\`.`);
  } else if (verification.status === 'manual' || verification.status === 'unsupported') {
    automatable.push('No automated verifier exists for this module — it requires a human attestation plus real evidence.');
  } else {
    automatable.push(`Verification returned \`${verification.status}\`. Fix the reported problem, then re-run \`npm run setup -- --work ${moduleId} --record\`.`);
  }
  for (const spec of missingEnv.filter((e) => e.generator)) automatable.push(`Generate \`${spec.key}\` automatically: \`${spec.command}\`.`);

  const human = [];
  if (missingEnv.length) human.push(`Supply ${missingEnv.length} environment value(s): ${missingEnv.map((e) => `\`${e.key}\``).join(', ')}.`);
  if (dependencies.some((d) => !d.complete)) human.push(`First finish: ${dependencies.filter((d) => !d.complete).map((d) => `#${d.number} ${d.name}`).join(', ')}.`);
  if ((module.consoleSteps || []).length) human.push(`Complete ${module.consoleSteps.length} provider-console step(s).`);
  if ((module.deploySteps || []).length) human.push(`Complete ${module.deploySteps.length} deployment step(s).`);
  if (pending.some((c) => c.owner === 'evidence')) human.push('Produce real evidence: connect an account and publish at least one live post, then sync metrics.');
  if (!human.length) human.push('None — only the manual-steps attestation remains.');

  return {
    id: module.id,
    number: module.number,
    name: module.name,
    category: module.category,
    kind: module.kind,
    summary: module.summary,
    preflight: {
      status: pf?.status || 'unknown',
      passed: pf?.passed || 0,
      total: pf?.total || 0,
      failingChecks: failingChecks.map((c) => ({ id: c.id, label: c.label, detail: c.detail })),
    },
    verification: verification ? {
      status: verification.status,
      summary: verification.summary,
      checkedAt: verification.checkedAt || null,
      action: verification.action || null,
      checks: verification.checks || [],
    } : null,
    completion: {
      complete: Boolean(auditModule?.complete),
      passed: auditModule?.passed || 0,
      total: auditModule?.total || 0,
      criteria,
      pending: pending.map((c) => c.id),
      nextAction: auditModule?.nextAction || null,
      confirmation: auditModule?.confirmation || null,
      lastVerification: auditModule?.lastVerification || null,
    },
    missingEnv,
    callbacks,
    permissions: module.permissions || [],
    consoleSteps: module.consoleSteps || [],
    deploySteps: module.deploySteps || [],
    verifySteps: module.verify || [],
    docs: module.docs || [],
    dependencies,
    automatable,
    human,
    finishCommand: `npm run setup -- --confirm ${module.id} --note "<what you did>"`,
    inspectCommand: `npm run setup -- --work ${module.id}`,
  };
}

/** Build work items for every module, in numbered order (one by one). */
export function buildAllWorkItems(context = {}) {
  return ACTIVATION_MODULES.map((m) => buildWorkItem(m.id, context));
}

/**
 * Recommended working order: unblock infrastructure/security first, then
 * offline-verifiable providers, then notification channels, then publishing,
 * then the external app-review bundle.
 */
export const RECOMMENDED_ORDER = [
  'encryption-key', 'public-https-origin', 'postgres',
  'ai-providers', 'research', 'image-providers', 'tts-providers',
  'smtp', 'notification-webhook',
  'facebook-pages', 'instagram-reels', 'youtube', 'x', 'stripe',
  'app-review',
];

export function orderedWorkItems(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = RECOMMENDED_ORDER.map((id) => byId.get(id)).filter(Boolean);
  for (const item of items) if (!ordered.includes(item)) ordered.push(item);
  return ordered;
}

// ---------------------------------------------------------------------------
// Markdown progress report
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
// Match GitHub's heading-anchor algorithm (same helper as runbooks.js): strip
// punctuation, then replace each remaining space with a hyphen. " / " becomes
// a double hyphen, so links must use this exact form.
const headingSlug = (text) => String(text).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-');
const itemSlug = (item) => headingSlug(`${item.number}. ${item.name}`);
const numbered = (items) => items?.length
  ? items.map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}`).join('\n')
  : '_None._';

function renderItem(item) {
  const lines = [
    `## ${item.number}. ${item.name}`,
    '',
    `\`id: ${item.id}\` · category: \`${item.category}\` · type: \`${item.kind}\` · **${item.completion.complete ? 'COMPLETE' : 'UNFINISHED'}**`,
    '',
    item.summary,
    '',
    `| Check | Value |`,
    `|---|---|`,
    `| Offline preflight | ${item.preflight.status} (${item.preflight.passed}/${item.preflight.total}) |`,
    `| Live verification | ${item.verification ? `${item.verification.status}${item.verification.checkedAt ? ` — ${item.verification.checkedAt}` : ''}` : 'not run'} |`,
    `| Completion audit | ${item.completion.passed}/${item.completion.total} criteria |`,
    '',
    '### Completion criteria',
    '',
    '| Criterion | Status | Owner | Next action |',
    '|---|---|---|---|',
    ...item.completion.criteria.map((c) => `| ${esc(c.label)} | ${c.status === 'pass' ? '✅ pass' : '⬜ pending'} | ${esc(c.ownerLabel)} | ${esc(c.action || (c.status === 'pass' ? 'Done' : c.command || '—'))} |`),
    '',
  ];

  if (item.completion.confirmation) {
    const conf = item.completion.confirmation;
    lines.push(
      '> **Human attestation recorded.** ',
      `> By \`${esc(conf.by || 'admin')}\` at ${esc(conf.at)} — ${esc(conf.note || '(no note)')}`,
      '>',
      '> This is a declaration that the external steps were done. It is audit-logged',
      '> and can be revoked with `npm run setup -- --unconfirm ' + item.id + '`.',
      '',
    );
  }

  if (item.missingEnv.length) {
    lines.push('### Values you must supply', '', 'Never paste these into chat or commit them. The wizard writes to a gitignored `.env` (mode 0600).', '', '| Variable | Secret | What it is | Command |', '|---|---|---|---|');
    for (const spec of item.missingEnv) lines.push(`| \`${spec.key}\` | ${spec.secret ? 'yes' : 'no'} | ${esc(spec.description || spec.label)} | \`${spec.command}\` |`);
    lines.push('');
  }

  if (item.callbacks.length) {
    lines.push('### Callback / webhook URLs', '', `Derived from \`PUBLIC_BASE_URL=${item.callbacks[0].url.split('/api/')[0]}\`. Register these **exactly** (no trailing slash).`, '');
    for (const cb of item.callbacks) lines.push(`- **${cb.label}** — \`${cb.url}\``);
    lines.push('');
  }
  if (item.permissions.length) {
    lines.push('### Required scopes / permissions / events', '', ...item.permissions.map((p) => `- \`${p}\``), '');
  }
  if (item.dependencies.length) {
    lines.push('### Depends on', '', ...item.dependencies.map((d) => `- #${d.number} ${d.name} — ${d.complete ? 'complete' : '**not complete**'}`), '');
  }

  lines.push('### What can be done from this repository now', '', ...item.automatable.map((a) => `- ${a}`), '');
  lines.push('### What only you can do', '', ...item.human.map((a) => `- ${a}`), '');

  if (item.consoleSteps.length) lines.push('### Provider console steps', '', numbered(item.consoleSteps), '');
  if (item.deploySteps.length) lines.push('### Deployment steps', '', numbered(item.deploySteps), '');
  if (item.verifySteps.length) lines.push('### Verify it works', '', numbered(item.verifySteps), '');
  if (item.docs.length) lines.push('### Official documentation', '', ...item.docs.map((d) => `- [${d.label}](${d.url})`), '');

  lines.push(
    '### Commands for this module',
    '',
    '```bash',
    `npm run activate -- ${item.id}                # one-by-one: configure, verify, record, report`,
    `npm run setup -- --work ${item.id}             # inspect this module's live state`,
    `npm run setup -- --work ${item.id} --record    # run + record live verification`,
    `npm run setup -- --module ${item.id}           # interactive value entry`,
    `npm run setup -- --verify ${item.id}           # read-only credential probe`,
    `npm run activate -- ${item.id} --attest "..."  # ONLY after doing the human steps`,
    '```',
    '',
    '<details><summary>Why the confirm command matters</summary>',
    '',
    '`--confirm` is a human attestation that the provider-console / deployment',
    'steps above were genuinely completed. It is audit-logged. Do not run it for',
    'steps you have not done — the audit must stay truthful.',
    '',
    '</details>',
    '',
    '[↑ Back to index](#module-index)',
    '',
    '---',
    '',
  );
  return lines.join('\n');
}

/**
 * Render the live progress report.
 * @param {Array} items work items (already in desired order)
 * @param {{generatedAt?: string, summary?: object}} meta
 */
export function renderProgressReport(items, meta = {}) {
  const summary = meta.summary || {};
  const header = [
    '# Activation progress — module by module',
    '',
    'Generated from the live preflight report, live verification results and the',
    'completion audit. Regenerate with:',
    '',
    '```bash',
    'npm run --silent setup -- --work all --record --progress',
    '```',
    '',
    `Generated: ${meta.generatedAt || new Date().toISOString()}`,
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Modules fully complete | ${summary.complete ?? '—'} / ${summary.total ?? items.length} |`,
    `| In progress | ${summary.inProgress ?? '—'} |`,
    `| Not started | ${summary.notStarted ?? '—'} |`,
    `| Criteria met | ${summary.criteriaMet ?? '—'} / ${summary.criteriaTotal ?? '—'} |`,
    `| Local preflight ready | ${summary.ready ?? '—'} |`,
    '',
    '> **Honesty rule.** A module is complete only when every criterion is backed',
    '> by real state: valid configuration, a recorded live verification, a',
    '> human attestation for provider-console steps, and real evidence (connected',
    '> account, live post, official metrics, processed webhook). Nothing here is',
    '> auto-confirmed and no credentials are printed.',
    '',
    '## Recommended working order',
    '',
    'Infrastructure and security first, then offline-verifiable providers, then',
    'notification channels, then publishing integrations, then app review.',
    '',
    '## One-by-one driver',
    '',
    '```bash',
    'npm run activate -- --list                       # remaining modules in dependency order',
    'KEY=value npm run activate -- <id>               # supply a credential from a secret manager',
    'npm run activate -- <id> --attest "what you did" # human attestation (audit-logged)',
    'npm run setup:runbooks                          # regenerate docs/ACTIVATION.md',
    '```',
    '',
    '`npm run activate` reads credentials from the process environment or',
    '`--set KEY=VALUE`, format-validates them, writes them to a gitignored `.env`,',
    'runs the **real** live verifier, records it, and prints the remaining',
    'criteria. It never invents credentials and never auto-attests.',
    '',
    '**Modules 12 and 13** are deployment work. The repository now ships a real',
    'production stack — [deploy/README.md](../deploy/README.md) — with a Dockerfile,',
    'Compose (API + 2 workers + PostgreSQL + Caddy TLS), a dedicated worker',
    'process, `npm run db:bootstrap` (real Postgres + two-worker claim proof) and',
    '`npm run deploy:check` (real external DNS/TLS/health/cookie/media probe).',
    '',
    '## Module index',
    '',
    '| # | Module | Preflight | Verification | Audit | Status |',
    '|---|---|---|---|---|---|',
    ...items.map((item) => `| ${item.number} | [${esc(item.name)}](#${itemSlug(item)}) | ${item.preflight.status} | ${item.verification?.status || 'not run'} | ${item.completion.passed}/${item.completion.total} | ${item.completion.complete ? '✅' : '⬜'} |`),
    '',
    '---',
    '',
  ];
  return `${header.join('\n')}${items.map(renderItem).join('\n')}`;
}
