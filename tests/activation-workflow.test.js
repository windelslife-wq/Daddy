/**
 * Tests for the one-by-one module completion workflow.
 * Uses a real temporary SQLite database and a real gitignored temp .env file.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-workflow-'));
const envFile = path.join(tempDir, '.env');
const dbPath = path.join(tempDir, 'app.sqlite3');

const cliEnv = {
  ...process.env,
  NODE_ENV: 'test',
  SEED_DEMO: 'false',
  ADMIN_EMAIL: '',
  ADMIN_PASSWORD: '',
  SQLITE_PATH: dbPath,
  DATA_DIR: path.join(tempDir, 'data'),
  STORAGE_DIR: path.join(tempDir, 'storage'),
  APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
};

function cli(...args) {
  return execFileSync(process.execPath, ['scripts/setup.js', ...args], {
    cwd: root, env: cliEnv, encoding: 'utf8', timeout: 60000,
  });
}

const { checkAll } = await import('../server/services/activation/preflight.js');
const { verifyModule } = await import('../server/services/activation/verifiers.js');
const { ACTIVATION_MODULES } = await import('../server/services/activation/modules.js');
const {
  buildWorkItem, buildAllWorkItems, orderedWorkItems, ownerForCriterion,
  renderProgressReport, RECOMMENDED_ORDER, OWNERS,
} = await import('../server/services/activation/workflow.js');

before(async () => {
  await fsp.mkdir(tempDir, { recursive: true });
});

after(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test('recommended order includes every module exactly once and unblocks dependencies first', () => {
  assert.equal(RECOMMENDED_ORDER.length, ACTIVATION_MODULES.length);
  assert.equal(new Set(RECOMMENDED_ORDER).size, ACTIVATION_MODULES.length);
  for (const module of ACTIVATION_MODULES) assert.ok(RECOMMENDED_ORDER.includes(module.id), `missing ${module.id}`);
  const indexOf = (id) => RECOMMENDED_ORDER.indexOf(id);
  assert.ok(indexOf('encryption-key') < indexOf('public-https-origin'));
  assert.ok(indexOf('public-https-origin') < indexOf('facebook-pages'));
  assert.ok(indexOf('facebook-pages') < indexOf('app-review'));
  assert.equal(RECOMMENDED_ORDER.at(-1), 'app-review');
});

test('criterion owners are explicit and never claim code can do provider work', () => {
  assert.equal(ownerForCriterion('live-verified'), 'code');
  assert.equal(ownerForCriterion('manual-steps'), 'provider-console');
  assert.equal(ownerForCriterion('connected-account'), 'evidence');
  assert.equal(ownerForCriterion('live-post'), 'evidence');
  assert.equal(ownerForCriterion('https-origin'), 'infrastructure');
  assert.equal(ownerForCriterion('local-config'), 'credential');
  for (const key of Object.keys(OWNERS)) assert.ok(OWNERS[key].startsWith('You') || key === 'code');
});

test('work items expose exact actions without ever exposing a credential value', async () => {
  const env = { ...cliEnv, META_APP_ID: '', META_APP_SECRET: '' };
  const preflight = checkAll({ env, root });
  const results = {};
  for (const m of ACTIVATION_MODULES) results[m.id] = await verifyModule(m.id, { env, timeoutMs: 1000 });
  const items = buildAllWorkItems({ preflight, verifications: results, audit: null, env });
  assert.equal(items.length, 15);
  const facebook = items.find((i) => i.id === 'facebook-pages');
  assert.equal(facebook.preflight.status, 'incomplete');
  assert.ok(facebook.missingEnv.some((e) => e.key === 'META_APP_ID'));
  assert.ok(facebook.missingEnv.some((e) => e.key === 'META_APP_SECRET'));
  assert.ok(facebook.missingEnv.find((e) => e.key === 'META_APP_SECRET').secret);
  assert.ok(facebook.callbacks.some((c) => c.url.endsWith('/api/oauth/facebook/callback')));
  assert.ok(facebook.consoleSteps.length > 0);
  assert.ok(facebook.dependencies.some((d) => d.id === 'public-https-origin'));
  assert.ok(facebook.human.length > 0);
  assert.ok(facebook.finishCommand.includes('--confirm facebook-pages'));

  // No work item may contain a secret value, only key names and placeholders.
  const serialised = JSON.stringify(items);
  assert.ok(!serialised.includes(cliEnv.APP_ENCRYPTION_KEY), 'encryption key value leaked into a work item');
  assert.ok(!serialised.includes('r8_'), 'provider token leaked into a work item');
  for (const item of items) {
    for (const spec of item.missingEnv) assert.ok(spec.command.includes('<VALUE>') || spec.command.includes('--generate-key'));
  }
});

test('orderedWorkItems does not drop or duplicate modules', () => {
  const preflight = checkAll({ env: cliEnv, root });
  const items = buildAllWorkItems({ preflight, verifications: {}, audit: null, env: cliEnv });
  const ordered = orderedWorkItems(items);
  assert.equal(ordered.length, 15);
  assert.equal(new Set(ordered.map((i) => i.id)).size, 15);
  assert.equal(ordered[0].id, 'encryption-key');
});

test('progress report has one section per module and index links match GitHub anchors', () => {
  const preflight = checkAll({ env: cliEnv, root });
  const items = orderedWorkItems(buildAllWorkItems({ preflight, verifications: {}, audit: null, env: cliEnv }));
  const md = renderProgressReport(items, { generatedAt: '2026-01-01T00:00:00Z', summary: { total: 15, complete: 0, criteriaMet: 10, criteriaTotal: 70 } });
  const headings = [...md.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
  // "Recommended working order" and "Module index" are also level-2 headings.
  assert.equal(headings.length, 15, `expected 15 module headings, got ${headings.length}`);
  const slug = (text) => text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-');
  for (const heading of headings) {
    assert.ok(md.includes(`](#${slug(heading)})`), `index link missing for ${heading}`);
  }
  assert.ok(md.includes('Honesty rule'));
  assert.ok(!md.includes(cliEnv.APP_ENCRYPTION_KEY));
});

test('CLI --work reports live state for a single module as JSON', () => {
  const out = cli('--work', '1', '--json', '--env', envFile);
  const data = JSON.parse(out);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, 'facebook-pages');
  assert.equal(data.recorded, false);
  assert.ok(data.verificationSummary['facebook-pages']);
  assert.ok(data.items[0].completion.criteria.length > 0);
});

test('CLI --work all --record persists real verification results in the app DB', async () => {
  const out = cli('--work', 'all', '--record', '--json', '--env', envFile);
  const data = JSON.parse(out);
  assert.equal(data.recorded, true);
  assert.equal(Object.keys(data.verificationSummary).length, 15);
  assert.equal(data.verificationSummary['ai-providers'], 'verified');
  assert.equal(data.verificationSummary['encryption-key'], 'verified');
  assert.equal(data.verificationSummary['app-review'], 'unsupported');
  assert.ok(data.summary.criteriaMet >= 10, `expected criteria to be met, got ${data.summary.criteriaMet}`);

  // The offline-verifiable modules should now have their live-verified criterion met.
  for (const id of ['ai-providers', 'research', 'image-providers', 'tts-providers', 'encryption-key']) {
    const item = data.items.find((i) => i.id === id);
    const criterion = item.completion.criteria.find((c) => c.id === 'live-verified');
    assert.equal(criterion.status, 'pass', `${id} live-verified should be recorded`);
  }
  // Nothing is auto-confirmed: provider console steps must remain pending.
  for (const item of data.items) {
    const manual = item.completion.criteria.find((c) => c.id === 'manual-steps');
    if (manual) assert.equal(manual.status, 'pending', `${item.id} must not be auto-confirmed`);
    assert.equal(item.completion.complete, false, `${item.id} must not be auto-completed`);
  }
  assert.ok(fs.existsSync(dbPath), 'app database should have been created');
});

test('CLI --confirm requires a real note and is audit-logged; --unconfirm reverses it', async () => {
  let failed = false;
  try { cli('--confirm', 'research', '--env', envFile); } catch { failed = true; }
  assert.ok(failed, 'confirm without a note must be refused');

  const out = cli('--confirm', 'research', '--note', 'Billing cap set in provider console, ticket 4471', '--env', envFile);
  assert.match(out, /Criteria: 3\/4 → 4\/4/);
  assert.match(out, /Module complete: YES/);

  const auditOut = JSON.parse(cli('--work', 'research', '--json', '--env', envFile));
  assert.equal(auditOut.items[0].completion.complete, true, 'research should now be fully complete');

  const undo = cli('--unconfirm', 'research', '--env', envFile);
  assert.match(undo, /Removed attestation/);
  const after = JSON.parse(cli('--work', 'research', '--json', '--env', envFile));
  assert.equal(after.items[0].completion.complete, false, 'unconfirm must reverse completion');
});

test('CLI --generate-key refuses to rotate an existing key', () => {
  const keyDir = path.join(tempDir, 'keys');
  fs.mkdirSync(keyDir, { recursive: true });
  const keyEnvFile = path.join(keyDir, '.env');
  fs.writeFileSync(keyEnvFile, '', { mode: 0o600 });
  // A clean process env: the key must come from the file, not a secret manager.
  const cleanEnv = { ...cliEnv };
  delete cleanEnv.APP_ENCRYPTION_KEY;
  const keyedCli = (...args) => execFileSync(process.execPath, ['scripts/setup.js', ...args], {
    cwd: root, env: cleanEnv, encoding: 'utf8', timeout: 60000,
  });
  const first = keyedCli('--generate-key', '--env', keyEnvFile);
  assert.match(first, /Wrote 1 value/);
  const content = fs.readFileSync(keyEnvFile, 'utf8');
  const key = content.match(/^APP_ENCRYPTION_KEY=(.+)$/m)?.[1];
  assert.ok(key && key.length > 20);
  const second = keyedCli('--generate-key', '--env', keyEnvFile);
  assert.match(second, /Refusing to rotate it silently/);
  assert.equal(fs.readFileSync(keyEnvFile, 'utf8').match(/^APP_ENCRYPTION_KEY=(.+)$/m)?.[1], key, 'key must be unchanged');
  // The generated key must be a valid 32-byte base64 value.
  assert.equal(Buffer.from(key.replace(/^"|"$/g, ''), 'base64').length, 32);
});
