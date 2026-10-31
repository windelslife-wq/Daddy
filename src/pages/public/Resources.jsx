import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, get } from '../../api.js';
import { SITE } from '../../config/site.js';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, Callout, FAQList, FeatureCard, PageHero, Prose, Section } from '../../components/Marketing.jsx';
import { ErrorBanner, Spinner } from '../../components/ui.jsx';

export function Docs() {
  return (
    <>
      <PageHero
        eyebrow="Documentation"
        title="Deploy, configure, and operate with confidence"
        description="This guide explains the local workflow, environment variables, callback URLs, background worker, database choices, and production readiness checks."
        actions={<><Link to="/signup" className="btn btn-primary btn-lg">Open the studio <Icon name="arrow-right" size={16} /></Link><Link to="/integrations" className="btn btn-secondary btn-lg">Integration guide</Link></>}
      />
      <Section eyebrow="Quick start" title="Run the complete workflow locally" description="The default configuration uses only local services, so you can verify generation through publishing without external credentials.">
        <div className="docs-layout">
          <aside className="docs-sidebar">
            <strong>Setup checklist</strong>
            <a href="#step-1">1. Install and run</a>
            <a href="#step-2">2. Sign in</a>
            <a href="#step-3">3. Create a project</a>
            <a href="#step-4">4. Review and publish</a>
            <a href="#step-5">5. Connect providers</a>
            <a href="#step-6">6. Prepare production</a>
          </aside>
          <div className="docs-content">
            <article id="step-1"><span className="docs-step">01</span><div><h2>Install and run</h2><p>Copy <code>.env.example</code> to <code>.env</code>, install dependencies, build the frontend, start the app, and start the worker in a second process.</p><pre className="code-block"><code>{`cp .env.example .env
npm install
npm run build
npm start
# second terminal
npm run worker`}</code></pre><p className="tiny">Open <code>PUBLIC_BASE_URL</code> (default <code>http://localhost:8787</code>). The worker must run for generation, rendering, publishing, and metric sync jobs.</p></div></article>
            <article id="step-2"><span className="docs-step">02</span><div><h2>Sign in</h2><p>When <code>SEED_DEMO=true</code>, the configured demo creator and administrator are seeded on first start. In production, disable demo seeding and rotate all seeded passwords.</p></div></article>
            <article id="step-3"><span className="docs-step">03</span><div><h2>Create a project</h2><p>Choose a niche or custom topic, then set style, language, voice, aspect ratio, duration, tone, captions, music, research, and publishing targets. The server validates every option before queueing work.</p></div></article>
            <article id="step-4"><span className="docs-step">04</span><div><h2>Review and publish</h2><p>Inspect the script, scenes, sources, generated assets, and video. Schedule the project or approve it for publication. The built-in sandbox provider receives a real HTTP request, stores the post, and can return metrics.</p></div></article>
            <article id="step-5"><span className="docs-step">05</span><div><h2>Connect providers</h2><p>Add server-side credentials for official social platforms and optional AI, image, voice, payment, email, and webhook services. Use the <Link to="/status">status page</Link> and <code>npm run doctor</code> to see what remains external.</p><pre className="code-block"><code>{`PUBLIC_BASE_URL=https://your-domain.example
APP_ENCRYPTION_KEY=<base64-32-byte-key>
DATABASE_URL=postgresql://...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
META_APP_ID=...
META_APP_SECRET=...
X_CLIENT_ID=...
X_CLIENT_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...`}</code></pre></div></article>
            <article id="step-6"><span className="docs-step">06</span><div><h2>Prepare production</h2><p>Use PostgreSQL, at least one worker, a public HTTPS origin, secure cookies, a strong encryption key, SMTP or a signed webhook, Stripe webhook registration, and provider app review. Never place secrets in frontend environment variables.</p><p>Register the Stripe webhook at <code>{`PUBLIC_BASE_URL/api/billing/webhook`}</code> and subscribe to checkout, subscription, and invoice events listed in the README.</p></div></article>
          </div>
        </div>
      </Section>
      <Section className="section-alt" eyebrow="API surface" title="Core backend areas" description="All protected endpoints rely on the same HTTP-only session cookie and server-side authorization.">
        <div className="marketing-grid grid-3">
          <FeatureCard icon="key" title="Authentication" description="Register, login, logout, profile updates, password changes, and session lookup." />
          <FeatureCard icon="film" title="Content and media" description="Project creation, generated assets, signed media URLs, subtitle files, and project timelines." />
          <FeatureCard icon="plug" title="Accounts" description="OAuth start/callback state, encrypted credentials, verification, permissions, and safe revocation." />
          <FeatureCard icon="send" title="Publishing" description="Scheduling, review, retries, per-platform publication rows, and failure diagnostics." />
          <FeatureCard icon="chart" title="Analytics" description="Official metric sync, data quality indicators, and recommendations based on real snapshots." />
          <FeatureCard icon="shield" title="Admin" description="Users, plans, settings, jobs, broadcasts, and integration readiness reporting." />
        </div>
      </Section>
      <Section eyebrow="Build on it" title="A public REST API for your own tools" description="Session endpoints above power the app. Integrations outside the browser use the versioned developer API with scoped keys, signed webhooks and an OpenAPI 3.1 document.">
        <div className="hero-actions">
          <Link to="/developers" className="btn btn-primary">Read the API reference <Icon name="arrow-right" size={16} /></Link>
          <a className="btn btn-secondary" href="/api/developer/openapi.json" download="film-club-lens-openapi.json">Download OpenAPI</a>
        </div>
      </Section>
      <CTASection title="Need help with a deployment decision?" description="Send us the context and we’ll point you to the relevant configuration or provider-console requirement." primary={{ to: '/contact', label: 'Contact the team' }} secondary={{ to: '/help', label: 'Visit help center' }} />
    </>
  );
}

const providers = [
  { icon: 'play', name: 'YouTube', requirement: 'Google Cloud OAuth client, YouTube Data API, youtube.upload scope, and optional Analytics/Reporting APIs for richer metrics.', callback: '/api/oauth/google/callback' },
  { icon: 'image', name: 'Instagram', requirement: 'Meta app with Facebook Login for Business, linked Page, Instagram Business account, public HTTPS media, and Advanced Access for required scopes.', callback: '/api/oauth/meta/callback' },
  { icon: 'users', name: 'Facebook Pages', requirement: 'Meta app with Page permissions, a Page admin who can grant access, and app review where required.', callback: '/api/oauth/meta/callback' },
  { icon: 'message-circle', name: 'X', requirement: 'X app with OAuth 2.0, appropriate API tier for media upload and metrics, and user-context authorization.', callback: '/api/oauth/x/callback' },
  { icon: 'code', name: 'Sandbox', requirement: 'No external account. A local HTTP target is included for real end-to-end publishing and metrics tests.', callback: '/api/oauth/sandbox/start' },
];

export function Integrations() {
  return (
    <>
      <PageHero
        eyebrow="Integrations"
        title="Official adapters, honest activation requirements"
        description="The platform includes real OAuth, publishing, metrics, and revocation adapters. Live posting becomes available only after the relevant provider console, app review, credential, and account-tier requirements are satisfied."
        actions={<><Link to="/status" className="btn btn-primary btn-lg">Check readiness <Icon name="activity" size={16} /></Link><Link to="/docs" className="btn btn-secondary btn-lg">Setup guide</Link></>}
      />
      <Section eyebrow="Social platforms" title="What each connection requires" description="These requirements are external to the codebase and must be completed by the organization that owns the provider apps.">
        <div className="provider-grid">
          {providers.map((provider) => (
            <article className="provider-card" key={provider.name}>
              <div className="provider-head"><span className="marketing-card-icon"><Icon name={provider.icon} size={20} /></span><h2>{provider.name}</h2></div>
              <p>{provider.requirement}</p>
              <div className="provider-callback"><span>Callback</span><code>{provider.callback}</code></div>
            </article>
          ))}
        </div>
        <Callout icon="alert-triangle" title="Configured does not always mean approved" tone="warning">
          A provider can be technically configured while app review, scopes, account permissions, paid API access, or public HTTPS media access are still incomplete. The readiness report separates local configuration from external approval.
        </Callout>
      </Section>
      <Section className="section-alt" eyebrow="Supporting services" title="Optional services with clear boundaries">
        <div className="marketing-grid grid-3">
          <FeatureCard icon="sparkles" title="AI text" description="Local script planning by default; OpenAI, Anthropic, or Gemini can be configured server-side." />
          <FeatureCard icon="image" title="Images" description="Procedural original scene art by default; OpenAI images or Replicate may be configured." />
          <FeatureCard icon="mic" title="Voice" description="Local speech synthesis by default; OpenAI or ElevenLabs voices can be configured." />
          <FeatureCard icon="search" title="Research" description="Optional Brave or Tavily search provider for source-backed topic research." />
          <FeatureCard icon="credit-card" title="Payments" description="Stripe subscription checkout and signed webhooks for plan activation and payment events." />
          <FeatureCard icon="bell" title="Notifications" description="In-app notifications, optional SMTP email, and HMAC-signed outbound webhooks with retries." />
        </div>
      </Section>
      <Section eyebrow="Verification" title="Tested without pretending to be live" description="Local provider simulators exercise the official adapter contracts end to end. They are not a substitute for approved provider credentials or live verification.">
        <div className="verification-grid">
          <div><Icon name="git-branch" size={20} /><h3>OAuth flows</h3><p>Connect, token exchange, account storage, publishing, metric sync, and revoke paths are contract-tested.</p></div>
          <div><Icon name="repeat" size={20} /><h3>Retry safety</h3><p>Idempotency keys, unique publication records, and conditional worker claims protect against duplicate posts.</p></div>
          <div><Icon name="webhook" size={20} /><h3>Signed webhooks</h3><p>Outbound notifications use an HMAC signature, timestamp, and retry policy for transient failures.</p></div>
          <div><Icon name="terminal" size={20} /><h3>Readiness CLI</h3><p><code>npm run doctor -- --json</code> reports configuration and highlights external provider-console tasks.</p></div>
        </div>
      </Section>
      <CTASection title="Need a production integration review?" description="Tell us which platforms and provider tiers you plan to use, and we’ll help identify the remaining external steps." primary={{ to: '/contact', label: 'Contact integrations team' }} secondary={{ to: '/security', label: 'Security details' }} />
    </>
  );
}

const HELP_ITEMS = [
  { q: 'Can I use the platform without any paid API keys?', a: <>Yes. Local mode includes procedural visuals, local narration, original ambient music, FFmpeg rendering, and sandbox publishing. See <Link to="/docs">documentation</Link>.</>, category: 'Getting started' },
  { q: 'Why is my social account not listed as connected?', a: 'Confirm the provider credentials are configured, the callback URL matches exactly, your account has the correct role on the Page or channel, and required scopes have been approved.', category: 'Accounts' },
  { q: 'What does review required mean?', a: 'Autopilot can generate a project but the publication waits for explicit approval. This prevents unreviewed AI content from being posted.', category: 'Automation' },
  { q: 'How are duplicate posts prevented on retries?', a: 'Publication rows are unique per project and platform, retries use stable idempotency keys, and workers claim jobs conditionally. A failed remote request is retried without creating a new target record.', category: 'Publishing' },
  { q: 'Why are analytics missing for a recent post?', a: 'Official platform metrics can lag, require specific permissions or API tiers, and may not be available for every post type. Sandbox metrics are simulated and excluded from recommendations.', category: 'Analytics' },
  { q: 'Where are my OAuth tokens stored?', a: 'They are encrypted with AES-256-GCM on the server. The frontend never receives provider secrets. See <Link to="/security">Security</Link>.', category: 'Security' },
  { q: 'How do I enable paid plans?', a: 'Set Stripe server credentials, register the webhook, and attach a Stripe Price ID to each paid plan in the admin control center.', category: 'Billing' },
  { q: 'What should I do if a job keeps failing?', a: <>Open the project or publishing history, read the stored error, then check Admin → Jobs. Provider errors usually relate to scopes, media accessibility, rate limits, or account permissions. <Link to="/contact">Contact support</Link> with the job ID and error.</>, category: 'Troubleshooting' },
];

export function Help() {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return HELP_ITEMS;
    return HELP_ITEMS.filter((item) => `${item.q} ${item.category} ${typeof item.a === 'string' ? item.a : ''}`.toLowerCase().includes(needle));
  }, [query]);
  return (
    <>
      <PageHero
        eyebrow="Help Center"
        title="Answers for setup, publishing, and operations"
        description="Find practical guidance for local evaluation, provider connections, automation, analytics, billing, and security."
        actions={<Link to="/contact" className="btn btn-primary btn-lg">Contact support <Icon name="headphones" size={16} /></Link>}
      />
      <Section eyebrow="Knowledge base" title="Search common questions" description="Use a keyword such as publishing, OAuth, billing, metrics, worker, or review.">
        <label className="help-search"><Icon name="search" size={18} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help articles…" aria-label="Search help articles" /></label>
        {filtered.length ? <FAQList items={filtered} /> : <div className="help-empty"><Icon name="search" size={24} /><h3>No matches</h3><p>Try a different phrase or <Link to="/contact">send us your question</Link>.</p></div>}
      </Section>
      <Section className="section-alt" eyebrow="Popular paths" title="Where to go next" align="center">
        <div className="marketing-grid grid-3">
          <Link to="/docs" className="help-path"><FeatureCard icon="book" title="Setup documentation" description="Install, configure, and verify the complete local workflow." /></Link>
          <Link to="/integrations" className="help-path"><FeatureCard icon="plug" title="Integration requirements" description="Understand provider credentials, scopes, and external approval tasks." /></Link>
          <Link to="/status" className="help-path"><FeatureCard icon="activity" title="Service status" description="Check live application health and provider configuration." /></Link>
        </div>
      </Section>
    </>
  );
}

export function Status() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    Promise.all([get('/api/meta/health'), get('/api/meta/status')])
      .then(([health, status]) => { setData({ health, status }); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  const integrations = Object.entries(data?.status?.integrations || {});
  return (
    <>
      <PageHero
        eyebrow="Service status"
        title="Live application and integration readiness"
        description="This page reads the public health endpoint and provider status endpoint directly. It reports configuration status, not a guarantee of external provider approval or uptime."
        actions={<button type="button" className="btn btn-secondary btn-lg" onClick={load}><Icon name="repeat" size={16} /> Refresh status</button>}
      />
      <Section className="section-tight" eyebrow="Current state" title="System status">
        {loading && !data && <div className="full-loader"><Spinner size={20} label="Checking services…" /></div>}
        <ErrorBanner error={error} onRetry={load} />
        {data && (
          <>
            <div className={`status-banner ${data.health?.ok ? 'ok' : 'down'}`}>
              <span className="status-orb"><Icon name={data.health?.ok ? 'check' : 'circle-alert'} size={20} /></span>
              <div><h2>{data.health?.ok ? 'Application is responding' : 'Application health check failed'}</h2><p>{data.health?.service || SITE.name} · Last checked {formatDate(data.health?.time || new Date().toISOString())}</p></div>
              <span className="status-tag">{data.status?.environment || 'unknown'}</span>
            </div>
            <div className="status-grid">
              <article className="status-card"><h3>Generation services</h3>
                <StatusLine label="AI provider" value={data.status?.ai?.active} ok={data.status?.ai?.configured} />
                <StatusLine label="Image provider" value={data.status?.images?.active} ok={data.status?.images?.configured} />
                <StatusLine label="Voice provider" value={data.status?.tts?.active} ok={data.status?.tts?.configured} />
                <StatusLine label="Video renderer" value={data.status?.videoRenderer} ok />
              </article>
              <article className="status-card"><h3>Platform adapters</h3>
                {integrations.map(([key, value]) => <StatusLine key={key} label={value.label || key} value={value.mode === 'local-http' ? 'Local HTTP' : value.configured ? 'Credentials set' : 'Needs credentials'} ok={value.configured} external={value.mode === 'official-oauth' && value.configured} />)}
              </article>
              <article className="status-card"><h3>Operations</h3>
                <StatusLine label="Public media" value={data.status?.publicMediaReady ? 'HTTPS origin ready' : 'Local / check URL'} ok={Boolean(data.status?.publicMediaReady)} />
                <StatusLine label="Stripe" value={data.status?.billing?.stripeConfigured ? 'Configured' : 'Not configured'} ok={Boolean(data.status?.billing?.stripeConfigured)} />
                <StatusLine label="SMTP email" value={data.status?.notifications?.smtpConfigured ? 'Configured' : 'Not configured'} ok={Boolean(data.status?.notifications?.smtpConfigured)} />
                <StatusLine label="Signed webhook" value={data.status?.notifications?.webhookSigned ? 'Configured' : 'Not configured'} ok={Boolean(data.status?.notifications?.webhookSigned)} />
              </article>
            </div>
            <Callout icon="info" title="What this status means" tone="info">
              “Credentials set” means server configuration exists. Live publishing still depends on provider app review, scopes, account permissions, API tiers, and platform availability. Run <code>npm run doctor</code> for a deployment-level checklist.
            </Callout>
          </>
        )}
      </Section>
      <CTASection title="See a missing provider configuration?" description="Follow the setup guide, then contact the team with the readiness report if you need help interpreting an external requirement." primary={{ to: '/docs', label: 'Open setup guide' }} secondary={{ to: '/contact', label: 'Contact support' }} />
    </>
  );
}

function StatusLine({ label, value, ok, external }) {
  return <div className="status-line"><span className={`status-dot ${ok ? 'ok' : 'pending'}`} /><strong>{label}</strong><span>{value || '—'}{external && <small className="external-note"> external checks apply</small>}</span></div>;
}

export function Security() {
  const sections = [
    { title: 'Authentication and sessions', paragraphs: ['Passwords are hashed before storage and never returned by the API. Sessions use HTTP-only cookies with SameSite protections; secure cookies are enabled for HTTPS deployments.', 'Authentication endpoints are rate-limited, and protected API routes check the current session and user status server-side.'], bullets: ['Password changes invalidate existing sessions.', 'Administrators can suspend or reactivate accounts.', 'Session records expire and are cleaned by maintenance jobs.'] },
    { title: 'Credentials and secrets', paragraphs: ['Provider API keys, OAuth client secrets, encryption keys, Stripe secrets, and SMTP credentials are read only from server environment variables.', 'OAuth access and refresh tokens are encrypted with AES-256-GCM before being stored. The admin interface reports configuration status without reading secret values.'], bullets: ['No provider secret is bundled into the frontend.', 'Production rejects non-HTTPS API endpoint overrides.', 'Account revocation attempts provider-side token invalidation where supported.'] },
    { title: 'Request and media protections', paragraphs: ['The Express API applies security headers, a restrictive Content Security Policy in production, same-origin checks for state-changing requests, request size limits, and API rate limits.', 'Local generated media can be served through signed URLs so direct file access is controlled by the application.'], bullets: ['JSON schema validation on API input.', 'Safe error messages that avoid secret leakage.', 'Signed outbound webhooks with timestamps and HMAC verification.'] },
    { title: 'Publishing safety', paragraphs: ['Publishing records are unique per project and platform. Retries reuse stable idempotency keys and workers claim jobs conditionally to prevent duplicate processing.', 'Review gates, daily autopilot limits, publication history, error logs, and provider permission checks make automated publishing auditable.'], bullets: ['Human approval can be required for every niche.', 'Failures are stored with enough context to diagnose.', 'Sandbox metrics are labeled and excluded from advice.'] },
    { title: 'Responsible disclosure', paragraphs: [`If you believe you have found a security issue, contact ${SITE.securityEmail} with a description, reproduction steps, affected URL, and a safe contact method.`, 'Do not send live credentials, private keys, or personal data. Rotate any credentials that may have been exposed before beginning an investigation.'], bullets: ['We will acknowledge reports and coordinate remediation.', 'Please allow a reasonable disclosure window.', 'Provider-side incidents should also be reported to the affected provider.'] },
  ];
  return (
    <>
      <PageHero eyebrow="Security" title="Security is part of the product architecture" description="Learn how the platform protects credentials, sessions, media, publishing operations, and webhook delivery." actions={<Link to="/contact" className="btn btn-primary btn-lg">Report a security issue <Icon name="shield-check" size={16} /></Link>} />
      <Section className="section-tight" eyebrow="Trust overview" title="Security practices across the stack"><Prose sections={sections} updated="October 27, 2026" /></Section>
      <Section className="section-alt" eyebrow="Shared responsibility" title="What operators still need to do">
        <Callout icon="alert-triangle" title="Deployment configuration matters" tone="warning">
          Use HTTPS, PostgreSQL, a strong APP_ENCRYPTION_KEY, secure cookies, restricted database access, secret rotation, provider least-privilege scopes, backups, monitoring, and a separate worker process in production.
        </Callout>
        <div className="marketing-grid grid-3">
          <FeatureCard icon="key" title="Protect secrets" description="Store keys in a managed secret store and rotate them when staff or infrastructure changes." />
          <FeatureCard icon="users" title="Limit admin access" description="Grant administrator roles only to trained operators and review account activity regularly." />
          <FeatureCard icon="eye" title="Review content" description="Keep human approval enabled for public publishing and verify rights before release." />
        </div>
      </Section>
      <CTASection title="Need the deployment checklist?" description="The documentation and readiness report show exactly which configuration values are required for a production environment." primary={{ to: '/docs', label: 'Read deployment guide' }} secondary={{ to: '/status', label: 'View status' }} />
    </>
  );
}

export function Changelog() {
  const entries = [
    { date: 'October 27, 2026', version: 'Current release', icon: 'palette', title: 'Global website, theme system, and refined authentication', items: ['Added a complete public website with product, resource, company, and legal pages.', 'Added Midnight, Daylight, Aurora, and system appearance themes that apply across public and application pages.', 'Added a shared site map used by header menus, mobile navigation, footer links, and route checks.', 'Split login and signup into dedicated pages with validation, password visibility, strength feedback, and a professional responsive layout.'] },
    { date: 'October 2026', version: 'Integration readiness', icon: 'cpu', title: 'Deployment doctor and provider approval visibility', items: ['Added machine-readable readiness checks and an admin integration panel.', 'Separated local configuration from external provider-console approval tasks.', 'Expanded official analytics adapters for YouTube Reporting and X media metrics where permissions permit.'] },
    { date: 'October 2026', version: 'Verification suite', icon: 'check-circle', title: 'End-to-end provider simulator and visual QA', items: ['Contract-tested OAuth, publishing, metrics, and revoke flows for supported social platforms.', 'Added external AI, media, Stripe, SMTP, and webhook simulator coverage.', 'Added desktop and mobile visual checks for overflow, console errors, and failed network requests.'] },
    { date: 'October 2026', version: 'Core platform', icon: 'rocket', title: 'Complete faceless video workflow', items: ['Implemented AI script planning, original visual generation, narration, captions, music, and FFmpeg rendering.', 'Added official publishing adapters, review gates, scheduling, autopilot, retries, and duplicate prevention.', 'Added analytics, admin controls, quotas, encrypted credentials, notifications, and PostgreSQL multiprocess support.'] },
  ];
  return (
    <>
      <PageHero eyebrow="Changelog" title="What changed and why it matters" description="A concise record of platform capabilities, verification work, and user experience improvements." actions={<Link to="/docs" className="btn btn-secondary btn-lg">Read documentation <Icon name="book" size={16} /></Link>} />
      <Section eyebrow="Release notes" title="Recent improvements" description="Dates reflect the current workspace release. Simulator tests are identified separately from live provider verification.">
        <div className="changelog-list">
          {entries.map((entry) => (
            <article className="changelog-item" key={entry.title}>
              <div className="changelog-meta"><span className="marketing-card-icon"><Icon name={entry.icon} size={19} /></span><small>{entry.date}</small><em>{entry.version}</em></div>
              <div className="changelog-copy"><h2>{entry.title}</h2><ul>{entry.items.map((item) => <li key={item}>{item}</li>)}</ul></div>
            </article>
          ))}
        </div>
      </Section>
      <Section className="section-alt" eyebrow="Verification language" title="No simulated result is presented as live">
        <Callout icon="info" title="Honest integration status" tone="info">
          Local provider simulators verify adapter contracts and error handling. They do not create live social posts, approve provider apps, or replace testing with official credentials and production accounts.
        </Callout>
      </Section>
      <CTASection title="Want the full technical history?" description="The repository README and commit history contain detailed implementation notes and verification commands." primary={{ to: '/docs', label: 'Open docs' }} secondary={{ to: '/contact', label: 'Ask a question' }} />
    </>
  );
}

export function Careers() {
  return (
    <>
      <PageHero eyebrow="Careers" title="Help build trustworthy creative automation" description="We are interested in people who care about reliable systems, responsible AI, excellent design, and clear technical communication." actions={<Link to="/contact" className="btn btn-primary btn-lg">Introduce yourself <Icon name="mail" size={16} /></Link>} />
      <Section eyebrow="Open roles" title="No roles are currently posted" description="We do not want to advertise positions that are not open. If your work aligns with the areas below, send a short introduction and relevant examples." align="center">
        <div className="marketing-grid grid-3">
          <FeatureCard icon="code" title="Full-stack engineering" description="React, Node.js, PostgreSQL, background jobs, integrations, and production operations." />
          <FeatureCard icon="palette" title="Product design" description="Accessible, professional interfaces for complex creation and publishing workflows." />
          <FeatureCard icon="shield-check" title="Trust and safety" description="Platform policy, content rights, abuse prevention, and responsible AI review processes." />
        </div>
      </Section>
      <Section className="section-alt" eyebrow="How we work" title="Principles for the team">
        <div className="three-up-grid">
          <div className="number-panel"><span>01</span><h3>Show the real state</h3><p>Interfaces should distinguish working features from local simulations and external requirements.</p></div>
          <div className="number-panel"><span>02</span><h3>Design for operators</h3><p>Reliability, observability, review, and recovery deserve as much attention as generation.</p></div>
          <div className="number-panel"><span>03</span><h3>Respect the ecosystem</h3><p>Official APIs, creator rights, user privacy, and platform rules are product constraints, not afterthoughts.</p></div>
        </div>
      </Section>
      <CTASection title="Think you would be a good fit?" description="Send a concise note describing what you have built and which part of the platform interests you most." primary={{ to: '/contact', label: 'Contact the team' }} secondary={{ to: '/about', label: 'About the project' }} />
    </>
  );
}

export function Press() {
  const factSheet = `${SITE.name}\n${SITE.tagline}\n\n${SITE.description}\n\nWebsite: ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.example'}\nMedia contact: ${SITE.email}\nSecurity contact: ${SITE.securityEmail}\n\nProduct: AI-assisted faceless video creation, review, scheduling, official social publishing, analytics, and administration.\nDeployment: Local-first evaluation, PostgreSQL production mode, background workers, encrypted credentials, and signed webhooks.\n`;
  return (
    <>
      <PageHero eyebrow="Press & brand" title="Product facts for writers and partners" description="Use this page for an accurate summary of what Film Club Lens is, how it works, and where its integration boundaries are." actions={<a className="btn btn-primary btn-lg" href={`data:text/plain,${encodeURIComponent(factSheet)}`} download="film-club-lens-fact-sheet.txt"><Icon name="download" size={16} /> Download fact sheet</a>} />
      <Section eyebrow="Positioning" title="What the platform does" description="A professional AI content operations system with real workflow, security, and publishing controls." align="center">
        <div className="press-statement"><Icon name="quote" size={28} /><p>{SITE.description} It supports local evaluation without paid APIs, then connects official provider integrations when organizational credentials and approvals are ready.</p></div>
      </Section>
      <Section className="section-alt" eyebrow="Key facts" title="At a glance">
        <div className="press-facts">
          <div><span>Product</span><strong>AI faceless video studio</strong></div>
          <div><span>Core workflow</span><strong>Script → media → review → publish → measure</strong></div>
          <div><span>Platforms</span><strong>YouTube, Instagram, Facebook, X, Sandbox</strong></div>
          <div><span>Architecture</span><strong>React, Express, SQLite/PostgreSQL, workers</strong></div>
          <div><span>Security</span><strong>Encrypted credentials, HTTP-only sessions, signed webhooks</strong></div>
          <div><span>Verification</span><strong>Provider simulators, E2E, visual QA, readiness CLI</strong></div>
        </div>
      </Section>
      <Section eyebrow="Media contact" title="Request clarification before publishing" description={`For product questions, screenshots, or technical details, contact ${SITE.email}. We can confirm whether a capability is live, local, or dependent on external provider approval.`}>
        <Callout icon="megaphone" title="Please avoid unsupported claims" tone="warning">
          Simulator tests and local sandbox publishing do not constitute live social-network verification. The platform does not guarantee provider app review, API tier access, or publishing success.
        </Callout>
      </Section>
      <CTASection title="Need a technical walkthrough?" description="Contact the team with your publication deadline and the specific workflow you want to understand." primary={{ to: '/contact', label: 'Contact press team' }} secondary={{ to: '/docs', label: 'Read docs' }} />
    </>
  );
}
