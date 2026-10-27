import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, Callout, PageHero, Section } from '../../components/Marketing.jsx';

const principles = [
  { icon: 'eye', title: 'Transparency over illusion', description: 'Provider readiness, simulated metrics, credential requirements, and external app-review tasks are stated plainly.' },
  { icon: 'shield-check', title: 'Safety through review', description: 'Automation should assist human judgment, not remove accountability for what gets published.' },
  { icon: 'key', title: 'Secrets stay secret', description: 'API keys and OAuth tokens live on the server, are encrypted at rest, and are never shipped to the browser.' },
  { icon: 'scale', title: 'Respect platform rules', description: 'Official APIs, scoped permissions, licensed assets, rate limits, community policies, and copyright matter.' },
  { icon: 'repeat', title: 'Operations are part of the product', description: 'Retries, duplicate prevention, job state, webhooks, notifications, and audit history are first-class features.' },
  { icon: 'puzzle', title: 'Open to real integrations', description: 'Provider endpoints can be configured for testing while production enforces HTTPS and approved secrets.' },
];

export default function About() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Build creative automation people can actually trust"
        description="Faceless Studio was designed as a complete content operations system, not a collection of attractive buttons. Every claim in the interface maps to a real workflow, a configuration requirement, or an explicitly labeled local simulation."
        actions={<><Link to="/features" className="btn btn-primary btn-lg">Explore the platform <Icon name="arrow-right" size={16} /></Link><Link to="/security" className="btn btn-secondary btn-lg">Read security approach</Link></>}
      />
      <Section eyebrow="Our approach" title="Principles that shape the platform" description="These principles influence the architecture, user experience, documentation, and integration boundaries." align="center">
        <div className="marketing-grid grid-3">{principles.map((item) => <div className="principle-card" key={item.title}><span className="marketing-card-icon"><Icon name={item.icon} size={20} /></span><h3>{item.title}</h3><p>{item.description}</p></div>)}</div>
      </Section>
      <Section className="section-alt" eyebrow="Architecture" title="A complete stack with clear boundaries">
        <div className="architecture-grid">
          <div className="architecture-card"><span>01</span><h3>React workspace</h3><p>A responsive studio for creation, review, scheduling, account management, analytics, billing, and administration.</p></div>
          <div className="architecture-card"><span>02</span><h3>Express API</h3><p>Validated endpoints, same-origin protection, rate limits, HTTP-only sessions, encrypted credentials, and audit logs.</p></div>
          <div className="architecture-card"><span>03</span><h3>Background worker</h3><p>Generation, rendering, publishing, metrics sync, scheduled content, retries, cleanup, and webhook delivery.</p></div>
          <div className="architecture-card"><span>04</span><h3>Data and media</h3><p>SQLite for evaluation, PostgreSQL for production, signed local media URLs, and isolated generated assets.</p></div>
          <div className="architecture-card"><span>05</span><h3>Official providers</h3><p>OAuth, publishing, metrics, AI, image, voice, payment, email, and webhook adapters with explicit readiness checks.</p></div>
          <div className="architecture-card"><span>06</span><h3>Verification tooling</h3><p>Unit tests, provider simulators, E2E workflow tests, visual QA, and a deployment readiness report.</p></div>
        </div>
      </Section>
      <Section eyebrow="Responsible AI" title="Assistance, provenance, and review">
        <Callout icon="info" title="Generated content still needs a human decision" tone="info">
          AI-generated scripts and visuals can be inaccurate or unsuitable. Review factual claims, rights, brand suitability, and platform policies before approving any publication. Research mode keeps source references in the project timeline.
        </Callout>
        <div className="responsibility-grid">
          <div><Icon name="file-text" size={20} /><h3>Source visibility</h3><p>Research results are stored with the project so editors can inspect supporting material.</p></div>
          <div><Icon name="music" size={20} /><h3>Original audio</h3><p>Local mode generates an original ambient bed rather than using copyrighted commercial music.</p></div>
          <div><Icon name="image" size={20} /><h3>Asset guidance</h3><p>The UI distinguishes procedural art from hosted image models and reminds operators to use licensed material.</p></div>
          <div><Icon name="shield" size={20} /><h3>Policy controls</h3><p>Acceptable use, content policy settings, review gates, and publication logs support responsible operations.</p></div>
        </div>
      </Section>
      <CTASection title="See the difference a complete workflow makes" description="Start locally, inspect every stage, and decide when to connect external services." />
    </>
  );
}
