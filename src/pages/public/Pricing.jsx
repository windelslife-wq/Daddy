import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, Callout, FAQList, PageHero, Section } from '../../components/Marketing.jsx';
import { ErrorBanner, Spinner } from '../../components/ui.jsx';

const PLAN_NOTES = {
  free: 'For evaluating the complete local workflow.',
  starter: 'For a single creator publishing consistently.',
  creator: 'For growing channels and recurring series.',
  scale: 'For teams and high-volume publishing operations.',
};

function formatPrice(cents) {
  const amount = Number(cents || 0) / 100;
  return amount === 0 ? '$0' : `$${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

export default function Pricing() {
  const { authenticated } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);

  useEffect(() => {
    let alive = true;
    get('/api/billing/plans')
      .then((data) => {
        if (!alive) return;
        const next = data?.plans || [];
        setPlans(next);
        setStripeConfigured(Boolean(next.some((plan) => plan.stripeConfigured)));
        setError(null);
      })
      .catch((err) => { if (alive) setError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <PageHero
        eyebrow="Plans & pricing"
        title="Simple plans with real, server-enforced limits"
        description="Start with the free local workflow. Upgrade when you need more videos, render time, connected accounts, and publications. Paid checkout activates only when Stripe is configured."
        actions={<><Link to={authenticated ? '/app/billing' : '/signup'} className="btn btn-primary btn-lg">{authenticated ? 'Manage plan' : 'Create free account'} <Icon name="arrow-right" size={16} /></Link><Link to="/contact" className="btn btn-secondary btn-lg">Ask about a team plan</Link></>}
      />
      <Section className="section-tight" eyebrow="Live plans" title="Choose the right publishing scale" description="Plans are loaded from the server database, so administrators can adjust limits without changing frontend code." align="center">
        {loading && <div className="full-loader"><Spinner size={20} label="Loading plans…" /></div>}
        <ErrorBanner error={error} onRetry={() => { setLoading(true); setError(null); get('/api/billing/plans').then((data) => { setPlans(data.plans || []); setStripeConfigured(Boolean((data.plans || []).some((plan) => plan.stripeConfigured))); }).catch(setError).finally(() => setLoading(false)); }} />
        {!loading && !error && (
          <div className="pricing-grid">
            {plans.map((plan) => {
              const featured = plan.id === 'creator';
              const cta = authenticated ? '/app/billing' : '/signup';
              return (
                <article className={`pricing-card ${featured ? 'featured' : ''}`} key={plan.id}>
                  {featured && <span className="pricing-ribbon">Most popular</span>}
                  <div className="pricing-card-head">
                    <span className="pricing-icon"><Icon name={plan.id === 'free' ? 'sparkles' : plan.id === 'scale' ? 'rocket' : 'zap'} size={20} /></span>
                    <h2>{plan.name}</h2>
                    <p>{PLAN_NOTES[plan.id] || 'A configurable workspace plan.'}</p>
                  </div>
                  <div className="pricing-price"><strong>{formatPrice(plan.price_cents)}</strong><span>/ month</span></div>
                  <Link to={cta} className={`btn ${featured ? 'btn-primary' : 'btn-secondary'} pricing-cta`}>{plan.price_cents === 0 ? 'Start free' : authenticated ? 'Choose in billing' : 'Get started'} <Icon name="arrow-right" size={15} /></Link>
                  <ul className="pricing-features">
                    {(plan.features?.length ? plan.features : ['Configurable usage limits']).map((feature) => <li key={feature}><Icon name="check" size={15} /> {feature}</li>)}
                    <li><Icon name="check" size={15} /> {Number(plan.max_accounts || 0)} connected accounts</li>
                    <li><Icon name="check" size={15} /> {Number(plan.max_posts_month || 0).toLocaleString()} posts / month</li>
                  </ul>
                  <div className="pricing-foot">{(plan.currency || 'USD')} · billed {(plan.interval || 'month')}ly</div>
                </article>
              );
            })}
          </div>
        )}
        <Callout icon="credit-card" title={stripeConfigured ? 'Stripe checkout is configured' : 'Paid checkout requires server configuration'} tone={stripeConfigured ? 'success' : 'info'}>
          {stripeConfigured
            ? 'Administrators must still attach a Stripe Price ID to each paid plan before checkout can start.'
            : 'Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PUBLIC_BASE_URL, and a Stripe Price ID for each paid plan. Free plan changes work without these settings.'}
        </Callout>
      </Section>
      <Section className="section-alt" eyebrow="What is included" title="Every plan includes the complete core product" description="Quotas change by plan; the underlying workflow, security model, and local provider options do not.">
        <div className="included-grid">
          {[
            ['wand-sparkles', 'AI script and video workflow'], ['film', 'FFmpeg MP4 rendering'], ['captions', 'Captions and subtitle export'],
            ['calendar', 'Scheduling and calendar'], ['repeat', 'Retry-safe publication records'], ['chart', 'Analytics and recommendations'],
            ['shield-check', 'Encrypted credentials'], ['cpu', 'Integration readiness report'],
          ].map(([icon, label]) => <div key={label}><Icon name={icon} size={19} /><span>{label}</span></div>)}
        </div>
      </Section>
      <Section eyebrow="Billing FAQ" title="Common questions" align="center">
        <FAQList items={[
          { q: 'Are limits enforced in the browser?', a: 'No. Limits are checked server-side before generation, rendering, account connection, and publishing. The UI only displays the current usage.' },
          { q: 'Can I test the platform without paid AI or social APIs?', a: 'Yes. Local procedural visuals, local narration, original ambient music, FFmpeg rendering, and the sandbox publisher work by default.' },
          { q: 'What happens if a Stripe payment fails?', a: 'The signed Stripe webhook records the relevant subscription or invoice event. Configure the webhook exactly at PUBLIC_BASE_URL/api/billing/webhook.' },
          { q: 'Can administrators change plans?', a: 'Yes. The admin control center can create plans, update limits, and attach Stripe Price IDs. Restart is not required for database-backed plan changes.' },
        ]} />
      </Section>
      <CTASection title="Start with the free local workflow" description="Verify the complete pipeline, then connect official providers and upgrade when your publishing needs grow." />
    </>
  );
}
