/**
 * Activation module registry.
 *
 * This is the single source of truth for everything that is still "unfinished"
 * about a deployment. Every module here is fully implemented in code; what
 * remains is configuration, provider-console approval, or infrastructure.
 *
 * The setup wizard, preflight checks, JSON report, and generated runbook are
 * all derived from this file so they can never drift apart.
 */
import crypto from 'node:crypto';

/** Exact callback/redirect URLs the server exposes. */
export function callbackUrlsFor(origin) {
  const base = String(origin || 'https://YOUR-DOMAIN').replace(/\/+$/, '');
  return {
    facebook: `${base}/api/oauth/facebook/callback`,
    google: `${base}/api/oauth/google/callback`,
    x: `${base}/api/oauth/x/callback`,
    sandbox: `${base}/api/oauth/sandbox/callback`,
    stripeWebhook: `${base}/api/billing/webhook`,
  };
}

export const CALLBACK_LABELS = {
  facebook: 'Facebook / Instagram OAuth callback',
  google: 'Google / YouTube OAuth callback',
  x: 'X OAuth callback',
  sandbox: 'Sandbox OAuth callback (local testing)',
  stripeWebhook: 'Stripe webhook endpoint',
};

const E = (key, validator, options = {}) => ({ key, validator, secret: false, ...options });
const step = (title, detail) => ({ title, detail });
const doc = (label, url) => ({ label, url });

/**
 * @type {Array<{
 *  id: string, number: number, name: string, category: string,
 *  kind: 'config'|'external'|'hybrid', summary: string,
 *  env: Array<object>, requiresHttps?: boolean, dependsOn?: string[],
 *  callbacks?: string[], permissions?: string[], consoleSteps?: object[],
 *  deploySteps?: object[], verify?: object[], docs?: object[]
 * }>}
 */
export const ACTIVATION_MODULES = [
  // ---------------------------------------------------------------- 1
  {
    id: 'facebook-pages',
    number: 1,
    name: 'Facebook Pages publishing',
    category: 'publishing',
    kind: 'hybrid',
    summary: 'Official Meta OAuth connect and video publishing to Facebook Pages. Adapters, token exchange/refresh, metrics and revoke are implemented; activation needs a Meta app with approved permissions.',
    requiresHttps: true,
    dependsOn: ['public-https-origin'],
    callbacks: ['facebook'],
    permissions: ['public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management'],
    env: [
      E('META_APP_ID', 'metaAppId', { label: 'Meta App ID', description: 'Numeric App ID from the Meta app dashboard (Settings → Basic).' }),
      E('META_APP_SECRET', 'metaAppSecret', { secret: true, label: 'Meta App Secret', description: 'App Secret from Settings → Basic. Never put this in frontend code.' }),
      E('META_GRAPH_VERSION', 'graphVersion', { label: 'Graph API version', description: 'Pinned Graph API version, e.g. v26.0.', optional: true, defaultValue: 'v26.0' }),
    ],
    consoleSteps: [
      step('Create a Meta app', 'In developers.facebook.com create a Business-type app and add "Facebook Login for Business".'),
      step('Request Advanced Access', 'Ask for Advanced Access on every permission listed above. Standard Access only works for app admins/developers/testers.'),
      step('Complete Business Verification', 'Submit your business documents in Business Settings → Security Centre. Required before external users can connect.'),
      step('Whitelist the callback URL', 'Facebook Login → Settings → Valid OAuth Redirect URIs. Paste the exact callback URL shown above (HTTPS, no trailing slash).'),
      step('Add test assets', 'Add at least one Facebook Page where you have CREATE_CONTENT / MANAGE task permission, plus app roles for testers.'),
      step('Submit App Review', 'Provide a screencast of the OAuth → review → publish flow and explain the automated posting use case.'),
    ],
    deploySteps: [
      step('Set App Secret in the server environment only', 'The value belongs in the server process environment or a secret manager, never in .env committed to Git and never in Vite/React code.'),
    ],
    verify: [
      step('Connect', 'Accounts → Connect Facebook. The consent screen should list your Page, and the account row should show "connected".'),
      step('Test token', 'Click "Test" on the connected account — it calls the provider verification endpoint.'),
      step('Publish', 'Create a short sandbox video first, then publish a real one to the Page and confirm the remote link resolves.'),
    ],
    docs: [
      doc('Meta video publishing', 'https://developers.facebook.com/docs/video-api/guides/publishing/'),
      doc('Facebook Login for Business', 'https://developers.facebook.com/docs/facebook-login/guides/'),
    ],
  },

  // ---------------------------------------------------------------- 2
  {
    id: 'instagram-reels',
    number: 2,
    name: 'Instagram Business / Reels publishing',
    category: 'publishing',
    kind: 'hybrid',
    summary: 'Reels publishing via the Meta Graph container API. Shares the Facebook OAuth app and additionally requires a publicly reachable HTTPS media URL — Meta downloads the video from the signed URL.',
    requiresHttps: true,
    dependsOn: ['facebook-pages', 'public-https-origin'],
    callbacks: ['facebook'],
    permissions: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_read_engagement'],
    env: [
      E('META_APP_ID', 'metaAppId', { label: 'Meta App ID', description: 'Same app as Facebook Pages (module 1).' }),
      E('META_APP_SECRET', 'metaAppSecret', { secret: true, label: 'Meta App Secret', description: 'Same app secret as module 1.' }),
      E('PUBLIC_BASE_URL', 'httpsOrigin', { label: 'Public HTTPS origin', description: 'Must be publicly reachable over HTTPS so Meta can fetch the rendered MP4.' }),
    ],
    consoleSteps: [
      step('Use a Professional account', 'Convert the target Instagram account to Professional (Business or Creator) and link it to the Facebook Page from module 1.'),
      step('Choose the right login family', 'This app uses Facebook Login for Business, so it requests instagram_basic / instagram_content_publish / instagram_manage_insights. Apps built on Instagram Login instead need the separate instagram_business_* family and a different host.'),
      step('Request Advanced Access', 'Advanced Access for the Instagram permissions, plus Instagram app review with a publishing screencast.'),
      step('Whitelist the shared callback', 'Same Facebook Login OAuth redirect URI as module 1.'),
    ],
    deploySteps: [
      step('Serve media over public HTTPS', 'The server signs and serves video at /api/media/public/:token/:filename. Deploy behind HTTPS with a real certificate; localhost or self-signed URLs fail silently at the container stage.'),
      step('Generate one real video before connecting', 'Create at least one completed project so a signed media URL can be tested before you rely on autopilot.'),
    ],
    verify: [
      step('Confirm container upload', 'Publish a test Reel and watch the publication status move through processing → published. A stuck "processing" state usually means Meta could not fetch the media URL.'),
      step('Check the remote link', 'Open the returned permalink while signed out to verify the Reel is public.'),
    ],
    docs: [
      doc('Instagram video publishing', 'https://developers.instagram.com/docs/instagram-platform/content-publishing/'),
      doc('IG Reels API', 'https://developers.facebook.com/docs/instagram-api/guides/video-publishing/'),
    ],
  },

  // ---------------------------------------------------------------- 3
  {
    id: 'youtube',
    number: 3,
    name: 'YouTube publishing & analytics',
    category: 'publishing',
    kind: 'hybrid',
    summary: 'Resumable uploads, captions, Data API engagement, Analytics API watch time/shares, and Reporting API thumbnail impressions. Needs a Google OAuth client with verified scopes.',
    requiresHttps: true,
    dependsOn: ['public-https-origin'],
    callbacks: ['google'],
    permissions: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ],
    env: [
      E('GOOGLE_CLIENT_ID', 'googleClientId', { label: 'Google OAuth Client ID', description: 'From Google Cloud → APIs & Services → Credentials (Web application).' }),
      E('GOOGLE_CLIENT_SECRET', 'googleClientSecret', { secret: true, label: 'Google OAuth Client Secret', description: 'From the same OAuth client entry.' }),
    ],
    consoleSteps: [
      step('Enable three APIs', 'In the Google Cloud project enable YouTube Data API v3, YouTube Analytics API, and YouTube Reporting API.'),
      step('Configure the consent screen', 'Set app name, support email, and authorized domain. Add all four scopes listed above.'),
      step('Handle verification', 'Either publish the consent screen (Google verification for sensitive/restricted scopes) or add every publishing account as a verified test user.'),
      step('Whitelist the callback URL', 'Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs. Use the exact /api/oauth/google/callback URL.'),
      step('Budget upload quota', 'Each upload consumes YouTube Data API units. Request a quota increase if autopilot will post many videos per day.'),
      step('Reconnect existing channels', 'After adding yt-analytics.readonly, disconnect and reconnect YouTube accounts so the refresh token carries the new scope.'),
    ],
    deploySteps: [
      step('Allow 48h for reach reports', 'Thumbnail-impression reports begin generating within ~48 hours after a channel_reach_basic_a1 reporting job is created. Missing impressions before then is expected.'),
    ],
    verify: [
      step('Connect and check scopes', 'Accounts → Connect YouTube. Confirm the consent screen shows all four scopes.'),
      step('Upload a short video', 'Publish a real short video and confirm it appears in YouTube Studio with the generated caption track.'),
      step('Sync metrics', 'Run a metrics sync; watch time and shares should come from the Analytics API once the video has views.'),
    ],
    docs: [
      doc('videos.insert', 'https://developers.google.com/youtube/v3/docs/videos/insert'),
      doc('YouTube Analytics reports', 'https://developers.google.com/youtube/analytics/reference/reports/query'),
    ],
  },

  // ---------------------------------------------------------------- 4
  {
    id: 'x',
    number: 4,
    name: 'X publishing & analytics',
    category: 'publishing',
    kind: 'hybrid',
    summary: 'OAuth 1.0a user-context connect, chunked v1.1 media upload, v2 post creation, public metrics, and private playback quartile estimates. Needs an approved read/write app and a sufficient API tier.',
    requiresHttps: true,
    dependsOn: ['public-https-origin'],
    callbacks: ['x'],
    permissions: ['Read and write app permissions', 'Media upload access', 'Exact callback URL match'],
    env: [
      E('X_CONSUMER_KEY', 'xConsumerKey', { label: 'X API Key (consumer key)', description: 'From the developer portal → your App → Keys and tokens.' }),
      E('X_CONSUMER_SECRET', 'xConsumerSecret', { secret: true, label: 'X API Secret (consumer secret)', description: 'From the same Keys and tokens page.' }),
    ],
    consoleSteps: [
      step('Create a Project + App', 'In the X developer portal create a Project and App with an approved use case for automated posting.'),
      step('Set read/write permissions', 'App settings → User authentication settings: enable OAuth 1.0a, set App permissions to Read and write, and provide the exact callback URL.'),
      step('Regenerate tokens after changes', 'Changing permissions invalidates existing user tokens — reconnect accounts afterwards.'),
      step('Confirm the API tier', 'Post creation, v1.1 media upload, and private media metrics may require a paid or elevated tier.'),
    ],
    deploySteps: [
      step('Keep consumer keys server-side', 'OAuth 1.0a signing happens on the server. Never expose consumer keys or user token secrets to the browser.'),
    ],
    verify: [
      step('Connect with 3-legged flow', 'Accounts → Connect X; approve and confirm the account row shows connected.'),
      step('Post a short video', 'Publish and confirm the remote URL resolves to your tweet.'),
      step('Check metrics tier', 'If private playback quartiles are unavailable the adapter uses public metrics and labels watch time as estimated.'),
    ],
    docs: [
      doc('X OAuth 1.0a', 'https://docs.x.com/fundamentals/authentication/api-reference'),
      doc('Chunked media upload', 'https://developer.x.com/en/docs/x-api/v1/media/upload-media/uploading-media/media-best-practices'),
    ],
  },

  // ---------------------------------------------------------------- 5
  {
    id: 'stripe',
    number: 5,
    name: 'Stripe billing (checkout + webhooks)',
    category: 'billing',
    kind: 'hybrid',
    summary: 'Subscription checkout, signature-verified webhooks, idempotent event storage, and plan assignment. Needs Stripe keys, real recurring Price IDs, and a registered webhook endpoint.',
    requiresHttps: true,
    dependsOn: ['public-https-origin'],
    callbacks: ['stripeWebhook'],
    permissions: ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed'],
    env: [
      E('STRIPE_SECRET_KEY', 'stripeSecretKey', { secret: true, label: 'Stripe secret key', description: 'Test with sk_test_…, go live with sk_live_… only after replay tests pass.' }),
      E('STRIPE_WEBHOOK_SECRET', 'stripeWebhookSecret', { secret: true, label: 'Stripe webhook signing secret', description: 'The whsec_… value shown for your webhook endpoint, not the API key.' }),
    ],
    consoleSteps: [
      step('Create recurring Prices', 'For every paid plan create a recurring Price in Stripe and copy its price_… ID.'),
      step('Set Price IDs in Admin → Plans', 'Paste each price_… ID into the matching plan row and save. Without it checkout returns stripe_price_missing and no charge is attempted.'),
      step('Register the webhook endpoint', 'Developers → Webhooks → Add endpoint. Paste the /api/billing/webhook URL shown above.'),
      step('Subscribe to four events', 'checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.'),
      step('Copy the signing secret', 'Use the endpoint-specific whsec_… value. It is different from the account API key.'),
      step('Activate and go live', 'Activate the Stripe account, then repeat Price IDs and webhook registration with live-mode keys.'),
    ],
    deploySteps: [
      step('Webhook body must stay raw', 'The route uses express.raw before express.json. Do not put a global JSON body parser in front of it or signature verification will fail.'),
    ],
    verify: [
      step('Replay a test event', 'Use Stripe CLI or the dashboard to send checkout.session.completed and confirm the plan changes and a webhook_events row is recorded.'),
      step('Check signature rejection', 'Send an unsigned request — it must return 400 stripe_signature_missing/invalid.'),
      step('Complete a test checkout', 'Use card 4242 4242 4242 4242 and confirm the success page assigns the plan.'),
    ],
    docs: [
      doc('Checkout Sessions', 'https://docs.stripe.com/api/checkout/sessions'),
      doc('Webhook signatures', 'https://docs.stripe.com/webhooks'),
    ],
  },

  // ---------------------------------------------------------------- 6
  {
    id: 'smtp',
    number: 6,
    name: 'SMTP email notifications',
    category: 'notifications',
    kind: 'config',
    summary: 'Nodemailer transport that mirrors in-app notifications to email. Fully implemented; only the SMTP connection URL is missing. No provider approval needed.',
    env: [
      E('SMTP_URL', 'smtpUrl', { secret: true, label: 'SMTP connection URL', description: 'e.g. smtps://user:password@smtp.example.com:465. URL-encode special characters in the password.' }),
      E('NOTIFICATION_FROM', 'optionalText', { label: 'From address', description: 'e.g. "Film Club Lens <notifications@example.com>".', optional: true }),
    ],
    consoleSteps: [
      step('Create an SMTP credential', 'Use your mail provider\'s app password / SMTP user. Avoid personal account passwords.'),
      step('Verify the sender domain', 'Configure SPF, DKIM and DMARC for the From domain to avoid spam filtering.'),
    ],
    verify: [
      step('Trigger a notification', 'Any billing/plan change or broadcast sends an email. Check the server log for "Email notification failed" if nothing arrives.'),
    ],
    docs: [doc('Nodemailer SMTP', 'https://nodemailer.com/smtp/')],
  },

  // ---------------------------------------------------------------- 7
  {
    id: 'notification-webhook',
    number: 7,
    name: 'Signed notification webhooks',
    category: 'notifications',
    kind: 'config',
    summary: 'Outbound notification events with HMAC-SHA256 X-Film-Club-Lens-Signature, 3-attempt retry with backoff, and timeout. Needs a receiver URL and a shared secret.',
    env: [
      E('NOTIFICATION_WEBHOOK_URL', 'webhookUrl', { label: 'Webhook receiver URL', description: 'Absolute HTTPS URL of your receiver (http allowed for local testing only).' }),
      E('NOTIFICATION_WEBHOOK_SECRET', 'webhookSecret', { secret: true, label: 'HMAC shared secret', description: 'At least 16 random characters; used to sign "timestamp.rawBody".' }),
    ],
    consoleSteps: [
      step('Generate a shared secret', 'e.g. openssl rand -hex 24. Store the same value in your receiver.'),
      step('Verify the signature', 'Compute sha256 HMAC over "<x-film-club-lens-timestamp>.<raw body>" and compare with a constant-time comparison against X-Film-Club-Lens-Signature (sha256=…).'),
      step('Enforce a timestamp window', 'Reject events older than 5 minutes to prevent replay.'),
      step('Deduplicate by event id', 'Delivery retries (3 attempts) can repeat the same notification.'),
    ],
    verify: [
      step('Trigger a broadcast', 'Admin → Broadcast; your receiver should get notification.created with a valid signature.'),
      step('Test retry behaviour', 'Return a 503 from the receiver and confirm three attempts in the server log.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 8
  {
    id: 'ai-providers',
    number: 8,
    name: 'External AI script providers',
    category: 'ai',
    kind: 'config',
    summary: 'OpenAI, Anthropic, and Gemini adapters for scripts, scene plans, captions and hashtags. Optional — the built-in local multilingual engine works offline and is the default.',
    env: [
      E('AI_PROVIDER', 'aiProvider', { label: 'AI provider', description: 'Choose local (offline), openai, anthropic, or gemini.', choices: ['local', 'openai', 'anthropic', 'gemini'], defaultValue: 'local' }),
      E('OPENAI_API_KEY', 'openaiKey', { secret: true, label: 'OpenAI API key', description: 'Required when AI_PROVIDER=openai.', requiredWhen: { AI_PROVIDER: 'openai' } }),
      E('OPENAI_MODEL', 'optionalText', { label: 'OpenAI model', description: 'e.g. gpt-4o-mini.', optional: true, defaultValue: 'gpt-4o-mini' }),
      E('ANTHROPIC_API_KEY', 'anthropicKey', { secret: true, label: 'Anthropic API key', description: 'Required when AI_PROVIDER=anthropic.', requiredWhen: { AI_PROVIDER: 'anthropic' } }),
      E('ANTHROPIC_MODEL', 'optionalText', { label: 'Anthropic model', description: 'e.g. claude-3-5-haiku-latest.', optional: true }),
      E('GEMINI_API_KEY', 'geminiKey', { secret: true, label: 'Gemini API key', description: 'Required when AI_PROVIDER=gemini.', requiredWhen: { AI_PROVIDER: 'gemini' } }),
      E('GEMINI_MODEL', 'optionalText', { label: 'Gemini model', description: 'e.g. gemini-2.0-flash.', optional: true }),
    ],
    consoleSteps: [
      step('Set billing limits', 'External AI usage incurs provider charges. Set a hard monthly spend cap in the provider console.'),
    ],
    verify: [
      step('Check provider status', 'Admin → Integrations should show the selected AI provider as configured.'),
      step('Generate a video', 'Create a project; the provider summary should name the external model. A failure must surface ai_provider_error, never a silent local fallback.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 9
  {
    id: 'research',
    number: 9,
    name: 'Research providers (Brave / Tavily)',
    category: 'ai',
    kind: 'config',
    summary: 'Optional web research that feeds sourced context into script generation. Default is none (offline).',
    env: [
      E('SEARCH_PROVIDER', 'searchProvider', { label: 'Research provider', description: 'Choose none, brave, or tavily.', choices: ['none', 'brave', 'tavily'], defaultValue: 'none' }),
      E('SEARCH_API_KEY', 'searchApiKey', { secret: true, label: 'Search API key', description: 'Brave Search API key or Tavily API key.', requiredWhenAny: [{ SEARCH_PROVIDER: 'brave' }, { SEARCH_PROVIDER: 'tavily' }] }),
    ],
    consoleSteps: [
      step('Choose a plan', 'Both providers require a paid plan for sustained automated research; check quota limits.'),
    ],
    verify: [
      step('Create a researched project', 'Enable research mode in AI Studio and confirm sources appear on the project detail page.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 'image-providers',
    number: 10,
    name: 'External image providers (OpenAI Images / Replicate)',
    category: 'media',
    kind: 'config',
    summary: 'Optional generative scene images. The default procedural SVG engine creates original art offline with no credentials.',
    env: [
      E('IMAGE_PROVIDER', 'imageProvider', { label: 'Image provider', description: 'Choose procedural, openai, or replicate.', choices: ['procedural', 'openai', 'replicate'], defaultValue: 'procedural' }),
      E('OPENAI_API_KEY', 'openaiKey', { secret: true, label: 'OpenAI API key', description: 'Required when IMAGE_PROVIDER=openai.', requiredWhen: { IMAGE_PROVIDER: 'openai' } }),
      E('OPENAI_IMAGE_MODEL', 'optionalText', { label: 'OpenAI image model', description: 'e.g. gpt-image-1.', optional: true, defaultValue: 'gpt-image-1' }),
      E('REPLICATE_API_TOKEN', 'replicateToken', { secret: true, label: 'Replicate API token', description: 'Required when IMAGE_PROVIDER=replicate.', requiredWhen: { IMAGE_PROVIDER: 'replicate' } }),
      E('REPLICATE_IMAGE_MODEL', 'optionalText', { label: 'Replicate model', description: 'e.g. black-forest-labs/flux-schnell.', optional: true }),
    ],
    consoleSteps: [
      step('Accept per-image costs', 'Generative images are billed per request and multiply by scene count (MAX_SCENES).'),
    ],
    verify: [
      step('Generate a project', 'Scene art should come from the chosen provider; check provider logs on the project detail page.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 11
  {
    id: 'tts-providers',
    number: 11,
    name: 'External TTS providers (OpenAI TTS / ElevenLabs)',
    category: 'media',
    kind: 'config',
    summary: 'Optional higher-quality narration. The default offline mespeak engine supports ten languages with voice presets.',
    env: [
      E('TTS_PROVIDER', 'ttsProvider', { label: 'TTS provider', description: 'Choose mespeak, openai, or elevenlabs.', choices: ['mespeak', 'openai', 'elevenlabs'], defaultValue: 'mespeak' }),
      E('OPENAI_API_KEY', 'openaiKey', { secret: true, label: 'OpenAI API key', description: 'Required when TTS_PROVIDER=openai.', requiredWhen: { TTS_PROVIDER: 'openai' } }),
      E('OPENAI_TTS_MODEL', 'optionalText', { label: 'OpenAI TTS model', description: 'e.g. gpt-4o-mini-tts.', optional: true }),
      E('ELEVENLABS_API_KEY', 'elevenLabsKey', { secret: true, label: 'ElevenLabs API key', description: 'Required when TTS_PROVIDER=elevenlabs.', requiredWhen: { TTS_PROVIDER: 'elevenlabs' } }),
      E('ELEVENLABS_VOICE_ID', 'optionalText', { label: 'ElevenLabs voice ID', description: 'Voice preset ID, e.g. 21m00Tcm4TlvDq8ikWAM.', optional: true }),
    ],
    consoleSteps: [
      step('Check character quotas', 'TTS billing is per character; long scripts consume quota quickly.'),
    ],
    verify: [
      step('Render a video', 'Confirm narration audio length matches the SRT captions in the rendered MP4.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 12
  {
    id: 'public-https-origin',
    number: 12,
    name: 'Public HTTPS origin, callbacks & signed media',
    category: 'infrastructure',
    kind: 'hybrid',
    summary: 'The deployment itself. OAuth providers and Instagram require a real public HTTPS origin; signed media URLs must be fetchable by Meta. Also covers production cookie/security hardening.',
    requiresHttps: true,
    callbacks: ['facebook', 'google', 'x', 'sandbox', 'stripeWebhook'],
    env: [
      E('PUBLIC_BASE_URL', 'httpsOrigin', { label: 'Public HTTPS origin', description: 'Exact origin registered with every OAuth provider and Stripe, e.g. https://filmclublens.com' }),
      E('NODE_ENV', 'nonEmpty', { label: 'Node environment', description: 'Set to production for a real deployment.', defaultValue: 'production' }),
      E('SECURE_COOKIES', 'nonEmpty', { label: 'Secure cookies', description: 'Set to true when served over HTTPS.', defaultValue: 'true' }),
    ],
    deploySteps: [
      step('Deploy behind HTTPS', 'Terminate TLS at a reverse proxy or platform edge with a valid CA certificate. No self-signed certs for OAuth callbacks.'),
      step('Point DNS at the app', 'PUBLIC_BASE_URL must match the external origin exactly — scheme, host, and port. No trailing slash.'),
      step('Forward the correct headers', 'Set X-Forwarded-Proto/Host and keep TRUST_PROXY=true so Express builds correct redirect and callback URLs.'),
      step('Enable secure cookies', 'Set SECURE_COOKIES=true, NODE_ENV=production, and a stable APP_ENCRYPTION_KEY (module 14).'),
      step('Disable seeded demo accounts', 'Set SEED_DEMO=false and provide ADMIN_EMAIL / ADMIN_PASSWORD deliberately, or rotate the seeded credentials immediately.'),
      step('Whitelist all callback URLs', 'Copy the exact URLs above into the Meta app, Google OAuth client, X app, and Stripe webhook settings.'),
      step('Verify signed media is public', 'Generate a video, copy its signed media URL, and fetch it from outside your network.'),
    ],
    verify: [
      step('Health probe', 'npm run doctor -- --probe should report the public health endpoint as reachable.'),
      step('Cookie check', 'Sign in and confirm the session cookie has Secure and HttpOnly flags.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 13
  {
    id: 'postgres',
    number: 13,
    name: 'Production database (PostgreSQL)',
    category: 'infrastructure',
    kind: 'hybrid',
    summary: 'Knex already supports PostgreSQL via DATABASE_URL, including schema creation, seeding, and conditional job claims verified with two real worker processes (pg-mem tests). Needs a real instance for multi-process production.',
    env: [
      E('DATABASE_URL', 'postgresUrl', { label: 'PostgreSQL connection URL', description: 'postgresql://user:password@host:5432/filmclublens?sslmode=require — include the database name.' }),
    ],
    deploySteps: [
      step('Create the database', 'Use a managed PostgreSQL with TLS — Neon, Supabase, Railway, RDS/Aurora, Cloud SQL, or your own server. Create an empty database (for example filmclublens); the app creates and migrates every table on first start. A free tier is sufficient to activate this module.'),
      step('Copy the direct connection URL', 'Copy the direct/session string (port 5432), not a transaction pooler, for bootstrap and migrations. It must include the database name, and on managed providers append ?sslmode=require. Format: postgresql://USER:PASSWORD@HOST:5432/filmclublens?sslmode=require'),
      step('Store it as a secret', 'Set DATABASE_URL in your deployment secret store, or in the host .env with mode 0600. It contains the database password — never commit it.'),
      step('Prove the connection and schema', 'With DATABASE_URL set, run npm run db:bootstrap (or npm run activate -- postgres). It connects with the real pg driver, creates and verifies every table, and proves two concurrent workers cannot claim the same job.'),
      step('Use a least-privilege role', 'Grant only the schema privileges the app needs and keep superuser out of the runtime role.'),
      step('Run multiple workers', 'Start one or more dedicated processes with WORKER_ENABLED=true and the same DATABASE_URL. Conditional job claims prevent duplicate work.'),
      step('Back up before migrating', 'SQLite data does not automatically transfer to PostgreSQL. Export/import deliberately if you have existing local data.'),
    ],
    verify: [
      step('Run the bootstrap proof', 'DATABASE_URL=postgresql://… npm run db:bootstrap should report PASS for connection, schema, tables, two-worker claim and single execution. Then npm run activate -- postgres --verify-only re-checks the server version, TLS and schema readiness.'),
      step('Start two workers', 'Confirm both processes claim jobs without duplicates (see tests/postgres-multiprocess.test.js).'),
      step('Check doctor', 'npm run doctor should report "Production database" as PASS.'),
    ],
    docs: [doc('Knex PostgreSQL', 'https://knexjs.org/guide/query-builder.html')],
  },

  // ---------------------------------------------------------------- 14
  {
    id: 'encryption-key',
    number: 14,
    name: 'Production credential encryption key',
    category: 'security',
    kind: 'config',
    summary: 'AES-256-GCM encryption for stored OAuth credentials. Development auto-generates data/development.key; production needs a stable base64 32-byte key. This module can be completed entirely offline.',
    env: [
      E('APP_ENCRYPTION_KEY', 'encryptionKey', { secret: true, label: 'Encryption key (base64, 32 bytes)', description: 'Generate with: openssl rand -base64 32. The wizard can generate one for you.', generator: 'encryptionKey' }),
    ],
    deploySteps: [
      step('Store in a secret manager', 'Keep this value in your platform secret store, not in a committed .env file.'),
      step('Never rotate casually', 'Rotating the key makes existing encrypted OAuth tokens unreadable — reconnect accounts after a rotation.'),
      step('Back it up securely', 'Losing the key means losing access to all stored account credentials.'),
    ],
    verify: [
      step('Restart the server', 'Existing connected accounts should still decrypt and pass the "Test" button.'),
      step('Check doctor', 'npm run doctor should report "Credential encryption key" as PASS.'),
    ],
    docs: [],
  },

  // ---------------------------------------------------------------- 15
  {
    id: 'app-review',
    number: 15,
    name: 'Provider app review / Business Verification',
    category: 'compliance',
    kind: 'external',
    summary: 'The four provider-console approval workflows (Meta, Google, X, Stripe). These cannot be automated from the repository — they require screencasts, business documents, scope justification, and reviewer decisions. Tracked as EXTERNAL until you confirm them.',
    dependsOn: ['facebook-pages', 'instagram-reels', 'youtube', 'x', 'stripe'],
    env: [],
    consoleSteps: [
      step('Meta App Review + Business Verification', 'Request Advanced Access for all Facebook and Instagram permissions, submit a screencast of OAuth → review → publish, complete Business Verification, and add test Pages/Professional accounts.'),
      step('Google consent screen verification', 'Publish the OAuth consent screen or add verified test users; justify youtube.upload and yt-analytics.readonly as sensitive scopes; enable all three YouTube APIs.'),
      step('X app permission review', 'Configure OAuth 1.0a with read/write permissions, exact callback URL, media upload access, and an approved automated-posting use case; confirm the tier covers private playback metrics.'),
      step('Stripe account activation', 'Activate the account, create live recurring Prices, register the live webhook endpoint and its four events, and replay test events before enabling live keys.'),
    ],
    verify: [
      step('Connect a real external user', 'Test with an account that is NOT an app admin/developer/tester — Standard Access hides failures here.'),
      step('Publish live', 'Perform at least one real post to each approved platform and confirm the remote URL.'),
      step('Confirm metrics', 'Verify official metrics arrive and are not labelled simulated.'),
      step('Re-run doctor', 'npm run doctor -- --probe; all EXTERNAL items should now be confirmed in the provider consoles.'),
    ],
    docs: [],
  },
];

// Normalise every module so consumers never need null checks on list fields.
for (const module of ACTIVATION_MODULES) {
  for (const field of ['env', 'dependsOn', 'callbacks', 'permissions', 'consoleSteps', 'deploySteps', 'verify', 'docs']) {
    if (!Array.isArray(module[field])) module[field] = [];
  }
  module.requiresHttps = Boolean(module.requiresHttps);
}

export function getModule(id) {
  return ACTIVATION_MODULES.find((m) => m.id === id) || null;
}

export function listModules() {
  return ACTIVATION_MODULES.slice();
}

/** Every distinct environment variable referenced by the registry. */
export function allEnvKeys() {
  return [...new Set(ACTIVATION_MODULES.flatMap((m) => m.env.map((e) => e.key)))];
}

/** Env specs that are applicable given the current environment object. */
export function applicableEnv(module, env = {}) {
  return module.env.filter((spec) => {
    if (spec.requiredWhen && !matchesAll(spec.requiredWhen, env)) return false;
    if (spec.requiredWhenAny && !spec.requiredWhenAny.some((rule) => matchesAll(rule, env))) return false;
    return true;
  });
}

function matchesAll(rule, env) {
  return Object.entries(rule).every(([key, value]) => {
    const current = env[key];
    if (Array.isArray(value)) return value.includes(current);
    return current === value;
  });
}

/**
 * A spec is required when it is applicable and not explicitly optional.
 * A spec with a defaultValue can be left unset — preflight reports it as
 * satisfied by the application default rather than failing the module.
 */
export function isEnvRequired(spec) {
  return !spec.optional;
}

/** Generate a value for specs that support it (currently the encryption key). */
export function generateEnvValue(spec) {
  if (spec.generator === 'encryptionKey') return crypto.randomBytes(32).toString('base64');
  return null;
}
