import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, CreditCard, Crown, ExternalLink, Sparkles, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { get, post } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, InfoBanner, PageHeader, Spinner, StatusBadge, useToast } from '../components/ui.jsx';

export default function Billing() {
  const { user, refresh } = useAuth();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(null);
  const { data, loading, error, reload } = useLoad(() => Promise.all([get('/api/billing/plans'), get('/api/settings/usage')]).then(([plans, usage]) => ({ ...plans, ...usage })), []);
  const plans = data?.plans || [];
  const currentPlan = data?.plan?.id || user?.plan_id;
  const stripeConfigured = plans.some((plan) => plan.stripeConfigured);
  const sessionId = params.get('session_id');
  const billingStatus = params.get('billing');

  useEffect(() => {
    if (!sessionId || billingStatus !== 'success') return;
    (async () => {
      try {
        await get(`/api/billing/checkout-session/${encodeURIComponent(sessionId)}`);
        await refresh();
        showToast('Subscription status verified.', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    })();
  }, [sessionId, billingStatus, refresh, showToast]);

  async function choosePlan(plan) {
    setBusy(plan.id);
    try {
      const result = await post('/api/billing/checkout', { planId: plan.id });
      if (result.updated) {
        await refresh();
        showToast(`Switched to ${plan.name}.`, 'success');
        await reload({ silent: true });
      } else if (result.url?.startsWith('/')) {
        window.location.assign(result.url);
      } else if (result.url) {
        window.location.href = result.url;
      } else throw new Error('Checkout did not return a URL.');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader eyebrow="Plans & billing" title="Choose your publishing scale" description="Plans enforce real server-side usage quotas. Stripe checkout activates only when server keys and Price IDs are configured." actions={<Button to="/app/settings" variant="ghost">Usage details</Button>} />
      {billingStatus === 'success' && <div className="banner banner-success"><Check size={18} /><div><strong>Checkout complete</strong><span>Your subscription is being verified. Plan limits update after confirmation.</span></div><Button size="sm" variant="ghost" onClick={() => setParams({})}>Dismiss</Button></div>}
      {billingStatus === 'cancelled' && <div className="banner banner-warning"><AlertCircle size={18} /><div><strong>Checkout cancelled</strong><span>No charge was made and your plan is unchanged.</span></div><Button size="sm" variant="ghost" onClick={() => setParams({})}>Dismiss</Button></div>}
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      {!stripeConfigured && <InfoBanner icon={CreditCard}><strong>Stripe is not configured on this server.</strong><span> Free plan changes work locally. Paid checkout requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and a Stripe Price ID on each paid plan.</span></InfoBanner>}
      {loading && !plans.length ? <div className="full-loader"><Spinner size={20} label="Loading plans…" /></div> : plans.length === 0 ? <Card><EmptyState icon={Crown} title="No plans available" description="An administrator must create plans in the admin panel." /></Card> : (
        <div className="plan-grid">
          {plans.map((plan, index) => {
            const current = plan.id === currentPlan;
            const paid = Number(plan.price_cents) > 0;
            const checkoutDisabled = Boolean(busy) || current || (paid && (!stripeConfigured || !plan.stripe_price_id));
            return (
              <div className={`plan-card ${index === 2 ? 'featured' : ''} ${current ? 'current' : ''}`} key={plan.id}>
                {index === 2 && <div className="plan-ribbon">Most popular</div>}
                <div className="row-between"><span className="badge badge-info">{plan.name}</span>{current && <StatusBadge status="connected" label="Current" />}</div>
                <div className="plan-price">{plan.price_cents === 0 ? 'Free' : `$${(Number(plan.price_cents) / 100).toFixed(0)}`}<span>{paid ? ` / ${plan.interval}` : ' forever'}</span></div>
                <p className="tiny">{plan.features?.[0] || 'AI faceless video creation and publishing.'}</p>
                <ul className="plan-features">
                  {(plan.features || []).map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}
                  <li><Check size={14} /> {plan.max_videos_month} videos / month</li>
                  <li><Check size={14} /> {plan.max_render_seconds_month} render seconds</li>
                  <li><Check size={14} /> {plan.max_posts_month} publications</li>
                  <li><Check size={14} /> {plan.max_accounts} connected accounts</li>
                </ul>
                <Button variant={current ? 'secondary' : index === 2 ? 'primary' : 'ghost'} className="btn-block" disabled={checkoutDisabled} onClick={() => choosePlan(plan)}>
                  {busy === plan.id ? <Spinner size={15} /> : current ? 'Current plan' : paid ? <><CreditCard size={15} /> Choose {plan.name}</> : <><Zap size={15} /> Switch to free</>}
                </Button>
                {paid && !plan.stripe_price_id && <small className="tiny" style={{ textAlign: 'center', marginTop: 8 }}>Admin must set Stripe Price ID.</small>}
              </div>
            );
          })}
        </div>
      )}
      <Card style={{ marginTop: 20 }} title="How billing works" icon={Sparkles}>
        <div className="grid grid-3">
          <div><strong>Server-side quotas</strong><p className="tiny">Every generation and publishing attempt checks the current plan before work is queued.</p></div>
          <div><strong>Signed Stripe webhook</strong><p className="tiny">Plan changes are applied after checkout completion or a verified webhook event with replay protection.</p></div>
          <div><strong>No fake charges</strong><p className="tiny">Without Stripe credentials, paid buttons are disabled and the API returns a clear configuration error.</p></div>
        </div>
      </Card>
    </>
  );
}
