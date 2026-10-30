/**
 * Live credential verification for activation modules.
 *
 * Where a provider exposes a cheap, read-only, app-level endpoint, this module
 * verifies that the configured server credentials actually work — without a
 * full OAuth round trip and without storing or printing a secret.
 *
 * Design rules:
 *  - Pure/injectable: `fetchImpl`, `smtpVerifyImpl`, `pgCheckImpl` can be
 *    replaced in tests, so no test ever needs real network access.
 *  - Never leak: every string returned passes through `sanitize()`, which
 *    replaces any configured env value with [redacted]. Request URLs are never
 *    included in output (several providers take the key in the query string).
 *  - Honest: modules that cannot be verified from code return `unsupported`
 *    with the manual checklist, rather than a fake success.
 */
import crypto from 'node:crypto';
import { ACTIVATION_MODULES, getModule, applicableEnv } from './modules.js';
import { isSet, runValidator, isLocalHostname } from './validators.js';

const DEFAULT_ROOTS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  brave: 'https://api.search.brave.com/res/v1/web',
  tavily: 'https://api.tavily.com',
  replicate: 'https://api.replicate.com/v1',
  elevenLabs: 'https://api.elevenlabs.io/v1',
  metaGraph: 'https://graph.facebook.com',
  metaAuth: 'https://www.facebook.com',
  googleOAuth: 'https://oauth2.googleapis.com',
  googleAuth: 'https://accounts.google.com',
  xApi: 'https://api.x.com/2',
  xOAuth: 'https://api.x.com',
  stripe: 'https://api.stripe.com/v1',
};

const ROOT_ENV = {
  openai: 'OPENAI_BASE_URL', anthropic: 'ANTHROPIC_BASE_URL', gemini: 'GEMINI_BASE_URL',
  brave: 'BRAVE_BASE_URL', tavily: 'TAVILY_BASE_URL', replicate: 'REPLICATE_BASE_URL',
  elevenLabs: 'ELEVENLABS_BASE_URL', metaGraph: 'META_GRAPH_BASE_URL', metaAuth: 'META_AUTH_BASE_URL',
  googleOAuth: 'GOOGLE_OAUTH_BASE_URL', googleAuth: 'GOOGLE_AUTH_BASE_URL', xApi: 'X_API_BASE_URL',
  xOAuth: 'X_OAUTH_BASE_URL', stripe: 'STRIPE_API_BASE_URL',
};

export function resolveApiRoots(env = process.env) {
  const roots = {};
  for (const [key, fallback] of Object.entries(DEFAULT_ROOTS)) {
    roots[key] = String(env[ROOT_ENV[key]] || fallback).replace(/\/+$/, '');
  }
  return roots;
}

/** Replace any configured secret that appears in output text. */
export function sanitize(text, env = {}) {
  let out = String(text ?? '');
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.length < 8) continue;
    if (/^(true|false|production|development|local|none|procedural|mespeak|v\d+\.\d+)$/i.test(value)) continue;
    if (out.includes(value)) out = out.split(value).join('[redacted]');
  }
  // Provider error messages sometimes echo the full request URL.
  return out.replace(/https?:\/\/\S+/g, (url) => (/\b(key|token|secret|client_secret|access_token)=/i.test(url) ? '[provider endpoint]' : url));
}

const checkPass = (name, detail) => ({ name, status: 'pass', detail });
const checkFail = (name, detail) => ({ name, status: 'fail', detail });
const checkSkip = (name, detail) => ({ name, status: 'skip', detail });

function urlWithParams(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  return url.toString();
}

/** A single HTTP probe. Returns a check object; never throws. */
async function httpCheck(ctx, { name, url, method = 'GET', headers = {}, body, okStatuses = [200], onOk, onFail }) {
  try {
    const response = await ctx.fetchImpl(url, {
      method,
      headers,
      body,
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ctx.timeoutMs) : undefined,
    });
    const status = Number(response.status);
    let text = '';
    try { text = await (response.text ? response.text() : ''); } catch { text = ''; }
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: String(text).slice(0, 300) }; }
    if (okStatuses.includes(status)) return checkPass(name, onOk ? onOk(data, status) : `Provider returned ${status}.`);
    return checkFail(name, onFail ? onFail(data, status) : `Provider returned ${status}: ${data?.error?.message || data?.message || 'request rejected'}`);
  } catch (error) {
    const message = String(error?.message || error).replace(/https?:\/\/\S+/g, '[provider endpoint]');
    return checkFail(name, `Could not reach provider: ${message}`);
  }
}

function providerError(data) {
  return data?.error?.message || data?.error_description || data?.message || data?.error || 'credentials rejected';
}

function missing(env, keys) {
  return keys.filter((k) => !isSet(env[k]));
}

function unconfigured(missingKeys) {
  return {
    status: 'unconfigured',
    summary: `Not configured — missing ${missingKeys.join(', ')}.`,
    checks: [checkSkip('credential check', `Skipped: ${missingKeys.join(', ')} not set.`)],
    action: `Set ${missingKeys.join(', ')} in the server environment, then re-run verification.`,
  };
}

function offline(detail) {
  return {
    status: 'verified',
    summary: detail,
    checks: [checkPass('offline default', detail)],
    action: null,
  };
}

// ---------------------------------------------------------------------------
// Provider verifiers
// ---------------------------------------------------------------------------

async function verifyMeta(ctx, { instagram = false } = {}) {
  const env = ctx.env;
  const need = instagram ? ['META_APP_ID', 'META_APP_SECRET', 'PUBLIC_BASE_URL'] : ['META_APP_ID', 'META_APP_SECRET'];
  const absent = missing(env, need);
  if (absent.length) return unconfigured(absent);

  const checks = [];
  checks.push(await httpCheck(ctx, {
    name: 'Meta app credentials',
    url: urlWithParams(`${ctx.roots.metaGraph}/oauth/access_token`, {
      grant_type: 'client_credentials', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET,
    }),
    onOk: (data) => data.access_token ? 'Meta accepted the app ID/secret and issued an app access token.' : 'Meta responded but did not return an access token.',
    onFail: (data, status) => `Meta rejected the app credentials (${status}): ${providerError(data)}. Check App ID/Secret in Settings → Basic.`,
  }));

  if (instagram) {
    const origin = runValidator('httpsOrigin', env.PUBLIC_BASE_URL);
    checks.push(origin.valid
      ? checkPass('public HTTPS media origin', 'PUBLIC_BASE_URL is a public HTTPS origin; Meta can fetch signed media URLs.')
      : checkFail('public HTTPS media origin', origin.message));
  }
  return result(checks, {
    action: 'Request Advanced Access for the publishing permissions and whitelist the OAuth callback URL (see the runbook).',
  });
}

async function verifyGoogle(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  if (absent.length) return unconfigured(absent);
  // Exchanging a deliberately invalid code distinguishes a valid client
  // (invalid_grant) from an unknown client (invalid_client) without user consent.
  const body = new URLSearchParams({
    code: 'activation-verification-invalid-code',
    grant_type: 'authorization_code',
    redirect_uri: `${String(env.PUBLIC_BASE_URL || 'https://example.com').replace(/\/+$/, '')}/api/oauth/google/callback`,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  }).toString();
  const check = await httpCheck(ctx, {
    name: 'Google OAuth client',
    url: `${ctx.roots.googleOAuth}/token`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    okStatuses: [200, 400],
    onOk: (data, status) => {
      if (status === 200 && data.access_token) return 'Google accepted the OAuth client credentials.';
      if (data.error === 'invalid_grant') return 'Google recognised the client ID/secret (the dummy code was rejected as expected).';
      if (data.error === 'invalid_client') return `INVALID: ${providerError(data)}`;
      return `Unexpected response: ${providerError(data)}`;
    },
  });
  // Re-classify a 400/invalid_client as a real failure.
  if (/^INVALID:/.test(check.detail)) return { status: 'invalid', summary: check.detail.replace(/^INVALID:\s*/, ''), checks: [checkFail('Google OAuth client', check.detail.replace(/^INVALID:\s*/, ''))], action: 'Recreate the OAuth client credentials and whitelist the callback URL.' };
  if (check.status === 'fail') return result([check], { action: 'Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and network egress.' });
  return result([check], { action: 'Verify the OAuth consent screen and enable the three YouTube APIs.' });
}

async function verifyX(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['X_CONSUMER_KEY', 'X_CONSUMER_SECRET']);
  if (absent.length) return unconfigured(absent);
  const basic = Buffer.from(`${encodeURIComponent(env.X_CONSUMER_KEY)}:${encodeURIComponent(env.X_CONSUMER_SECRET)}`).toString('base64');
  const check = await httpCheck(ctx, {
    name: 'X app-only credentials',
    url: `${ctx.roots.xOAuth}/oauth2/token`,
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    onOk: (data) => data.access_token ? 'X accepted the consumer key/secret and issued an app-only bearer token.' : 'X responded without a bearer token; check the app tier.',
    onFail: (data, status) => `X rejected the consumer credentials (${status}): ${providerError(data)}.`,
  });
  return result([check], { action: 'Confirm read/write permissions, the exact callback URL, and that the API tier allows media upload.' });
}

async function verifyStripe(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
  if (absent.length) return unconfigured(absent);
  const checks = [];
  checks.push(await httpCheck(ctx, {
    name: 'Stripe API key',
    url: `${ctx.roots.stripe}/account`,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    onOk: (data) => data.id ? `Stripe accepted the key (account ${String(data.id).slice(0, 24)}).` : 'Stripe accepted the key.',
    onFail: (data, status) => `Stripe rejected the key (${status}): ${providerError(data)}.`,
  }));
  const whsec = runValidator('stripeWebhookSecret', env.STRIPE_WEBHOOK_SECRET);
  checks.push(whsec.valid
    ? checkPass('webhook signing secret', 'STRIPE_WEBHOOK_SECRET has the expected whsec_ format.')
    : checkFail('webhook signing secret', whsec.message));
  return result(checks, { action: 'Create recurring Price IDs in Admin → Plans and register the webhook endpoint with its four events.' });
}

async function verifySmtp(ctx) {
  const absent = missing(ctx.env, ['SMTP_URL']);
  if (absent.length) return unconfigured(absent);
  if (!ctx.smtpVerifyImpl) return {
    status: 'unsupported',
    summary: 'SMTP verification requires opening a mail socket; run `npm run setup -- --verify smtp` from the server host.',
    checks: [checkSkip('SMTP connection', 'Not run in this context.')],
    action: 'Run the CLI verifier on the server, or send a test broadcast and check delivery.',
  };
  try {
    const outcome = await ctx.smtpVerifyImpl(ctx.env.SMTP_URL, ctx.timeoutMs);
    return outcome.ok
      ? result([checkPass('SMTP connection', 'SMTP server accepted the connection and credentials.')], {})
      : result([checkFail('SMTP connection', outcome.message)], { action: 'Check SMTP_URL credentials, port, and TLS settings.' });
  } catch (error) {
    return result([checkFail('SMTP connection', sanitize(error.message, ctx.env))], { action: 'Check network egress to the SMTP host.' });
  }
}

async function verifyWebhook(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['NOTIFICATION_WEBHOOK_URL', 'NOTIFICATION_WEBHOOK_SECRET']);
  if (absent.length) return unconfigured(absent);
  const raw = JSON.stringify({ id: `act_${crypto.randomUUID()}`, type: 'activation.ping', createdAt: new Date().toISOString() });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `sha256=${crypto.createHmac('sha256', env.NOTIFICATION_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex')}`;
  const check = await httpCheck(ctx, {
    name: 'signed webhook delivery',
    url: env.NOTIFICATION_WEBHOOK_URL,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-faceless-event': 'activation.ping',
      'x-faceless-timestamp': String(timestamp),
      'x-faceless-signature': signature,
    },
    body: raw,
    okStatuses: [200, 201, 202, 204],
    onOk: (_data, status) => `Receiver accepted the signed ping (${status}).`,
    onFail: (data, status) => `Receiver returned ${status}: ${providerError(data)}.`,
  });
  return result([check], { action: 'Verify the HMAC over "timestamp.rawBody" and deduplicate by event id in your receiver.' });
}

async function verifyOpenAiKey(ctx, label) {
  return httpCheck(ctx, {
    name: label,
    url: `${ctx.roots.openai}/models`,
    headers: { authorization: `Bearer ${ctx.env.OPENAI_API_KEY}` },
    onOk: () => 'OpenAI accepted the API key.',
    onFail: (data, status) => `OpenAI rejected the key (${status}): ${providerError(data)}.`,
  });
}

async function verifyAi(ctx) {
  const env = ctx.env;
  const provider = env.AI_PROVIDER || 'local';
  if (provider === 'local') return offline('Local offline script engine is active — no external credential to verify.');
  const keyVar = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' }[provider];
  const absent = missing(env, [keyVar]);
  if (absent.length) return unconfigured(absent);
  let check;
  if (provider === 'openai') check = await verifyOpenAiKey(ctx, 'OpenAI API key');
  else if (provider === 'anthropic') check = await httpCheck(ctx, {
    name: 'Anthropic API key',
    url: `${ctx.roots.anthropic}/models`,
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    onOk: () => 'Anthropic accepted the API key.',
    onFail: (data, status) => `Anthropic rejected the key (${status}): ${providerError(data)}.`,
  });
  else check = await httpCheck(ctx, {
    name: 'Gemini API key',
    url: urlWithParams(`${ctx.roots.gemini}/models`, { key: env.GEMINI_API_KEY }),
    onOk: () => 'Gemini accepted the API key.',
    onFail: (data, status) => `Gemini rejected the key (${status}): ${providerError(data)}.`,
  });
  return result([check], { action: 'Set a provider spend cap, then generate a test project and confirm the provider summary names the external model.' });
}

async function verifyResearch(ctx) {
  const env = ctx.env;
  const provider = env.SEARCH_PROVIDER || 'none';
  if (provider === 'none') return offline('Research is disabled — the offline research mode needs no credential.');
  const absent = missing(env, ['SEARCH_API_KEY']);
  if (absent.length) return unconfigured(absent);
  const check = provider === 'brave'
    ? await httpCheck(ctx, {
      name: 'Brave Search API',
      url: urlWithParams(`${ctx.roots.brave}/search`, { q: 'faceless studio activation', count: 1 }),
      headers: { 'x-subscription-token': env.SEARCH_API_KEY, accept: 'application/json' },
      onOk: () => 'Brave accepted the API key (minimal 1-result query).',
      onFail: (data, status) => `Brave rejected the key (${status}): ${providerError(data)}.`,
    })
    : await httpCheck(ctx, {
      name: 'Tavily API',
      url: `${ctx.roots.tavily}/search`,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SEARCH_API_KEY}` },
      body: JSON.stringify({ query: 'faceless studio activation', max_results: 1 }),
      onOk: () => 'Tavily accepted the API key (minimal 1-result query).',
      onFail: (data, status) => `Tavily rejected the key (${status}): ${providerError(data)}.`,
    });
  return result([check], { action: 'This probe consumed one search credit; confirm sources appear on a researched project.' });
}

async function verifyImages(ctx) {
  const env = ctx.env;
  const provider = env.IMAGE_PROVIDER || 'procedural';
  if (provider === 'procedural') return offline('Procedural SVG scene art is active offline — no external credential to verify.');
  if (provider === 'openai') {
    const absent = missing(env, ['OPENAI_API_KEY']);
    if (absent.length) return unconfigured(absent);
    return result([await verifyOpenAiKey(ctx, 'OpenAI Images key')], { action: 'Generate a test project and confirm scene art comes from the external provider.' });
  }
  const absent = missing(env, ['REPLICATE_API_TOKEN']);
  if (absent.length) return unconfigured(absent);
  const check = await httpCheck(ctx, {
    name: 'Replicate API token',
    url: `${ctx.roots.replicate}/account`,
    headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
    onOk: () => 'Replicate accepted the API token.',
    onFail: (data, status) => `Replicate rejected the token (${status}): ${providerError(data)}.`,
  });
  return result([check], { action: 'Generate a test project and confirm the provider log names the Replicate model.' });
}

async function verifyTts(ctx) {
  const env = ctx.env;
  const provider = env.TTS_PROVIDER || 'mespeak';
  if (provider === 'mespeak') return offline('Offline mespeak narration is active — no external credential to verify.');
  if (provider === 'openai') {
    const absent = missing(env, ['OPENAI_API_KEY']);
    if (absent.length) return unconfigured(absent);
    return result([await verifyOpenAiKey(ctx, 'OpenAI TTS key')], { action: 'Render a test video and confirm narration audio matches the SRT captions.' });
  }
  const absent = missing(env, ['ELEVENLABS_API_KEY']);
  if (absent.length) return unconfigured(absent);
  const check = await httpCheck(ctx, {
    name: 'ElevenLabs API key',
    url: `${ctx.roots.elevenLabs}/user`,
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
    onOk: () => 'ElevenLabs accepted the API key.',
    onFail: (data, status) => `ElevenLabs rejected the key (${status}): ${providerError(data)}.`,
  });
  return result([check], { action: 'Render a test video and confirm narration audio matches the SRT captions.' });
}

async function verifyOrigin(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['PUBLIC_BASE_URL']);
  if (absent.length) return unconfigured(absent);
  const shape = runValidator('httpsOrigin', env.PUBLIC_BASE_URL);
  const checks = [shape.valid
    ? checkPass('public HTTPS origin', 'PUBLIC_BASE_URL is a public HTTPS origin with no path or credentials.')
    : checkFail('public HTTPS origin', shape.message)];
  if (shape.valid) {
    checks.push(await httpCheck(ctx, {
      name: 'public health probe',
      url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/api/meta/health`,
      okStatuses: [200],
      onOk: () => 'The public origin routes to this server and /api/meta/health is reachable.',
      onFail: (_d, status) => `Health endpoint returned ${status}. Point DNS/TLS at this server.`,
    }));
  }
  return result(checks, { action: 'Whitelist all callback URLs in the Meta, Google, X, and Stripe consoles.' });
}

async function verifyPostgres(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['DATABASE_URL']);
  if (absent.length) return unconfigured(absent);
  const shape = runValidator('postgresUrl', env.DATABASE_URL);
  if (!shape.valid) return result([checkFail('connection URL', shape.message)], { action: 'Fix the DATABASE_URL format.' });
  if (!ctx.pgCheckImpl) return {
    status: 'unsupported',
    summary: 'PostgreSQL connection test is available from the CLI on the server host.',
    checks: [checkSkip('database connection', 'Not run in this context.')],
    action: 'Run `npm run setup -- --verify postgres` on the server.',
  };
  try {
    const outcome = await ctx.pgCheckImpl(env.DATABASE_URL, ctx.timeoutMs);
    if (!outcome.ok) {
      return result([checkFail('database connection', outcome.message)], { action: 'Check host, credentials, TLS mode, and firewall rules.' });
    }
    const checks = [checkPass('database connection',
      `Connected to PostgreSQL${outcome.version ? ` ${outcome.version}` : ''} and SELECT 1 succeeded.`)];
    // TLS: a remote database without encryption sends the password and every
    // query in plaintext. Local/private hosts are allowed to skip it.
    let local = false;
    try { local = isLocalHostname(new URL(env.DATABASE_URL).hostname); } catch { local = false; }
    if (outcome.tls === true) {
      checks.push(checkPass('TLS in use', 'The connection is encrypted (pg_stat_ssl reports ssl = true).'));
    } else if (outcome.tls === false) {
      checks.push(local
        ? checkPass('TLS in use', 'Plaintext connection to a local/private host — acceptable for local development only.')
        : checkFail('TLS in use', 'The connection to this remote host is NOT encrypted. Append ?sslmode=require to DATABASE_URL.'));
    } else {
      checks.push(checkSkip('TLS in use', 'Server did not report pg_stat_ssl for this role; confirm TLS in the provider console.'));
    }
    if (outcome.tables == null) {
      checks.push(checkSkip('schema readiness', 'Could not read pg_tables with this role; run `npm run db:bootstrap` to create and verify the schema.'));
    } else if (outcome.missingCore?.length) {
      checks.push(checkSkip('schema readiness',
        `${outcome.tables} table(s) present; missing ${outcome.missingCore.join(', ')}. Run \`npm run db:bootstrap\` to create the schema.`));
    } else {
      checks.push(checkPass('schema readiness', `${outcome.tables} public table(s) present, including users, jobs, projects, accounts and plans.`));
    }
    return result(checks, { action: 'Run `npm run db:bootstrap` to prove schema creation and two-worker job claims.' });
  } catch (error) {
    return result([checkFail('database connection', sanitize(error.message, env))], { action: 'Check network egress to the database host.' });
  }
}

function verifyEncryptionKey(ctx) {
  const env = ctx.env;
  const absent = missing(env, ['APP_ENCRYPTION_KEY']);
  if (absent.length) return unconfigured(absent);
  const shape = runValidator('encryptionKey', env.APP_ENCRYPTION_KEY);
  if (!shape.valid) return result([checkFail('key format', shape.message)], { action: 'Generate with `npm run setup -- --generate-key`.' });
  try {
    const key = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update('activation-round-trip'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return plain === 'activation-round-trip'
      ? result([checkPass('AES-256-GCM round trip', 'The key encrypts and decrypts a test payload correctly.')], {})
      : result([checkFail('AES-256-GCM round trip', 'Decrypted payload did not match.')], { action: 'Regenerate the key.' });
  } catch (error) {
    return result([checkFail('AES-256-GCM round trip', sanitize(error.message, env))], { action: 'Regenerate the key.' });
  }
}

function verifyAppReview() {
  return {
    status: 'unsupported',
    summary: 'Provider app review and Business Verification cannot be verified from code — reviewer decisions live in provider consoles.',
    checks: [checkSkip('provider approval', 'Manual confirmation required for Meta, Google, X, and Stripe.')],
    action: 'Complete the four console checklists in docs/ACTIVATION.md §15, then smoke-test with a non-team account.',
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function result(checks, { action = null } = {}) {
  const failed = checks.filter((c) => c.status === 'fail');
  const ran = checks.filter((c) => c.status !== 'skip');
  const networkDown = failed.length > 0 && failed.every((c) => c.detail.startsWith('Could not reach provider'));
  return {
    status: networkDown ? 'unreachable' : failed.length ? 'invalid' : ran.length ? 'verified' : 'unsupported',
    summary: failed.length
      ? `${failed.length} of ${checks.length} check(s) failed: ${failed.map((c) => c.name).join(', ')}.`
      : `All ${checks.length} check(s) passed.`,
    checks,
    action: failed.length ? (action || 'Correct the reported issue and re-run verification.') : action,
  };
}

const VERIFIERS = {
  'facebook-pages': (ctx) => verifyMeta(ctx),
  'instagram-reels': (ctx) => verifyMeta(ctx, { instagram: true }),
  youtube: verifyGoogle,
  x: verifyX,
  stripe: verifyStripe,
  smtp: verifySmtp,
  'notification-webhook': verifyWebhook,
  'ai-providers': verifyAi,
  research: verifyResearch,
  'image-providers': verifyImages,
  'tts-providers': verifyTts,
  'public-https-origin': verifyOrigin,
  postgres: verifyPostgres,
  'encryption-key': verifyEncryptionKey,
  'app-review': verifyAppReview,
};

/**
 * Verify one module's credentials.
 * @returns {Promise<{id,name,number,status,summary,checks,action,checkedAt,durationMs}>}
 */
export async function verifyModule(id, options = {}) {
  const module = getModule(id);
  if (!module) throw new Error(`Unknown activation module: ${id}`);
  const env = options.env || process.env;
  const ctx = {
    env,
    roots: resolveApiRoots(env),
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: options.timeoutMs || 8000,
    smtpVerifyImpl: options.smtpVerifyImpl || null,
    pgCheckImpl: options.pgCheckImpl || null,
  };
  const started = Date.now();
  let outcome;
  try {
    outcome = await (VERIFIERS[id] || (() => ({ status: 'unsupported', summary: 'No verifier available.', checks: [], action: null })))(ctx);
  } catch (error) {
    outcome = { status: 'unreachable', summary: sanitize(error.message, env), checks: [], action: 'Re-run verification; check server logs for details.' };
  }
  // Defence in depth: scrub every string that leaves this function.
  const scrub = (text) => sanitize(text, env);
  return {
    id,
    number: module.number,
    name: module.name,
    status: outcome.status,
    summary: scrub(outcome.summary),
    checks: (outcome.checks || []).map((c) => ({ name: scrub(c.name), status: c.status, detail: scrub(c.detail) })),
    action: outcome.action ? scrub(outcome.action) : null,
    requiredEnv: applicableEnv(module, env).filter((s) => !s.optional).map((s) => s.key),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

/** Verify several modules with bounded concurrency. */
export async function verifyAll(options = {}) {
  const ids = options.only && options.only.length ? options.only : ACTIVATION_MODULES.map((m) => m.id);
  const concurrency = Math.max(1, Math.min(options.concurrency || 4, ids.length || 1));
  const results = new Array(ids.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const index = cursor++;
      results[index] = await verifyModule(ids[index], options);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const ordered = results.filter(Boolean).sort((a, b) => a.number - b.number);
  const counts = {};
  for (const r of ordered) counts[r.status] = (counts[r.status] || 0) + 1;
  return { generatedAt: new Date().toISOString(), summary: { total: ordered.length, ...counts }, results: ordered };
}

export const VERIFIER_IDS = Object.keys(VERIFIERS);
