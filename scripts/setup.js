#!/usr/bin/env node
/**
 * Faceless Studio — activation wizard.
 *
 * Works through the unfinished modules one by one. It never contacts a
 * provider and never prints a secret. It only reads/writes a gitignored .env,
 * validates value formats, and reports offline preflight status.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  ACTIVATION_MODULES, getModule, applicableEnv, generateEnvValue,
  callbackUrlsFor, CALLBACK_LABELS,
} from '../server/services/activation/modules.js';
import { runValidator, isSet, describeValue } from '../server/services/activation/validators.js';
import { readEnvFile, mergeEnv, writeEnvFile, gitignoreCovers, loadEnv } from '../server/services/activation/envFile.js';
import { checkAll, nextModule, statusLabel } from '../server/services/activation/preflight.js';
import { renderRunbooks, renderModuleRunbook } from '../server/services/activation/runbooks.js';
import {
  buildWorkItem, buildAllWorkItems, orderedWorkItems, renderProgressReport,
} from '../server/services/activation/workflow.js';
import { cliVerifierImpls } from './verifier-impls.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code, text) => useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text);
const bold = (t) => c('1', t);
const dim = (t) => c('2', t);
const green = (t) => c('32', t);
const yellow = (t) => c('33', t);
const red = (t) => c('31', t);
const cyan = (t) => c('36', t);

function parseArgs(argv) {
  const args = {
    command: null, module: null, json: false, brief: false, runbooks: false,
    generateKey: false, set: [], envFile: '.env', help: false, verify: null,
    work: null, record: false, progress: false, confirm: null, note: '', unconfirm: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--list') args.command = 'list';
    else if (a === '--check') args.command = 'check';
    else if (a === '--next') args.command = 'next';
    else if (a === '--json') args.json = true;
    else if (a === '--brief') args.brief = true;
    else if (a === '--runbooks') args.runbooks = true;
    else if (a === '--generate-key') args.generateKey = true;
    else if (a === '--record') args.record = true;
    else if (a === '--progress') args.progress = true;
    else if (a === '--verify') {
      const next = argv[i + 1];
      args.verify = next && !next.startsWith('-') ? (argv[++i]) : 'all';
    } else if (a.startsWith('--verify=')) args.verify = a.slice('--verify='.length) || 'all';
    else if (a === '--work') {
      const next = argv[i + 1];
      args.work = next && !next.startsWith('-') ? (argv[++i]) : 'all';
    } else if (a.startsWith('--work=')) args.work = a.slice('--work='.length) || 'all';
    else if (a === '--confirm' || a === '--unconfirm') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) { console.error(red(`Missing module id after ${a}`)); process.exit(2); }
      if (a === '--confirm') args.confirm = argv[++i]; else args.unconfirm = argv[++i];
    } else if (a === '--note') args.note = argv[++i] || '';
    else if (a.startsWith('--note=')) args.note = a.slice('--note='.length);
    else if (a === '--module' || a === '-m') args.module = argv[++i] || null;
    else if (a.startsWith('--module=')) args.module = a.slice('--module='.length);
    // Node 22 reserves --env-file for itself, so use --env for the wizard.
    else if (a === '--env' || a === '--env-file') args.envFile = argv[++i] || '.env';
    else if (a.startsWith('--env=')) args.envFile = a.slice('--env='.length) || '.env';
    else if (a === '--set') {
      const pair = argv[++i] || '';
      const index = pair.indexOf('=');
      if (index > 0) args.set.push([pair.slice(0, index).trim(), pair.slice(index + 1).trim()]);
      else { console.error(red('Invalid --set; expected KEY=VALUE')); process.exit(2); }
    } else if (!a.startsWith('-') && !args.command) args.module = a;
    else { console.error(red(`Unknown option: ${a}`)); process.exit(2); }
  }
  return args;
}

function help() {
  console.log(`
${bold('Faceless Studio activation wizard')}

${dim('Works through the unfinished modules one by one. No provider is ever')}
${dim('contacted; secrets are never printed.')}

  ${cyan('npm run setup')}                              Interactive: status table, then pick a module
  ${cyan('npm run setup -- --list')}                   List all 15 modules and their status
  ${cyan('npm run setup -- --check')}                  Offline preflight report for every module
  ${cyan('npm run --silent setup -- --check --json')} Machine-readable report (use --silent to strip npm's banner)
  ${cyan('npm run setup -- --next')}                   Open the first unfinished module
  ${cyan('npm run setup -- --module <id|number>')}     Open a specific module
  ${cyan('npm run setup -- --brief')}                  Skip printing the checklist steps
  ${cyan('npm run setup -- --set KEY=VALUE')}          Set a value non-interactively (repeatable)
  ${cyan('npm run setup -- --generate-key')}           Generate APP_ENCRYPTION_KEY into .env
  ${cyan('npm run setup -- --verify')}                 Live-verify every module's credentials
  ${cyan('npm run setup -- --verify facebook-pages')}  Verify one module (id or number)
  ${cyan('npm run setup -- --work 1')}                  Work module #1 one-by-one: live state + exact next actions
  ${cyan('npm run setup -- --work all --record')}       Verify ALL modules and record results in the app DB
  ${cyan('npm run setup -- --work all --progress')}     Regenerate docs/ACTIVATION_PROGRESS.md
  ${cyan('npm run setup -- --confirm smtp --note "..."')} Attest that a module's human steps are DONE
  ${cyan('npm run setup -- --unconfirm smtp')}         Undo a mistaken attestation
  ${cyan('npm run setup -- --runbooks')}               Regenerate docs/ACTIVATION.md
  ${cyan('npm run setup -- --env .env.prod')}          Target a different env file (Node reserves --env-file)

${dim('Verification makes read-only, app-level calls to configured providers.')}
${dim('Nothing is printed that contains a secret, and no provider is contacted')}
${dim('for a module that has no credentials configured.')}

${bold('One-by-one completion workflow')}
${dim('  --work <id|number|all>  inspect a module: preflight, live verification,')}
${dim('  completion criteria, missing env keys, callback URLs, and exact commands.')}
${dim('  --record               persist the verification result (audit-logged).')}
${dim('  --confirm              ONLY after you genuinely did the provider/deploy')}
${dim('  steps. It is an attestation, not an automatic completion — the audit')}
${dim('  must stay truthful. --unconfirm reverses it.')}

${dim('Module ids:')} ${ACTIVATION_MODULES.map((m) => m.id).join(', ')}

${dim('After activation run:')} npm run doctor -- --probe
`);
}

function statusCell(status) {
  const label = statusLabel(status).padEnd(11);
  if (status === 'ready') return green(label);
  if (status === 'external') return yellow(label);
  return red(label);
}

function printTable(report) {
  console.log(`\n${bold('Activation status')}  ${dim(report.generatedAt)}`);
  console.log(`  ${green(String(report.summary.ready) + ' ready')} · ${red(String(report.summary.incomplete) + ' need work')} · ${yellow(String(report.summary.external) + ' external')}  (of ${report.summary.total})\n`);
  console.log(`  ${dim('#'.padEnd(3))} ${dim('MODULE'.padEnd(42))} ${dim('STATUS'.padEnd(12))} ${dim('CHECKS')}`);
  for (const m of report.modules) {
    const name = `${m.number}. ${m.name}`.slice(0, 41).padEnd(42);
    console.log(`  ${String(m.number).padEnd(3)} ${name} ${statusCell(m.status)} ${m.passed}/${m.total}`);
  }
  console.log('');
  for (const g of report.global) {
    const icon = g.status === 'pass' ? green('PASS') : g.status === 'fail' ? red('FAIL') : dim('INFO');
    console.log(`  [${icon}] ${g.label} — ${g.detail}`);
  }
  console.log('');
}

function printChecks(m) {
  for (const check of m.checks) {
    const icon = check.status === 'pass' ? green('ok  ') : check.status === 'fail' ? red('MISS') : dim('info');
    console.log(`   ${icon} ${check.label.padEnd(34)} ${check.detail}`);
  }
}

function printModuleChecklist(m, env, { brief = false } = {}) {
  console.log(`\n${bold(`Module ${m.number}: ${m.name}`)}`);
  console.log(dim(`  id: ${m.id}  ·  category: ${m.category}  ·  type: ${m.kind}`));
  console.log(`\n  ${m.summary}\n`);

  if (m.dependsOn.length) {
    console.log(`  ${bold('Depends on:')} ${m.dependsOn.join(', ')}\n`);
  }

  console.log(`  ${bold('Environment variables')}`);
  const specs = applicableEnv(getModule(m.id), env);
  if (!specs.length) console.log('   (none — this module is completed in provider consoles)');
  for (const s of specs) {
    const set = isSet(env[s.key]);
    const currentRaw = set
      ? `set (${describeValue(env[s.key]).fingerprint})`
      : (s.defaultValue !== undefined ? `default: ${s.defaultValue}` : 'not set');
    const current = (set ? green : dim)(currentRaw.padEnd(24));
    console.log(`   ${s.key.padEnd(30)} ${current} ${s.secret ? dim('secret') : ''} ${s.optional ? dim('optional') : ''}`);
    if (s.description) console.log(`     ${dim(s.description)}`);
  }

  if (m.callbacks.length) {
    const urls = callbackUrlsFor(env.PUBLIC_BASE_URL || 'https://YOUR-DOMAIN');
    console.log(`\n  ${bold('Exact callback URLs')}`);
    for (const key of m.callbacks) console.log(`   ${(CALLBACK_LABELS[key] || key).padEnd(38)} ${cyan(urls[key])}`);
  }

  if (brief) { printChecks(m); return; }

  if (m.permissions.length) {
    console.log(`\n  ${bold('Permissions / scopes / events')}`);
    for (const p of m.permissions) console.log(`   - ${p}`);
  }
  const section = (title, items) => {
    if (!items?.length) return;
    console.log(`\n  ${bold(title)}`);
    items.forEach((s, i) => console.log(`   ${String(i + 1).padStart(2)}. ${bold(s.title)} — ${s.detail}`));
  };
  section('Provider console steps', m.consoleSteps);
  section('Deployment steps', m.deploySteps);
  section('Verify it works', m.verify);
  if (m.docs.length) {
    console.log(`\n  ${bold('Official documentation')}`);
    for (const d of m.docs) console.log(`   - ${d.label}: ${cyan(d.url)}`);
  }
  console.log(`\n  ${bold('Current preflight')}`);
  printChecks(m);
}

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let hidden = false;
  const original = typeof rl._writeToOutput === 'function' ? rl._writeToOutput.bind(rl) : null;
  if (original) {
    rl._writeToOutput = (str) => {
      if (!hidden) return original(str);
      if (typeof str === 'string' && /[\r\n]/.test(str)) return original('\n');
      return undefined;
    };
  }
  return {
    ask: (prompt, { secret = false } = {}) => new Promise((resolve) => {
      process.stdout.write(prompt);
      hidden = secret;
      rl.question('', (answer) => {
        hidden = false;
        if (secret) process.stdout.write('\n');
        resolve(String(answer ?? '').trim());
      });
    }),
    close: () => rl.close(),
  };
}

async function promptForValue(prompter, spec, env) {
  const existing = env[spec.key];
  const hasExisting = isSet(existing);
  let tail = hasExisting ? dim(' [Enter = keep current]') : '';
  if (spec.optional) tail += dim(' [Enter = skip]');
  if (spec.defaultValue !== undefined && !hasExisting) tail += dim(` [Enter = ${spec.defaultValue}]`);
  if (spec.generator) tail += dim(' [g = generate]');

  if (spec.choices) {
    console.log(`\n   ${bold(spec.key)} — ${spec.description || spec.label}`);
    spec.choices.forEach((choice, i) => console.log(`     ${i + 1}) ${choice}${choice === spec.defaultValue ? dim(' (default / offline)') : ''}`));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = await prompter.ask(`   Choose 1-${spec.choices.length}, type a value, or Enter: `);
      if (!answer) return hasExisting ? undefined : (spec.defaultValue ?? undefined);
      const index = Number(answer);
      const chosen = Number.isInteger(index) && index >= 1 && index <= spec.choices.length
        ? spec.choices[index - 1] : answer;
      const result = runValidator(spec.validator, chosen);
      if (result.valid) return chosen;
      console.log(red(`   ${result.message}`));
    }
    return undefined;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await prompter.ask(`   ${bold(spec.key)}${tail} ${spec.secret ? dim('(hidden)') : ''}: `, { secret: Boolean(spec.secret) });
    if (!answer) {
      if (hasExisting) return undefined;
      if (spec.defaultValue !== undefined) return spec.defaultValue;
      if (spec.optional) return undefined;
      console.log(yellow('   A value is required. Enter "s" to skip this module.'));
      continue;
    }
    if (answer.toLowerCase() === 's') return undefined;
    if (spec.generator && answer.toLowerCase() === 'g') return generateEnvValue(spec);
    const result = runValidator(spec.validator, answer);
    if (result.valid) return answer;
    console.log(red(`   ${result.message}`) + dim(' (value not shown)'));
  }
  console.log(yellow('   Too many invalid attempts; leaving this value unchanged.'));
  return undefined;
}

async function runWizard(module, env, envPath, args) {
  printModuleChecklist({ ...reportModule(module.id, env) }, env, { brief: args.brief });
  if (!process.stdin.isTTY) {
    console.log(dim('\n  Non-interactive terminal: use --set KEY=VALUE to store values, or read the runbook above.'));
    return;
  }
  const prompter = createPrompter();
  const updates = {};
  try {
    console.log(`\n${bold('Enter values')} ${dim('— input is hidden for secrets, nothing is echoed back.')}`);
    const specs = applicableEnv(getModule(module.id), env);
    for (const spec of specs) {
      const value = await promptForValue(prompter, spec, env);
      if (value !== undefined) updates[spec.key] = value;
    }
    if (!Object.keys(updates).length) {
      console.log(dim('\n  No changes.'));
      return;
    }
    applyUpdates(envPath, updates);
  } finally {
    prompter.close();
  }
  const refreshed = { ...loadEnv(envPath), ...updates };
  const after = reportModule(module.id, refreshed);
  console.log(`\n${bold('Updated preflight')}`);
  printChecks(after);
  console.log(after.status === 'ready'
    ? green('\n  Local configuration complete. Provider-console steps above still need to be done by you.')
    : yellow('\n  Local configuration is still incomplete — run this module again when you have the remaining values.'));
  if (after.consoleSteps.length || after.deploySteps.length) {
    console.log(dim(`\n  ${after.consoleSteps.length} provider-console step(s), ${after.deploySteps.length} deployment step(s), ${after.verify.length} verification step(s) remain.`));
  }
  const next = nextModule(checkAll({ env: refreshed, root }));
  if (next) console.log(dim(`  Next module: #${next.number} ${next.name} — npm run setup -- --module ${next.id}`));
}

function reportModule(id, env) {
  return checkAll({ env, root }).modules.find((m) => m.id === id);
}

function applyUpdates(envPath, updates) {
  if (!gitignoreCovers(root, path.basename(envPath))) {
    console.error(red(`\n  Refusing to write secrets: ${path.basename(envPath)} is not covered by .gitignore.`));
    process.exit(1);
  }
  const invalid = [];
  for (const [key, value] of Object.entries(updates)) {
    const spec = findSpec(key);
    if (spec) {
      const result = runValidator(spec.validator, value);
      if (!result.valid) invalid.push(`${key}: ${result.message}`);
    }
  }
  if (invalid.length) {
    console.error(red('\n  Refusing to write invalid values:'));
    for (const line of invalid) console.error(red(`   - ${line}`));
    process.exit(1);
  }
  const content = mergeEnv(readEnvFile(envPath), updates);
  writeEnvFile(envPath, content);
  const relativePath = path.relative(root, envPath);
  const displayPath = relativePath.startsWith('..') ? envPath : relativePath;
  console.log(green(`\n  Wrote ${Object.keys(updates).length} value(s) to ${displayPath} (mode 0600):`));
  for (const [key, value] of Object.entries(updates)) {
    const d = describeValue(value);
    console.log(`   ${key.padEnd(30)} ${d.length} chars  ${d.fingerprint}`);
  }
}

function findSpec(key) {
  for (const m of ACTIVATION_MODULES) for (const s of m.env) if (s.key === key) return s;
  return null;
}

function verifyCell(status) {
  const labels = {
    verified: 'VERIFIED', invalid: 'INVALID', unconfigured: 'NOT CONFIGURED',
    unreachable: 'UNREACHABLE', unsupported: 'MANUAL',
  };
  const label = (labels[status] || status.toUpperCase()).padEnd(14);
  if (status === 'verified') return green(label);
  if (status === 'invalid' || status === 'unreachable') return red(label);
  return yellow(label);
}

function printVerificationRow(r) {
  console.log(`  ${String(r.number).padEnd(3)} ${`${r.number}. ${r.name}`.slice(0, 41).padEnd(42)} ${verifyCell(r.status)} ${String(r.checks.length).padStart(2)} checks  ${r.durationMs}ms`);
  for (const c of r.checks) {
    const icon = c.status === 'pass' ? green('ok  ') : c.status === 'fail' ? red('FAIL') : dim('skip');
    console.log(`       ${icon} ${c.name.padEnd(28)} ${c.detail}`);
  }
  if (r.action) console.log(dim(`       → ${r.action}`));
}

async function runVerification(args, env) {
  const { verifyModule, verifyAll } = await import('../server/services/activation/verifiers.js');
  const impls = await cliVerifierImpls();
  if (args.verify === 'all') {
    console.log(`\n${bold('Live credential verification')} ${dim('— read-only, app-level probes')}\n`);
    const report = await verifyAll({ env, ...impls, concurrency: 4, timeoutMs: 8000 });
    if (args.json) { console.log(JSON.stringify(report, null, 2)); return; }
    for (const r of report.results) printVerificationRow(r);
    console.log(`\n  ${bold('Summary')} ${JSON.stringify(report.summary)}`);
    console.log(dim('  UNREACHABLE usually means this host cannot egress to the provider; MANUAL means it can only be confirmed in a provider console.\n'));
    return;
  }
  const id = resolveModule(args.verify, checkAll({ env, root }), { strict: false });
  if (!id) return;
  const r = await verifyModule(id.id, { env, ...impls, timeoutMs: 8000 });
  if (args.json) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`\n${bold(`Verification: ${r.name}`)}\n`);
  printVerificationRow(r);
  console.log(`\n  ${bold('Status:')} ${verifyCell(r.status).trim()} — ${r.summary}\n`);
}

function resolveModule(identifier, report, { strict = true } = {}) {
  if (!identifier) return null;
  const byId = getModule(identifier);
  if (byId) return byId;
  const byNumber = report.modules.find((m) => String(m.number) === String(identifier));
  if (byNumber) return getModule(byNumber.id);
  const message = `Unknown module "${identifier}". Run npm run setup -- --list to see ids.`;
  if (strict) { console.error(red(message)); process.exit(2); }
  console.log(yellow(`  ${message}`));
  return null;
}

// ---------------------------------------------------------------------------
// One-by-one module completion workflow
// ---------------------------------------------------------------------------

/**
 * Lazily load the DB-backed activation services. Importing these loads
 * dotenv/config, so it is only done for --work/--confirm commands that really
 * need the application database.
 */
async function loadDbServices() {
  const dbModule = await import('../server/db.js');
  const completion = await import('../server/services/activation/completion.js');
  await dbModule.initializeDatabase(dbModule.db, {
    seedDemo: false, adminEmail: '', adminPassword: '',
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return { ...dbModule, ...completion };
}

function printWorkItem(item) {
  console.log(`\n${bold(`Module ${item.number}: ${item.name}`)} ${dim(`(${item.id})`)}`);
  console.log(`  ${dim('Preflight')}  ${item.preflight.status} (${item.preflight.passed}/${item.preflight.total})`);
  console.log(`  ${dim('Verify')}     ${item.verification ? `${item.verification.status} — ${item.verification.summary}` : 'not run'}`);
  console.log(`  ${dim('Completion')} ${item.completion.passed}/${item.completion.total} criteria ${item.completion.complete ? green('COMPLETE') : yellow('UNFINISHED')}`);
  console.log(`\n  ${bold('Criteria')}`);
  for (const c of item.completion.criteria) {
    const icon = c.status === 'pass' ? green('[x]') : yellow('[ ]');
    console.log(`   ${icon} ${c.label.padEnd(42)} ${dim(c.ownerLabel)}`);
    if (c.status !== 'pass' && c.action) console.log(`        ${dim(`→ ${c.action}`)}`);
  }
  if (item.missingEnv.length) {
    console.log(`\n  ${bold('Values you must supply')} ${dim('(wizard writes gitignored .env, mode 0600)')}`);
    for (const spec of item.missingEnv) console.log(`   - ${spec.key.padEnd(30)} ${spec.secret ? dim('secret') : dim('plain')}  ${spec.command}`);
  }
  if (item.callbacks.length) {
    console.log(`\n  ${bold('Callback URLs')}`);
    for (const cb of item.callbacks) console.log(`   - ${cb.label}: ${cb.url}`);
  }
  if (item.dependencies.some((d) => !d.complete)) {
    console.log(`\n  ${bold('Depends on')} ${item.dependencies.filter((d) => !d.complete).map((d) => `#${d.number} ${d.name}`).join(', ')}`);
  }
  console.log(`\n  ${bold('You can do now')}`);
  for (const action of item.automatable) console.log(`   - ${action}`);
  console.log(`\n  ${bold('Only you can do')}`);
  for (const action of item.human) console.log(`   - ${action}`);
  if (item.consoleSteps.length || item.deploySteps.length) {
    console.log(`\n  ${bold('External checklist')}`);
    for (const [i, s] of [...item.consoleSteps, ...item.deploySteps].entries()) console.log(`   ${i + 1}. ${s.title} — ${s.detail}`);
  }
  console.log(`\n  ${dim('Inspect:')} ${item.inspectCommand}`);
  console.log(`  ${dim('Finish:')} ${item.finishCommand}\n`);
}

async function runWork(args, envPath) {
  const env = loadEnv(envPath);
  const preflight = checkAll({ env, root, envFile: path.basename(envPath) });
  const { verifyModule } = await import('../server/services/activation/verifiers.js');
  const impls = await cliVerifierImpls();

  const all = args.work === 'all';
  const ids = all
    ? ACTIVATION_MODULES.map((m) => m.id)
    : [resolveModule(args.work, preflight)?.id].filter(Boolean);
  if (!ids.length) return;

  const fresh = {};
  for (const id of ids) {
    fresh[id] = await verifyModule(id, { env, ...impls, timeoutMs: 8000 });
  }

  let services = null;
  let audit = null;
  let recorded = {};
  try {
    services = await loadDbServices();
    if (args.record) {
      for (const id of ids) {
        await services.recordModuleVerification(fresh[id]);
        await services.logAudit({
          userId: 'cli', action: 'cli.activation.verify', entityType: 'activation_module',
          entityId: id, details: { status: fresh[id].status, checks: fresh[id].checks.length, source: 'setup --work' },
        });
      }
    }
    recorded = await services.getVerifications();
    audit = await services.buildCompletionAudit({ env, root });
  } catch (error) {
    console.log(yellow(`  Application database unavailable (${error.message}). Showing configuration state only; completion criteria cannot be read.`));
  }

  const verifications = { ...recorded, ...fresh };
  const context = { preflight, verifications, audit, env };
  const items = all ? buildAllWorkItems(context) : [buildWorkItem(ids[0], context)];
  const ordered = all ? orderedWorkItems(items) : items;

  const summary = {
    ...(preflight.summary || {}),
    ...(audit?.summary || {}),
  };

  if (args.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      summary,
      verificationSummary: Object.fromEntries(ids.map((id) => [id, fresh[id].status])),
      recorded: args.record,
      items: ordered,
    }, null, 2));
  } else {
    console.log(`\n${bold(all ? 'Activation completion workflow — all modules' : `Activation completion workflow — ${items[0].name}`)}`);
    console.log(dim(`  ${ids.length} module(s) checked · ${args.record ? 'results recorded in the app DB' : 'read-only (use --record to persist)'}\n`));
    for (const item of ordered) printWorkItem(item);
    console.log(bold('  Summary'));
    console.log(`   Modules complete: ${summary.complete ?? '?'} / ${summary.total ?? ACTIVATION_MODULES.length}`);
    console.log(`   Criteria met:     ${summary.criteriaMet ?? '?'} / ${summary.criteriaTotal ?? '?'}`);
    console.log(`   Preflight ready:  ${summary.ready ?? '?'} / ${summary.total ?? ACTIVATION_MODULES.length}\n`);
  }

  if (args.progress) {
    const docsDir = path.join(root, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const out = path.join(docsDir, 'ACTIVATION_PROGRESS.md');
    const fullItems = all ? ordered : null;
    fs.writeFileSync(out, renderProgressReport(fullItems || orderedWorkItems(buildAllWorkItems(context)), {
      generatedAt: new Date().toISOString(), summary,
    }), 'utf8');
    console.log(green(`  Wrote ${path.relative(root, out)}\n`));
  }

  if (services?.closeDb) await services.closeDb();
}

async function runConfirm(args, envPath) {
  const id = args.confirm || args.unconfirm;
  const undo = Boolean(args.unconfirm);
  const env = loadEnv(envPath);
  const preflight = checkAll({ env, root, envFile: path.basename(envPath) });
  const module = resolveModule(id, preflight);
  if (!module) return;

  if (!undo && String(args.note).trim().length < 5) {
    console.error(red('\n  Refusing to attest without a note. Describe what you actually did:'));
    console.error(red(`  npm run setup -- --confirm ${module.id} --note "Advanced Access approved in Meta console, ticket #1234"\n`));
    process.exit(2);
  }

  console.log(yellow(`\n  ATTENTION: --confirm is a human attestation that the provider-console /`));
  console.log(yellow(`  deployment steps for "${module.name}" were genuinely completed.`));
  console.log(yellow(`  It is audit-logged. Do not run it for steps you have not done.\n`));

  const services = await loadDbServices();
  const before = await services.buildCompletionAudit({ env, root });
  const beforeItem = before.modules.find((m) => m.id === module.id);
  await services.setModuleConfirmation(module.id, 'cli', { confirmed: !undo, note: args.note });
  await services.logAudit({
    userId: 'cli', action: undo ? 'cli.activation.unconfirm' : 'cli.activation.confirm',
    entityType: 'activation_module', entityId: module.id,
    details: { note: String(args.note || '').slice(0, 500), source: 'setup --confirm' },
  });
  const after = await services.buildCompletionAudit({ env, root });
  const afterItem = after.modules.find((m) => m.id === module.id);
  console.log(green(`  ${undo ? 'Removed' : 'Recorded'} attestation for ${module.name}.`));
  console.log(`   Criteria: ${beforeItem.passed}/${beforeItem.total} → ${afterItem.passed}/${afterItem.total}`);
  console.log(`   Module complete: ${afterItem.complete ? green('YES') : yellow('no — other criteria still pending')}`);
  if (!afterItem.complete) {
    console.log(dim('   Remaining:'));
    for (const c of afterItem.checks.filter((c) => c.status === 'pending')) console.log(dim(`    - ${c.label}: ${c.action}`));
  }
  console.log('');
  await services.closeDb();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); return; }
  const envPath = path.isAbsolute(args.envFile) ? args.envFile : path.join(root, args.envFile);
  // Deliberately do NOT call dotenv.config(): process.env must stay untouched so
  // values written to .env during this run are what preflight reports on.
  const env = loadEnv(envPath);

  if (args.runbooks) {
    const docsDir = path.join(root, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const out = path.join(docsDir, 'ACTIVATION.md');
    fs.writeFileSync(out, renderRunbooks(), 'utf8');
    console.log(green(`Wrote ${path.relative(root, out)} (${ACTIVATION_MODULES.length} module runbooks).`));
    return;
  }

  if (args.generateKey) {
    const spec = findSpec('APP_ENCRYPTION_KEY');
    const current = loadEnv(envPath);
    if (isSet(current.APP_ENCRYPTION_KEY)) {
      console.log(yellow('\n  APP_ENCRYPTION_KEY is already set. Refusing to rotate it silently — rotating makes existing encrypted OAuth tokens unreadable.'));
      console.log(dim('  If you really intend to rotate, remove the old value first and reconnect every affected account.\n'));
      return;
    }
    // In development the app already generated data/development.key and may
    // have encrypted credentials with it. Reuse that exact key so activating
    // module 14 never orphans stored tokens.
    const dataDir = path.isAbsolute(current.DATA_DIR || '') ? current.DATA_DIR : path.join(root, current.DATA_DIR || 'data');
    const devKeyPath = path.join(dataDir, 'development.key');
    let value = generateEnvValue(spec);
    if (fs.existsSync(devKeyPath)) {
      const existing = fs.readFileSync(devKeyPath, 'utf8').trim();
      if (runValidator('encryptionKey', existing).valid) value = existing;
    }
    applyUpdates(envPath, { APP_ENCRYPTION_KEY: value });
    console.log(dim('  Used the existing development key where available so stored credentials still decrypt.'));
    return;
  }

  if (args.set.length) {
    applyUpdates(envPath, Object.fromEntries(args.set));
    if (!args.module && !args.command && !args.work && !args.confirm && !args.unconfirm) return;
  }

  if (args.work) { await runWork(args, envPath); return; }
  if (args.confirm || args.unconfirm) { await runConfirm(args, envPath); return; }
  if (args.progress) { args.work = 'all'; await runWork(args, envPath); return; }

  const report = checkAll({ env: loadEnv(envPath), root, envFile: path.basename(envPath) });

  if (args.verify) {
    await runVerification(args, loadEnv(envPath));
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (args.command === 'check') { printTable(report); return; }
  if (args.command === 'list') { printTable(report); console.log(dim('  Tip: npm run setup -- --module <id>   ·   npm run setup -- --next\n')); return; }

  let identifier = args.module;
  if (args.command === 'next') {
    const next = nextModule(report);
    if (!next) { console.log(green('\n  Every module is locally ready. Provider-console approvals are the only remaining work.\n')); return; }
    identifier = next.id;
  }
  const module = resolveModule(identifier, report);

  printTable(report);
  if (!module) {
    if (process.stdin.isTTY) {
      const prompter = createPrompter();
      try {
        const answer = await prompter.ask('  Module id or number (Enter = next unfinished, q = quit): ');
        if (answer.toLowerCase() === 'q') return;
        const pending = nextModule(report);
        const chosen = (!answer || answer.toLowerCase() === 'next')
          ? (pending && getModule(pending.id))
          : resolveModule(answer, report, { strict: false });
        if (chosen) await runWizard(chosen, loadEnv(envPath), envPath, args);
      } finally { prompter.close(); }
    } else {
      console.log(dim('  Non-interactive terminal. Pick a module to see its full checklist:'));
      console.log(cyan('    npm run setup -- --module facebook-pages'));
      console.log(dim('  Or read the generated runbook: docs/ACTIVATION.md\n'));
    }
    return;
  }
  await runWizard(module, loadEnv(envPath), envPath, args);
}

main().catch((error) => {
  console.error(red(`\nSetup failed: ${error.message}`));
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
