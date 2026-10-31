/**
 * Tests for the production deployment stack and the one-by-one activation
 * driver. All servers here are real local listeners (real TLS, real SMTP
 * conversation, real signed HTTP webhook) — nothing is mocked inside the
 * verifier. They prove the tooling works; they are NOT production activation.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-deploy-'));
const certDir = path.join(tempDir, 'tls');

function run(script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000,
  });
}

// Async variant: the test process also hosts the TLS/SMTP/HTTP servers, so a
// blocking spawnSync would deadlock the event loop and the child would time out.
function runAsync(script, args = [], env = {}, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = ''; let done = false;
    const finish = (status) => {
      if (done) return; done = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(124); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { stderr += e.message; finish(1); });
    child.on('close', (code) => finish(code));
  });
}

before(async () => {
  await fsp.mkdir(certDir, { recursive: true });
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
});

after(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Deployment artifacts
// ---------------------------------------------------------------------------

test('docker-compose.yml is valid YAML and wires a real multi-worker stack', () => {
  const doc = YAML.parse(read('docker-compose.yml'), { merge: true });
  assert.deepEqual(Object.keys(doc.services).sort(), ['app', 'caddy', 'db-bootstrap', 'postgres', 'worker']);
  for (const name of ['app', 'worker', 'db-bootstrap']) {
    const env = doc.services[name].environment;
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.SECURE_COOKIES, 'true');
    assert.equal(env.TRUST_PROXY, 'true');
    assert.equal(env.SEED_DEMO, 'false');
    assert.ok(String(env.PUBLIC_BASE_URL).startsWith('https://'));
    assert.ok(String(env.DATABASE_URL).startsWith('postgresql://'));
    assert.ok(env.APP_ENCRYPTION_KEY.includes('APP_ENCRYPTION_KEY'));
  }
  assert.equal(String(doc.services.app.environment.WORKER_ENABLED).toLowerCase(), 'false');
  assert.equal(String(doc.services.worker.environment.WORKER_ENABLED).toLowerCase(), 'true');
  assert.equal(doc.services.app.environment.APP_URL, doc.services.app.environment.PUBLIC_BASE_URL);
  assert.equal(doc.services.app.environment.EXPOSE_DEMO_CREDENTIALS, 'false');
  assert.match(doc.services.app.environment.ADMIN_PASSWORD, /ADMIN_PASSWORD:\?/);
  assert.equal(doc.services.worker.depends_on.app.condition, 'service_healthy');
  assert.equal(doc.services.worker.healthcheck.disable, true);
  assert.deepEqual(doc.services['db-bootstrap'].profiles, ['tools']);
  assert.equal(doc.services['db-bootstrap'].healthcheck.disable, true);
  assert.deepEqual(doc.services.worker.command, ['node', 'server/worker-standalone.js']);
  assert.deepEqual(doc.services['db-bootstrap'].command, ['node', 'scripts/db-bootstrap.mjs']);
  assert.ok(doc.services.caddy.ports.some((p) => String(p).startsWith('443:')));
  assert.ok(doc.services.caddy.ports.some((p) => String(p).startsWith('80:')));
  assert.equal(doc.services.postgres.ports, undefined, 'Postgres must never be published');
  assert.ok(doc.services.postgres.healthcheck);
  for (const v of ['pgdata', 'caddy-data', 'app-storage']) assert.ok(Object.hasOwn(doc.volumes, v), `missing volume ${v}`);
});

test('Dockerfile builds the frontend, prunes dev deps and runs non-root', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /FROM node:22/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /ffmpeg/);
  assert.match(dockerfile, /TRUST_PROXY=true/);
  assert.match(dockerfile, /SECURE_COOKIES=true/);
  assert.match(dockerfile, /CMD \["node", "server\/index.js"\]/);
});

test('.dockerignore excludes secrets, data and build artifacts', () => {
  const ignore = read('.dockerignore');
  for (const entry of ['.env', 'node_modules', 'dist', 'data', 'storage', '.git', '*.sqlite3']) {
    assert.ok(ignore.split('\n').map((l) => l.trim()).includes(entry), `missing ${entry}`);
  }
  assert.ok(ignore.includes('!.env.example'));
});

test('Caddyfile terminates TLS and forwards the public scheme', () => {
  const caddy = read('deploy/Caddyfile');
  assert.match(caddy, /\{\$DOMAIN\}/);
  assert.match(caddy, /reverse_proxy app:3000/);
  assert.match(caddy, /X-Forwarded-Proto https/);
  assert.match(caddy, /Strict-Transport-Security/);
});

test('deployment runbook documents both modules and the exact callbacks', () => {
  const doc = read('deploy/README.md');
  for (const url of [
    '/api/oauth/facebook/callback', '/api/oauth/google/callback', '/api/oauth/x/callback',
    '/api/oauth/sandbox/callback', '/api/billing/webhook',
  ]) assert.ok(doc.includes(url), `missing ${url}`);
  assert.match(doc, /deploy:check/);
  assert.match(doc, /db:bootstrap/);
  assert.match(doc, /--scale worker=2/);
  assert.match(doc, /APP_ENCRYPTION_KEY/);
});

test('package.json exposes the new one-by-one commands', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const key of ['activate', 'deploy:check', 'db:bootstrap', 'worker']) assert.ok(scripts[key], `missing script ${key}`);
  assert.match(scripts.worker, /worker-standalone/);
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test('db-bootstrap refuses to run without a real PostgreSQL URL', () => {
  const r = run('scripts/db-bootstrap.mjs', [], { DATABASE_URL: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /not set to a PostgreSQL URL|Module 13 needs a real instance/);
});

test('worker-standalone refuses to start with WORKER_ENABLED=false', () => {
  const r = run('server/worker-standalone.js', [], { WORKER_ENABLED: 'false' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /refusing to start a worker-only process/);
});

test('deploy-check rejects a non-HTTPS local origin without making network calls', () => {
  const r = run('scripts/deploy-check.mjs', ['--origin', 'http://localhost:8787', '--json']);
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.summary.failed, 1);
  assert.match(report.checks[0].name, /origin shape/);
  assert.equal(report.callbacks.facebook, 'http://localhost:8787/api/oauth/facebook/callback');
});

// ---------------------------------------------------------------------------
// Real external deployment check against a local TLS server
// ---------------------------------------------------------------------------

test('deploy-check performs a real DNS + TLS + health + cookie + media check', async () => {
  const seen = [];
  const server = https.createServer({
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
  }, (req, res) => {
    seen.push(req.url);
    if (req.url === '/api/meta/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    if (req.url === '/api/meta/config') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    if (req.url === '/api/auth/login') {
      res.writeHead(200, { 'set-cookie': 'session=test; Path=/; HttpOnly; Secure; SameSite=Lax' });
      res.end('{"ok":true}'); return;
    }
    if (req.url.startsWith('/media/')) {
      res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/4' }); res.end('abcd'); return;
    }
    if (req.url.startsWith('/api/oauth/') || req.url.startsWith('/api/billing/')) {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"missing state"}'); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `https://localhost:${port}`;
  try {
    const r = await runAsync('scripts/deploy-check.mjs', [
      '--origin', origin, '--allow-local', '--insecure', '--json',
      '--email', 'admin@example.com', '--password', 'test',
      '--media-url', `${origin}/media/clip.mp4`,
    ]);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, true, `expected ok: ${JSON.stringify(report.checks)}`);
    const names = report.checks.map((c) => c.name);
    for (const name of ['origin shape', 'DNS resolution', 'TLS certificate', 'public health endpoint', 'callback routes reachable', 'secure session cookies', 'signed media URL public', 'OAuth / webhook callback routes']) {
      assert.ok(names.includes(name), `missing check ${name}`);
    }
    for (const c of report.checks) assert.notEqual(c.status, 'fail', `${c.name} failed: ${c.detail}`);
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.callbacks.google, `${origin}/api/oauth/google/callback`);
    assert.equal(report.callbacks.stripeWebhook, `${origin}/api/billing/webhook`);
    assert.ok(seen.includes('/api/meta/health'));
    assert.ok(seen.some((u) => u.startsWith('/api/oauth/facebook/callback')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// One-by-one activation driver
// ---------------------------------------------------------------------------

function isolatedEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(tempDir, 'env-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, '', { mode: 0o600 });
  return {
    dir, envFile,
    env: {
      NODE_ENV: 'test', SEED_DEMO: 'false', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
      SQLITE_PATH: path.join(dir, 'app.sqlite3'), DATA_DIR: path.join(dir, 'data'),
      STORAGE_DIR: path.join(dir, 'storage'), WORKER_ENABLED: 'false',
      APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
      ...extra,
    },
  };
}

test('activate --list reports every module in dependency order without secrets', () => {
  const iso = isolatedEnv();
  const r = run('scripts/activate.mjs', ['--list', '--json', '--env', iso.envFile], iso.env);
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.modules.length, 15);
  assert.equal(report.modules[0].id, 'encryption-key');
  assert.equal(report.modules.at(-1).id, 'app-review');
  assert.ok(report.modules.find((m) => m.id === 'smtp').missingEnv.includes('SMTP_URL'));
  assert.ok(report.modules.find((m) => m.id === 'facebook-pages').missingEnv.includes('META_APP_SECRET'));
  assert.ok(!r.stdout.includes(iso.env.APP_ENCRYPTION_KEY), 'secret leaked into --list output');
});

test('activate refuses missing credentials and leaves the env file untouched', () => {
  const iso = isolatedEnv();
  const r = run('scripts/activate.mjs', ['smtp', '--env', iso.envFile], iso.env);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /SMTP_URL/);
  assert.equal(fs.readFileSync(iso.envFile, 'utf8'), '', 'nothing should be written');
});

test('activate validates formats and rejects an invalid SMTP_URL', () => {
  const iso = isolatedEnv();
  const r = run('scripts/activate.mjs', ['smtp', '--env', iso.envFile, '--set', 'SMTP_URL=https://not-smtp.example.com'], iso.env);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /INVALID/);
  assert.equal(fs.readFileSync(iso.envFile, 'utf8'), '');
});

test('activate runs a real SMTP handshake, records verification and does NOT auto-attest', async () => {
  // A genuine (minimal, RFC-shaped) SMTP server. nodemailer's verify() opens a
  // socket and issues EHLO; nothing inside the verifier is stubbed.
  const smtp = net.createServer((socket) => {
    socket.write('220 localhost ESMTP activation-test\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let at;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const port = smtp.address().port;
  const iso = isolatedEnv();
  try {
    const r = await runAsync('scripts/activate.mjs', [
      'smtp', '--env', iso.envFile, '--set', `SMTP_URL=smtp://127.0.0.1:${port}`, '--json',
    ], iso.env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.verification.status, 'verified');
    assert.deepEqual(report.valuesWritten, ['SMTP_URL']);
    assert.equal(report.completion.complete, false, 'manual steps must still be pending');
    assert.ok(report.completion.pending.some((c) => c.id === 'manual-steps'));
    assert.ok(report.completion.pending.every((c) => c.id !== 'live-verified'));
    const envContent = fs.readFileSync(iso.envFile, 'utf8');
    assert.ok(envContent.includes('SMTP_URL='));
    assert.ok(!r.stdout.includes(iso.env.APP_ENCRYPTION_KEY));
  } finally {
    await new Promise((resolve) => smtp.close(resolve));
  }
});

test('activate requires a meaningful attestation and only records it after real verification', async () => {
  // Signed webhook receiver: verifies the HMAC the app sends, so this is a real
  // signed delivery rather than a canned 200.
  const secret = 'test-webhook-secret';
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const timestamp = req.headers['x-film-club-lens-timestamp'];
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
      const ok = req.headers['x-film-club-lens-signature'] === expected;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(ok ? '{"ok":true}' : '{"ok":false}');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const port = receiver.address().port;
  const shortIso = isolatedEnv();
  const goodIso = isolatedEnv();
  const argsFor = (iso) => [
    'notification-webhook', '--env', iso.envFile,
    '--set', `NOTIFICATION_WEBHOOK_URL=http://127.0.0.1:${port}/hook`,
    '--set', `NOTIFICATION_WEBHOOK_SECRET=${secret}`,
  ];
  try {
    const short = await runAsync('scripts/activate.mjs', [...argsFor(shortIso), '--attest', 'ok', '--json'], shortIso.env);
    assert.equal(short.status, 2);
    assert.match(short.stdout + short.stderr, /meaningful note/);

    const good = await runAsync('scripts/activate.mjs', [...argsFor(goodIso), '--attest', 'Receiver deployed, HMAC verified end to end, ticket 9912', '--json'], goodIso.env);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    const report = JSON.parse(good.stdout);
    assert.equal(report.verification.status, 'verified');
    assert.equal(report.completion.complete, true, 'module 7 has no evidence criteria, so attestation completes it');
    assert.deepEqual(report.valuesWritten.sort(), ['NOTIFICATION_WEBHOOK_SECRET', 'NOTIFICATION_WEBHOOK_URL']);
    assert.ok(!good.stdout.includes(secret), 'webhook secret must never be printed');
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
  }
});
