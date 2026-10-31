/**
 * Provider configuration owned by the Super Admin dashboard.
 *
 * Precedence is deliberate and always the same: a value saved in the dashboard
 * overrides the server environment; clearing it falls back to the environment.
 * Secrets are AES-256-GCM encrypted with APP_ENCRYPTION_KEY before they reach the
 * database and are never returned to any client — the API exposes only whether a
 * credential exists, where it came from, and its last four characters.
 *
 * The effective values are written straight into the shared `config` object, so
 * every service (AI, images, TTS, film providers) picks them up on its next read
 * without a restart. Nothing here invents a provider: switching to a provider
 * without a credential is rejected with an explicit error.
 */
import { config, providerStatus } from './config.js';
import { db, now, json, parseJson } from './db.js';
import { encrypt, decrypt } from './security.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export const PROVIDER_TABLE = 'provider_config';
const ROW_ID = 'default';

/** Provider choices per modality. `credential` names the secret that enables it. */
export const MODALITIES = [
  {
    id: 'ai',
    label: 'AI writing',
    description: 'Screenplays, scripts, captions and copy. Local mode is a deterministic template, not AI.',
    path: ['ai', 'provider'],
    env: 'AI_PROVIDER',
    options: [
      { id: 'local', label: 'Local template engine', credential: null, note: 'No external service, no cost.' },
      { id: 'openai', label: 'OpenAI', credential: 'openaiKey' },
      { id: 'anthropic', label: 'Anthropic', credential: 'anthropicKey' },
      { id: 'gemini', label: 'Google Gemini', credential: 'geminiKey' },
    ],
  },
  {
    id: 'research',
    label: 'Research & search',
    description: 'Web research for topic and claim checking. Off keeps every result local.',
    path: ['ai', 'researchProvider'],
    env: 'SEARCH_PROVIDER',
    options: [
      { id: 'none', label: 'Off', credential: null },
      { id: 'brave', label: 'Brave Search', credential: 'researchApiKey' },
      { id: 'tavily', label: 'Tavily', credential: 'researchApiKey' },
    ],
  },
  {
    id: 'images',
    label: 'Image generation',
    description: 'Scene art, storyboards and thumbnails.',
    path: ['media', 'imageProvider'],
    env: 'IMAGE_PROVIDER',
    options: [
      { id: 'procedural', label: 'Procedural SVG (local)', credential: null, note: 'Renders on this server.' },
      { id: 'openai', label: 'OpenAI images', credential: 'openaiKey' },
      { id: 'replicate', label: 'Replicate', credential: 'replicateToken' },
    ],
  },
  {
    id: 'tts',
    label: 'Text to speech',
    description: 'Narration and character voices.',
    path: ['media', 'ttsProvider'],
    env: 'TTS_PROVIDER',
    options: [
      { id: 'mespeak', label: 'meSpeak (local)', credential: null },
      { id: 'openai', label: 'OpenAI TTS', credential: 'openaiKey' },
      { id: 'elevenlabs', label: 'ElevenLabs', credential: 'elevenLabsKey' },
    ],
  },
  {
    id: 'film',
    label: 'Film video generation',
    description: 'Scene clips for the AI film studio. Off rejects generation with a 503 instead of faking a clip.',
    path: ['film', 'videoProvider'],
    env: 'FILM_VIDEO_PROVIDER',
    options: [
      { id: 'none', label: 'Off (no video provider)', credential: null },
      { id: 'replicate', label: 'Replicate', credential: 'replicateToken' },
      { id: 'fal', label: 'fal.ai', credential: 'falKey' },
      { id: 'veo', label: 'Google Veo', credential: 'veoKey' },
    ],
  },
];

/**
 * Secrets the dashboard can store. `paths` are the config fields a secret feeds —
 * a single Replicate token, for example, serves both image and film generation.
 */
export const SECRETS = [
  { id: 'openaiKey', label: 'OpenAI API key', group: 'OpenAI', env: 'OPENAI_API_KEY', placeholder: 'sk-…', paths: [['ai', 'openaiKey']] },
  { id: 'anthropicKey', label: 'Anthropic API key', group: 'Anthropic', env: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-…', paths: [['ai', 'anthropicKey']] },
  { id: 'geminiKey', label: 'Google Gemini API key', group: 'Google', env: 'GEMINI_API_KEY', placeholder: 'AIza…', paths: [['ai', 'geminiKey']] },
  { id: 'veoKey', label: 'Google Veo API key', group: 'Google', env: 'GOOGLE_VEO_API_KEY', placeholder: 'AIza…', paths: [['film', 'veoKey']] },
  { id: 'researchApiKey', label: 'Search API key (Brave or Tavily)', group: 'Search', env: 'SEARCH_API_KEY', placeholder: 'BSA… or tvly-…', paths: [['ai', 'researchApiKey']] },
  { id: 'replicateToken', label: 'Replicate API token', group: 'Replicate', env: 'REPLICATE_API_TOKEN', placeholder: 'r8_…', paths: [['media', 'replicateToken'], ['film', 'replicateToken']] },
  { id: 'falKey', label: 'fal.ai API key', group: 'fal.ai', env: 'FAL_API_KEY', placeholder: 'key-id:key-secret', paths: [['film', 'falKey']] },
  { id: 'elevenLabsKey', label: 'ElevenLabs API key', group: 'ElevenLabs', env: 'ELEVENLABS_API_KEY', placeholder: 'sk_…', paths: [['media', 'elevenLabsKey']] },
];

/** Non-secret model overrides. Blank means "use the environment value". */
export const MODEL_FIELDS = [
  { id: 'openaiModel', label: 'OpenAI text model', group: 'OpenAI', env: 'OPENAI_MODEL', path: ['ai', 'openaiModel'] },
  { id: 'anthropicModel', label: 'Anthropic model', group: 'Anthropic', env: 'ANTHROPIC_MODEL', path: ['ai', 'anthropicModel'] },
  { id: 'geminiModel', label: 'Gemini model', group: 'Google', env: 'GEMINI_MODEL', path: ['ai', 'geminiModel'] },
  { id: 'openaiImageModel', label: 'OpenAI image model', group: 'OpenAI', env: 'OPENAI_IMAGE_MODEL', path: ['media', 'openaiImageModel'] },
  { id: 'replicateImageModel', label: 'Replicate image model', group: 'Replicate', env: 'REPLICATE_IMAGE_MODEL', path: ['media', 'replicateModel'] },
  { id: 'openaiTtsModel', label: 'OpenAI TTS model', group: 'OpenAI', env: 'OPENAI_TTS_MODEL', path: ['media', 'openaiTtsModel'] },
  { id: 'elevenLabsVoiceId', label: 'ElevenLabs default voice ID', group: 'ElevenLabs', env: 'ELEVENLABS_VOICE_ID', path: ['media', 'elevenLabsVoiceId'] },
  { id: 'filmReplicateModel', label: 'Replicate film model', group: 'Replicate', env: 'FILM_REPLICATE_VIDEO_MODEL', path: ['film', 'replicateModel'] },
  { id: 'filmFalModel', label: 'fal.ai film model', group: 'fal.ai', env: 'FILM_FAL_VIDEO_MODEL', path: ['film', 'falModel'] },
  { id: 'filmVeoModel', label: 'Veo model', group: 'Google', env: 'FILM_VEO_MODEL', path: ['film', 'veoModel'] },
];

function getPath(target, path) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), target);
}

function setPath(target, path, value) {
  const last = path[path.length - 1];
  const parent = path.slice(0, -1).reduce((node, key) => {
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
    return node[key];
  }, target);
  parent[last] = value;
}

/**
 * Environment values are captured once, before anything is applied. They are both
 * the fallback when a dashboard value is cleared and the "inherited" value shown
 * in the admin table.
 */
const ENV_BASELINE = new Map();
for (const modality of MODALITIES) ENV_BASELINE.set(modality.path.join('.'), getPath(config, modality.path));
for (const secret of SECRETS) for (const path of secret.paths) ENV_BASELINE.set(path.join('.'), getPath(config, path));
for (const field of MODEL_FIELDS) ENV_BASELINE.set(field.path.join('.'), getPath(config, field.path));

function envValue(path) {
  return ENV_BASELINE.get(path.join('.'));
}

function defaultState() {
  return {
    active: Object.fromEntries(MODALITIES.map((modality) => [modality.id, String(envValue(modality.path) || 'none').toLowerCase()])),
    models: {},
    secrets: {},
  };
}

let current = defaultState();
let loadedAt = null;

function secretDefinition(id) {
  const def = SECRETS.find((item) => item.id === id);
  if (!def) throw new AppError(400, 'unknown_provider_secret', `Unknown credential "${id}".`);
  return def;
}

function modalityDefinition(id) {
  const def = MODALITIES.find((item) => item.id === id);
  if (!def) throw new AppError(400, 'unknown_provider_modality', `Unknown provider category "${id}".`);
  return def;
}

function optionDefinition(modality, optionId) {
  return modality.options.find((item) => item.id === optionId) || null;
}

/** Decrypt a stored secret, or report that the record cannot be read. */
function readSecret(record) {
  if (!record?.ct) return null;
  try {
    const value = decrypt(record.ct);
    return typeof value === 'string' && value ? value : null;
  } catch (error) {
    logger.error({ error: error.message }, 'Stored provider credential could not be decrypted');
    return null;
  }
}

function credentialValue(id) {
  const stored = readSecret(current.secrets[id]);
  if (stored) return stored;
  const def = secretDefinition(id);
  return envValue(def.paths[0]) || '';
}

function credentialAvailable(next, id) {
  if (next.secrets[id]?.ct) return true;
  const def = secretDefinition(id);
  return Boolean(envValue(def.paths[0]));
}

/** Wipe every managed field back to its environment value, then layer the state on top. */
function applyState(state) {
  for (const [key, value] of ENV_BASELINE) setPath(config, key.split('.'), value);
  for (const modality of MODALITIES) {
    const chosen = state.active[modality.id] || envValue(modality.path);
    setPath(config, modality.path, chosen);
  }
  for (const secret of SECRETS) {
    const value = readSecret(state.secrets[secret.id]);
    if (value) for (const path of secret.paths) setPath(config, path, value);
  }
  for (const field of MODEL_FIELDS) {
    const value = state.models[field.id];
    if (value) setPath(config, field.path, value);
  }
}

function normalizeState(raw) {
  const base = defaultState();
  const active = parseJson(raw?.active, {}) || {};
  for (const modality of MODALITIES) {
    const option = optionDefinition(modality, String(active[modality.id] || '').toLowerCase());
    if (option) base.active[modality.id] = option.id;
  }
  const models = parseJson(raw?.models, {}) || {};
  for (const field of MODEL_FIELDS) {
    const value = typeof models[field.id] === 'string' ? models[field.id].trim() : '';
    if (value) base.models[field.id] = value.slice(0, 160);
  }
  const secrets = parseJson(raw?.secrets, {}) || {};
  for (const secret of SECRETS) {
    const record = secrets[secret.id];
    if (record?.ct) {
      base.secrets[secret.id] = {
        ct: String(record.ct),
        last4: String(record.last4 || ''),
        updatedAt: record.updatedAt || null,
        updatedBy: record.updatedBy || null,
      };
    }
  }
  return base;
}

/** Load the saved configuration at boot. Never throws: a corrupt row falls back to env. */
export async function loadProviderConfig() {
  let state = defaultState();
  try {
    const row = await db(PROVIDER_TABLE).where({ id: ROW_ID }).first();
    if (row) state = normalizeState(row);
  } catch (error) {
    logger.error({ error: error.message }, 'Provider configuration could not be loaded; environment values are in use');
  }
  current = state;
  applyState(current);
  loadedAt = now();
  return current;
}

export function providerConfigState() {
  return { ...current, active: { ...current.active }, models: { ...current.models }, secrets: { ...current.secrets } };
}

/**
 * The admin view. Contains no plaintext credential: only presence, provenance,
 * last four characters and who changed it.
 */
export function providerConfigView() {
  const status = providerStatus();
  return {
    updatedAt: loadedAt,
    environment: {
      ai: envValue(['ai', 'provider']),
      research: envValue(['ai', 'researchProvider']),
      images: envValue(['media', 'imageProvider']),
      tts: envValue(['media', 'ttsProvider']),
      film: envValue(['film', 'videoProvider']),
    },
    encryptionActive: Boolean(config.encryptionKeyMaterial),
    modalities: MODALITIES.map((modality) => ({
      id: modality.id,
      label: modality.label,
      description: modality.description,
      env: modality.env,
      active: current.active[modality.id],
      inherited: envValue(modality.path),
      source: current.active[modality.id] === envValue(modality.path) ? 'environment' : 'dashboard',
      options: modality.options.map((option) => ({
        id: option.id,
        label: option.label,
        note: option.note || null,
        credential: option.credential,
        ready: option.credential ? credentialAvailable(current, option.credential) : true,
      })),
    })),
    secrets: SECRETS.map((secret) => {
      const record = current.secrets[secret.id] || null;
      const envSet = Boolean(envValue(secret.paths[0]));
      return {
        id: secret.id,
        label: secret.label,
        group: secret.group,
        env: secret.env,
        placeholder: secret.placeholder,
        source: record ? 'dashboard' : envSet ? 'environment' : null,
        last4: record?.last4 || null,
        updatedAt: record?.updatedAt || null,
        updatedBy: record?.updatedBy || null,
        // Environment keys stay hidden too: only their presence is ever reported.
        configured: Boolean(record) || envSet,
      };
    }),
    models: MODEL_FIELDS.map((field) => ({
      id: field.id,
      label: field.label,
      group: field.group,
      env: field.env,
      value: getPath(config, field.path) || '',
      inherited: envValue(field.path) || '',
      source: current.models[field.id] ? 'dashboard' : 'environment',
    })),
    status,
  };
}

const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 500;

function cleanSecretValue(value, label) {
  if (typeof value !== 'string') throw new AppError(400, 'invalid_provider_secret', `${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < MIN_SECRET_LENGTH) throw new AppError(400, 'invalid_provider_secret', `${label} looks too short to be a real credential.`);
  if (trimmed.length > MAX_SECRET_LENGTH) throw new AppError(400, 'invalid_provider_secret', `${label} is longer than ${MAX_SECRET_LENGTH} characters.`);
  if (/\s/.test(trimmed)) throw new AppError(400, 'invalid_provider_secret', `${label} must not contain spaces — check the paste.`);
  return trimmed;
}

/**
 * Persist a change, then make it effective immediately.
 *
 * The whole request is validated against the state it would produce, so an admin
 * can add a key and select its provider in one save, and can never leave an
 * active provider without the credential it needs.
 */
export async function updateProviderConfig(input = {}, userId = null) {
  const next = providerConfigState();
  const written = [];
  const cleared = [];

  for (const [modalityId, optionId] of Object.entries(input.active || {})) {
    const modality = modalityDefinition(modalityId);
    const option = optionDefinition(modality, String(optionId).toLowerCase());
    if (!option) {
      throw new AppError(400, 'unknown_provider_option', `${optionId} is not a valid choice for ${modality.label}.`);
    }
    next.active[modalityId] = option.id;
  }

  for (const [fieldId, rawValue] of Object.entries(input.models || {})) {
    const field = MODEL_FIELDS.find((item) => item.id === fieldId);
    if (!field) throw new AppError(400, 'unknown_provider_model', `Unknown model field "${fieldId}".`);
    const value = String(rawValue ?? '').trim();
    if (!value) delete next.models[fieldId];
    else if (value.length > 160) throw new AppError(400, 'invalid_provider_model', `${field.label} is too long.`);
    else if (!/^[\w.:/@-]+$/.test(value)) throw new AppError(400, 'invalid_provider_model', `${field.label} may only contain letters, numbers and -_.:/@.`);
    else next.models[fieldId] = value;
  }

  for (const [secretId, rawValue] of Object.entries(input.secrets || {})) {
    const def = secretDefinition(secretId);
    if (rawValue === null || rawValue === '') {
      delete next.secrets[secretId];
      cleared.push(secretId);
      continue;
    }
    const value = cleanSecretValue(rawValue, def.label);
    next.secrets[secretId] = {
      ct: encrypt(value),
      last4: value.slice(-4),
      updatedAt: now(),
      updatedBy: userId,
    };
    written.push(secretId);
  }

  for (const modality of MODALITIES) {
    const option = optionDefinition(modality, next.active[modality.id]);
    if (!option) throw new AppError(400, 'unknown_provider_option', `${next.active[modality.id]} is not a valid choice for ${modality.label}.`);
    if (option.credential && !credentialAvailable(next, option.credential)) {
      const def = secretDefinition(option.credential);
      throw new AppError(
        400,
        'provider_credential_missing',
        `${modality.label} cannot use ${option.label} yet: add ${def.label} first, or choose another provider.`,
      );
    }
  }

  const timestamp = now();
  const row = {
    id: ROW_ID,
    active: json(next.active),
    models: json(next.models),
    secrets: json(next.secrets),
    updated_at: timestamp,
    updated_by: userId,
  };
  await db(PROVIDER_TABLE).insert(row).onConflict('id').merge(row);

  current = next;
  applyState(current);
  loadedAt = timestamp;
  logger.info({ active: next.active, written, cleared }, 'Provider configuration updated');

  return { written, cleared, state: current };
}

const TEST_TIMEOUT_MS = 6000;

async function probe(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text().catch(() => '');
    return { status: response.status, latencies: Date.now() - started, body: body.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live credential check. Every probe is a real, read-only call to the official
 * API; nothing is reported as verified unless the provider answered. fal.ai has
 * no credential endpoint at all, so it reports `checked: false` rather than
 * pretending.
 */
export async function testProviderCredential(target) {
  const def = secretDefinition(target);
  const credential = credentialValue(target);
  if (!credential) {
    return {
      target,
      label: def.label,
      checked: false,
      ok: false,
      code: 'missing_credential',
      message: `${def.label} is not configured yet.`,
      checkedAt: now(),
    };
  }

  const get = (url, headers = {}) => probe(url, { headers });
  const post = (url, body, headers = {}) => probe(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  let label = def.label;
  let run;
  switch (target) {
    case 'openaiKey':
      run = () => get(`${config.externalApis.openai}/models`, { authorization: `Bearer ${credential}` });
      break;
    case 'anthropicKey':
      run = () => get(`${config.externalApis.anthropic}/models`, { 'x-api-key': credential, 'anthropic-version': '2023-06-01' });
      break;
    case 'geminiKey':
    case 'veoKey':
      run = () => get(`${config.externalApis.gemini}/models?key=${encodeURIComponent(credential)}`);
      if (target === 'veoKey') label = 'Google Generative Language API';
      break;
    case 'replicateToken':
      run = () => get(`${config.externalApis.replicate}/account`, { authorization: `Bearer ${credential}` });
      break;
    case 'elevenLabsKey':
      run = () => get(`${config.externalApis.elevenLabs}/user`, { 'xi-api-key': credential });
      break;
    case 'researchApiKey': {
      const provider = config.ai.researchProvider;
      if (provider === 'brave') {
        run = () => get(`${config.externalApis.brave}/search?q=provider%20check&count=1`, { accept: 'application/json', 'x-subscription-token': credential });
      } else if (provider === 'tavily') {
        run = () => post(`${config.externalApis.tavily}/search`, { api_key: credential, query: 'provider check', max_results: 1 });
      } else {
        return {
          target,
          label: def.label,
          checked: false,
          ok: false,
          code: 'research_disabled',
          message: 'Research is switched off. Choose Brave or Tavily before testing the search key.',
          checkedAt: now(),
        };
      }
      break;
    }
    case 'falKey':
      return {
        target,
        label: def.label,
        checked: false,
        ok: null,
        code: 'no_status_endpoint',
        message: 'fal.ai exposes no credential status endpoint, so this key can only be proven by a real generation. The film studio health check pings the API root.',
        checkedAt: now(),
      };
    default:
      throw new AppError(400, 'unknown_provider_target', `No test is defined for "${target}".`);
  }

  try {
    const result = await run();
    const ok = result.status >= 200 && result.status < 300;
    const rejected = result.status === 401 || result.status === 403;
    return {
      target,
      label,
      checked: true,
      ok,
      status: result.status,
      latencyMs: result.latencies,
      code: ok ? 'verified' : rejected ? 'rejected' : 'unexpected_response',
      message: ok
        ? `${label} accepted the credential (HTTP ${result.status}).`
        : rejected
          ? `${label} rejected the credential (HTTP ${result.status}). Check the key and its permissions.`
          : `${label} answered HTTP ${result.status}. The credential was not confirmed.`,
      checkedAt: now(),
    };
  } catch (error) {
    return {
      target,
      label,
      checked: true,
      ok: false,
      status: null,
      latencyMs: null,
      code: error.name === 'AbortError' ? 'timeout' : 'unreachable',
      message: error.name === 'AbortError'
        ? `${label} did not answer within ${TEST_TIMEOUT_MS / 1000}s.`
        : `${label} could not be reached from this server: ${error.message}`,
      checkedAt: now(),
    };
  }
}
