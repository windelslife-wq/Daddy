import React, { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { SITE } from '../config/site.js';
import { Icon } from '../components/Icon.jsx';
import { Footer } from '../components/Footer.jsx';
import { ThemeSwitcher } from '../components/ThemeSwitcher.jsx';
import { ErrorBanner, Spinner } from '../components/ui.jsx';

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_CLASSES = ['empty', 'weak', 'fair', 'good', 'strong'];

function passwordScore(value) {
  let score = 0;
  if (value.length >= 10) score += 1;
  if (value.length >= 14) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

function safeDestination(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/app';
  if (value === '/login' || value === '/signup' || value === '/') return '/app';
  return value;
}

function PasswordToggle({ visible, onClick }) {
  return (
    <button className="password-toggle" type="button" onClick={onClick} aria-label={visible ? 'Hide password' : 'Show password'}>
      <Icon name={visible ? 'eye-off' : 'eye'} size={17} />
    </button>
  );
}

export default function AuthPage({ mode = 'login' }) {
  const { authenticated, loading, login, register, providerStatus } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isSignup = mode === 'signup';
  const destination = safeDestination(searchParams.get('next') || location.state?.from || '/app');

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', accepted: false });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const score = useMemo(() => passwordScore(form.password), [form.password]);
  const demo = providerStatus?.demoCredentials;

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(new Error('Enter a valid email address.'));
    if (!form.password) return setError(new Error('Enter your password.'));
    if (isSignup) {
      if (form.name.trim().length < 2) return setError(new Error('Enter your full name.'));
      if (form.password.length < 10) return setError(new Error('Use a password with at least 10 characters.'));
      if (form.password !== form.confirm) return setError(new Error('The passwords do not match.'));
      if (!form.accepted) return setError(new Error('Please accept the Terms of Service and Privacy Policy.'));
    }
    setBusy(true);
    try {
      if (isSignup) await register(form.name.trim(), email, form.password);
      else await login(email, form.password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const useDemo = async () => {
    if (!demo?.email || !demo?.password) return;
    setError(null);
    setDemoBusy(true);
    try {
      await login(demo.email, demo.password);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setDemoBusy(false);
    }
  };

  if (!loading && authenticated) return <Navigate to={destination} replace />;

  return (
    <div className="auth-site">
      <a className="skip-link" href="#auth-main">Skip to form</a>
      <header className="auth-header">
        <div className="container auth-header-inner">
          <Link to="/" className="brand"><span className="brand-mark"><Icon name="sparkles" size={18} /></span><span className="brand-copy"><strong>{SITE.name}</strong><small>Creator operations</small></span></Link>
          <div className="auth-header-actions">
            <Link to="/" className="auth-back-link"><Icon name="arrow-left" size={15} /> Back to website</Link>
            <ThemeSwitcher compact />
          </div>
        </div>
      </header>
      <main id="auth-main" className="auth-shell">
        <aside className="auth-aside">
          <div className="auth-aside-glow" />
          <div className="auth-aside-content">
            <span className="eyebrow">Your creative operating system</span>
            <h1>Create with AI.<br />Publish with confidence.</h1>
            <p>One workspace for scripting, original visuals, narration, captions, review, scheduling, official publishing, and analytics.</p>
            <div className="auth-highlight-grid">
              <div><Icon name="shield-check" size={19} /><strong>Review gates</strong><span>Approve content before it goes live.</span></div>
              <div><Icon name="repeat" size={19} /><strong>Retry-safe</strong><span>Duplicate prevention built into publishing.</span></div>
              <div><Icon name="key" size={19} /><strong>Secure by design</strong><span>Secrets and tokens stay server-side.</span></div>
              <div><Icon name="cpu" size={19} /><strong>Local mode</strong><span>Verify the workflow without paid APIs.</span></div>
            </div>
            <div className="auth-aside-footer"><Icon name="check-circle" size={16} /> Built for original content and official APIs.</div>
          </div>
        </aside>
        <section className="auth-panel">
          <div className="auth-card">
            <div className="auth-card-head">
              <span className="eyebrow">{isSignup ? 'Start building' : 'Welcome back'}</span>
              <h2>{isSignup ? 'Create your workspace' : 'Sign in to your studio'}</h2>
              <p>{isSignup ? 'Set up your account and validate the complete local workflow in minutes.' : 'Continue your projects, schedules, and publishing operations.'}</p>
            </div>
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <Link to={`/login${searchParams.get('next') ? `?next=${encodeURIComponent(searchParams.get('next'))}` : ''}`} role="tab" aria-selected={!isSignup} className={!isSignup ? 'active' : ''}><Icon name="login" size={15} /> Sign in</Link>
              <Link to="/signup" role="tab" aria-selected={isSignup} className={isSignup ? 'active' : ''}><Icon name="user-plus" size={15} /> Create account</Link>
            </div>
            <ErrorBanner error={error} />
            <form className="auth-form" onSubmit={submit} noValidate>
              {isSignup && (
                <label className="form-label">Full name
                  <span className="input-with-icon"><Icon name="user" size={16} /><input className="input" value={form.name} onChange={update('name')} autoComplete="name" placeholder="Alex Morgan" required minLength={2} maxLength={180} /></span>
                </label>
              )}
              <label className="form-label">Email address
                <span className="input-with-icon"><Icon name="mail" size={16} /><input className="input" type="email" value={form.email} onChange={update('email')} autoComplete="email" placeholder="you@company.com" required maxLength={320} /></span>
              </label>
              <label className="form-label">{isSignup ? 'Create password' : 'Password'}
                <span className="input-with-icon"><Icon name="lock" size={16} /><input className="input" type={showPassword ? 'text' : 'password'} value={form.password} onChange={update('password')} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 10 characters' : 'Enter your password'} required minLength={isSignup ? 10 : 1} maxLength={128} /><PasswordToggle visible={showPassword} onClick={() => setShowPassword((value) => !value)} /></span>
              </label>
              {isSignup && (
                <>
                  <div className={`password-strength ${STRENGTH_CLASSES[score]}`}>
                    <div className="strength-bars">{[1, 2, 3, 4].map((step) => <span key={step} className={score >= step ? 'filled' : ''} />)}</div>
                    <span>{form.password ? STRENGTH_LABELS[score] : 'Use at least 10 characters'}</span>
                  </div>
                  <div className="password-rules">
                    <span className={form.password.length >= 10 ? 'met' : ''}><Icon name="check" size={12} /> 10+ characters</span>
                    <span className={/[a-z]/.test(form.password) && /[A-Z]/.test(form.password) ? 'met' : ''}><Icon name="check" size={12} /> Upper & lowercase</span>
                    <span className={/\d/.test(form.password) ? 'met' : ''}><Icon name="check" size={12} /> Number</span>
                    <span className={/[^A-Za-z0-9]/.test(form.password) ? 'met' : ''}><Icon name="check" size={12} /> Symbol</span>
                  </div>
                  <label className="form-label">Confirm password
                    <span className="input-with-icon"><Icon name="lock" size={16} /><input className="input" type={showConfirm ? 'text' : 'password'} value={form.confirm} onChange={update('confirm')} autoComplete="new-password" placeholder="Repeat your password" required maxLength={128} /><PasswordToggle visible={showConfirm} onClick={() => setShowConfirm((value) => !value)} /></span>
                  </label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={form.accepted} onChange={update('accepted')} />
                    <span>I agree to the <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>, and I will review AI-generated content before publishing.</span>
                  </label>
                </>
              )}
              {!isSignup && (
                <div className="auth-form-meta">
                  <span><Icon name="shield-check" size={14} /> Secure session</span>
                  <Link to="/help">Need account help?</Link>
                </div>
              )}
              <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={busy}>
                {busy ? <><Spinner size={16} /> {isSignup ? 'Creating workspace…' : 'Signing in…'}</> : <>{isSignup ? 'Create free account' : 'Sign in'} <Icon name="arrow-right" size={16} /></>}
              </button>
            </form>
            <div className="auth-switch">
              {isSignup ? <>Already have an account? <Link to="/login">Sign in</Link></> : <>New to Faceless Studio? <Link to="/signup">Create an account</Link></>}
            </div>
            {demo?.email && demo?.password && (
              <>
                <div className="auth-divider"><span>or explore the demo</span></div>
                <div className="demo-access">
                  <div className="demo-access-head"><Icon name="sparkles" size={17} /><div><strong>Demo workspace</strong><span>Preloaded niche, sandbox account, and sample data.</span></div></div>
                  <div className="demo-credentials"><code>{demo.email}</code><code>{demo.password}</code></div>
                  <button type="button" className="btn btn-secondary demo-login-btn" onClick={useDemo} disabled={demoBusy || busy}>{demoBusy ? <><Spinner size={15} /> Signing in…</> : <><Icon name="play" size={15} /> Use demo account</>}</button>
                </div>
              </>
            )}
            <p className="auth-legal">By continuing you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>. Never share your password or API keys.</p>
          </div>
        </section>
      </main>
      <Footer compact />
    </div>
  );
}
