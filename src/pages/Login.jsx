import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clapperboard, Globe2, LockKeyhole, Sparkles, WandSparkles, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, ErrorBanner, Field, Spinner, useToast } from '../components/ui.jsx';

export default function Login() {
  const { login, register, options, providerStatus } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const demo = providerStatus?.demoCredentials;

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      showToast(mode === 'login' ? 'Welcome back.' : 'Your workspace is ready.', 'success');
      navigate(location.state?.from || '/app', { replace: true });
    } catch (err) {
      setError(err);
    } finally { setPending(false); }
  }

  async function useDemo() {
    if (!demo?.email) { setError(new Error('No demo account is seeded on this server.')); return; }
    if (!demo.password) { setError(new Error('Demo password is hidden in production. Use the credentials from the deployment README.')); return; }
    const credentials = { ...form, email: demo.email, password: demo.password };
    setForm(credentials);
    setPending(true);
    setError(null);
    try {
      await login(demo.email, demo.password);
      showToast('Signed in to the preview workspace.', 'success');
      navigate('/app', { replace: true });
    } catch (err) { setError(err); }
    finally { setPending(false); }
  }

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div><strong>Faceless Studio</strong><span>AI content automation</span></div>
        </div>
        <div className="auth-hero">
          <div className="eyebrow">Create once. Publish everywhere.</div>
          <h1>Turn one idea into a complete faceless video campaign.</h1>
          <p>Generate original scripts, scene art, narration, subtitles, platform captions, and scheduled posts — then publish through official APIs or the built-in sandbox channel.</p>
          <div className="auth-highlights">
            <div className="auth-highlight"><Clapperboard size={18} /><strong>Real MP4 rendering</strong><span>FFmpeg, burned-in captions, original music, and subtitle files.</span></div>
            <div className="auth-highlight"><Globe2 size={18} /><strong>Official integrations</strong><span>Facebook, Instagram, YouTube, and X OAuth adapters.</span></div>
            <div className="auth-highlight"><WandSparkles size={18} /><strong>Autopilot-ready</strong><span>Niches, schedules, review gates, retries, and analytics.</span></div>
            <div className="auth-highlight"><LockKeyhole size={18} /><strong>Secret-safe</strong><span>Encrypted tokens, server-side keys, RBAC, and quotas.</span></div>
          </div>
        </div>
        <div className="auth-footer">Built for original, policy-aware content. External AI and social APIs activate only with valid credentials.</div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-card">
          <div className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Get started'}</div>
          <h2>{mode === 'login' ? 'Sign in to your studio' : 'Create your workspace'}</h2>
          <p>{mode === 'login' ? 'Manage generation jobs, connected accounts, schedules, and performance.' : 'Start with the free plan. Connect accounts whenever you are ready.'}</p>
          <ErrorBanner error={error} />
          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <Field label="Full name" required><input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Alex Creator" minLength={2} required /></Field>
            )}
            <Field label="Email address" required><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@example.com" required /></Field>
            <Field label="Password" required hint={mode === 'register' ? 'Use at least 10 characters.' : undefined}><input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="••••••••••" minLength={mode === 'register' ? 10 : 1} required /></Field>
            <Button type="submit" size="lg" variant="primary" disabled={pending} className="btn-block">
              {pending ? <Spinner size={17} label="Please wait…" /> : <>{mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></>}
            </Button>
          </form>
          {demo?.email && (
            <>
              <div className="auth-divider">or</div>
              <Button variant="secondary" className="btn-block" onClick={useDemo} disabled={pending || !demo.password}>
                <Zap size={16} /> {demo.password ? 'Enter preview workspace' : 'Demo password hidden'}
              </Button>
              {demo.password && <small className="tiny" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>{demo.email} · {demo.password}</small>}
            </>
          )}
          <div className="auth-switch">
            {mode === 'login' ? 'New to Faceless Studio?' : 'Already have an account?'}{' '}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </div>
          <div className="row row-wrap" style={{ justifyContent: 'center', marginTop: 20, gap: 14 }}>
            <span className="tiny"><CheckCircle2 size={13} color="var(--green)" /> Secure sessions</span>
            <span className="tiny"><CheckCircle2 size={13} color="var(--green)" /> Encrypted tokens</span>
          </div>
        </div>
      </section>
    </div>
  );
}
