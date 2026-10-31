import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = path.resolve(process.cwd());

function env(name, fallback = '') {
  return (process.env[name] ?? fallback).trim();
}
function envInt(name, fallback) {
  const value = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}
function envBool(name, fallback = false) {
  const value = env(name, fallback ? 'true' : 'false').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}
function baseUrl(name, fallback) {
  return (env(name) || fallback).replace(/\/+$/, '');
}

const port = envInt('PORT', 8787);
const dataDir = path.resolve(root, env('DATA_DIR', 'data'));
const storageDir = path.resolve(root, env('STORAGE_DIR', 'storage'));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(storageDir, { recursive: true });

const databaseUrl = env('DATABASE_URL');
const isProduction = env('NODE_ENV') === 'production';

// In development we persist an auto-generated local key so encrypted test tokens
// survive restarts. Production must provide a stable 32-byte key from the secret store.
const localKeyPath = path.join(dataDir, 'development.key');
if (!env('APP_ENCRYPTION_KEY') && !isProduction && !fs.existsSync(localKeyPath)) {
  fs.writeFileSync(localKeyPath, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
}
const encryptionKeyMaterial = env('APP_ENCRYPTION_KEY') ||
  (!isProduction && fs.existsSync(localKeyPath) ? fs.readFileSync(localKeyPath, 'utf8').trim() : '');

export const config = {
  root,
  isProduction,
  isDev: !isProduction,
  port,
  host: env('HOST', '0.0.0.0'),
  dataDir,
  storageDir,
  publicDir: path.join(storageDir, 'public'),
  dbPath: path.resolve(root, env('SQLITE_PATH', 'data/app.sqlite3')),
  databaseUrl,
  appName: env('APP_NAME', 'Faceless Studio'),
  appUrl: env('APP_URL', `http://localhost:${port}`),
  publicBaseUrl: env('PUBLIC_BASE_URL', env('APP_URL', `http://localhost:${port}`)).replace(/\/$/, ''),
  sessionTtlDays: envInt('SESSION_TTL_DAYS', 14),
  encryptionKeyMaterial,
  seedDemo: envBool('SEED_DEMO', !isProduction),
  skipFrontend: envBool('SKIP_FRONTEND', false),
  demoEmail: env('DEMO_EMAIL', 'creator@faceless.local'),
  demoPassword: env('DEMO_PASSWORD', 'StudioDemo2026!'),
  adminEmail: env('ADMIN_EMAIL', isProduction ? '' : 'admin@faceless.local'),
  adminPassword: env('ADMIN_PASSWORD', isProduction ? '' : 'AdminStudio2026!'),
  worker: {
    enabled: envBool('WORKER_ENABLED', true),
    // Long-form scene polling is I/O bound (HTTP polls), so a handful of
    // concurrent jobs is normal. Keep FILM_SCENE_CONCURRENCY below this value.
    concurrency: envInt('WORKER_CONCURRENCY', 6),
    pollMs: envInt('WORKER_POLL_MS', 1000),
    maxAttempts: envInt('WORKER_MAX_ATTEMPTS', 5),
    jobTimeoutMs: envInt('JOB_TIMEOUT_MS', 20 * 60 * 1000),
  },
  ai: {
    provider: env('AI_PROVIDER', 'local'),
    model: env('AI_MODEL', ''),
    maxScenes: envInt('MAX_SCENES', 8),
    researchProvider: env('SEARCH_PROVIDER', 'none'),
    researchApiKey: env('SEARCH_API_KEY'),
    openaiKey: env('OPENAI_API_KEY'),
    openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
    anthropicKey: env('ANTHROPIC_API_KEY'),
    anthropicModel: env('ANTHROPIC_MODEL', 'claude-3-5-haiku-latest'),
    geminiKey: env('GEMINI_API_KEY'),
    geminiModel: env('GEMINI_MODEL', 'gemini-2.0-flash'),
  },
  media: {
    imageProvider: env('IMAGE_PROVIDER', 'procedural'),
    openaiImageModel: env('OPENAI_IMAGE_MODEL', 'gpt-image-1'),
    replicateToken: env('REPLICATE_API_TOKEN'),
    replicateModel: env('REPLICATE_IMAGE_MODEL', 'black-forest-labs/flux-schnell'),
    ttsProvider: env('TTS_PROVIDER', 'mespeak'),
    openaiTtsModel: env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
    elevenLabsKey: env('ELEVENLABS_API_KEY'),
    elevenLabsVoiceId: env('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM'),
    ffmpegPath: env('FFMPEG_PATH') || (await import('@ffmpeg-installer/ffmpeg')).default.path,
  },
  oauth: {
    metaAppId: env('META_APP_ID') || env('FACEBOOK_APP_ID'),
    metaAppSecret: env('META_APP_SECRET') || env('FACEBOOK_APP_SECRET'),
    metaGraphVersion: env('META_GRAPH_VERSION', 'v26.0'),
    googleClientId: env('GOOGLE_CLIENT_ID') || env('YOUTUBE_CLIENT_ID'),
    googleClientSecret: env('GOOGLE_CLIENT_SECRET') || env('YOUTUBE_CLIENT_SECRET'),
    xConsumerKey: env('X_CONSUMER_KEY'),
    xConsumerSecret: env('X_CONSUMER_SECRET'),
  },
  stripe: {
    secret: env('STRIPE_SECRET_KEY'),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
  },
  notifications: {
    smtpUrl: env('SMTP_URL'),
    webhookUrl: env('NOTIFICATION_WEBHOOK_URL'),
    webhookSecret: env('NOTIFICATION_WEBHOOK_SECRET'),
    webhookTimeoutMs: envInt('NOTIFICATION_WEBHOOK_TIMEOUT_MS', 10000),
    from: env('NOTIFICATION_FROM', 'Faceless Studio <notifications@example.com>'),
  },
  // These are server-side endpoint roots. Defaults always target the official APIs.
  // Overrides are intended for isolated integration tests, approved API gateways,
  // and enterprise proxies; never point them at an untrusted host.
  externalApis: {
    openai: baseUrl('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    anthropic: baseUrl('ANTHROPIC_BASE_URL', 'https://api.anthropic.com/v1'),
    gemini: baseUrl('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    brave: baseUrl('BRAVE_BASE_URL', 'https://api.search.brave.com/res/v1/web'),
    tavily: baseUrl('TAVILY_BASE_URL', 'https://api.tavily.com'),
    replicate: baseUrl('REPLICATE_BASE_URL', 'https://api.replicate.com/v1'),
    elevenLabs: baseUrl('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io/v1'),
    metaGraph: baseUrl('META_GRAPH_BASE_URL', 'https://graph.facebook.com'),
    metaAuth: baseUrl('META_AUTH_BASE_URL', 'https://www.facebook.com'),
    googleApi: baseUrl('GOOGLE_API_BASE_URL', 'https://www.googleapis.com'),
    googleUpload: baseUrl('GOOGLE_UPLOAD_BASE_URL', 'https://www.googleapis.com/upload/youtube/v3'),
    googleAnalytics: baseUrl('GOOGLE_ANALYTICS_BASE_URL', 'https://youtubeanalytics.googleapis.com/v2'),
    googleReporting: baseUrl('GOOGLE_REPORTING_BASE_URL', 'https://youtubereporting.googleapis.com/v1'),
    googleOAuth: baseUrl('GOOGLE_OAUTH_BASE_URL', 'https://oauth2.googleapis.com'),
    googleAuth: baseUrl('GOOGLE_AUTH_BASE_URL', 'https://accounts.google.com'),
    xApi: baseUrl('X_API_BASE_URL', 'https://api.x.com/2'),
    xOAuth: baseUrl('X_OAUTH_BASE_URL', 'https://api.x.com'),
    xUpload: env('X_UPLOAD_BASE_URL', 'https://upload.twitter.com/1.1/media/upload.json'),
    stripe: baseUrl('STRIPE_API_BASE_URL', 'https://api.stripe.com/v1'),
  },
  film: {
    videoProvider: env('FILM_VIDEO_PROVIDER', 'none').toLowerCase(),
    replicateToken: env('REPLICATE_API_TOKEN'),
    replicateModel: env('FILM_REPLICATE_VIDEO_MODEL', 'kwaivgi/kling-v2.1-master'),
    falKey: env('FAL_API_KEY'),
    falModel: env('FILM_FAL_VIDEO_MODEL', 'fal-ai/kling-video/v2.1/master/image-to-video'),
    veoKey: env('GOOGLE_VEO_API_KEY') || env('GEMINI_API_KEY'),
    veoModel: env('FILM_VEO_MODEL', 'veo-3.0-generate-001'),
    // One clip = one provider prediction. Both the clip length ceiling and the
    // number of clips per film are configurable so long-form production can be
    // scaled without touching code.
    maxSceneSeconds: envInt('FILM_MAX_SCENE_SECONDS', 10),
    minSceneSeconds: envInt('FILM_MIN_SCENE_SECONDS', 4),
    transitionFadeSeconds: Math.max(0.1, Math.min(2, Number(env('FILM_TRANSITION_FADE_SECONDS', '0.5')) || 0.5)),
    // 720 scenes × 10s covers a 60-minute film (360 clips) with headroom for a
    // 2-hour cut. Raise together with FILM_MAX_PROJECT_SECONDS for longer films.
    maxScenes: envInt('FILM_MAX_SCENES', 720),
    maxProjectSeconds: envInt('FILM_MAX_PROJECT_SECONDS', 3600),
    minProjectSeconds: envInt('FILM_MIN_PROJECT_SECONDS', 5),
    // How many scene jobs may run in flight for one film. Kept below worker
    // concurrency so assembly and other jobs always have a free slot.
    sceneConcurrency: envInt('FILM_SCENE_CONCURRENCY', 4),
    screenplayChunkScenes: envInt('FILM_SCREENPLAY_CHUNK_SCENES', 25),
    // Long films are rendered in segments then concatenated without re-encoding
    // the whole timeline, which keeps memory and temp disk bounded.
    assemblySegmentScenes: envInt('FILM_ASSEMBLY_SEGMENT_SCENES', 24),
    maxRenderWidth: envInt('FILM_MAX_RENDER_WIDTH', 1280),
    // Burning subtitles into the picture needs a full re-encode. Above this
    // length the renderer writes a soft subtitle track + .srt instead.
    burnInMaxSeconds: envInt('FILM_BURN_IN_MAX_SECONDS', 900),
    assemblyTimeoutMs: envInt('FILM_ASSEMBLY_TIMEOUT_MS', 4 * 60 * 60 * 1000),
    sfxEnabled: envBool('FILM_SFX_ENABLED', true),
    maxReferenceImageMb: envInt('FILM_MAX_REFERENCE_IMAGE_MB', 10),
    pollIntervalMs: envInt('FILM_POLL_INTERVAL_MS', 5000),
    pollTimeoutMs: envInt('FILM_POLL_TIMEOUT_MS', 15 * 60 * 1000),
    maxClipMb: envInt('FILM_MAX_CLIP_MB', 200),
    // Credits per second of generated video (rounded up), per 1k TTS chars, per assembly.
    creditPerVideoSecond: envInt('FILM_CREDIT_PER_VIDEO_SECOND', 10),
    creditPerTtsThousandChars: envInt('FILM_CREDIT_PER_TTS_1K_CHARS', 2),
    creditPerAssembly: envInt('FILM_CREDIT_PER_ASSEMBLY', 5),
    grantByPlan: { free: 60, starter: 300, creator: 900, scale: 3000 },
  },
  apiRateLimitPerMinute: envInt('API_RATE_LIMIT_PER_MINUTE', 600),
  security: {
    trustProxy: envBool('TRUST_PROXY', true),
    secureCookies: envBool('SECURE_COOKIES', isProduction && env('PUBLIC_BASE_URL').startsWith('https://')),
  },
};

const configured = {
  local: true,
  procedural: true,
  mespeak: true,
  ffmpeg: true,
  openai: Boolean(config.ai.openaiKey),
  anthropic: Boolean(config.ai.anthropicKey),
  gemini: Boolean(config.ai.geminiKey),
  brave: Boolean(config.ai.researchApiKey),
  tavily: Boolean(config.ai.researchApiKey),
  openaiImages: Boolean(config.ai.openaiKey),
  replicate: Boolean(config.media.replicateToken),
  elevenlabs: Boolean(config.media.elevenLabsKey),
  facebook: Boolean(config.oauth.metaAppId && config.oauth.metaAppSecret),
  instagram: Boolean(config.oauth.metaAppId && config.oauth.metaAppSecret),
  youtube: Boolean(config.oauth.googleClientId && config.oauth.googleClientSecret),
  x: Boolean(config.oauth.xConsumerKey && config.oauth.xConsumerSecret),
  stripe: Boolean(config.stripe.secret),
  smtp: Boolean(config.notifications.smtpUrl),
  publicMedia: config.publicBaseUrl.startsWith('https://'),
};

export function providerStatus() {
  const p = config.ai.provider;
  return {
    appName: config.appName,
    environment: config.isProduction ? 'production' : 'development',
    publicBaseUrl: config.publicBaseUrl,
    publicMediaReady: configured.publicMedia,
    ai: {
      active: p,
      configured: p === 'local' ? true : Boolean(configured[p]),
      available: ['local', 'openai', 'anthropic', 'gemini'].filter((key) => configured[key]),
    },
    research: {
      active: config.ai.researchProvider,
      configured: config.ai.researchProvider === 'none' || Boolean(config.ai.researchApiKey),
    },
    images: {
      active: config.media.imageProvider,
      configured: config.media.imageProvider === 'procedural' || Boolean(configured[config.media.imageProvider]),
      available: ['procedural', 'openai', 'replicate'].filter((key) => configured[key === 'openai' ? 'openaiImages' : key]),
    },
    tts: {
      active: config.media.ttsProvider,
      configured: config.media.ttsProvider === 'mespeak' || config.media.ttsProvider === 'openai'
        ? Boolean(configured[config.media.ttsProvider])
        : Boolean(configured.elevenlabs),
      available: ['mespeak', ...(config.ai.openaiKey ? ['openai'] : []), ...(config.media.elevenLabsKey ? ['elevenlabs'] : [])],
    },
    videoRenderer: 'ffmpeg',
    film: {
      active: config.film.videoProvider,
      configured: config.film.videoProvider === 'replicate' ? Boolean(config.film.replicateToken)
        : config.film.videoProvider === 'fal' ? Boolean(config.film.falKey)
          : config.film.videoProvider === 'veo' ? Boolean(config.film.veoKey) : false,
      available: ['none', 'replicate', 'fal', 'veo'],
      maxSceneSeconds: config.film.maxSceneSeconds,
      maxScenes: config.film.maxScenes,
    },
    integrations: {
      sandbox: { configured: true, mode: 'local-http', label: 'Sandbox' },
      facebook: { configured: configured.facebook, mode: 'official-oauth', label: 'Facebook Pages' },
      instagram: { configured: configured.instagram, mode: 'official-oauth', label: 'Instagram Business' },
      youtube: { configured: configured.youtube, mode: 'official-oauth', label: 'YouTube' },
      x: { configured: configured.x, mode: 'official-oauth', label: 'X' },
    },
    billing: { stripeConfigured: configured.stripe },
    notifications: { smtpConfigured: configured.smtp, webhookConfigured: Boolean(config.notifications.webhookUrl), webhookSigned: Boolean(config.notifications.webhookSecret) },
    seedDemo: config.seedDemo,
    demoCredentials: config.seedDemo
      ? { email: config.demoEmail, password: config.isProduction && !envBool('EXPOSE_DEMO_CREDENTIALS', false) ? null : config.demoPassword }
      : null,
  };
}

export function assertProductionSecrets() {
  const errors = [];
  if (!config.databaseUrl) errors.push('DATABASE_URL is strongly recommended for production (SQLite is single-node only).');
  if (!config.encryptionKeyMaterial) errors.push('APP_ENCRYPTION_KEY must be set to a base64-encoded 32-byte key.');
  if (config.publicBaseUrl.startsWith('http://')) errors.push('PUBLIC_BASE_URL must be an HTTPS origin for OAuth and Instagram media URLs.');
  if (config.adminEmail && !config.adminPassword) errors.push('ADMIN_PASSWORD is required when ADMIN_EMAIL is set.');
  for (const [name, url] of Object.entries(config.externalApis)) {
    if (!url.startsWith('https://')) errors.push(`${name} API override must use HTTPS in production.`);
  }
  if (config.notifications.webhookUrl) {
    if (!config.notifications.webhookUrl.startsWith('https://')) errors.push('NOTIFICATION_WEBHOOK_URL must use HTTPS in production.');
    if (!config.notifications.webhookSecret) errors.push('NOTIFICATION_WEBHOOK_SECRET should be set when NOTIFICATION_WEBHOOK_URL is configured.');
  }
  return errors;
}
