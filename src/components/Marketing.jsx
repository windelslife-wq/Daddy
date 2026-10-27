import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';

export function PageHero({ eyebrow, title, description, actions, children, className = '', id }) {
  return (
    <section className={`page-hero ${className}`} id={id}>
      <div className="container page-hero-inner">
        <div className="page-hero-copy">
          {eyebrow && <span className="eyebrow"><Icon name="sparkle" size={13} /> {eyebrow}</span>}
          <h1>{title}</h1>
          {description && <p className="lead">{description}</p>}
          {actions && <div className="hero-actions">{actions}</div>}
          {children}
        </div>
        {className.includes('home-hero') && <HomeHeroVisual />}
      </div>
    </section>
  );
}

function HomeHeroVisual() {
  return (
    <div className="home-hero-visual" aria-label="Product workflow preview">
      <div className="hero-glow" />
      <div className="hero-window">
        <div className="hero-window-bar"><span /><span /><span /><strong>Studio / Campaign</strong></div>
        <div className="hero-window-body">
          <div className="hero-project-head">
            <div><small>Ready to review</small><h3>The science of deep sleep</h3></div>
            <span className="badge badge-success"><Icon name="check" size={12} /> Generated</span>
          </div>
          <div className="hero-video-tile">
            <div className="hero-video-art"><Icon name="play" size={28} /></div>
            <div className="hero-video-meta"><strong>9:16 · 45 sec · Captions on</strong><span>Original scenes · licensed bed · neural voice</span></div>
          </div>
          <div className="hero-progress"><span style={{ width: '82%' }} /></div>
          <div className="hero-publish-row">
            {['YouTube', 'Instagram', 'Facebook', 'X'].map((name) => <span key={name}>{name.charAt(0)}<small>{name}</small></span>)}
          </div>
          <div className="hero-metrics">
            <div><strong>12</strong><small>Scenes</small></div>
            <div><strong>4</strong><small>Targets</small></div>
            <div><strong>0</strong><small>Duplicates</small></div>
          </div>
        </div>
      </div>
      <div className="hero-floating-card hero-floating-card-one"><Icon name="wand-sparkles" size={16} /><span>Script + visuals ready</span></div>
      <div className="hero-floating-card hero-floating-card-two"><Icon name="shield-check" size={16} /><span>Rights checked</span></div>
    </div>
  );
}

export function Section({ eyebrow, title, description, id, children, className = '', align = 'left' }) {
  return (
    <section className={`content-section ${className}`} id={id}>
      <div className="container">
        {(title || eyebrow || description) && (
          <div className={`section-head ${align === 'center' ? 'center' : ''}`}>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function FeatureCard({ icon = 'sparkles', title, description, bullets, children, className = '' }) {
  return (
    <article className={`marketing-card ${className}`}>
      <div className="marketing-card-icon"><Icon name={icon} size={20} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {bullets?.length > 0 && <ul className="check-list">{bullets.map((bullet) => <li key={bullet}><Icon name="check" size={14} /> {bullet}</li>)}</ul>}
      {children}
    </article>
  );
}

export function StepList({ steps }) {
  return (
    <div className="step-list">
      {steps.map((step, index) => (
        <article className="step-card" key={step.title}>
          <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="step-icon"><Icon name={step.icon || 'sparkles'} size={19} /></div>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </article>
      ))}
    </div>
  );
}

export function FAQList({ items }) {
  return (
    <div className="faq-list">
      {items.map((item) => (
        <details className="faq-item" key={item.q}>
          <summary><span>{item.q}</span><Icon name="chevron-down" size={17} /></summary>
          <div className="faq-answer">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export function CTASection({ title = 'Ready to build your content engine?', description = 'Start with the local workflow, then connect official provider accounts when your apps and credentials are approved.', primary = { to: '/signup', label: 'Create free account' }, secondary = { to: '/contact', label: 'Talk to us' } }) {
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <div><span className="eyebrow">Get started</span><h2>{title}</h2><p>{description}</p></div>
        <div className="hero-actions">
          {primary && <Link to={primary.to} className="btn btn-primary btn-lg">{primary.label} <Icon name="arrow-right" size={16} /></Link>}
          {secondary && <Link to={secondary.to} className="btn btn-secondary btn-lg">{secondary.label}</Link>}
        </div>
      </div>
    </section>
  );
}

export function MetricStrip({ items }) {
  return <div className="metric-strip">{items.map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>;
}

export function Callout({ icon = 'info', title, children, tone = 'info' }) {
  return (
    <aside className={`marketing-callout ${tone}`}>
      <Icon name={icon} size={19} />
      <div>{title && <strong>{title}</strong>}<div>{children}</div></div>
    </aside>
  );
}

export function Prose({ sections, updated }) {
  return (
    <div className="prose-layout">
      <aside className="prose-toc" aria-label="On this page">
        <strong>On this page</strong>
        {sections.map((section, index) => <a key={section.title} href={`#section-${index + 1}`}>{section.title}</a>)}
      </aside>
      <article className="prose">
        {updated && <p className="prose-updated">Last updated: {updated}</p>}
        {sections.map((section, index) => (
          <section key={section.title} id={`section-${index + 1}`}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.bullets?.length > 0 && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
          </section>
        ))}
      </article>
    </div>
  );
}
