import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, FeatureCard, MetricStrip, PageHero, Section, StepList } from '../../components/Marketing.jsx';

const features = [
  { icon: 'clapperboard', title: 'AI filmmaking studio', description: 'Develop short dramas, films and series scene by scene, from story and characters to an assembled production.', to: '/filmmaking' },
  { icon: 'wand-sparkles', title: 'Idea to complete video', description: 'Generate a script, scene plan, narration, captions, soundtrack, and MP4 from one topic or niche.', to: '/features' },
  { icon: 'send', title: 'Official publishing', description: 'Connect supported accounts and publish through platform APIs with review gates and retry-safe records.', to: '/integrations' },
  { icon: 'bot', title: 'Autopilot with control', description: 'Schedule recurring series, enforce daily limits, and require human approval before anything goes live.', to: '/features' },
  { icon: 'chart', title: 'Analytics you can trust', description: 'Sync available official metrics and keep simulated sandbox data clearly labeled and separated.', to: '/features' },
  { icon: 'shield-check', title: 'Security first', description: 'Encrypted OAuth tokens, HTTP-only sessions, signed webhooks, server-side secrets, and audit history.', to: '/security' },
  { icon: 'puzzle', title: 'Production-ready stack', description: 'SQLite for local evaluation and PostgreSQL with real background workers for multi-process deployment.', to: '/docs' },
];

const steps = [
  { icon: 'target', title: 'Choose a niche', description: 'Pick an evergreen category or provide a custom topic, tone, language, and duration.' },
  { icon: 'film', title: 'Review the production', description: 'Inspect the script, scenes, captions, sources, visual style, and generated media before publishing.' },
  { icon: 'calendar', title: 'Schedule or approve', description: 'Set a time, use autopilot, or require manual review. Every target gets its own publication record.' },
  { icon: 'trending-up', title: 'Learn and improve', description: 'Sync official platform metrics and use data-backed recommendations for the next campaign.' },
];

export default function Home() {
  return (
    <>
      <PageHero
        className="home-hero"
        eyebrow="AI faceless video operations"
        title={<>Turn one idea into a complete publishing workflow.</>}
        description="Faceless Studio combines script generation, original scene creation, narration, captions, scheduling, official social publishing, and analytics in one professional workspace."
        actions={<>
          <Link to="/signup" className="btn btn-primary btn-lg">Start creating <Icon name="arrow-right" size={17} /></Link>
          <Link to="/docs" className="btn btn-secondary btn-lg"><Icon name="book" size={17} /> Read the docs</Link>
        </>}
      >
        <div className="hero-trust-row">
          <span><Icon name="check-circle" size={15} /> No fake publishing claims</span>
          <span><Icon name="check-circle" size={15} /> Local mode works out of the box</span>
          <span><Icon name="check-circle" size={15} /> Official API adapters</span>
        </div>
      </PageHero>

      <Section className="section-tight">
        <div className="logo-strip" aria-label="Supported publishing platforms">
          <span>Built to connect with</span>
          <strong>YouTube Shorts</strong><strong>Instagram Reels</strong><strong>Facebook Reels</strong><strong>X Videos</strong><strong>Sandbox API</strong>
        </div>
      </Section>

      <Section eyebrow="One workspace" title="Everything a faceless content team needs" description="From the first prompt to a measured, retry-safe publication, each stage is visible and under your control." align="center">
        <div className="marketing-grid grid-3">
          {features.map((feature) => (
            <Link key={feature.title} to={feature.to} className="feature-link">
              <FeatureCard icon={feature.icon} title={feature.title} description={feature.description} />
            </Link>
          ))}
        </div>
      </Section>

      <Section className="section-alt" eyebrow="How it works" title="A repeatable workflow, not a black box" description="The platform separates generation, review, scheduling, publishing, and measurement so failures and successes are traceable." align="center">
        <StepList steps={steps} />
      </Section>

      <Section eyebrow="Designed for trust" title="Professional where it matters" description="Automation is only useful when it respects platform rules, content rights, and your approval process.">
        <div className="split-panel">
          <div className="split-copy">
            <div className="value-row"><span className="value-icon"><Icon name="shield-check" size={18} /></span><div><h3>Review before release</h3><p>Keep autopilot in draft or review mode, inspect every asset, and explicitly approve campaigns that should publish.</p></div></div>
            <div className="value-row"><span className="value-icon"><Icon name="repeat" size={18} /></span><div><h3>Duplicate prevention</h3><p>Idempotency keys, unique publication records, conditional worker claims, and retry handling prevent accidental repeat posts.</p></div></div>
            <div className="value-row"><span className="value-icon"><Icon name="key" size={18} /></span><div><h3>Secrets stay server-side</h3><p>The browser never receives provider secrets. OAuth tokens are encrypted at rest and sessions use HTTP-only cookies.</p></div></div>
            <div className="value-row"><span className="value-icon"><Icon name="activity" size={18} /></span><div><h3>Honest integration status</h3><p>Live APIs activate only when credentials, app review, scopes, payment, and public HTTPS requirements are satisfied.</p></div></div>
          </div>
          <div className="trust-card">
            <span className="eyebrow">Deployment readiness</span>
            <h3>Know exactly what is configured</h3>
            <p>The built-in readiness report explains which integrations are operational, which need server credentials, and which require provider-console approval.</p>
            <MetricStrip items={[{ value: '5', label: 'Platform adapters' }, { value: '4', label: 'Theme modes' }, { value: '24/7', label: 'Background worker' }]} />
            <Link to="/status" className="text-link">View service status <Icon name="arrow-right" size={15} /></Link>
          </div>
        </div>
      </Section>

      <Section className="section-alt" eyebrow="Built for real teams" title="Local evaluation to production deployment" description="Start without paid APIs, verify the complete workflow against the built-in sandbox, then configure external providers when ready.">
        <div className="three-up-grid">
          <div className="number-panel"><span>01</span><h3>Evaluate locally</h3><p>Use procedural art, local TTS, FFmpeg rendering, and the sandbox publisher to test the full workflow without external keys.</p></div>
          <div className="number-panel"><span>02</span><h3>Connect providers</h3><p>Add server-side credentials for AI, media, OAuth, payments, email, and webhooks. The app reports exactly what is missing.</p></div>
          <div className="number-panel"><span>03</span><h3>Operate professionally</h3><p>Run PostgreSQL, workers, HTTPS, signed webhooks, encrypted credentials, audit logs, retries, notifications, and usage limits.</p></div>
        </div>
      </Section>

      <CTASection />
    </>
  );
}
