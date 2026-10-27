import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../../api.js';
import { SITE } from '../../config/site.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { ErrorBanner, Spinner } from '../../components/ui.jsx';
import { CTASection, FAQList, PageHero, Section } from '../../components/Marketing.jsx';

const TOPICS = [
  { id: 'sales', label: 'Plans and team setup' },
  { id: 'support', label: 'Product support' },
  { id: 'integrations', label: 'Integrations and provider approval' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'security', label: 'Security or privacy' },
  { id: 'other', label: 'Something else' },
];

const INITIAL = { name: '', email: '', topic: 'sales', message: '', website: '' };

export default function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (!user) return;
    setForm((current) => ({ ...current, name: current.name || user.name || '', email: current.email || user.email || '' }));
  }, [user]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (form.name.trim().length < 2) return setError(new Error('Please enter your name.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError(new Error('Please enter a valid email address.'));
    if (form.message.trim().length < 10) return setError(new Error('Please add at least 10 characters so we can understand your request.'));
    setBusy(true);
    try {
      const result = await post('/api/contact', {
        name: form.name.trim(), email: form.email.trim(), topic: form.topic,
        message: form.message.trim(), website: form.website,
      });
      setReference(result.reference || '');
      setSent(true);
      setForm({ ...INITIAL, name: user?.name || '', email: user?.email || '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the team behind the workflow"
        description="Ask about deployment, provider approval, team plans, integrations, security, or a specific content operation. Messages are stored and routed to administrators through the platform’s notification system."
        actions={<a href={`mailto:${SITE.email}`} className="btn btn-secondary btn-lg"><Icon name="mail" size={16} /> {SITE.email}</a>}
      />
      <Section className="contact-section" eyebrow="Send a message" title="We’ll route it to the right person" description="For security-sensitive reports, include an affected URL and a safe way to contact you. Please do not send API keys or passwords.">
        <div className="contact-grid">
          <div className="contact-aside">
            <div className="contact-card"><span className="marketing-card-icon"><Icon name="headphones" size={20} /></span><h3>Product support</h3><p>Need help with generation, publishing, billing, or account settings? Start with the Help Center or send the details here.</p><Link to="/help" className="text-link">Browse help topics <Icon name="arrow-right" size={14} /></Link></div>
            <div className="contact-card"><span className="marketing-card-icon"><Icon name="plug" size={20} /></span><h3>Integration readiness</h3><p>Official providers may require app review, verified domains, scopes, paid accounts, and public HTTPS callbacks.</p><Link to="/integrations" className="text-link">See requirements <Icon name="arrow-right" size={14} /></Link></div>
            <div className="contact-card"><span className="marketing-card-icon"><Icon name="shield-check" size={20} /></span><h3>Security</h3><p>Report suspected vulnerabilities to <a href={`mailto:${SITE.securityEmail}`}>{SITE.securityEmail}</a>. Rotation of credentials should happen before sharing any diagnostic data.</p></div>
          </div>
          <div className="contact-form-wrap">
            {sent ? (
              <div className="contact-success" role="status">
                <span className="success-icon"><Icon name="mail-check" size={28} /></span>
                <h2>Message received</h2>
                <p>Your request has been saved and administrators have been notified. We’ll reply to <strong>{form.email || 'your email'}</strong>.</p>
                {reference && <code>Reference: {reference}</code>}
                <button type="button" className="btn btn-secondary" onClick={() => setSent(false)}>Send another message</button>
              </div>
            ) : (
              <form className="contact-form" onSubmit={submit} noValidate>
                <ErrorBanner error={error} />
                <div className="form-row-2">
                  <label className="form-label">Your name
                    <input className="input" value={form.name} onChange={update('name')} autoComplete="name" placeholder="Alex Morgan" required minLength={2} maxLength={180} />
                  </label>
                  <label className="form-label">Email address
                    <input className="input" type="email" value={form.email} onChange={update('email')} autoComplete="email" placeholder="you@company.com" required maxLength={320} />
                  </label>
                </div>
                <label className="form-label">What is this about?
                  <select className="input select" value={form.topic} onChange={update('topic')}>
                    {TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
                  </select>
                </label>
                <label className="form-label">Message
                  <textarea className="input textarea" value={form.message} onChange={update('message')} placeholder="Tell us what you are building and where you need help…" required minLength={10} maxLength={5000} rows={7} />
                  <span className="field-hint">{form.message.length}/5000 · Never include passwords or API keys.</span>
                </label>
                <label className="honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={update('website')} /></label>
                <div className="contact-form-foot">
                  <p>By sending this form you agree to our <Link to="/privacy">Privacy Policy</Link>.</p>
                  <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? <><Spinner size={16} /> Sending…</> : <>Send message <Icon name="send" size={16} /></>}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </Section>
      <Section className="section-alt" eyebrow="Before you write" title="Quick answers" align="center">
        <FAQList items={[
          { q: 'Can you configure my social API apps for me?', a: <>Provider app creation, app review, domain verification, and paid account access happen in each provider’s console. We can explain the requirements; see <Link to="/integrations">integrations</Link>.</> },
          { q: 'Where do I report a vulnerability?', a: <>Use security as the topic above or email <a href={`mailto:${SITE.securityEmail}`}>{SITE.securityEmail}</a>. Do not include live credentials.</> },
          { q: 'Is there a self-hosted setup guide?', a: <>Yes. The <Link to="/docs">documentation</Link> covers local setup, environment variables, callback URLs, workers, and production checks.</> },
        ]} />
      </Section>
      <CTASection title="Prefer to explore first?" description="The public status page and documentation show the platform’s current readiness and deployment requirements." primary={{ to: '/docs', label: 'Read documentation' }} secondary={{ to: '/status', label: 'View status' }} />
    </>
  );
}
