#!/usr/bin/env node
/**
 * Activate ONE module end to end, one by one.
 *
 * Reads credentials from the process environment (secret manager / CI) or
 * --set KEY=VALUE, format-validates them, writes them to a gitignored .env,
 * runs the real live verifier, records the result, optionally records the
 * human attestation, and prints exactly what remains.
 *
 * It NEVER invents credentials, never auto-attests, and never prints a secret.
 *
 *   npm run activate -- --list
 *   SMTP_URL=smtp://user:pass@mail.example.com:587 \
 *     npm run activate -- smtp --attest "SPF/DKIM configured, ticket 4471"
 *   npm run activate -- 12 --set PUBLIC_BASE_URL=https://filmclublens.com
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  ACTIVATION_MODULES, getModule, applicableEnv, isEnvRequired, callbackUrlsFor,
} = await import('../server/services/activation/modules.js');
const { runValidator, isSet } = await import('../server/services/activation/validators.js');
const {
  readEnvFile, mergeEnv, writeEnvFile, gitignoreCovers, loadEnv,
} = await import('../server/services/activation/envFile.js');
const { checkAll } = await import('../server/services/activation/preflight.js');
const { verifyModule } = await import('../server/services/activation/verifiers.js');
const { buildWorkItem, RECOMMENDED_ORDER } = await import('../server/services/activation/workflow.js');
const { cliVerifierImpls } = await import('./verifier-impls.mjs');

function parseArgs(argv) {
  const args = { module: null, list: false, json: false, set: [], envFile: '.env', attest: null, verifyOnly: false, noWrite: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--list') args.list = true;
    else if (a === '--json') args.json = true;
    else if (a === '--verify-only') args.verifyOnly = true;
    else if (a === '--no-write') args.noWrite = true;
    else if (a === '--env' || a === '--env-file') args.envFile = argv[++i] || '.env';
    else if (a.startsWith('--env=')) args.envFile = a.slice(6) || '.env';
    else if (a === '--attest') args.attest = argv[++i] || '';
    else if (a.startsWith('--attest=')) args.attest = a.slice(9);
    else if (a === '--set') {
      const pair = argv[++i] || '';
      const at = pair.indexOf('=');
      if (at <= 0) { console.error('Invalid --set; expected KEY=VALUE'); process.exit(2); }
      args.set.push([pair.slice(0, at).trim(), pair.slice(at + 1).trim()]);
    } else if (!a.startsWith('-') && !args.module) args.module = a;
    else { console.error(`Unknown option: ${a}`); process.exit(2); }
  }
  return args;
}

function help() {
  console.log(`
Activate unfinished modules one by one.

  npm run activate -- --list                       Show every module, status and required keys
  npm run activate -- smtp                         Show exactly what this module needs
  KEY=value npm run activate -- smtp               Supply a credential from a secret manager
  npm run activate -- smtp --set SMTP_URL=smtp://…  Supply a credential as a flag
  npm run activate -- smtp --attest "what you did"  Record the human attestation
  npm run activate -- smtp --verify-only            Verify + record without changing .env
  npm run activate -- smtp --json                  Machine-readable result

Credentials are read from the process environment first, then --set. Secrets
are never printed. Values are format-validated before being written to a
gitignored .env (mode 0600). Nothing is auto-attested: --attest is an explicit
human declaration that the provider-console / deployment steps are done.
`);
}

function resolveModule(identifier) {
  if (!identifier) return null;
  const byId = getModule(identifier);
  if (byId) return byId;
  return ACTIVATION_MODULES.find((m) => String(m.number) === String(identifier)) || null;
}

async function dbServices() {
  const dbModule = await import('../server/db.js');
  const completion = await import('../server/services/activation/completion.js');
  await dbModule.initializeDatabase(dbModule.db, {
    seedDemo: false, adminEmail: '', adminPassword: '',
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return { ...dbModule, ...completion };
}

function requiredKeys(module, env) {
  return applicableEnv(module, env)
    .filter((spec) => isEnvRequired(spec))
    .map((spec) => spec.key);
}

async function listModules(envPath, json) {
  const env = loadEnv(envPath);
  const preflight = checkAll({ env, root, envFile: path.basename(envPath) });
  let services = null;
  let audit = null;
  try { services = await dbServices(); audit = await services.buildCompletionAudit({ env, root }); }
  catch { /* no DB available; still show configuration state */ }
  const byId = Object.fromEntries((audit?.modules || []).map((m) => [m.id, m]));
  const remaining = ACTIVATION_MODULES.filter((m) => !byId[m.id]?.complete);
  const order = [...RECOMMENDED_ORDER, ...ACTIVATION_MODULES.map((m) => m.id)];
  remaining.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const rows = remaining.map((m) => {
    const pf = preflight.modules.find((p) => p.id === m.id);
    const a = byId[m.id];
    return {
      number: m.number, id: m.id, name: m.name,
      preflight: pf?.status || 'unknown',
      complete: Boolean(a?.complete),
      criteria: a ? `${a.passed}/${a.total}` : '?',
      pending: a?.checks.filter((c) => c.status === 'pending').map((c) => c.id) || [],
      requiredEnv: requiredKeys(m, env),
      missingEnv: (pf?.envSpecs || []).filter((s) => !s.set && !s.optional).map((s) => s.key),
      nextAction: a?.nextAction || null,
    };
  });
  if (json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), remaining: rows.length, modules: rows }, null, 2));
  } else {
    console.log(`\n${remaining.length} unfinished module(s), in dependency order:\n`);
    for (const r of rows) {
      console.log(`  #${String(r.number).padStart(2)} ${r.id.padEnd(24)} ${String(r.criteria).padEnd(5)} ${r.preflight}`);
      console.log(`      needs: ${r.missingEnv.length ? r.missingEnv.join(', ') : '(no env values)'}`);
      console.log(`      pending: ${r.pending.join(', ') || 'none'}`);
    }
    console.log('\n  Activate one at a time: KEY=value npm run activate -- <id>\n');
  }
  if (services?.closeDb) await services.closeDb();
}

async function activate(args, envPath) {
  const module = resolveModule(args.module);
  if (!module) { console.error(`Unknown module "${args.module}". Run npm run activate -- --list`); process.exit(2); }

  let env = loadEnv(envPath);
  const updates = {};
  const specs = applicableEnv(module, env).filter((spec) => isEnvRequired(spec));
  const problems = [];

  if (!args.verifyOnly) {
    for (const spec of specs) {
      if (isSet(env[spec.key])) continue;
      const fromFlag = args.set.find(([k]) => k === spec.key);
      const value = fromFlag ? fromFlag[1] : process.env[spec.key];
      if (!isSet(value)) {
        problems.push(`${spec.key} — ${spec.description}`);
        continue;
      }
      const check = runValidator(spec.validator, value);
      if (!check.valid) problems.push(`${spec.key} — INVALID: ${check.message}`);
      else updates[spec.key] = value;
    }
  }

  if (problems.length) {
    const report = { ok: false, module: module.id, stage: 'configuration', problems, moduleRequirements: specs.map((s) => s.key) };
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`\nModule ${module.number}: ${module.name} — missing or invalid values:\n`);
      for (const p of problems) console.log(`  - ${p}`);
      console.log(`\n  Supply them as environment variables (recommended) or:`);
      console.log(`   npm run activate -- ${module.id} --set ${specs.map((s) => `${s.key}=<VALUE>`).join(' --set ')}`);
      console.log(`\n  Full checklist: npm run setup -- --work ${module.id}\n`);
    }
    process.exitCode = 2;
    return;
  }

  if (Object.keys(updates).length && !args.noWrite) {
    if (!gitignoreCovers(root, path.basename(envPath))) {
      console.error(`Refusing to write secrets: ${path.basename(envPath)} is not covered by .gitignore.`);
      process.exitCode = 1;
      return;
    }
    writeEnvFile(envPath, mergeEnv(readEnvFile(envPath), updates));
  }
  env = { ...env, ...loadEnv(envPath), ...updates };

  const preflight = checkAll({ env, root, envFile: path.basename(envPath) });
  const impls = await cliVerifierImpls();
  const verification = await verifyModule(module.id, { env, ...impls, timeoutMs: 10000 });

  let services = null;
  let before = null;
  let after = null;
  try {
    services = await dbServices();
    before = await services.buildCompletionAudit({ env, root });
    await services.recordModuleVerification(verification);
    await services.logAudit({
      userId: 'cli', action: 'cli.activation.verify', entityType: 'activation_module',
      entityId: module.id, details: { status: verification.status, source: 'activate' },
    });
    if (args.attest && verification.status !== 'verified' && verification.status !== 'unsupported') {
      console.error(`\nRefusing to attest: live verification is "${verification.status}", not verified. Fix that first.\n`);
      process.exitCode = 2;
      return;
    }
    if (args.attest) {
      if (String(args.attest).trim().length < 8) {
        console.error('\n--attest needs a meaningful note describing what you actually did.\n');
        if (services?.closeDb) await services.closeDb();
        process.exitCode = 2;
        return;
      }
      await services.setModuleConfirmation(module.id, 'cli', { confirmed: true, note: args.attest });
      await services.logAudit({
        userId: 'cli', action: 'cli.activation.confirm', entityType: 'activation_module',
        entityId: module.id, details: { note: String(args.attest).slice(0, 500), source: 'activate' },
      });
    }
    after = await services.buildCompletionAudit({ env, root });
  } catch (error) {
    console.error(`Could not access the application database: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const verifications = { ...(await services.getVerifications()), [module.id]: verification };
  const item = buildWorkItem(module.id, { preflight, verifications, audit: after, env });
  const beforeItem = before.modules.find((m) => m.id === module.id);
  const afterItem = after.modules.find((m) => m.id === module.id);
  const ok = verification.status === 'verified' || verification.status === 'unsupported';

  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    module: { id: module.id, number: module.number, name: module.name },
    valuesWritten: Object.keys(updates),
    verification: { status: verification.status, summary: verification.summary, action: verification.action },
    completion: {
      before: `${beforeItem.passed}/${beforeItem.total}`,
      after: `${afterItem.passed}/${afterItem.total}`,
      complete: afterItem.complete,
      pending: afterItem.checks.filter((c) => c.status === 'pending').map((c) => ({ id: c.id, label: c.label, owner: c.owner, action: c.action })),
    },
    callbacks: module.callbacks ? Object.fromEntries(module.callbacks.map((k) => [k, callbackUrlsFor(env.PUBLIC_BASE_URL)[k]])) : {},
    nextCommand: afterItem.complete ? null : `npm run activate -- ${module.id}`,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nModule ${module.number}: ${module.name}`);
    if (report.valuesWritten.length) console.log(`  Wrote ${report.valuesWritten.length} value(s): ${report.valuesWritten.join(', ')} (values hidden).`);
    console.log(`  Live verification: ${verification.status.toUpperCase()} — ${verification.summary}`);
    if (verification.action) console.log(`  → ${verification.action}`);
    console.log(`  Completion: ${report.completion.before} → ${report.completion.after} ${afterItem.complete ? '✅ COMPLETE' : ''}`);
    if (!afterItem.complete) {
      console.log('\n  Still pending:');
      for (const c of report.completion.pending) console.log(`   - [${c.owner}] ${c.label}: ${c.action || 'see runbook'}`);
      console.log(`\n  Console/deploy checklist: npm run setup -- --work ${module.id}`);
      console.log(`  When genuinely done: npm run activate -- ${module.id} --attest "<what you did>"`);
    }
    if (module.callbacks?.length) {
      console.log('\n  Register these exact callback URLs:');
      for (const [k, value] of Object.entries(report.callbacks)) console.log(`   ${k.padEnd(14)} ${value}`);
    }
    console.log('');
  }

  if (services?.closeDb) await services.closeDb();
  process.exitCode = ok || afterItem.complete ? 0 : 1;
  // Importing db/nodemailer/pg can leave keep-alive handles behind. Flush
  // stdout and exit explicitly so CI callers never hang.
  process.stdout.write('', () => process.exit(process.exitCode));
}

const args = parseArgs(process.argv.slice(2));
if (args.help) help();
else {
  const envPath = path.isAbsolute(args.envFile) ? args.envFile : path.join(root, args.envFile);
  if (args.list) await listModules(envPath, args.json);
  else if (args.module) await activate(args, envPath);
  else help();
}
