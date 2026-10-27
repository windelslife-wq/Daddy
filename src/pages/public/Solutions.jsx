import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, Callout, PageHero, Section } from '../../components/Marketing.jsx';

const solutions = [
  {
    icon: 'video', label: 'Independent creators', title: 'Publish consistently without living in an editor',
    description: 'Turn a niche into a repeatable series. Generate scripts and videos, review them on your own time, and queue posts across channels.',
    points: ['Evergreen niche calendars', 'Approval before publishing', 'Per-platform captions and metadata', 'Performance feedback'],
  },
  {
    icon: 'building', label: 'Agencies and studios', title: 'Manage multiple content series with clear controls',
    description: 'Standardize production settings, enforce quotas, and keep client content in review until an operator approves it.',
    points: ['Reusable niche configuration', 'Usage and plan limits', 'Publication history', 'Audit and failure visibility'],
  },
  {
    icon: 'graduation-cap', label: 'Educators', title: 'Transform lessons into short visual explainers',
    description: 'Use custom topics, educational tone, multilingual narration, and captions to make short-form educational content.',
    points: ['Ten languages', 'Scene-by-scene scripts', 'Subtitle export', 'Source references for research mode'],
  },
  {
    icon: 'newspaper', label: 'Publishers', title: 'Scale verified, rights-conscious content operations',
    description: 'Keep source notes alongside generated assets and require editorial approval before any external publication.',
    points: ['Review gates', 'Research provider options', 'Traceable project timeline', 'Acceptable use controls'],
  },
  {
    icon: 'store', label: 'Businesses', title: 'Create product stories and social updates at pace',
    description: 'Build branded short-form campaigns with configurable visual styles, voice, aspect ratios, and schedules.',
    points: ['Brand-ready aspect ratios', 'Campaign calendar', 'Connected official accounts', 'Analytics sync'],
  },
  {
    icon: 'code', label: 'Developers', title: 'Evaluate a complete automation stack locally',
    description: 'Use the built-in sandbox provider and simulator-friendly configuration to test OAuth, publishing, metrics, webhooks, and jobs.',
    points: ['Local HTTP publishing target', 'Signed webhook contract', 'Configurable provider endpoints', 'Integration readiness CLI'],
  },
];

export default function Solutions() {
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        title="One content engine for many kinds of teams"
        description="Faceless Studio adapts to creators, agencies, educators, publishers, businesses, and engineering teams through configurable niches, review rules, provider settings, and publishing targets."
        actions={<><Link to="/signup" className="btn btn-primary btn-lg">Build your workflow <Icon name="arrow-right" size={16} /></Link><Link to="/contact" className="btn btn-secondary btn-lg">Discuss a use case</Link></>}
      />
      <Section eyebrow="Use cases" title="Workflows mapped to real goals" description="Each solution uses the same reliable pipeline, with settings that match the team’s operating model." align="center">
        <div className="solutions-grid">
          {solutions.map((item, index) => (
            <article className={`solution-card ${index % 2 === 0 ? 'solution-card-primary' : ''}`} key={item.title}>
              <div className="solution-top"><span className="marketing-card-icon"><Icon name={item.icon} size={20} /></span><small>{item.label}</small></div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <ul className="check-list">{item.points.map((point) => <li key={point}><Icon name="check" size={14} /> {point}</li>)}</ul>
            </article>
          ))}
        </div>
      </Section>
      <Section className="section-alt" eyebrow="Responsible automation" title="Scale without losing editorial control">
        <Callout icon="shield-check" title="Human review is a first-class workflow" tone="success">
          Autopilot can generate and prepare content, but review-required niches keep publications waiting for explicit approval. This helps teams comply with platform rules and their own editorial standards.
        </Callout>
        <div className="control-grid">
          <div><Icon name="target" size={20} /><h3>Daily posting limits</h3><p>Cap how many videos an autopilot niche can create each day.</p></div>
          <div><Icon name="eye" size={20} /><h3>Approval states</h3><p>Keep every publication visible as draft, reviewing, queued, published, or failed.</p></div>
          <div><Icon name="repeat" size={20} /><h3>Duplicate prevention</h3><p>Retries use stable identifiers and conditional job claims to avoid repeat posts.</p></div>
          <div><Icon name="file-text" size={20} /><h3>Rights notes</h3><p>Research sources and asset provenance stay available for review.</p></div>
        </div>
      </Section>
      <CTASection title="Bring your content process into one workspace" description="Start with a single niche, validate the full pipeline in sandbox mode, and expand when you are ready." />
    </>
  );
}
