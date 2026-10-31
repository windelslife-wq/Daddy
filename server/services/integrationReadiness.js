import { config, providerStatus, assertProductionSecrets } from '../config.js';

const OFFICIAL_API_HOSTS = new Set([
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
  'api.search.brave.com', 'api.tavily.com', 'api.replicate.com', 'api.elevenlabs.io',
  'graph.facebook.com', 'www.facebook.com', 'www.googleapis.com',
  'youtubeanalytics.googleapis.com', 'youtubereporting.googleapis.com',
  'oauth2.googleapis.com', 'accounts.google.com', 'api.x.com', 'upload.twitter.com',
  'api.stripe.com',
]);

const DOCS = {
  metaPublishing: 'https://developers.facebook.com/documentation/instagram-platform/content-publishing.md',
  facebookVideo: 'https://developers.facebook.com/docs/video-api/guides/publishing/',
  youtubeUpload: 'https://developers.google.com/youtube/v3/docs/videos/insert',
  youtubeAnalytics: 'https://developers.google.com/youtube/analytics/reference/reports/query',
  youtubeReporting: 'https://developers.google.com/youtube/reporting/v1/reports',
  xOauth: 'https://docs.x.com/fundamentals/authentication/api-reference',
  stripeWebhooks: 'https://docs.stripe.com/webhooks',
};

function callbackUrls() {
  const origin = config.publicBaseUrl.replace(/\/$/, '');
  return {
    facebook: `${origin}/api/oauth/facebook/callback`,
    google: `${origin}/api/oauth/google/callback`,
    x: `${origin}/api/oauth/x/callback`,
    sandbox: `${origin}/api/oauth/sandbox/callback`,
    stripeWebhook: `${origin}/api/billing/webhook`,
  };
}

function publicUrlState() {
  try {
    const url = new URL(config.publicBaseUrl);
    const hostname = url.hostname.toLowerCase();
    const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.test');
    return {
      value: config.publicBaseUrl,
      https: url.protocol === 'https:',
      local,
      valid: true,
    };
  } catch {
    return { value: config.publicBaseUrl, https: false, local: false, valid: false };
  }
}

function apiEndpointState() {
  const overrides = [];
  const insecure = [];
  for (const [name, value] of Object.entries(config.externalApis)) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') insecure.push(name);
      if (!OFFICIAL_API_HOSTS.has(url.hostname)) overrides.push(name);
    } catch {
      insecure.push(name);
    }
  }
  return { overrides, insecure, total: Object.keys(config.externalApis).length };
}

function check(id, title, status, detail, action = null, docs = null) {
  return { id, title, status, detail, action, docs };
}

export function providerApprovalChecklist() {
  return [
    {
      id: 'meta',
      platform: 'Facebook Pages & Instagram Reels',
      loginType: 'Facebook Login for Business',
      requiredPermissions: [
        'public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
        'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'business_management',
      ],
      appReview: 'Request Advanced Access for each permission above and provide a screencast of the OAuth → review → publish flow.',
      businessVerification: 'Complete Meta Business Verification; add admins, developers, and test Pages/Instagram professional accounts to the app.',
      accountRequirements: 'A Facebook Page with CREATE_CONTENT/MANAGE task permission, an Instagram Professional account linked to that Page, and a public HTTPS base URL for Reels media.',
      conditionalPermissions: 'If the Page role was granted through Business Manager, Meta may also require ads_management or ads_read.',
      docs: [DOCS.metaPublishing, DOCS.facebookVideo],
    },
    {
      id: 'google',
      platform: 'YouTube uploads, captions, and analytics',
      loginType: 'Google OAuth 2.0',
      requiredScopes: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
      ],
      appReview: 'Publish the OAuth consent screen or add every publishing/analytics account as a verified test user; request the scopes above.',
      businessVerification: 'No Google Business Verification is required, but the consent screen and API project must be verified for sensitive scopes.',
      accountRequirements: 'Enable YouTube Data API v3, YouTube Analytics API, and YouTube Reporting API; monitor upload quota and reconnect existing channels to grant yt-analytics.readonly.',
      conditionalPermissions: 'Bulk reach reports begin generating within 48 hours after a channel_reach_basic_a1 reporting job is created.',
      docs: [DOCS.youtubeUpload, DOCS.youtubeAnalytics, DOCS.youtubeReporting],
    },
    {
      id: 'x',
      platform: 'X video posts and metrics',
      loginType: 'OAuth 1.0a user context',
      requiredScopes: ['Read and write app permissions', 'Media upload access', 'Exact callback URL match'],
      appReview: 'Configure a Project/App with read/write permissions and an approved use case for automated posting.',
      businessVerification: 'No separate business verification, but the active API tier must include post creation, v1.1 media upload, and private media metrics for full analytics.',
      accountRequirements: 'Use real user access tokens from the 3-legged flow; keep consumer keys server-side and reconnect after permission changes.',
      conditionalPermissions: 'Private playback quartiles require user-context authorization and an eligible API tier; public post metrics otherwise remain available.',
      docs: [DOCS.xOauth],
    },
    {
      id: 'stripe',
      platform: 'Paid checkout and subscription webhooks',
      loginType: 'Stripe secret key + webhook signing secret',
      requiredEvents: [
        'checkout.session.completed',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_failed',
      ],
      appReview: 'Create recurring Prices for every paid plan and set each Price ID in Admin → Plans.',
      businessVerification: 'Activate the Stripe account and use live-mode keys only after test-mode checkout and webhook replay tests pass.',
      accountRequirements: 'Register the exact HTTPS webhook URL and copy the signing secret to STRIPE_WEBHOOK_SECRET.',
      conditionalPermissions: 'Paid plans return a clear error until a Stripe Price ID is stored on the plan row.',
      docs: [DOCS.stripeWebhooks],
    },
  ];
}

export async function buildIntegrationReadiness({ probe = false } = {}) {
  const status = providerStatus();
  const publicUrl = publicUrlState();
  const endpoints = apiEndpointState();
  const callbacks = callbackUrls();
  const productionWarnings = assertProductionSecrets();
  const checks = [];

  checks.push(check(
    'public-base-url',
    'Public HTTPS origin',
    publicUrl.valid && publicUrl.https && !publicUrl.local ? 'pass' : 'warn',
    publicUrl.valid ? `${publicUrl.value} (${publicUrl.https ? 'HTTPS' : 'not HTTPS'}${publicUrl.local ? ', local/test hostname' : ''})` : 'PUBLIC_BASE_URL is not a valid URL.',
    'Set PUBLIC_BASE_URL to the exact public HTTPS origin registered with OAuth providers and Stripe.',
  ));
  checks.push(check(
    'oauth-callbacks',
    'OAuth and webhook callback URLs',
    publicUrl.valid && publicUrl.https && !publicUrl.local ? 'pass' : 'warn',
    callbacks,
    'Copy these exact URLs into the Meta app, Google OAuth client, X app, and Stripe webhook settings.',
  ));
  checks.push(check(
    'public-media',
    'Signed public media delivery',
    publicUrl.https && !publicUrl.local ? 'pass' : 'warn',
    'Instagram Reels containers require Meta to fetch video_url/cover_url from a public HTTPS URL. The app serves signed media at /api/media/public/:token/:filename.',
    'Deploy behind HTTPS and generate one real video before connecting Instagram.',
    DOCS.metaPublishing,
  ));
  checks.push(check(
    'background-worker',
    'Background worker',
    config.worker.enabled ? 'pass' : 'warn',
    config.worker.enabled ? `Enabled with concurrency ${config.worker.concurrency}.` : 'WORKER_ENABLED=false; generation, publishing, retries, and metrics jobs will not run.',
    'Enable one or more worker processes for production.',
  ));
  let databaseProtocol = null;
  try { databaseProtocol = config.databaseUrl ? new URL(config.databaseUrl).protocol.replace(':', '') : null; } catch { databaseProtocol = 'invalid URL'; }
  checks.push(check(
    'database',
    'Production database',
    /^postgres(ql)?:\/\//i.test(config.databaseUrl || '') ? 'pass' : 'warn',
    config.databaseUrl ? `DATABASE_URL is set (${databaseProtocol}).` : 'SQLite is active. It is suitable for local/single-node use only.',
    'Set DATABASE_URL to PostgreSQL for multi-worker or multi-instance production.',
  ));
  checks.push(check(
    'encryption-key',
    'Credential encryption key',
    config.encryptionKeyMaterial ? 'pass' : 'fail',
    config.encryptionKeyMaterial ? 'A server-side encryption key is available; stored OAuth credentials use AES-256-GCM.' : 'APP_ENCRYPTION_KEY is missing.',
    'Generate 32 random bytes and set APP_ENCRYPTION_KEY (base64) in the production secret store.',
  ));
  checks.push(check(
    'api-endpoints',
    'Official API endpoint roots',
    endpoints.insecure.length || endpoints.overrides.length ? 'warn' : 'pass',
    endpoints.overrides.length ? `Custom endpoint roots: ${endpoints.overrides.join(', ')}.` : `All ${endpoints.total} endpoint roots target official HTTPS hosts.`,
    endpoints.overrides.length ? 'Custom roots are supported for approved gateways and isolated tests. Confirm they are trusted, TLS-protected, and intentional.' : null,
  ));
  checks.push(check(
    'stripe',
    'Stripe checkout and webhooks',
    status.billing.stripeConfigured && config.stripe.webhookSecret ? 'external' : 'warn',
    status.billing.stripeConfigured && config.stripe.webhookSecret ? 'Keys are configured; Price IDs and webhook endpoint registration must be confirmed in Stripe.' : 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, then add Price IDs in Admin → Plans.',
    'Register the webhook URL above and the four supported subscription events.',
    DOCS.stripeWebhooks,
  ));
  checks.push(check(
    'smtp',
    'SMTP email delivery',
    status.notifications.smtpConfigured ? 'pass' : 'warn',
    status.notifications.smtpConfigured ? 'SMTP_URL is configured; in-app notifications are also emailed.' : 'SMTP_URL is not configured; notifications remain in-app (and optional webhook).',
    'Set SMTP_URL to an SMTP submission URL to deliver email notifications.',
  ));
  checks.push(check(
    'notification-webhook',
    'Signed notification webhooks',
    status.notifications.webhookConfigured && status.notifications.webhookSigned ? 'pass' : 'warn',
    status.notifications.webhookConfigured ? `Webhook configured; HMAC signing ${status.notifications.webhookSigned ? 'enabled' : 'disabled'}.` : 'NOTIFICATION_WEBHOOK_URL is not configured.',
    'Configure NOTIFICATION_WEBHOOK_URL and NOTIFICATION_WEBHOOK_SECRET; verify X-Film-Club-Lens-Signature with the shared secret.',
  ));

  for (const [key, integration] of Object.entries(status.integrations)) {
    checks.push(check(
      `${key}-credentials`,
      `${integration.label} credentials`,
      integration.configured ? 'external' : 'warn',
      integration.configured ? 'Server credentials are configured; provider app approval and a real connected account must still be verified.' : 'Server OAuth credentials are missing; this integration is disabled.',
      integration.configured ? 'Complete the provider approval checklist below and connect a real account.' : `Set the environment variables for ${integration.label}.`,
    ));
  }

  if (probe) {
    const healthUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/api/meta/health`;
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      checks.push(check('public-health-probe', 'Public health probe', response.ok ? 'pass' : 'fail', `${healthUrl} returned ${response.status}.`, response.ok ? null : 'Make the public HTTPS origin route to this running server.'));
    } catch (error) {
      checks.push(check('public-health-probe', 'Public health probe', 'fail', `${healthUrl} could not be reached: ${error.message}`, 'Make the public HTTPS origin route to this running server.'));
    }
  }

  const failing = checks.filter((item) => item.status === 'fail');
  const warnings = checks.filter((item) => item.status === 'warn');
  const external = checks.filter((item) => item.status === 'external');
  return {
    generatedAt: new Date().toISOString(),
    environment: config.isProduction ? 'production' : 'development/test',
    overall: failing.length ? 'blocked' : warnings.length || external.length ? 'attention-required' : 'ready',
    summary: { pass: checks.filter((item) => item.status === 'pass').length, warn: warnings.length, fail: failing.length, external: external.length },
    publicBaseUrl: publicUrl,
    callbacks,
    checks,
    productionWarnings,
    providerApproval: providerApprovalChecklist(),
    note: 'Checks marked external cannot be completed from code: they require provider console approval, paid/tiered accounts, real OAuth users, or a public HTTPS deployment.',
  };
}
