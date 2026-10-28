/**
 * Completion audit for activation modules.
 *
 * The setup wizard answers "is it configured?" and the verifier answers "do the
 * credentials work?". This module answers the last question: "is the module
 * actually DONE?" — using real application state (connected accounts, granted
 * scopes, published posts, official metrics, Stripe Price IDs, webhook events)
 * plus an explicit admin confirmation for steps that only happen in a provider
 * console.
 *
 * Server-only: this file imports the database. The CLI does not load it.
 */
import { db, getSetting, setSetting, parseJson } from '../../db.js';
import { decrypt } from '../../security.js';
import { ACTIVATION_MODULES, getModule } from './modules.js';
import { checkAll } from './preflight.js';
import { isSet, runValidator } from './validators.js';
import { ownerForCriterion, commandForCriterion, OWNERS, RECOMMENDED_ORDER } from './workflow.js';

export const CONFIRMATIONS_KEY = 'activation.confirmations';
export const VERIFICATIONS_KEY = 'activation.verifications';

/** Modules whose verifier never makes a network call. */
const OFFLINE_VERIFIABLE = new Set(['ai-providers', 'research', 'image-providers', 'tts-providers', 'encryption-key', 'app-review']);

export async function getConfirmations() {
  return parseJson(await getSetting(CONFIRMATIONS_KEY, {}), {}) || {};
}

export async function setModuleConfirmation(moduleId, userId, { confirmed = true, note = '' } = {}) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown activation module: ${moduleId}`);
  const all = await getConfirmations();
  if (confirmed) {
    all[moduleId] = { at: new Date().toISOString(), by: userId || 'admin', note: String(note || '').slice(0, 500) };
  } else {
    delete all[moduleId];
  }
  await setSetting(CONFIRMATIONS_KEY, all, userId);
  return all[moduleId] || null;
}

export async function recordModuleVerification(result) {
  const all = parseJson(await getSetting(VERIFICATIONS_KEY, {}), {}) || {};
  all[result.id] = {
    status: result.status,
    summary: result.summary,
    checkedAt: result.checkedAt,
    checks: result.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
  };
  await setSetting(VERIFICATIONS_KEY, all);
  return all[result.id];
}

export async function getVerifications() {
  return parseJson(await getSetting(VERIFICATIONS_KEY, {}), {}) || {};
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

async function gather() {
  const [accounts, plans, published, metrics, processedWebhooks, projects, confirmations, verifications] = await Promise.all([
    db('accounts').select('id', 'platform', 'status', 'active', 'scopes', 'permissions', 'credentials', 'token_expires_at'),
    db('plans').select('id', 'name', 'price_cents', 'stripe_price_id', 'active'),
    db('publications as p').join('accounts as a', 'a.id', 'p.account_id')
      .where('p.status', 'published').select('p.id', 'p.remote_url', 'a.platform'),
    db('post_metrics as m').join('publications as p', 'p.id', 'm.publication_id')
      .join('accounts as a', 'a.id', 'p.account_id').select('m.raw', 'a.platform'),
    db('webhook_events').where({ provider: 'stripe' }).whereNotNull('processed_at').select('id'),
    db('projects').select('id', 'status', 'video_path', 'provider_summary', 'sources'),
    getConfirmations(),
    getVerifications(),
  ]);
  return { accounts, plans, published, metrics, processedWebhooks, projects, confirmations, verifications };
}

const isActive = (row) => row.active === true || row.active === 1 || row.active === '1';
const connectedAccounts = (ctx, platform) => ctx.accounts.filter((a) => a.platform === platform && a.status === 'connected' && isActive(a));
const publishedOn = (ctx, platform) => ctx.published.filter((p) => p.platform === platform && p.remote_url);
const officialPlatforms = ['facebook', 'instagram', 'youtube', 'x'];

function isSimulated(raw) {
  const value = parseJson(raw, {});
  return Boolean(value?.simulated || value?.note?.toLowerCase?.().includes('sandbox'));
}
const officialMetrics = (ctx, platform) => ctx.metrics.filter((m) => (platform ? m.platform === platform : true) && !isSimulated(m.raw));

function credentialsHealth(accounts) {
  let decrypted = 0;
  let failed = 0;
  for (const account of accounts) {
    if (!account.credentials) continue;
    try {
      if (String(account.credentials).startsWith('v1.')) decrypt(account.credentials);
      else JSON.parse(account.credentials);
      decrypted += 1;
    } catch { failed += 1; }
  }
  return { decrypted, failed };
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

function criterion(id, label, ok, detail, action) {
  return { id, label, status: ok ? 'pass' : 'pending', detail, action: ok ? null : action };
}

function commonCriteria(module, ctx, preflightModule) {
  const checks = [];
  // External-only modules (module 15) have no environment values to configure;
  // their preflight status is deliberately "external", not "ready".
  if (module.kind !== 'external') {
    checks.push(criterion(
      'local-config', 'Local configuration',
      preflightModule.status === 'ready',
      preflightModule.status === 'ready'
        ? `All ${preflightModule.passed}/${preflightModule.total} environment/dependency checks pass.`
        : `${preflightModule.passed}/${preflightModule.total} configuration checks pass.`,
      `Run \`npm run setup -- --module ${module.id}\` and fill the missing values.`,
    ));
  }

  // Module 15 (provider app review) has no verifier by design — a provider
  // reviewer decision cannot produce a "verified" result from code.
  if (module.kind !== 'external') {
    const verification = ctx.verifications[module.id];
    const verified = verification?.status === 'verified';
    checks.push(criterion(
      'live-verified', 'Live verification passed', verified,
      verification ? `Last check: ${verification.status} at ${verification.checkedAt}.` : 'No verification has been recorded for this module.',
      OFFLINE_VERIFIABLE.has(module.id)
        ? 'Click Verify (this module is checked offline).'
        : 'Click Verify once the credentials are in place.',
    ));
  }

  const manualSteps = module.consoleSteps.length + module.deploySteps.length;
  if (manualSteps > 0) {
    const confirmation = ctx.confirmations[module.id];
    checks.push(criterion(
      'manual-steps', 'Provider / deployment steps confirmed',
      Boolean(confirmation),
      confirmation
        ? `Confirmed by ${confirmation.by || 'admin'} at ${confirmation.at}${confirmation.note ? ` — ${confirmation.note}` : ''}.`
        : `${manualSteps} manual step(s) must be completed outside this repository.`,
      'Finish the checklist in the provider console, then click "Mark steps done".',
    ));
  }
  return checks;
}

function accountCriterion(ctx, platform, label) {
  const accounts = connectedAccounts(ctx, platform);
  return criterion(
    'connected-account', `Connected, active ${label} account`,
    accounts.length > 0,
    accounts.length ? `${accounts.length} connected ${label} account(s).` : `No connected ${label} account yet.`,
    `Use Accounts → Connect ${label} and approve the OAuth consent screen.`,
  );
}

function scopeCriterion(ctx, platform, required, label) {
  const accounts = connectedAccounts(ctx, platform);
  const missing = new Set(required);
  for (const account of accounts) {
    const granted = [
      ...parseJson(account.scopes, []),
      ...parseJson(account.permissions, []),
    ].map(String);
    for (const value of required) if (granted.some((g) => g.includes(value))) missing.delete(value);
  }
  return criterion(
    'granted-scopes', `${label} permissions granted`,
    accounts.length > 0 && missing.size === 0,
    missing.size === 0 && accounts.length > 0
      ? `All required ${label} permissions are present on at least one connected account.`
      : `Missing: ${[...missing].join(', ') || 'no connected account to inspect'}.`,
    'Disconnect and reconnect the account, granting every requested scope (and request Advanced Access in the provider console).',
  );
}

function livePostCriterion(ctx, platform, label) {
  const posts = publishedOn(ctx, platform);
  return criterion(
    'live-post', `Live published post on ${label}`,
    posts.length > 0,
    posts.length ? `${posts.length} published post(s) with a remote link.` : 'No live post has been published to this platform yet.',
    'Publish one real short video and confirm the remote permalink resolves while signed out.',
  );
}

const YOUTUBE_SCOPES = ['youtube.upload', 'youtube.readonly', 'youtube.force-ssl', 'yt-analytics.readonly'];

function moduleSpecificCriteria(module, ctx, env) {
  switch (module.id) {
    case 'facebook-pages':
      return [
        accountCriterion(ctx, 'facebook', 'Facebook Page'),
        scopeCriterion(ctx, 'facebook', ['pages_manage_posts'], 'Facebook publishing'),
        livePostCriterion(ctx, 'facebook', 'Facebook'),
      ];
    case 'instagram-reels':
      return [
        accountCriterion(ctx, 'instagram', 'Instagram'),
        scopeCriterion(ctx, 'instagram', ['instagram_content_publish'], 'Instagram publishing'),
        criterion('public-media', 'Public media URL available',
          runValidator('httpsOrigin', env.PUBLIC_BASE_URL).valid && ctx.projects.some((p) => p.video_path),
          ctx.projects.some((p) => p.video_path) && runValidator('httpsOrigin', env.PUBLIC_BASE_URL).valid
            ? 'At least one rendered video exists and the origin is public HTTPS, so signed media URLs can be fetched by Meta.'
            : 'Generate one real video and set a public HTTPS PUBLIC_BASE_URL before connecting Instagram.',
          'Generate a video, then verify the signed media URL from outside your network.'),
        livePostCriterion(ctx, 'instagram', 'Instagram'),
      ];
    case 'youtube':
      return [
        accountCriterion(ctx, 'youtube', 'YouTube'),
        scopeCriterion(ctx, 'youtube', YOUTUBE_SCOPES, 'YouTube API'),
        livePostCriterion(ctx, 'youtube', 'YouTube'),
        criterion('official-metrics', 'Official YouTube metrics synced',
          officialMetrics(ctx, 'youtube').length > 0,
          officialMetrics(ctx, 'youtube').length ? `${officialMetrics(ctx, 'youtube').length} non-simulated metric snapshot(s).` : 'No official (non-simulated) metrics have been synced.',
          'Run a metrics sync on a published YouTube video after it has views.'),
      ];
    case 'x':
      return [
        accountCriterion(ctx, 'x', 'X'),
        livePostCriterion(ctx, 'x', 'X'),
      ];
    case 'stripe': {
      const paid = ctx.plans.filter((p) => isActive(p) && Number(p.price_cents) > 0);
      const missingPrices = paid.filter((p) => !/^price_/.test(String(p.stripe_price_id || '')));
      return [
        criterion('price-ids', 'Stripe Price IDs on every paid plan',
          paid.length > 0 && missingPrices.length === 0,
          missingPrices.length === 0
            ? `All ${paid.length} active paid plan(s) have a price_… ID.`
            : `Missing Price ID on: ${missingPrices.map((p) => p.name || p.id).join(', ') || 'no paid plans'}.`,
          'Create a recurring Price in Stripe and paste its price_… ID into Admin → Plans.'),
        criterion('webhook-events', 'Signed Stripe webhook processed',
          ctx.processedWebhooks.length > 0,
          ctx.processedWebhooks.length ? `${ctx.processedWebhooks.length} processed Stripe webhook event(s).` : 'No Stripe webhook has been processed yet.',
          'Register /api/billing/webhook in Stripe and replay a test checkout.session.completed event.'),
      ];
    }
    case 'smtp':
      return [criterion('smtp-config', 'SMTP transport configured', isSet(env.SMTP_URL),
        isSet(env.SMTP_URL) ? 'SMTP_URL is set; the mail transport is created at startup.' : 'SMTP_URL is not set.',
        'Set SMTP_URL in the server environment.')];
    case 'notification-webhook':
      return [criterion('webhook-config', 'Signed webhook receiver configured',
        isSet(env.NOTIFICATION_WEBHOOK_URL) && isSet(env.NOTIFICATION_WEBHOOK_SECRET),
        isSet(env.NOTIFICATION_WEBHOOK_URL) && isSet(env.NOTIFICATION_WEBHOOK_SECRET)
          ? 'URL and shared HMAC secret are both set.' : 'The webhook URL or signing secret is missing.',
        'Set NOTIFICATION_WEBHOOK_URL and NOTIFICATION_WEBHOOK_SECRET.')];
    case 'ai-providers':
    case 'image-providers':
    case 'tts-providers': {
      const map = {
        'ai-providers': ['AI_PROVIDER', 'local', 'scriptProvider', 'AI'],
        'image-providers': ['IMAGE_PROVIDER', 'procedural', 'imageProvider', 'image'],
        'tts-providers': ['TTS_PROVIDER', 'mespeak', 'ttsProvider', 'TTS'],
      };
      const [key, offlineValue, summaryKey, label] = map[module.id];
      const provider = env[key] || offlineValue;
      const external = provider !== offlineValue;
      const used = ctx.projects.some((p) => {
        const summary = parseJson(p.provider_summary, {});
        return summary?.[summaryKey] && summary[summaryKey] !== offlineValue;
      });
      return [
        criterion('provider-active', `${label} provider active`,
          !external || isSet(env[key]),
          external ? `External provider "${provider}" selected.` : `Offline default "${offlineValue}" is active — nothing to activate.`,
          `Set ${key} and its matching API key.`),
        ...(external ? [criterion('provider-evidence', `${label} output generated`,
          used,
          used ? 'At least one project records output from the external provider.' : 'No project has used the external provider yet.',
          'Generate a test video and check the provider summary on the project detail page.')] : []),
      ];
    }
    case 'research': {
      const provider = env.SEARCH_PROVIDER || 'none';
      const external = provider !== 'none';
      const used = ctx.projects.some((p) => (parseJson(p.sources, []) || []).length > 0);
      return [
        criterion('research-active', 'Research provider active', !external || isSet(env.SEARCH_API_KEY),
          external ? `External provider "${provider}" selected.` : 'Research is disabled — the offline mode needs no activation.',
          'Set SEARCH_PROVIDER and SEARCH_API_KEY.'),
        ...(external ? [criterion('research-evidence', 'Researched project generated', used,
          used ? 'At least one project has research sources.' : 'No project has recorded research sources.',
          'Enable research mode in AI Studio and generate a project.')] : []),
      ];
    }
    case 'public-https-origin':
      return [
        criterion('https-origin', 'Public HTTPS origin',
          runValidator('httpsOrigin', env.PUBLIC_BASE_URL).valid,
          runValidator('httpsOrigin', env.PUBLIC_BASE_URL).valid ? 'PUBLIC_BASE_URL is a public HTTPS origin.' : 'PUBLIC_BASE_URL is not a public HTTPS origin.',
          'Deploy behind HTTPS with a valid certificate and set PUBLIC_BASE_URL.'),
        criterion('secure-cookies', 'Secure session cookies',
          env.NODE_ENV === 'production' && /^(true|1|yes|on)$/i.test(String(env.SECURE_COOKIES || '')),
          env.NODE_ENV === 'production' && /^(true|1|yes|on)$/i.test(String(env.SECURE_COOKIES || '')) ? 'Production mode with secure cookies enabled.' : 'NODE_ENV=production and SECURE_COOKIES=true are required.',
          'Set NODE_ENV=production and SECURE_COOKIES=true.'),
      ];
    case 'postgres': {
      const worker = !/^(false|0|no|off)$/i.test(String(env.WORKER_ENABLED || ''));
      return [
        criterion('worker-enabled', 'Background worker enabled', worker,
          worker ? 'WORKER_ENABLED is on (default).' : 'WORKER_ENABLED is explicitly disabled.',
          'Set WORKER_ENABLED=true on API and worker processes.'),
      ];
    }
    case 'encryption-key': {
      const health = credentialsHealth(ctx.accounts);
      return [
        criterion('stored-credentials', 'Stored credentials decrypt with the current key',
          health.failed === 0,
          health.failed === 0 ? `All ${health.decrypted} stored credential set(s) decrypt successfully.` : `${health.failed} stored credential set(s) cannot be decrypted — the key was likely rotated.`,
          'Restore the previous APP_ENCRYPTION_KEY or reconnect the affected accounts.'),
      ];
    }
    case 'app-review': {
      const officialPosts = officialPlatforms.reduce((n, p) => n + publishedOn(ctx, p).length, 0);
      const officialMetricCount = officialMetrics(ctx, null).filter((m) => officialPlatforms.includes(m.platform)).length;
      return [
        criterion('live-smoke-test', 'Live post published with a non-team account',
          officialPosts > 0,
          officialPosts > 0 ? `${officialPosts} published post(s) on official platforms.` : 'No post has been published to an official platform.',
          'Publish one real short video using an account that is not an app admin/developer/tester — Standard Access hides permission problems for team members.'),
        criterion('official-metrics', 'Official metrics received',
          officialMetricCount > 0,
          officialMetricCount > 0 ? `${officialMetricCount} non-simulated official metric snapshot(s).` : 'No official metrics have been synced (sandbox metrics are excluded).',
          'Sync metrics on a live official post and confirm they are not labelled simulated.'),
      ];
    }
    default:
      return [];
  }
}

/**
 * Build the completion audit.
 * @returns {Promise<{generatedAt, summary, modules}>}
 */
export async function buildCompletionAudit({ env = process.env, root = process.cwd() } = {}) {
  const [ctx, report] = await Promise.all([gather(), Promise.resolve(checkAll({ env, root }))]);
  const byId = Object.fromEntries(report.modules.map((m) => [m.id, m]));

  const modules = ACTIVATION_MODULES.map((module) => {
    const missingEnvKeys = (byId[module.id]?.checks || [])
      .filter((c) => c.status === 'fail' && c.id.startsWith('env:'))
      .map((c) => c.id.slice('env:'.length));
    const checks = [
      ...commonCriteria(module, ctx, byId[module.id]),
      ...moduleSpecificCriteria(module, ctx, env),
    ].map((c) => {
      const owner = ownerForCriterion(c.id);
      return {
        ...c,
        owner,
        ownerLabel: OWNERS[owner],
        command: c.status === 'pass' ? null : commandForCriterion(c.id, module.id, missingEnvKeys),
      };
    });
    const passed = checks.filter((c) => c.status === 'pass').length;
    const pending = checks.filter((c) => c.status === 'pending');
    return {
      id: module.id,
      number: module.number,
      name: module.name,
      complete: pending.length === 0,
      passed,
      total: checks.length,
      checks,
      confirmation: ctx.confirmations[module.id] || null,
      lastVerification: ctx.verifications[module.id] || null,
      nextAction: pending.length ? pending[0].action : null,
    };
  });

  const complete = modules.filter((m) => m.complete).length;
  const byModuleId = Object.fromEntries(modules.map((m) => [m.id, m]));
  // `nextModule` stays the first incomplete module in numbered order for
  // backward compatibility. `recommendedNextModule` respects dependencies:
  // security/HTTPS/database before OAuth publishing integrations.
  const dependencyOrder = [...RECOMMENDED_ORDER, ...ACTIVATION_MODULES.map((m) => m.id)];
  const recommended = dependencyOrder
    .map((id) => byModuleId[id])
    .find((m) => m && !m.complete) || null;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: modules.length,
      complete,
      inProgress: modules.filter((m) => !m.complete && m.passed > 0).length,
      notStarted: modules.filter((m) => !m.complete && m.passed === 0).length,
      criteriaMet: modules.reduce((n, m) => n + m.passed, 0),
      criteriaTotal: modules.reduce((n, m) => n + m.total, 0),
    },
    modules,
    recommendedOrder: RECOMMENDED_ORDER,
    nextModule: modules.find((m) => !m.complete) || null,
    recommendedNextModule: recommended,
  };
}
