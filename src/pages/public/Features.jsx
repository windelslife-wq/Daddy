import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, Callout, FeatureCard, PageHero, Section, StepList } from '../../components/Marketing.jsx';

const core = [
  { icon: 'pen-line', title: 'AI scriptwriting', description: 'Generate hooks, scene-by-scene narration, titles, descriptions, hashtags, and platform-aware captions.', bullets: ['Custom topic or niche', 'Tone and duration controls', 'Optional research providers'] },
  { icon: 'image', title: 'Original visual production', description: 'Create procedural scene art by default or connect an approved image model provider for generated visuals.', bullets: ['Six visual styles', '9:16, 1:1, and 16:9', 'Licensed-source guidance'] },
  { icon: 'mic', title: 'Narration and audio', description: 'Use local speech synthesis by default or configure a hosted voice provider with organization-approved voices.', bullets: ['Ten supported languages', 'Voice selection', 'Original ambient soundtrack'] },
  { icon: 'captions', title: 'Captions and subtitles', description: 'Burn captions into video where supported and export subtitle assets alongside the rendered MP4.', bullets: ['Caption timing', 'SRT export', 'Readable styling'] },
  { icon: 'clapperboard', title: 'FFmpeg rendering', description: 'Compose scenes, Ken Burns motion, transitions, narration, captions, and audio into H.264/AAC output.', bullets: ['Deterministic scene timing', 'Progress status', 'Generated asset downloads'] },
  { icon: 'shield-check', title: 'Rights and safety', description: 'Keep source references with generated projects and review content before it reaches any publishing target.', bullets: ['Human review gate', 'Source panel', 'Acceptable use policy'] },
];

const operations = [
  { icon: 'calendar', title: 'Unified calendar', description: 'See scheduled, processing, reviewed, published, and failed posts across all connected accounts.' },
  { icon: 'bot', title: 'Autopilot niches', description: 'Create recurring series with frequency, timezone, daily limits, and review requirements.' },
  { icon: 'repeat', title: 'Retry-safe publishing', description: 'Per-platform publication rows, idempotency keys, conditional job claims, and clear failure logs.' },
  { icon: 'bell', title: 'Notifications', description: 'In-app notifications plus optional email and HMAC-signed outbound webhooks with retries.' },
  { icon: 'chart', title: 'Official analytics', description: 'Sync platform metrics where APIs and permissions allow; simulated sandbox metrics are explicitly excluded from advice.' },
  { icon: 'gauge', title: 'Usage enforcement', description: 'Server-side quotas for videos, render seconds, posts, and connected accounts based on the active plan.' },
];

const steps = [
  { icon: 'target', title: 'Configure', description: 'Set niche, topic, style, language, voice, aspect ratio, duration, and tone.' },
  { icon: 'sparkles', title: 'Generate', description: 'The worker creates the plan, assets, audio, captions, and video in traceable stages.' },
  { icon: 'eye', title: 'Review', description: 'Inspect the script, scenes, source references, media, and safety notes.' },
  { icon: 'send', title: 'Publish', description: 'Schedule or send to connected official accounts with per-target status tracking.' },
  { icon: 'trending-up', title: 'Measure', description: 'Sync metrics and use data-backed suggestions to improve the next production.' },
];

export default function Features() {
  return (
    <>
      <PageHero
        eyebrow="Platform capabilities"
        title="Production tools with operation-grade controls"
        description="Every capability is connected to a working backend workflow: generation jobs, persisted assets, review states, scheduled publications, retries, notifications, and metrics."
        actions={<><Link to="/signup" className="btn btn-primary btn-lg">Try the studio <Icon name="arrow-right" size={16} /></Link><Link to="/docs" className="btn btn-secondary btn-lg">Implementation guide</Link></>}
      />
      <Section eyebrow="Creation" title="From a single prompt to a finished asset" description="The creation pipeline is modular, so local providers work by default and hosted providers can be added without exposing secrets to the browser.">
        <div className="marketing-grid grid-3">{core.map((item) => <FeatureCard key={item.title} {...item} />)}</div>
      </Section>
      <Section className="section-alt" eyebrow="Workflow" title="A production pipeline you can inspect" align="center">
        <StepList steps={steps} />
      </Section>
      <Section eyebrow="Operations" title="Built for consistent publishing" description="Automation requires more than a generate button. These controls make recurring content dependable and accountable.">
        <div className="marketing-grid grid-3">{operations.map((item) => <FeatureCard key={item.title} {...item} />)}</div>
        <Callout icon="info" title="Local mode is fully usable" tone="info">
          Procedural visuals, local narration, original ambient music, FFmpeg rendering, and sandbox publishing let you verify the entire workflow before configuring paid services.
        </Callout>
      </Section>
      <Section className="section-alt" eyebrow="Administration" title="Control center for the whole workspace" description="Administrators can manage users, plans, quotas, jobs, integration settings, failures, broadcasts, and readiness reports.">
        <div className="admin-feature-grid">
          {[
            ['users', 'User management', 'Roles, statuses, plan assignment, usage, and recent account activity.'],
            ['credit-card', 'Plans and limits', 'Server-enforced quotas with optional Stripe subscription checkout.'],
            ['list-checks', 'Background jobs', 'Job status, attempts, retries, errors, and cleanup operations.'],
            ['cpu', 'Provider readiness', 'A checklist separating local configuration from external provider approval.'],
            ['bell', 'Broadcasts', 'Send in-app notifications to all users or specific roles.'],
            ['shield', 'Security posture', 'Encrypted credentials, same-origin checks, CSP, rate limits, and audit events.'],
          ].map(([icon, title, description]) => <FeatureCard key={title} icon={icon} title={title} description={description} />)}
        </div>
      </Section>
      <CTASection title="See the complete workflow in your own workspace" description="Create a project, inspect its assets, schedule it, and verify the publication record in the sandbox." />
    </>
  );
}
