/**
 * Credential format validation for the activation wizard.
 *
 * Security contract: a validator NEVER returns the value it inspected. Error
 * messages describe the expected shape only, so a mistyped secret cannot leak
 * into logs, terminal scrollback, or a bug report. `describeValue` provides a
 * safe, non-reversible fingerprint that lets an operator compare two values.
 */
import crypto from 'node:crypto';

const PLACEHOLDERS = new Set([
  '', 'changeme', 'change-me', 'your_key_here', 'your-key-here', 'xxx', 'xxxx',
  // NB: "none" is NOT a placeholder — it is the legitimate offline value of
  // SEARCH_PROVIDER (see the research module).
  'todo', 'tbd', 'null', 'undefined', 'example', 'placeholder',
  'paste_here', 'paste-here', 'replace_me', 'replace-me', 'sk_test_xxx',
]);

function ok(message = 'Valid.') { return { valid: true, message }; }
function bad(message) { return { valid: false, message }; }

/** True for empty strings or obvious copy/paste placeholders. */
export function looksLikePlaceholder(value) {
  const v = String(value ?? '').trim();
  if (PLACEHOLDERS.has(v.toLowerCase())) return true;
  if (/^<.*>$/.test(v) || /^\{\{.*\}\}$/.test(v)) return true;
  if (/^(x{4,}|\*{4,}|\.{3,}|0{6,}|1{6,})$/i.test(v)) return true;
  return false;
}

/**
 * A safe description of a secret: length plus a short, one-way fingerprint.
 * Never returns any of the original characters.
 */
export function describeValue(value) {
  const raw = String(value ?? '');
  if (!raw) return { present: false, length: 0, fingerprint: null };
  return {
    present: true,
    length: raw.length,
    fingerprint: `sha256:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8)}`,
  };
}

function required(validator) {
  return (value) => {
    if (looksLikePlaceholder(value)) return bad('A real value is required (placeholder or empty).');
    return validator(String(value).trim());
  };
}

function hasNoWhitespace(value) {
  return !/[\s]/.test(value);
}

function isBase64Bytes(value, bytes) {
  let buf;
  try { buf = Buffer.from(value, 'base64'); } catch { return false; }
  if (buf.length !== bytes) return false;
  // Reject sloppy base64 that happens to decode to the right length.
  const canonical = buf.toString('base64').replace(/=+$/, '');
  return canonical === value.replace(/=+$/, '');
}

function urlOf(value, protocols) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!protocols.includes(url.protocol)) return null;
  if (!url.hostname) return null;
  return url;
}

function isLocalHostname(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
    || h.endsWith('.local') || h.endsWith('.test') || h.endsWith('.localhost')
    || /^127\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\./.test(h) || /^10\./.test(h);
}

/** Registry of reusable validators. Each returns { valid, message }. */
export const validators = {
  nonEmpty: required((v) => v.length > 0 ? ok() : bad('A non-empty value is required.')),

  metaAppId: required((v) => {
    if (!/^\d{6,20}$/.test(v)) return bad('Meta App ID is a numeric string (digits only, usually 15-16 digits).');
    return ok();
  }),

  metaAppSecret: required((v) => {
    if (!hasNoWhitespace(v)) return bad('Meta App Secret must not contain whitespace.');
    if (v.length < 24) return bad('Meta App Secret is a long hex string (32+ characters).');
    if (!/^[a-f0-9]+$/i.test(v)) return bad('Meta App Secret should be hexadecimal characters only.');
    return ok();
  }),

  graphVersion: required((v) => /^v\d+\.\d+$/.test(v) ? ok() : bad('Graph API version looks like "v26.0".')),

  googleClientId: required((v) => {
    if (!v.endsWith('.apps.googleusercontent.com')) {
      return bad('Google OAuth Client ID ends with ".apps.googleusercontent.com".');
    }
    return ok();
  }),

  googleClientSecret: required((v) => {
    if (!hasNoWhitespace(v)) return bad('Client secret must not contain whitespace.');
    if (v.length < 12) return bad('Google client secret is at least 12 characters.');
    return ok();
  }),

  xConsumerKey: required((v) => {
    if (!hasNoWhitespace(v)) return bad('Consumer key must not contain whitespace.');
    if (v.length < 10) return bad('X consumer key (API key) is at least 10 characters.');
    return ok();
  }),

  xConsumerSecret: required((v) => {
    if (!hasNoWhitespace(v)) return bad('Consumer secret must not contain whitespace.');
    if (v.length < 10) return bad('X consumer secret (API secret) is at least 10 characters.');
    return ok();
  }),

  stripeSecretKey: required((v) => {
    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(v)) {
      return bad('Stripe secret key starts with "sk_test_" or "sk_live_".');
    }
    return ok();
  }),

  stripeWebhookSecret: required((v) => {
    if (!/^whsec_[A-Za-z0-9+/=_-]+$/.test(v)) return bad('Stripe webhook secret starts with "whsec_".');
    return ok();
  }),

  openaiKey: required((v) => {
    if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(v)) return bad('OpenAI API key starts with "sk-".');
    return ok();
  }),

  anthropicKey: required((v) => {
    if (!/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(v)) return bad('Anthropic API key starts with "sk-ant-".');
    return ok();
  }),

  geminiKey: required((v) => {
    if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(v)) return bad('Gemini API key starts with "AIza".');
    return ok();
  }),

  replicateToken: required((v) => {
    if (!/^r8_[A-Za-z0-9]+$/.test(v)) return bad('Replicate token starts with "r8_".');
    return ok();
  }),

  elevenLabsKey: required((v) => {
    if (!hasNoWhitespace(v) || v.length < 20) return bad('ElevenLabs API key is a long token (32+ characters).');
    return ok();
  }),

  searchApiKey: required((v) => {
    if (!hasNoWhitespace(v) || v.length < 12) return bad('Search API key is at least 12 characters with no whitespace.');
    return ok();
  }),

  encryptionKey: required((v) => {
    if (!isBase64Bytes(v, 32)) return bad('APP_ENCRYPTION_KEY must be base64 that decodes to exactly 32 bytes (generate with: openssl rand -base64 32).');
    return ok();
  }),

  httpsOrigin: required((v) => {
    const url = urlOf(v, ['https:']);
    if (!url) return bad('PUBLIC_BASE_URL must be an absolute HTTPS origin, e.g. https://filmclublens.com.');
    if (isLocalHostname(url.hostname)) return bad('PUBLIC_BASE_URL must be a public hostname, not localhost/127.0.0.1/*.local/*.test.');
    if (url.pathname !== '/' || url.search || url.hash) return bad('PUBLIC_BASE_URL should be an origin only — no path, query, or fragment.');
    if (url.username || url.password) return bad('PUBLIC_BASE_URL must not contain credentials.');
    return ok();
  }),

  postgresUrl: required((v) => {
    const url = urlOf(v, ['postgres:', 'postgresql:']);
    if (!url) return bad('DATABASE_URL must start with postgresql:// or postgres://.');
    if (!url.pathname || url.pathname === '/') return bad('DATABASE_URL must include a database name in the path.');
    return ok();
  }),

  smtpUrl: required((v) => {
    const url = urlOf(v, ['smtp:', 'smtps:']);
    if (!url) return bad('SMTP_URL must start with smtp:// or smtps://.');
    return ok();
  }),

  webhookUrl: required((v) => {
    const url = urlOf(v, ['https:', 'http:']);
    if (!url) return bad('Webhook URL must be an absolute http(s) URL.');
    if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
      return bad('A non-local webhook URL must use HTTPS.');
    }
    return ok();
  }),

  webhookSecret: required((v) => {
    if (!hasNoWhitespace(v)) return bad('Webhook secret must not contain whitespace.');
    if (v.length < 16) return bad('Use at least 16 random characters for the HMAC secret.');
    return ok();
  }),

  aiProvider: required((v) => ['local', 'openai', 'anthropic', 'gemini'].includes(v)
    ? ok() : bad('AI_PROVIDER must be one of: local, openai, anthropic, gemini.')),

  searchProvider: required((v) => ['none', 'brave', 'tavily'].includes(v)
    ? ok() : bad('SEARCH_PROVIDER must be one of: none, brave, tavily.')),

  imageProvider: required((v) => ['procedural', 'openai', 'replicate'].includes(v)
    ? ok() : bad('IMAGE_PROVIDER must be one of: procedural, openai, replicate.')),

  ttsProvider: required((v) => ['mespeak', 'openai', 'elevenlabs'].includes(v)
    ? ok() : bad('TTS_PROVIDER must be one of: mespeak, openai, elevenlabs.')),

  /** Optional free-form values: only reject whitespace-only junk. */
  optionalText: (v) => looksLikePlaceholder(v) ? ok('Not set (optional).') : ok(),
};

export function runValidator(name, value) {
  const fn = validators[name] || validators.nonEmpty;
  try {
    const result = fn(value);
    return { valid: Boolean(result?.valid), message: result?.message || 'Invalid value.' };
  } catch (error) {
    return { valid: false, message: `Validation error: ${error.message}` };
  }
}

/** True when a value is non-empty and not a placeholder. */
export function isSet(value) {
  return !looksLikePlaceholder(value);
}

export { isLocalHostname };
