#!/usr/bin/env node
/**
 * Real external deployment check for activation module 12.
 *
 * Unlike `doctor --probe` (which inspects the local process), this tool checks
 * the deployment from the OUTSIDE: DNS, a real TLS handshake and certificate,
 * the public health endpoint, secure session cookies, signed media URLs and
 * every OAuth/webhook callback path. Nothing is faked; a check either reaches
 * the real origin or fails.
 *
 *   npm run deploy:check -- --origin https://studio.example.com
 *   npm run deploy:check -- --origin https://studio.example.com --json
 *   npm run deploy:check -- --origin https://studio.example.com \
 *       --email admin@example.com --password '…' --media-url 'https://…/media/…'
 *
 * For local self-signed tests only: add --insecure --allow-local.
 */
import https from 'node:https';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { callbackUrlsFor } = await import('../server/services/activation/modules.js');

function parseArgs(argv) {
  const out = {
    origin: process.env.PUBLIC_BASE_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : ''),
    json: false, insecure: false, allowLocal: false, timeout: 10000,
    email: '', password: '', mediaUrl: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--origin') out.origin = argv[++i] || '';
    else if (a.startsWith('--origin=')) out.origin = a.slice(9);
    else if (a === '--json') out.json = true;
    else if (a === '--insecure') out.insecure = true;
    else if (a === '--allow-local') out.allowLocal = true;
    else if (a === '--timeout') out.timeout = Number(argv[++i]) || 10000;
    else if (a === '--email') out.email = argv[++i] || '';
    else if (a === '--password') out.password = argv[++i] || '';
    else if (a === '--media-url') out.mediaUrl = argv[++i] || '';
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown option: ${a}`); process.exit(2); }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: npm run deploy:check -- --origin https://studio.example.com [options]

Options:
  --origin <url>       Public HTTPS origin (default: PUBLIC_BASE_URL or https://$DOMAIN)
  --email <e>          Admin email for the secure-cookie login check
  --password <p>       Admin password for the secure-cookie login check
  --media-url <url>    Signed media URL to fetch from outside the network
  --timeout <ms>       Per-request timeout (default 10000)
  --json               Machine-readable output
  --insecure           Skip TLS verification (local self-signed tests ONLY)
  --allow-local        Permit localhost origins (local tests ONLY)

Exit code 0 = every required check passed, 1 = at least one failure.`);
}

function request(url, { method = 'GET', body = null, headers = {}, insecure = false, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      rejectUnauthorized: !insecure,
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        redirect: res.headers.location || null,
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: '', error: 'timeout' }); });
    req.on('error', (error) => resolve({ status: 0, headers: {}, body: '', error: error.message }));
    if (body) req.write(body);
    req.end();
  });
}

function tlsInfo(hostname, port, insecure, timeout) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: hostname, port, servername: hostname, rejectUnauthorized: !insecure, timeout,
    }, () => {
      const cert = socket.getPeerCertificate(true);
      const valid = socket.authorized || insecure;
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      socket.end();
      resolve({
        ok: Boolean(cert && Object.keys(cert).length),
        authorised: Boolean(socket.authorized),
        subject: cert?.subject?.CN || null,
        issuer: cert?.issuer?.O || cert?.issuer?.CN || null,
        validTo: validTo ? validTo.toISOString() : null,
        daysRemaining: validTo ? Math.floor((validTo - Date.now()) / 86400000) : null,
        expired: validTo ? validTo.getTime() < Date.now() : false,
        protocol: socket.getProtocol?.() || null,
        acceptedInsecure: insecure && !valid,
      });
    });
    socket.setTimeout(timeout, () => { socket.destroy(); resolve({ ok: false, error: 'timeout' }); });
    socket.on('error', (error) => resolve({ ok: false, error: error.message }));
  });
}

const results = [];
function record(name, status, detail, { required = true, hint = null } = {}) {
  results.push({ name, status, detail, required, hint });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.origin) {
    if (args.json) console.log(JSON.stringify({ ok: false, error: 'No origin supplied. Use --origin https://… or set PUBLIC_BASE_URL.' }, null, 2));
    else console.error('No origin supplied. Use --origin https://… or set PUBLIC_BASE_URL.\n');
    process.exit(1);
  }

  let url;
  try { url = new URL(args.origin); } catch {
    record('origin shape', 'fail', 'Not a valid URL.');
    return finish(args, args.origin);
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local') || url.hostname.endsWith('.test');
  const shapeOk = url.protocol === 'https:' && (!local || args.allowLocal) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  record('origin shape', shapeOk ? 'pass' : 'fail',
    shapeOk
      ? `${url.origin} is a public HTTPS origin with no path or credentials.`
      : `Expected a public https:// origin. Got ${url.origin}${url.pathname}; local hosts need --allow-local.`,
    { hint: 'Set PUBLIC_BASE_URL to the exact origin registered with your OAuth providers.' });

  if (!shapeOk) return finish(args, url.origin);

  try {
    const addresses = await dns.lookup(url.hostname, { all: true });
    record('DNS resolution', addresses.length ? 'pass' : 'fail',
      addresses.length ? `${url.hostname} resolves to ${addresses.map((a) => a.address).join(', ')}.` : 'No DNS records found.',
      { hint: 'Point an A/AAAA record at the host running Caddy and wait for propagation.' });
  } catch (error) {
    record('DNS resolution', 'fail', error.message, { hint: 'Check the DNS A/AAAA record for the domain.' });
  }

  const cert = await tlsInfo(url.hostname, Number(url.port) || 443, args.insecure, args.timeout);
  const tlsOk = cert.ok && !cert.expired && (cert.authorised || args.insecure);
  record('TLS certificate', tlsOk ? 'pass' : 'fail',
    cert.ok
      ? `CN=${cert.subject} issuer=${cert.issuer} expires=${cert.validTo} (${cert.daysRemaining}d left) ${cert.protocol}${args.insecure ? ' [verification skipped]' : ''}.`
      : `TLS handshake failed: ${cert.error || 'no certificate returned'}.`,
    { hint: 'Use a CA-signed certificate (Caddy/Let’s Encrypt). Self-signed certs break OAuth callbacks.' });

  const health = await request(`${url.origin}/api/meta/health`, { insecure: args.insecure, timeout: args.timeout });
  let healthBodyOk = false;
  try { healthBodyOk = JSON.parse(health.body)?.ok === true || JSON.parse(health.body)?.status === 'ok'; } catch { /* non-JSON health response */ }
  record('public health endpoint', health.status === 200 ? 'pass' : 'fail',
    health.status === 200
      ? `/api/meta/health returned 200${healthBodyOk ? ' with a healthy payload' : ''} from the public origin.`
      : `GET /api/meta/health returned ${health.status || health.error || 'no response'}.`,
    { hint: 'Confirm Caddy forwards to app:3000 and the container healthcheck passes.' });

  // Forwarded headers: the app must see https even though the upstream is http.
  const meta = await request(`${url.origin}/api/meta/config`, { insecure: args.insecure, timeout: args.timeout });
  record('callback routes reachable', meta.status === 200 ? 'pass' : 'fail',
    meta.status === 200
      ? 'Public API routes are reachable through the TLS edge.'
      : `GET /api/meta/config returned ${meta.status || meta.error || 'no response'}.`,
    { hint: 'Check TRUST_PROXY=true and X-Forwarded-Proto/Host headers.' });

  // Secure session cookies, only when credentials are supplied.
  if (args.email && args.password) {
    const login = await request(`${url.origin}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: args.email, password: args.password }),
      headers: { 'content-type': 'application/json' },
      insecure: args.insecure, timeout: args.timeout,
    });
    const cookies = login.headers['set-cookie'] || [];
    const session = cookies.find((c) => /session/i.test(c)) || cookies[0] || '';
    const secure = /;\s*secure\b/i.test(session);
    const httpOnly = /;\s*httponly\b/i.test(session);
    record('secure session cookies', login.status < 400 && secure && httpOnly ? 'pass' : 'fail',
      login.status < 400
        ? `Login returned ${login.status}; cookie has Secure=${secure}, HttpOnly=${httpOnly}.`
        : `Login returned ${login.status || login.error || 'no response'}; cannot inspect cookies.`,
      { required: false, hint: 'Set NODE_ENV=production and SECURE_COOKIES=true.' });
  } else {
    record('secure session cookies', 'skip', 'Provide --email and --password to check Secure/HttpOnly cookie flags.', { required: false });
  }

  if (args.mediaUrl) {
    const media = await request(args.mediaUrl, { insecure: args.insecure, timeout: args.timeout, headers: { range: 'bytes=0-1023' } });
    const type = media.headers['content-type'] || '';
    const ok = media.status === 200 || media.status === 206;
    record('signed media URL public', ok ? 'pass' : 'fail',
      ok ? `Returned ${media.status} (${type}) from outside the network.` : `Returned ${media.status || media.error || 'no response'}.`,
      { required: false, hint: 'Instagram/Meta must be able to fetch this URL without authentication.' });
  } else {
    record('signed media URL public', 'skip', 'Provide --media-url to verify a generated video is publicly fetchable.', { required: false });
  }

  const callbacks = callbackUrlsFor(url.origin);
  const callbackPaths = [...new Set(Object.values(callbacks).map((value) => new URL(value).pathname))];
  const callbackResults = await Promise.all(callbackPaths.map(async (p) => {
    const r = await request(`${url.origin}${p}`, { insecure: args.insecure, timeout: args.timeout });
    return { path: p, status: r.status || r.error };
  }));
  const routesOk = callbackResults.every((r) => typeof r.status === 'number' && r.status !== 404 && r.status < 500);
  record('OAuth / webhook callback routes', routesOk ? 'pass' : 'fail',
    callbackResults.map((r) => `${r.path} → ${r.status}`).join(', '),
    { hint: 'A 400 without OAuth state is expected; 404/502 means the route or proxy is broken.' });

  return finish(args, url.origin, callbacks);
}

function finish(args, origin, callbacks = null) {
  const failures = results.filter((r) => r.required && r.status === 'fail');
  const ok = failures.length === 0 && results.some((r) => r.status === 'pass');
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    origin,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skip').length,
    },
    checks: results,
    callbacks: callbacks || callbackUrlsFor(origin),
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nDeployment check — ${origin}\n`);
    for (const r of results) {
      const icon = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
      console.log(`  [${icon}] ${r.name} — ${r.detail}`);
      if (r.status === 'fail' && r.hint) console.log(`         → ${r.hint}`);
    }
    console.log('\nExact callback URLs to register in provider consoles:');
    for (const [key, value] of Object.entries(report.callbacks)) console.log(`  ${key.padEnd(14)} ${value}`);
    console.log(`\n  ${ok ? 'OK — public HTTPS origin is reachable and correctly configured.' : 'NOT READY — fix the failures above.'}\n`);
  }
  const code = ok ? 0 : 1;
  process.exitCode = code;
  // TLS sockets can keep a timeout timer alive; flush output then exit.
  process.stdout.write('', () => process.exit(code));
}

main().catch((error) => {
  console.error(`deploy-check failed: ${error.message}`);
  process.exitCode = 1;
});
