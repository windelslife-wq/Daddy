import React, { useState } from 'react';
import { Bell, BrainCircuit, CheckCircle2, Cpu, KeyRound, LockKeyhole, Settings as SettingsIcon, UserRound, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { get, patch, post } from '../api.js';
import { Button, Card, ErrorBanner, Field, InfoBanner, KeyValue, PageHeader, QuotaBar, Spinner, StatusBadge, Tabs, Toggle, useToast } from '../components/ui.jsx';

export default function Settings() {
  const { user, refresh, providerStatus } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('profile');
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useLoad(() => get('/api/settings'), []);
  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' });
  const [preferences, setPreferences] = useState(data?.preferences || {});
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
  const settings = data?.settings || {};
  const plan = data?.plan || {};
  const usage = data?.usage || {};

  React.useEffect(() => {
    setProfile({ name: user?.name || '', email: user?.email || '' });
  }, [user?.name, user?.email]);
  React.useEffect(() => { if (data?.preferences) setPreferences(data.preferences); }, [data?.preferences]);

  async function action(fn, message) {
    setBusy(true);
    try { await fn(); showToast(message, 'success'); await Promise.all([reload({ silent: true }), refresh()]); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" description="Manage your profile, defaults, security, quotas, and provider readiness." actions={<Button to="/app/billing" variant="secondary">Manage plan</Button>} />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'profile', label: 'Profile', icon: UserRound },
        { id: 'preferences', label: 'Preferences', icon: SettingsIcon },
        { id: 'security', label: 'Security', icon: LockKeyhole },
        { id: 'providers', label: 'AI providers', icon: BrainCircuit },
        { id: 'usage', label: 'Usage & quotas', icon: Zap },
        { id: 'notifications', label: 'Notifications', icon: Bell },
      ]} />
      <div className="grid grid-sidebar" style={{ marginTop: 18 }}>
        <Card>
          {loading && !data ? <Spinner label="Loading settings…" /> : (
            <>
              {tab === 'profile' && (
                <div className="stack">
                  <h2>Profile</h2>
                  <p className="tiny">Update the name and email used for sessions and notifications.</p>
                  <form className="stack" onSubmit={(e) => { e.preventDefault(); action(() => patch('/api/auth/profile', profile), 'Profile updated.'); }}>
                    <Field label="Full name" required><input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required /></Field>
                    <Field label="Email address" required><input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} required /></Field>
                    <div><Button type="submit" variant="primary" disabled={busy}>Save profile</Button></div>
                  </form>
                  <KeyValue items={[['User ID', user?.id], ['Role', user?.role], ['Plan', plan.name], ['Member since', new Date(user?.created_at || Date.now()).toLocaleDateString()]]} />
                </div>
              )}
              {tab === 'preferences' && (
                <div className="stack">
                  <h2>Content defaults</h2>
                  <p className="tiny">These preferences are stored with your user profile; new projects use them where applicable.</p>
                  <div className="grid grid-2">
                    <Field label="Default niche"><input value={preferences.defaultNiche || ''} onChange={(e) => setPreferences({ ...preferences, defaultNiche: e.target.value })} placeholder="Education & interesting facts" /></Field>
                    <Field label="Default style"><input value={preferences.defaultStyle || ''} onChange={(e) => setPreferences({ ...preferences, defaultStyle: e.target.value })} placeholder="cinematic" /></Field>
                    <Field label="Default language"><input value={preferences.defaultLanguage || ''} onChange={(e) => setPreferences({ ...preferences, defaultLanguage: e.target.value })} placeholder="en" /></Field>
                    <Field label="Timezone"><input value={preferences.timezone || ''} onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })} placeholder="Africa/Lagos" /></Field>
                  </div>
                  <Toggle checked={preferences.defaultReviewRequired ?? settings.defaultReviewRequired} onChange={(v) => setPreferences({ ...preferences, defaultReviewRequired: v })} label="Require review by default" description="Recommended for factual niches and newly connected accounts." />
                  <Toggle checked={preferences.emailNotifications ?? false} onChange={(v) => setPreferences({ ...preferences, emailNotifications: v })} label="Email notifications" description={providerStatus?.notifications?.smtpConfigured ? 'SMTP is configured on the server.' : 'SMTP is not configured; in-app notifications still work.'} disabled={!providerStatus?.notifications?.smtpConfigured} />
                  <Button variant="primary" disabled={busy} onClick={() => action(() => patch('/api/settings', { preferences }), 'Preferences saved.')}>Save preferences</Button>
                </div>
              )}
              {tab === 'security' && (
                <div className="stack">
                  <h2>Password & sessions</h2>
                  <InfoBanner icon={KeyRound}><strong>Secret credentials stay on the server.</strong><span> OAuth tokens are encrypted with AES-256-GCM and sessions use HTTP-only cookies.</span></InfoBanner>
                  <form className="stack" onSubmit={(e) => { e.preventDefault(); action(() => post('/api/auth/change-password', password), 'Password changed. Sign in again with your new password.'); setPassword({ currentPassword: '', newPassword: '' }); }}>
                    <Field label="Current password" required><input type="password" value={password.currentPassword} onChange={(e) => setPassword({ ...password, currentPassword: e.target.value })} required /></Field>
                    <Field label="New password" required hint="At least 10 characters."><input type="password" value={password.newPassword} onChange={(e) => setPassword({ ...password, newPassword: e.target.value })} minLength={10} required /></Field>
                    <div><Button type="submit" variant="primary" disabled={busy}>Change password</Button></div>
                  </form>
                  <div className="banner banner-warning" style={{ margin: 0 }}>Changing your password revokes existing sessions. You will be signed out and need to log in again.</div>
                </div>
              )}
              {tab === 'providers' && (
                <div className="stack">
                  <h2>Provider status</h2>
                  <p className="tiny">Provider selection and API keys are read from server environment variables. No secret is stored in frontend code.</p>
                  <div className="key-value">
                    {[
                      ['AI script', providerStatus?.ai?.active || 'local'], ['AI configured', providerStatus?.ai?.configured ? 'Yes' : 'No'],
                      ['Research', providerStatus?.research?.active || 'none'], ['Image generation', providerStatus?.images?.active || 'procedural'],
                      ['Text to speech', providerStatus?.tts?.active || 'mespeak'], ['Renderer', providerStatus?.videoRenderer || 'ffmpeg'],
                      ['Public base URL', providerStatus?.publicBaseUrl], ['Public media', providerStatus?.publicMediaReady ? 'HTTPS ready' : 'Local only'],
                    ].map(([key, value]) => <div className="kv-item" key={key}><span>{key}</span><strong>{value || '—'}</strong></div>)}
                  </div>
                  <InfoBanner icon={Cpu}><strong>Local mode works without paid APIs.</strong><span> Procedural scene art, mespeak narration, original ambient music, FFmpeg rendering, and sandbox publishing are active by default.</span></InfoBanner>
                  <div className="grid grid-2">
                    <Card title="Available AI providers" className="card"><div className="row row-wrap">{(providerStatus?.ai?.available || ['local']).map((item) => <StatusBadge key={item} status="connected" label={item} />)}</div></Card>
                    <Card title="Available image providers" className="card"><div className="row row-wrap">{(providerStatus?.images?.available || ['procedural']).map((item) => <StatusBadge key={item} status="connected" label={item} />)}</div></Card>
                  </div>
                </div>
              )}
              {tab === 'usage' && (
                <div className="stack">
                  <h2>Usage & quotas</h2>
                  <p className="tiny">Current {plan.name || 'Free'} plan usage for this calendar month.</p>
                  <QuotaBar label="Videos generated" used={usage.videos || 0} limit={plan.max_videos_month || 0} />
                  <QuotaBar label="Render seconds" used={usage.render_seconds || 0} limit={plan.max_render_seconds_month || 0} suffix="sec" />
                  <QuotaBar label="Publications" used={usage.posts || 0} limit={plan.max_posts_month || 0} />
                  <KeyValue items={[['AI requests', usage.ai_requests || 0], ['TTS characters', usage.tts_characters || 0], ['Connected accounts limit', plan.max_accounts || 0], ['Project limit', plan.max_projects || 0]]} />
                  <Button to="/app/billing" variant="primary">View plans</Button>
                </div>
              )}
              {tab === 'notifications' && (
                <div className="stack">
                  <h2>Notifications</h2>
                  <p className="tiny">In-app notifications are always available. Email and webhook delivery depend on server configuration.</p>
                  <KeyValue items={[['SMTP email', providerStatus?.notifications?.smtpConfigured ? 'Configured' : 'Not configured'], ['Webhook', providerStatus?.notifications?.webhookConfigured ? 'Configured' : 'Not configured'], ['Default privacy', settings.defaultPrivacy], ['Metrics sync interval', `${settings.metricsSyncIntervalHours || 6}h`], ['Max publish retries', settings.maxPublishRetries || 3]]} />
                  <Button variant="primary" disabled={busy} onClick={() => action(() => post('/api/settings/test-notification', {}), 'Test notification created.')}><Bell size={15} /> Send test notification</Button>
                  <div className="banner banner-info" style={{ margin: 0 }}><CheckCircle2 size={18} /><div><strong>Policy</strong><span>{settings.contentPolicy || 'Original content only.'}</span></div></div>
                </div>
              )}
            </>
          )}
        </Card>
        <div className="stack">
          <Card title="Current plan" icon={Zap}>
            <h2>{plan.name || 'Free'}</h2>
            <p className="tiny">{plan.features?.join(' · ') || 'Usage-limited plan'}</p>
            <QuotaBar label="Videos" used={usage.videos || 0} limit={plan.max_videos_month || 0} />
            <Button to="/app/billing" variant="secondary" className="btn-block">Compare plans</Button>
          </Card>
          <Card title="Security posture" icon={LockKeyhole}>
            <ul className="plan-features" style={{ margin: 0 }}>
              <li><CheckCircle2 size={15} /> Scrypt password hashing.</li>
              <li><CheckCircle2 size={15} /> HTTP-only session cookies.</li>
              <li><CheckCircle2 size={15} /> AES-256-GCM encrypted OAuth tokens.</li>
              <li><CheckCircle2 size={15} /> Idempotency keys for jobs and publications.</li>
              <li><CheckCircle2 size={15} /> Secrets and API keys remain server-side.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
