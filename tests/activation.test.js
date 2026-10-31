import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ACTIVATION_MODULES, getModule, applicableEnv, allEnvKeys,
  generateEnvValue, callbackUrlsFor, CALLBACK_LABELS,
} from '../server/services/activation/modules.js';
import {
  validators, runValidator, describeValue, looksLikePlaceholder,
} from '../server/services/activation/validators.js';
import {
  mergeEnv, parseEnv, readEnvFile, writeEnvFile, gitignoreCovers, formatValue,
} from '../server/services/activation/envFile.js';
import { checkAll, nextModule, globalChecks } from '../server/services/activation/preflight.js';
import { renderRunbooks, renderModuleRunbook } from '../server/services/activation/runbooks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fullEnv(overrides = {}) {
  return {
    META_APP_ID: '123456789012345',
    META_APP_SECRET: 'abcdef0123456789abcdef0123456789',
    META_GRAPH_VERSION: 'v26.0',
    GOOGLE_CLIENT_ID: '1234567890-abcdef.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-abcdefghijklmnop',
    X_CONSUMER_KEY: 'xconsumerkey12345',
    X_CONSUMER_SECRET: 'xconsumersecret12345',
    STRIPE_SECRET_KEY: 'sk_test_abcdef123456',
    STRIPE_WEBHOOK_SECRET: 'whsec_abcdef123456',
    PUBLIC_BASE_URL: 'https://filmclublens.com',
    NODE_ENV: 'production',
    SECURE_COOKIES: 'true',
    SEED_DEMO: 'false',
    SMTP_URL: 'smtps://user:password@smtp.example.com:465',
    NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com/faceless',
    NOTIFICATION_WEBHOOK_SECRET: 'a'.repeat(24),
    AI_PROVIDER: 'local',
    SEARCH_PROVIDER: 'none',
    IMAGE_PROVIDER: 'procedural',
    TTS_PROVIDER: 'mespeak',
    DATABASE_URL: 'postgresql://user:password@db.example.com:5432/faceless',
    APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    ...overrides,
  };
}

test('registry is complete, internally consistent, and ordered 1..15', () => {
  assert.equal(ACTIVATION_MODULES.length, 15);
  const ids = ACTIVATION_MODULES.map((m) => m.id);
  assert.equal(new Set(ids).size, 15, 'module ids must be unique');
  assert.deepEqual(ACTIVATION_MODULES.map((m) => m.number), Array.from({ length: 15 }, (_, i) => i + 1));

  for (const m of ACTIVATION_MODULES) {
    assert.ok(m.name && m.summary && m.category, `${m.id} needs name/summary/category`);
    assert.ok(['config', 'external', 'hybrid'].includes(m.kind), `${m.id} has a valid kind`);
    assert.ok(Array.isArray(m.env), `${m.id} has an env array`);
    assert.ok(m.consoleSteps && m.deploySteps && m.verify && m.docs, `${m.id} has checklist arrays`);
    for (const spec of m.env) {
      assert.ok(spec.key && spec.label, `${m.id} env specs need key + label`);
      assert.ok(validators[spec.validator], `${m.id}/${spec.key} references a real validator: ${spec.validator}`);
    }
    for (const dep of m.dependsOn || []) {
      assert.ok(getModule(dep), `${m.id} depends on an unknown module: ${dep}`);
    }
    for (const cb of m.callbacks || []) {
      assert.ok(CALLBACK_LABELS[cb], `${m.id} references an unknown callback: ${cb}`);
    }
    // Every requiredWhen rule must reference a variable that actually exists.
    for (const spec of m.env) {
      for (const rule of [spec.requiredWhen, ...(spec.requiredWhenAny || [])].filter(Boolean)) {
        for (const key of Object.keys(rule)) assert.ok(allEnvKeys().includes(key), `${m.id}/${spec.key} rule uses unknown key ${key}`);
      }
    }
  }
});

test('callback URLs are exact and derive from the configured origin', () => {
  const urls = callbackUrlsFor('https://filmclublens.com/');
  assert.equal(urls.facebook, 'https://filmclublens.com/api/oauth/facebook/callback');
  assert.equal(urls.google, 'https://filmclublens.com/api/oauth/google/callback');
  assert.equal(urls.x, 'https://filmclublens.com/api/oauth/x/callback');
  assert.equal(urls.sandbox, 'https://filmclublens.com/api/oauth/sandbox/callback');
  assert.equal(urls.stripeWebhook, 'https://filmclublens.com/api/billing/webhook');
});

test('validators accept real-looking values and reject placeholders', () => {
  const env = fullEnv();
  for (const [key, value] of Object.entries(env)) {
    const spec = ACTIVATION_MODULES.flatMap((m) => m.env).find((s) => s.key === key);
    if (!spec || !value || key === 'SEED_DEMO' || key === 'SECURE_COOKIES' || key === 'NODE_ENV') continue;
    const result = runValidator(spec.validator, value);
    assert.equal(result.valid, true, `${key} should be valid: ${result.message}`);
  }
  assert.equal(runValidator('stripeSecretKey', 'your_key_here').valid, false);
  assert.equal(runValidator('httpsOrigin', 'http://localhost:8787').valid, false);
  assert.equal(runValidator('postgresUrl', 'sqlite://data/app.db').valid, false);
  assert.equal(runValidator('encryptionKey', 'not-base64-32-bytes').valid, false);
  assert.equal(runValidator('aiProvider', 'banana').valid, false);
  assert.equal(looksLikePlaceholder('{{meta_app_secret}}'), true);
});

test('validators never leak the inspected value into their messages', () => {
  const secret = 'SUPERSECRETVALUE_should_never_appear_98765';
  for (const name of ['stripeSecretKey', 'metaAppSecret', 'encryptionKey', 'openaiKey']) {
    const result = runValidator(name, secret);
    assert.ok(!result.message.includes(secret), `${name} leaked the value`);
  }
  const d = describeValue(secret);
  assert.equal(JSON.stringify(d).includes(secret), false);
  assert.match(d.fingerprint, /^sha256:[a-f0-9]{8}$/);
});

test('generated encryption key is valid base64 encoding exactly 32 bytes', () => {
  const spec = getModule('encryption-key').env[0];
  const value = generateEnvValue(spec);
  assert.equal(Buffer.from(value, 'base64').length, 32);
  assert.equal(runValidator('encryptionKey', value).valid, true);
});

test('mergeEnv preserves comments, replaces in place, revives templates, and never duplicates keys', () => {
  const original = [
    '# Film Club Lens — server environment',
    'NODE_ENV=development',
    '',
    '# META_APP_ID=',
    'OPENAI_API_KEY=',
    '# trailing comment',
  ].join('\n');
  const merged = mergeEnv(original, {
    NODE_ENV: 'production',
    META_APP_ID: '123456789012345',
    OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz',
    STRIPE_SECRET_KEY: 'sk_test_newvalue',
  });
  assert.ok(merged.includes('# Film Club Lens — server environment'));
  assert.ok(merged.includes('# trailing comment'));
  assert.equal((merged.match(/^NODE_ENV=/gm) || []).length, 1);
  assert.equal((merged.match(/^META_APP_ID=/gm) || []).length, 1);
  assert.equal((merged.match(/^OPENAI_API_KEY=/gm) || []).length, 1);
  assert.ok(merged.includes('STRIPE_SECRET_KEY='));
  assert.ok(merged.includes('Added by the Film Club Lens setup wizard'));

  const parsed = parseEnv(merged);
  assert.equal(parsed.NODE_ENV, 'production');
  assert.equal(parsed.META_APP_ID, '123456789012345');
  assert.equal(parsed.OPENAI_API_KEY, 'sk-abcdefghijklmnopqrstuvwxyz');

  const twice = mergeEnv(merged, { STRIPE_SECRET_KEY: 'sk_test_updated' });
  assert.equal((twice.match(/^STRIPE_SECRET_KEY=/gm) || []).length, 1);
  assert.equal(parseEnv(twice).STRIPE_SECRET_KEY, 'sk_test_updated');
  assert.ok(!twice.includes('sk_test_newvalue'));
});

test('formatValue round-trips realistic values through dotenv v17', () => {
  const values = [
    'sk_test_abcdef123456',
    'a"b\\c',
    'Film Club Lens <notifications@example.com>',
    'sk-test#with-hash',
    'line1\nline2',
    'postgresql://user:p%40ss@db.example.com:5432/faceless',
  ];
  for (const value of values) {
    const parsed = parseEnv(`KEY=${formatValue(value)}\n`);
    assert.equal(parsed.KEY, value, `failed for ${JSON.stringify(value)}`);
  }
  assert.equal(parseEnv(`KEY=${formatValue('')}\n`).KEY, '');
});

test('mergeEnv refuses to write a value dotenv cannot preserve', () => {
  // A literal backslash followed by "n" inside a quoted value would be
  // unescaped to a newline by dotenv — never corrupt a secret silently.
  const unrepresentable = 'has space and \\n literal';
  assert.throws(
    () => mergeEnv('OTHER=value\n', { KEY: unrepresentable }),
    /cannot preserve|process environment/,
  );
});

test('writeEnvFile is atomic and restricts permissions to owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-'));
  try {
    const file = path.join(dir, '.env');
    writeEnvFile(file, 'SECRET="abc"\n');
    assert.equal(fs.readFileSync(file, 'utf8'), 'SECRET="abc"\n');
    assert.equal(parseEnv(readEnvFile(file)).SECRET, 'abc');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('.env.tmp')).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitignoreCovers protects .env and .env.* but not .env.example', () => {
  assert.equal(gitignoreCovers(root, '.env'), true);
  assert.equal(gitignoreCovers(root, '.env.production'), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-'));
  try {
    assert.equal(gitignoreCovers(dir, '.env'), false);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\n.env.*\n!.env.example\n');
    assert.equal(gitignoreCovers(dir, '.env'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight: empty environment reports incomplete modules and starts at #1', () => {
  const report = checkAll({ env: {}, root });
  assert.equal(report.summary.total, 15);
  assert.ok(report.summary.incomplete >= 10);
  assert.equal(nextModule(report).id, 'facebook-pages');
  const fb = report.modules.find((m) => m.id === 'facebook-pages');
  assert.equal(fb.status, 'incomplete');
  assert.ok(fb.checks.some((c) => c.id === 'env:META_APP_ID' && c.status === 'fail'));
  assert.ok(fb.callbacks[0].url.includes('/api/oauth/facebook/callback'));
});

test('preflight: fully configured environment clears every local check', () => {
  const env = fullEnv();
  const report = checkAll({ env, root });
  const broken = report.modules.filter((m) => m.status === 'incomplete');
  assert.deepEqual(broken.map((m) => m.id), [], `unexpected failures: ${JSON.stringify(broken.map((m) => ({ id: m.id, fails: m.checks.filter((c) => c.status === 'fail') })), null, 2)}`);
  assert.equal(report.summary.ready, 14);
  assert.equal(report.summary.external, 1, 'app review stays EXTERNAL by design');
  assert.equal(nextModule(report).id, 'app-review');
  // External console work is still reported even when locally ready.
  assert.ok(report.modules.find((m) => m.id === 'facebook-pages').consoleSteps.length > 0);
});

test('preflight: conditional env keys activate only for the selected provider', () => {
  const base = fullEnv({ AI_PROVIDER: 'openai' });
  const specs = applicableEnv(getModule('ai-providers'), base).map((s) => s.key);
  assert.ok(specs.includes('OPENAI_API_KEY'));
  assert.ok(!specs.includes('ANTHROPIC_API_KEY'));
  const report = checkAll({ env: base, root });
  const ai = report.modules.find((m) => m.id === 'ai-providers');
  assert.ok(ai.checks.some((c) => c.id === 'env:OPENAI_API_KEY' && c.status === 'fail'));
});

test('preflight report never contains a raw secret value', () => {
  const env = fullEnv();
  const serialized = JSON.stringify(checkAll({ env, root }));
  for (const key of ['META_APP_SECRET', 'STRIPE_SECRET_KEY', 'APP_ENCRYPTION_KEY', 'GOOGLE_CLIENT_SECRET', 'NOTIFICATION_WEBHOOK_SECRET']) {
    assert.ok(!serialized.includes(env[key]), `${key} leaked into the report`);
  }
});

test('global checks pass for this repository', () => {
  const checks = globalChecks({ env: fullEnv(), root });
  assert.ok(checks.some((c) => c.id === 'global:gitignore' && c.status === 'pass'));
  assert.ok(checks.some((c) => c.id === 'global:frontend-secrets' && c.status === 'pass'));
  assert.ok(checks.some((c) => c.id === 'global:seed-demo' && c.status === 'pass'));
});

test('generated runbook covers all modules, callbacks and wizard commands', () => {
  const text = renderRunbooks();
  for (const m of ACTIVATION_MODULES) {
    assert.ok(text.includes(m.name), `runbook missing ${m.name}`);
    assert.ok(text.includes(`npm run setup -- --module ${m.id}`), `runbook missing wizard command for ${m.id}`);
  }
  assert.ok(text.includes('https://YOUR-DOMAIN/api/oauth/facebook/callback'));
  assert.ok(text.includes('/api/billing/webhook'));
  assert.ok(text.includes('npm run doctor -- --probe'));
  assert.ok(renderModuleRunbook(ACTIVATION_MODULES[0]).startsWith('## 1. Facebook Pages publishing'));
  // GitHub keeps a double hyphen where " / " punctuation was stripped.
  assert.ok(text.includes('(#2-instagram-business--reels-publishing)'), 'slash-containing anchor must match GitHub slugs');
  assert.ok(text.includes('(#12-public-https-origin-callbacks--signed-media)'));
  assert.ok(!text.includes('(39 tests)'), 'do not hardcode a stale test count');
});
