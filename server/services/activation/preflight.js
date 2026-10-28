/**
 * Offline preflight checks for activation modules.
 *
 * Pure functions: all inputs are passed in (env object + repo root), so this
 * module is safe to use from tests, the CLI, and an admin endpoint without
 * importing server/config.js (which has filesystem and ffmpeg side effects).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVATION_MODULES, getModule, applicableEnv, callbackUrlsFor, CALLBACK_LABELS,
} from './modules.js';
import { runValidator, isSet, describeValue, looksLikePlaceholder } from './validators.js';
import { gitignoreCovers } from './envFile.js';

const pass = (id, label, detail) => ({ id, label, status: 'pass', detail });
const fail = (id, label, detail) => ({ id, label, status: 'fail', detail });
const info = (id, label, detail) => ({ id, label, status: 'info', detail });

function describeSetValue(value) {
  const d = describeValue(value);
  return d.present ? `Set (${d.length} chars, ${d.fingerprint}).` : 'Not set.';
}

/** Evaluate one module's local configuration. Dependencies resolved later. */
function configChecks(module, env) {
  const checks = [];
  for (const spec of applicableEnv(module, env)) {
    const value = env[spec.key];
    const id = `env:${spec.key}`;
    if (!isSet(value)) {
      if (spec.optional) {
        checks.push(pass(id, spec.key, `Optional — not set${spec.defaultValue ? ` (default: ${spec.defaultValue})` : ''}.`));
      } else if (spec.defaultValue !== undefined) {
        checks.push(pass(id, spec.key, `Not set — application default "${spec.defaultValue}" is active (offline mode).`));
      } else {
        checks.push(fail(id, spec.key, `Missing. ${spec.description || ''}`.trim()));
      }
      continue;
    }
    const result = runValidator(spec.validator, value);
    const detail = result.valid
      ? `${describeSetValue(value)} ${result.message}`
      : `Invalid format — ${result.message} (value hidden)`;
    checks.push(result.valid ? pass(id, spec.key, detail) : fail(id, spec.key, detail));
  }

  // HTTPS origin is checked explicitly unless PUBLIC_BASE_URL is already a spec.
  if (module.requiresHttps && !module.env.some((s) => s.key === 'PUBLIC_BASE_URL')) {
    const result = runValidator('httpsOrigin', env.PUBLIC_BASE_URL);
    checks.push(result.valid
      ? pass('origin:https', 'Public HTTPS origin', 'PUBLIC_BASE_URL is a public HTTPS origin.')
      : fail('origin:https', 'Public HTTPS origin', result.message));
  }
  return checks;
}

function callbacksFor(module, env) {
  const origin = env.PUBLIC_BASE_URL || '';
  const urls = callbackUrlsFor(origin || 'https://YOUR-DOMAIN');
  return (module.callbacks || []).map((key) => ({ key, label: CALLBACK_LABELS[key] || key, url: urls[key] }));
}

/**
 * Evaluate all modules.
 * @returns {{ generatedAt, summary, modules: object[], global: object[] }}
 */
export function checkAll({ env = process.env, root = process.cwd(), envFile = '.env' } = {}) {
  const partial = ACTIVATION_MODULES.map((module) => {
    const checks = configChecks(module, env);
    return { module, checks };
  });

  const statusById = {};
  for (const item of partial) {
    statusById[item.module.id] = item.checks.some((c) => c.status === 'fail') ? 'incomplete' : 'ready';
  }

  const modules = partial.map(({ module, checks }) => {
    const depChecks = (module.dependsOn || []).map((depId) => {
      const dep = getModule(depId);
      const depStatus = statusById[depId] || 'incomplete';
      return depStatus === 'ready'
        ? pass(`dep:${depId}`, `Depends on: ${dep?.name || depId}`, 'Dependency is ready.')
        : fail(`dep:${depId}`, `Depends on: ${dep?.name || depId}`, 'Activate that module first.');
    });

    const allChecks = [...checks, ...depChecks];
    const hasFails = allChecks.some((c) => c.status === 'fail');
    const isExternalOnly = module.kind === 'external' && module.env.length === 0;
    const status = isExternalOnly ? 'external' : hasFails ? 'incomplete' : 'ready';
    const localChecks = allChecks.filter((c) => c.status !== 'info');

    return {
      id: module.id,
      number: module.number,
      name: module.name,
      category: module.category,
      kind: module.kind,
      summary: module.summary,
      status,
      passed: localChecks.filter((c) => c.status === 'pass').length,
      total: localChecks.length,
      externalPending: (module.consoleSteps || []).length + (module.deploySteps || []).length,
      checks: allChecks,
      callbacks: callbacksFor(module, env),
      envSpecs: applicableEnv(module, env).map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        secret: Boolean(s.secret),
        optional: Boolean(s.optional),
        choices: s.choices || null,
        defaultValue: s.defaultValue ?? null,
        generator: s.generator || null,
        set: isSet(env[s.key]),
      })),
      consoleSteps: module.consoleSteps || [],
      deploySteps: module.deploySteps || [],
      verify: module.verify || [],
      docs: module.docs || [],
      permissions: module.permissions || [],
      dependsOn: module.dependsOn || [],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: modules.length,
      ready: modules.filter((m) => m.status === 'ready').length,
      incomplete: modules.filter((m) => m.status === 'incomplete').length,
      external: modules.filter((m) => m.status === 'external').length,
    },
    modules,
    global: globalChecks({ env, root, envFile }),
  };
}

/** The next module to work on, in numbered order ("one by one"). */
export function nextModule(report) {
  return report.modules.find((m) => m.status !== 'ready') || null;
}

const SECRET_PATTERNS = [
  { name: 'Stripe live/test secret', re: /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/ },
  { name: 'Stripe webhook secret', re: /\bwhsec_[A-Za-z0-9]{8,}/ },
  { name: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{20,}/ },
  { name: 'Replicate token', re: /\br8_[A-Za-z0-9]{20,}/ },
];

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|html|css|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Repository-wide safety checks that are not tied to a single module. */
export function globalChecks({ env = process.env, root = process.cwd(), envFile = '.env' } = {}) {
  const checks = [];
  checks.push(gitignoreCovers(root, path.basename(envFile))
    ? pass('global:gitignore', '.env is gitignored', 'Secrets will not be committed.')
    : fail('global:gitignore', '.env is gitignored', 'Add .env to .gitignore before storing secrets.'));

  const srcDir = path.join(root, 'src');
  const leaked = [];
  for (const file of walk(srcDir)) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(text)) leaked.push(`${path.relative(root, file)} (${p.name})`);
    }
  }
  checks.push(leaked.length
    ? fail('global:frontend-secrets', 'No secrets in frontend source', `Possible secrets found in: ${leaked.join(', ')}`)
    : pass('global:frontend-secrets', 'No secrets in frontend source', 'Frontend source contains no provider secret patterns.'));

  checks.push(fs.existsSync(path.join(root, 'node_modules'))
    ? pass('global:dependencies', 'Dependencies installed', 'node_modules is present.')
    : info('global:dependencies', 'Dependencies installed', 'Run npm install before starting the server.'));

  const demo = env.SEED_DEMO;
  const prod = env.NODE_ENV === 'production';
  if (prod && (demo === undefined || /^(true|1|yes|on)$/i.test(String(demo)))) {
    checks.push(fail('global:seed-demo', 'Seeded demo accounts disabled', 'Set SEED_DEMO=false in production and rotate admin credentials.'));
  } else {
    checks.push(pass('global:seed-demo', 'Seeded demo accounts disabled', prod ? 'SEED_DEMO is false.' : 'Development mode — remember to set SEED_DEMO=false in production.'));
  }

  if (prod && !/^https:\/\//.test(String(env.PUBLIC_BASE_URL || ''))) {
    checks.push(fail('global:secure-cookies', 'Secure session cookies', 'PUBLIC_BASE_URL must be HTTPS in production so secure cookies work.'));
  } else {
    checks.push(pass('global:secure-cookies', 'Secure session cookies', 'Cookie/HTTPS configuration looks consistent.'));
  }
  return checks;
}

/** Compact one-line status for CLI tables. */
export function statusLabel(status) {
  return { ready: 'READY', incomplete: 'NEEDS WORK', external: 'EXTERNAL' }[status] || status.toUpperCase();
}

export { configChecks };
