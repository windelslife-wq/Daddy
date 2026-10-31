import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, FlaskConical, Link2, ShieldCheck } from 'lucide-react';
import { BrandMark } from '../components/BrandMark.jsx';
import { post } from '../api.js';
import { Button, Card, ErrorBanner, Field, Spinner } from '../components/ui.jsx';

export default function SandboxConsent() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const state = params.get('state') || '';
  const [displayName, setDisplayName] = useState('Sandbox Channel');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(state ? null : new Error('Missing sandbox authorization state. Start the connection from the Accounts page.'));

  async function authorize(event) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await post('/api/oauth/sandbox/authorize', { state, displayName });
      window.location.assign(result.redirectUrl);
    } catch (err) {
      setError(err);
      setPending(false);
    }
  }

  return (
    <div className="public-page">
      <Card className="public-card">
        <div className="row" style={{ marginBottom: 18 }}><div className="brand-mark"><BrandMark size={38} /></div><div><strong>Film Club Lens</strong><small style={{ display: 'block' }}>Authorization request</small></div></div>
        <h1>Connect a local sandbox channel</h1>
        <p>This creates a real local HTTP publishing target on this server. It is for end-to-end testing only and does not contact any external social network.</p>
        <ErrorBanner error={error} />
        <form onSubmit={authorize} className="stack">
          <Field label="Channel display name" required><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={120} required disabled={!state} /></Field>
          <div className="banner banner-info" style={{ margin: 0 }}><ShieldCheck size={18} /><div><strong>What will happen</strong><span>The server stores an encrypted random bearer token, creates an account record, and uses it to accept MP4 uploads through `/api/sandbox/v1/posts`.</span></div></div>
          <div className="row row-wrap">
            <Button type="submit" variant="primary" disabled={!state || pending}>{pending ? <Spinner size={16} label="Connecting…" /> : <><Link2 size={16} /> Authorize sandbox channel</>}</Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/app/accounts')}>Cancel</Button>
          </div>
        </form>
        <hr />
        <div className="row row-wrap tiny"><CheckCircle2 size={14} color="var(--green)" /> No external API key required <FlaskConical size={14} color="var(--cyan)" /> Deterministic simulated metrics</div>
      </Card>
    </div>
  );
}
