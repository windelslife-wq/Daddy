import React, { useEffect, useState } from 'react';
import {
  Activity, AlertCircle, BarChart3, CheckCircle2, Clapperboard, Cpu, KeyRound, ListChecks, Mail,
  PlugZap, RefreshCw, Rocket, Send, Settings as SettingsIcon, ShieldCheck, Trash2, Users, Wallet,
} from 'lucide-react';
import { useLoad } from '../hooks.js';
import { get, patch, post, put, formatDate, formatNumber } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, KeyValue, Modal, PageHeader, Spinner, StatusBadge, Toggle, useToast } from '../components/ui.jsx';
import ProviderSettings from './admin/ProviderSettings.jsx';

const tabs = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'providers', label: 'Providers', icon: PlugZap },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'plans', label: 'Plans & limits', icon: Wallet },
  { id: 'settings', label: 'Global settings', icon: SettingsIcon },
  { id: 'jobs', label: 'Jobs', icon: ListChecks },
  { id: 'integrations', label: 'Integrations', icon: Cpu },
  { id: 'activation', label: 'Activation', icon: Rocket },
  { id: 'film', label: 'Film studio', icon: Clapperboard },
  { id: 'logs', label: 'Audit logs', icon: ShieldCheck },
  { id: 'messages', label: 'Messages', icon: Mail },
];

function boolValue(value) { return value === true || value === 1 || value === 'true'; }
function readinessTone(status) {
  return { pass: 'completed', warn: 'needs_review', fail: 'failed', external: 'processing' }[status] || 'draft';
}
function activationTone(status) {
  return { ready: 'completed', incomplete: 'needs_review', external: 'processing' }[status] || 'draft';
}
function verifyTone(status) {
  return { verified: 'completed', invalid: 'failed', unreachable: 'failed', unconfigured: 'needs_review', unsupported: 'processing' }[status] || 'draft';
}

export default function Admin() {
  const { showToast } = useToast();
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [userEdits, setUserEdits] = useState({});
  const [planEdits, setPlanEdits] = useState({});
  const [settingsForm, setSettingsForm] = useState({});
  const [newPlan, setNewPlan] = useState({ name: '', priceCents: 0, maxVideosMonth: 20, maxRenderSecondsMonth: 1800, maxPostsMonth: 100, maxAccounts: 5, maxProjects: 100, features: '', active: true, stripePriceId: '' });
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcast, setBroadcast] = useState({ title: '', body: '', type: 'info', actionUrl: '/app' });
  const [verifyResults, setVerifyResults] = useState({});
  const [verifying, setVerifying] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const loader = () => {
    const endpoints = {
      overview: '/api/admin/overview', users: '/api/admin/users', plans: '/api/admin/plans',
      settings: '/api/admin/settings', jobs: '/api/admin/jobs', integrations: '/api/admin/integrations',
      activation: '/api/admin/activation',
      film: '/api/admin/film/ops',
      logs: '/api/admin/audit-logs', messages: '/api/admin/contact-messages',
    };
    // The Providers tab owns its own load: it edits a single configuration object.
    if (!endpoints[tab]) return Promise.resolve(null);
    return get(endpoints[tab]);
  };
  const { data, loading, error, reload } = useLoad(loader, [tab], { refreshMs: tab === 'overview' || tab === 'jobs' ? 15000 : 0 });

  const auditLoad = useLoad(() => (tab === 'activation' ? get('/api/admin/activation/audit') : Promise.resolve(null)), [tab], { initial: null });
  const audit = tab === 'activation' ? auditLoad.data : null;
  const auditById = Object.fromEntries((audit?.modules || []).map((a) => [a.id, a]));

  const verifyActivation = async (id) => {
    setVerifying(id);
    try {
      const result = await post(`/api/admin/activation/${encodeURIComponent(id)}/verify`);
      setVerifyResults((prev) => ({ ...prev, [id]: result }));
      showToast(`${result.name}: ${result.status}`, result.status === 'verified' ? 'success' : result.status === 'invalid' || result.status === 'unreachable' ? 'error' : 'info');
      await auditLoad.reload({ silent: true }).catch(() => {});
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setVerifying(null);
    }
  };

  const confirmActivation = async (id, confirmed) => {
    setConfirming(id);
    try {
      await post(`/api/admin/activation/${encodeURIComponent(id)}/confirm`, { confirmed, note: confirmed ? 'Confirmed in Admin → Activation' : '' });
      showToast(confirmed ? 'Manual steps marked done.' : 'Confirmation removed.', 'success');
      await auditLoad.reload({ silent: true }).catch(() => {});
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setConfirming(null);
    }
  };

  useEffect(() => {
    if (tab === 'users' && data?.users) {
      setUserEdits(Object.fromEntries(data.users.map((user) => [user.id, { role: user.role, planId: user.planId, status: user.status }])));
    }
    if (tab === 'plans' && data?.plans) {
      setPlanEdits(Object.fromEntries(data.plans.map((plan) => [plan.id, {
        name: plan.name, priceCents: plan.priceCents, maxVideosMonth: plan.maxVideosMonth,
        maxRenderSecondsMonth: plan.maxRenderSecondsMonth, maxPostsMonth: plan.maxPostsMonth,
        maxAccounts: plan.maxAccounts, maxProjects: plan.maxProjects,
        features: (plan.features || []).join('\n'), active: plan.active, stripePriceId: plan.stripePriceId || '',
      }])));
    }
    if (tab === 'settings' && data?.settings) setSettingsForm(data.settings);
  }, [tab, data]);

  async function action(fn, message) {
    setBusy(true);
    try { const result = await fn(); if (message) showToast(message, 'success'); await reload({ silent: true }); return result; }
    catch (err) { showToast(err.message, 'error'); return null; }
    finally { setBusy(false); }
  }
  async function saveUser(userId) {
    await action(() => patch(`/api/admin/users/${userId}`, userEdits[userId]), 'User updated.');
  }
  async function savePlan(planId) {
    const edit = planEdits[planId];
    if (!edit) return;
    const payload = { ...edit, features: String(edit.features || '').split('\n').map((item) => item.trim()).filter(Boolean) };
    await action(() => put(`/api/admin/plans/${planId}`, payload), 'Plan updated.');
  }
  async function createPlan() {
    const payload = { ...newPlan, features: String(newPlan.features || '').split('\n').map((item) => item.trim()).filter(Boolean) };
    const result = await action(() => post('/api/admin/plans', { plan: payload }), 'Plan created.');
    if (result) setNewPlan({ ...newPlan, name: '', features: '' });
  }
  async function saveSettings() {
    const payload = {
      allowSignups: boolValue(settingsForm.allow_signups),
      maintenanceMode: boolValue(settingsForm.maintenance_mode),
      defaultReviewRequired: boolValue(settingsForm.default_review_required),
      autopilotEnabled: boolValue(settingsForm.autopilot_enabled),
      defaultPrivacy: settingsForm.default_privacy || 'public',
      maxPublishRetries: Number(settingsForm.max_publish_retries || 3),
      metricsSyncIntervalHours: Number(settingsForm.metrics_sync_interval_hours || 6),
      captionReferenceCodes: boolValue(settingsForm.caption_reference_codes),
      contentPolicy: settingsForm.content_policy || '',
      supportedLanguages: settingsForm.supported_languages || [],
      supportedPlatforms: settingsForm.supported_platforms || [],
    };
    await action(() => patch('/api/admin/settings', payload), 'Global settings saved.');
  }
  async function setFilmProvider(providerId, enabled) {
    const result = await action(() => post(`/api/admin/film/providers/${encodeURIComponent(providerId)}`, { enabled }), enabled ? 'Provider enabled.' : 'Provider disabled.');
    if (!result) return;
  }
  const [health, setHealth] = useState(null);
  const [healthBusy, setHealthBusy] = useState(false);
  async function checkFilmHealth() {
    setHealthBusy(true);
    try { setHealth(await get('/api/admin/film/health')); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setHealthBusy(false); }
  }
  async function retryFilmJobs() {
    const result = await action(() => post('/api/admin/film/jobs/retry-failed', {}), 'Failed film jobs requeued.');
    if (result) showToast(`${result.requeued} job(s) back in the queue.`, 'info');
  }
  async function retryJob(id) { await action(() => post(`/api/admin/jobs/${id}/retry`, {}), 'Job retried.'); }
  async function cancelJob(id) { await action(() => post(`/api/admin/jobs/${id}/cancel`, {}), 'Job cancelled.'); }
  async function cleanup() { await action(() => post('/api/admin/cleanup', {}), 'Cleanup job queued.'); }
  async function setContactStatus(id, status) { await action(() => patch(`/api/admin/contact-messages/${id}`, { status }), `Message marked ${status}.`); }
  async function sendBroadcast() {
    const result = await action(() => post('/api/admin/notifications/broadcast', broadcast), 'Broadcast sent.');
    if (result) setBroadcastOpen(false);
  }

  return (
    <>
      <PageHeader eyebrow="Administration" title="Admin control center" description="Manage users, plans, provider credentials, integrations, global settings, and background jobs." actions={<><Button variant="ghost" onClick={cleanup} disabled={busy}><Trash2 size={15} /> Cleanup</Button><Button variant="secondary" onClick={() => setBroadcastOpen(true)}><Send size={15} /> Broadcast</Button></>} />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <div className="admin-grid">
        <div className="admin-side card" style={{ padding: 10 }}>
          {tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={16} /> {item.label}</button>)}
        </div>
        <div className="stack">
          {loading && !data ? <Card><Spinner label="Loading admin data…" /></Card> : (
            <>
              {tab === 'providers' && <ProviderSettings />}
              {tab === 'overview' && data?.counts && (
                <>
                  <div className="stat-grid">
                    {Object.entries(data.counts).map(([key, value]) => <div className="stat-card" key={key}><div className="stat-top"><span>{key.replace(/([A-Z])/g, ' $1')}</span><span className="stat-icon"><BarChart3 size={16} /></span></div><div className="stat-value">{formatNumber(value)}</div><div className="stat-foot">Total</div></div>)}
                    <div className="stat-card"><div className="stat-top"><span>Total views</span><span className="stat-icon"><BarChart3 size={16} /></span></div><div className="stat-value">{formatNumber(data.totalViews)}</div><div className="stat-foot">Synced metric snapshots</div></div>
                  </div>
                  {(data.productionWarnings || []).length > 0 && <div className="banner banner-warning"><AlertCircle size={18} /><div><strong>Production configuration warnings</strong><span>{data.productionWarnings.join(' ')}</span></div></div>}
                  <Card title="Recent jobs" icon={ListChecks}><div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Attempts</th><th>Run at</th><th>Error</th></tr></thead><tbody>{data.recentJobs.map((job) => <tr key={job.id}><td>{job.type}</td><td><StatusBadge status={job.status} /></td><td>{job.attempts}/{job.maxAttempts}</td><td><small>{formatDate(job.runAt)}</small></td><td className="error-text">{job.lastError}</td></tr>)}</tbody></table></div></Card>
                  <Card title="Recent publishing failures" icon={AlertCircle}>{data.recentFailures.length === 0 ? <EmptyState icon={CheckCircle2} title="No recent failures" description="All clear." /> : <div className="list">{data.recentFailures.map((pub) => <div className="list-item" key={pub.id}><div className="list-main"><strong>{pub.id}</strong><small>{pub.lastError}</small></div><StatusBadge status={pub.status} /></div>)}</div>}</Card>
                  <Card title="Recent users" icon={Users}><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Role</th><th>Joined</th></tr></thead><tbody>{data.recentUsers.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.planId}</td><td>{user.role}</td><td><small>{formatDate(user.createdAt)}</small></td></tr>)}</tbody></table></div></Card>
                </>
              )}
              {tab === 'users' && <Card title="Users" icon={Users}><div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Plan</th><th>Status</th><th>Usage</th><th /></tr></thead><tbody>{(data?.users || []).map((user) => {
                const edit = userEdits[user.id] || { role: user.role, planId: user.planId, status: user.status };
                return <tr key={user.id}><td><strong>{user.name}</strong><small style={{ display: 'block' }}>{user.email}</small></td><td><select value={edit.role} onChange={(e) => setUserEdits({ ...userEdits, [user.id]: { ...edit, role: e.target.value } })}><option value="user">user</option><option value="admin">admin</option></select></td><td><select value={edit.planId} onChange={(e) => setUserEdits({ ...userEdits, [user.id]: { ...edit, planId: e.target.value } })}>{[...new Set(['free', 'starter', 'creator', 'scale', edit.planId].filter(Boolean))].map((plan) => <option key={plan} value={plan}>{plan}</option>)}</select></td><td><select value={edit.status} onChange={(e) => setUserEdits({ ...userEdits, [user.id]: { ...edit, status: e.target.value } })}><option value="active">active</option><option value="suspended">suspended</option></select></td><td><small>{user.usage?.videos || 0} videos · {user.projects || 0} projects</small></td><td><Button size="xs" variant="primary" onClick={() => saveUser(user.id)} disabled={busy}>Save</Button></td></tr>;
              })}</tbody></table></div></Card>}
              {tab === 'plans' && (
                <>
                  <Card title="Create plan" icon={Wallet}>
                    <div className="grid grid-3">
                      <Field label="Name"><input value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} /></Field>
                      <Field label="Price (cents)"><input type="number" min="0" value={newPlan.priceCents} onChange={(e) => setNewPlan({ ...newPlan, priceCents: Number(e.target.value) })} /></Field>
                      <Field label="Stripe Price ID"><input value={newPlan.stripePriceId} onChange={(e) => setNewPlan({ ...newPlan, stripePriceId: e.target.value })} placeholder="price_..." /></Field>
                      <Field label="Videos / month"><input type="number" min="0" value={newPlan.maxVideosMonth} onChange={(e) => setNewPlan({ ...newPlan, maxVideosMonth: Number(e.target.value) })} /></Field>
                      <Field label="Render seconds"><input type="number" min="0" value={newPlan.maxRenderSecondsMonth} onChange={(e) => setNewPlan({ ...newPlan, maxRenderSecondsMonth: Number(e.target.value) })} /></Field>
                      <Field label="Posts / month"><input type="number" min="0" value={newPlan.maxPostsMonth} onChange={(e) => setNewPlan({ ...newPlan, maxPostsMonth: Number(e.target.value) })} /></Field>
                    </div>
                    <Field label="Features (one per line)"><textarea value={newPlan.features} onChange={(e) => setNewPlan({ ...newPlan, features: e.target.value })} /></Field>
                    <Button variant="primary" onClick={createPlan} disabled={busy || newPlan.name.trim().length < 2}>Create plan</Button>
                  </Card>
                  <Card title="Plans & limits" icon={Wallet}><div className="table-wrap"><table><thead><tr><th>Plan</th><th>Price</th><th>Videos</th><th>Render sec</th><th>Posts</th><th>Accounts</th><th>Stripe</th><th /></tr></thead><tbody>{(data?.plans || []).map((plan) => {
                    const edit = planEdits[plan.id] || plan;
                    return <tr key={plan.id}><td><input value={edit.name} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, name: e.target.value } })} /><small>{plan.id}</small></td><td><input type="number" value={edit.priceCents} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, priceCents: Number(e.target.value) } })} /></td><td><input type="number" value={edit.maxVideosMonth} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, maxVideosMonth: Number(e.target.value) } })} /></td><td><input type="number" value={edit.maxRenderSecondsMonth} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, maxRenderSecondsMonth: Number(e.target.value) } })} /></td><td><input type="number" value={edit.maxPostsMonth} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, maxPostsMonth: Number(e.target.value) } })} /></td><td><input type="number" value={edit.maxAccounts} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, maxAccounts: Number(e.target.value) } })} /></td><td><input value={edit.stripePriceId || ''} onChange={(e) => setPlanEdits({ ...planEdits, [plan.id]: { ...edit, stripePriceId: e.target.value } })} placeholder="price_..." /></td><td><Button size="xs" variant="primary" onClick={() => savePlan(plan.id)} disabled={busy}>Save</Button></td></tr>;
                  })}</tbody></table></div><p className="tiny" style={{ marginTop: 12, marginBottom: 0 }}>Plan creation and updates are real database changes. Stripe Price IDs must already exist in your Stripe account.</p></Card>
                </>
              )}
              {tab === 'settings' && data?.settings && <Card title="Global settings" icon={SettingsIcon}>
                <div className="grid grid-2">
                  <Toggle checked={boolValue(settingsForm.allow_signups)} onChange={(v) => setSettingsForm({ ...settingsForm, allow_signups: v })} label="Allow signups" description="Controls public registration." />
                  <Toggle checked={boolValue(settingsForm.maintenance_mode)} onChange={(v) => setSettingsForm({ ...settingsForm, maintenance_mode: v })} label="Maintenance mode" description="Pauses scheduler ticks." />
                  <Toggle checked={boolValue(settingsForm.default_review_required)} onChange={(v) => setSettingsForm({ ...settingsForm, default_review_required: v })} label="Default review required" description="Applies to new projects when omitted." />
                  <Toggle checked={boolValue(settingsForm.autopilot_enabled)} onChange={(v) => setSettingsForm({ ...settingsForm, autopilot_enabled: v })} label="Autopilot enabled" description="Platform-wide automation control." />
                  <Toggle checked={boolValue(settingsForm.caption_reference_codes)} onChange={(v) => setSettingsForm({ ...settingsForm, caption_reference_codes: v })} label="Caption reference codes" description="Adds duplicate-prevention markers to descriptions." />
                  <Field label="Default YouTube privacy"><select value={settingsForm.default_privacy || 'public'} onChange={(e) => setSettingsForm({ ...settingsForm, default_privacy: e.target.value })}><option value="public">public</option><option value="unlisted">unlisted</option><option value="private">private</option></select></Field>
                  <Field label="Max publish retries"><input type="number" min="1" max="20" value={settingsForm.max_publish_retries || 3} onChange={(e) => setSettingsForm({ ...settingsForm, max_publish_retries: Number(e.target.value) })} /></Field>
                  <Field label="Metrics sync interval (hours)"><input type="number" min="1" max="168" value={settingsForm.metrics_sync_interval_hours || 6} onChange={(e) => setSettingsForm({ ...settingsForm, metrics_sync_interval_hours: Number(e.target.value) })} /></Field>
                </div>
                <Field label="Content policy"><textarea value={settingsForm.content_policy || ''} onChange={(e) => setSettingsForm({ ...settingsForm, content_policy: e.target.value })} /></Field>
                <div className="grid grid-2">
                  <Field label="Supported languages (comma-separated)"><input value={(settingsForm.supported_languages || []).join(', ')} onChange={(e) => setSettingsForm({ ...settingsForm, supported_languages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
                  <Field label="Supported platforms"><div className="row row-wrap">{['sandbox', 'facebook', 'instagram', 'youtube', 'x'].map((platform) => <label className="checkbox-row" key={platform}><input type="checkbox" checked={(settingsForm.supported_platforms || []).includes(platform)} onChange={() => setSettingsForm({ ...settingsForm, supported_platforms: (settingsForm.supported_platforms || []).includes(platform) ? settingsForm.supported_platforms.filter((p) => p !== platform) : [...(settingsForm.supported_platforms || []), platform] })} /> {platform}</label>)}</div></Field>
                </div>
                <Button variant="primary" onClick={saveSettings} disabled={busy}>Save settings</Button>
                {(data.productionWarnings || []).length > 0 && <div className="banner banner-warning" style={{ marginTop: 16, marginBottom: 0 }}><AlertCircle size={18} /><div><strong>Production warnings</strong><span>{data.productionWarnings.join(' ')}</span></div></div>}
              </Card>}
              {tab === 'jobs' && <Card title="Background jobs" icon={ListChecks} action={<Button size="sm" variant="ghost" onClick={() => reload()}><RefreshCw size={14} /> Refresh</Button>}>
                <div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Attempts</th><th>Run at</th><th>Error</th><th className="text-right">Actions</th></tr></thead><tbody>{(data?.jobs || []).map((job) => <tr key={job.id}><td>{job.type}</td><td><StatusBadge status={job.status} /></td><td>{job.attempts}/{job.maxAttempts}</td><td><small>{formatDate(job.runAt)}</small></td><td className="error-text truncate" style={{ maxWidth: 260 }}>{job.lastError}</td><td><div className="row" style={{ justifyContent: 'flex-end' }}><Button size="xs" variant="secondary" onClick={() => retryJob(job.id)} disabled={busy || job.status === 'running'}>Retry</Button><Button size="xs" variant="danger" onClick={() => cancelJob(job.id)} disabled={busy || ['completed', 'failed'].includes(job.status)}>Cancel</Button></div></td></tr>)}</tbody></table></div>
              </Card>}
              {tab === 'integrations' && data?.providerStatus && <Card title="Integrations & environment" icon={Cpu}>
                <KeyValue items={[['AI', data.providerStatus.ai.active], ['Research', data.providerStatus.research.active], ['Images', data.providerStatus.images.active], ['TTS', data.providerStatus.tts.active], ['Film video provider', `${data.providerStatus.film?.active || 'none'} (${data.providerStatus.film?.configured ? 'configured' : 'needs keys'})`], ['Film clip limit', `${data.providerStatus.film?.maxSceneSeconds || '—'}s / ${data.providerStatus.film?.maxScenes || '—'} scenes`], ['Renderer', data.providerStatus.videoRenderer], ['Public base URL', data.providerStatus.publicBaseUrl]]} />
                <div className="grid grid-2" style={{ marginTop: 16 }}>
                  <div><h3>Official integration readiness</h3><div className="list">{Object.entries(data.providerStatus.integrations).map(([key, integration]) => <div className="integration-row" key={key}><strong>{integration.label}</strong><StatusBadge status={integration.configured ? 'connected' : 'needs_review'} label={integration.configured ? 'Configured' : 'Needs keys'} /></div>)}</div></div>
                  <div><h3>Required environment variables</h3><ul className="env-list">{Object.entries(data.requiredEnvironment || {}).map(([key, values]) => <li key={key}><strong>{key}</strong><br />{values.map((value) => <code key={value}>{value}</code>)}</li>)}</ul></div>
                </div>
                <InfoBanner icon={KeyRound}><strong>Where credentials live.</strong><span> Provider keys are managed in the <strong>Providers</strong> tab: encrypted with <code>APP_ENCRYPTION_KEY</code>, write-only once saved, and falling back to these environment variables when not set there. Publishing scopes and app review stay environment-only because they are provider-console approvals, not application settings.</span></InfoBanner>
              </Card>}
              {tab === 'integrations' && data?.readiness && <>
                <Card title="Deployment readiness" icon={ShieldCheck} subtitle={`Overall: ${data.readiness.overall}. ${data.readiness.note}`}>
                  <div className="table-wrap"><table><thead><tr><th>Check</th><th>Status</th><th>Detail</th><th>Action</th></tr></thead><tbody>{data.readiness.checks.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td><StatusBadge status={readinessTone(item.status)} label={item.status.toUpperCase()} /></td><td><small>{typeof item.detail === 'string' ? item.detail : (item.detail?.facebook || '')}</small></td><td><small>{item.action || '—'}{item.docs ? <> <a href={item.docs} target="_blank" rel="noreferrer">Docs</a></> : null}</small></td></tr>)}</tbody></table></div>
                  <div className="grid grid-2" style={{ marginTop: 16 }}>
                    <div><h3>Exact callback URLs</h3><ul className="env-list">{Object.entries(data.readiness.callbacks).map(([key, value]) => <li key={key}><strong>{key}</strong><br /><code>{value}</code></li>)}</ul></div>
                    <div><h3>Public origin</h3><KeyValue items={[['Value', data.readiness.publicBaseUrl.value], ['HTTPS', data.readiness.publicBaseUrl.https ? 'yes' : 'no'], ['Local/test host', data.readiness.publicBaseUrl.local ? 'yes' : 'no'], ['Environment', data.readiness.environment]]} />{data.readiness.productionWarnings.length > 0 && <div className="banner banner-warning" style={{ marginTop: 12, marginBottom: 0 }}><AlertCircle size={18} /><div><strong>Production warnings</strong><span>{data.readiness.productionWarnings.join(' ')}</span></div></div>}</div>
                  </div>
                </Card>
                <Card title="Provider app review & business verification" icon={KeyRound}>
                  <div className="stack">{data.readiness.providerApproval.map((item) => <details key={item.id} className="card" style={{ padding: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>{item.platform} — {item.loginType}</summary><div className="stack" style={{ marginTop: 12 }}><div><strong>Permissions/scopes</strong><div className="row row-wrap" style={{ marginTop: 6 }}>{(item.requiredPermissions || item.requiredScopes || item.requiredEvents || []).map((value) => <code key={value}>{value}</code>)}</div></div><p className="tiny"><strong>App review:</strong> {item.appReview}</p><p className="tiny"><strong>Business verification:</strong> {item.businessVerification}</p><p className="tiny"><strong>Account requirements:</strong> {item.accountRequirements}</p><p className="tiny"><strong>Conditional:</strong> {item.conditionalPermissions || '—'}</p><div className="row row-wrap">{(item.docs || []).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">Official docs</a>)}</div></div></details>)}</div>
                  <InfoBanner icon={ShieldCheck}><strong>These are provider-console steps.</strong><span> No code can grant Advanced Access, approve an OAuth consent screen, activate a paid API tier, or verify a business. The checks above remain explicitly external until you finish them.</span></InfoBanner>
                </Card>
              </>}
              {tab === 'activation' && data?.modules && <Card title="Activation modules" icon={Rocket} subtitle={`${data.summary.ready} ready locally · ${audit ? `${audit.summary.complete}/${audit.summary.total} fully complete` : 'loading completion audit…'} · ${data.summary.external} external. Work in dependency order.`} action={<Button size="sm" variant="ghost" onClick={() => { reload(); auditLoad.reload({ silent: true }).catch(() => {}); }}><RefreshCw size={14} /> Refresh</Button>}>
                <InfoBanner icon={KeyRound}><strong>Local config vs. live check vs. done.</strong><span> Local config is an offline preflight. "Verify" makes a read-only, app-level call to the configured provider — it never prints or stores a secret and skips modules with no credentials. A module is <strong>complete</strong> only when its local config, verification, real application evidence and provider-console steps all pass. Use <code>npm run setup -- --work &lt;id&gt; --record</code> to work a module one by one, and <code>--confirm &lt;id&gt; --note "..."</code> only after genuinely finishing its external steps.</span></InfoBanner>
                {audit && <div className="grid grid-2" style={{ marginBottom: 14 }}>
                  <div><h3>Completion audit</h3><KeyValue items={[['Fully complete', `${audit.summary.complete} / ${audit.summary.total}`], ['In progress', audit.summary.inProgress], ['Not started', audit.summary.notStarted], ['Criteria met', `${audit.summary.criteriaMet} / ${audit.summary.criteriaTotal}`]]} /></div>
                  <div><h3>Recommended next module</h3>{(audit.recommendedNextModule || audit.nextModule) ? <><strong>#{(audit.recommendedNextModule || audit.nextModule).number} {(audit.recommendedNextModule || audit.nextModule).name}</strong><p className="tiny">{(audit.recommendedNextModule || audit.nextModule).nextAction || 'Review the remaining criteria below.'}</p><p className="tiny">Ordered by dependency: security key → HTTPS origin → database → offline providers → notifications → publishing → app review. Full detail in <code>docs/ACTIVATION_PROGRESS.md</code>.</p><Button size="xs" variant="secondary" onClick={() => verifyActivation((audit.recommendedNextModule || audit.nextModule).id)} disabled={verifying === (audit.recommendedNextModule || audit.nextModule).id}>Verify now</Button></> : <p className="tiny">Every module is complete. Keep an eye on provider approvals and token expiry.</p>}</div>
                </div>}
                <div className="table-wrap"><table><thead><tr><th>#</th><th>Module</th><th>Local config</th><th>Live check</th><th>Done</th><th>Checks</th><th className="text-right">Action</th></tr></thead>
                  <tbody>{data.modules.map((m) => {
                    const v = verifyResults[m.id];
                    return (<React.Fragment key={m.id}>
                      <tr>
                        <td>{m.number}</td>
                        <td><strong>{m.name}</strong><br /><small>{m.summary}</small></td>
                        <td><StatusBadge status={activationTone(m.status)} label={m.status.toUpperCase()} /></td>
                        <td>{v ? <StatusBadge status={verifyTone(v.status)} label={v.status.toUpperCase()} /> : <small>not run</small>}</td>
                        <td>{auditById[m.id] ? <StatusBadge status={auditById[m.id].complete ? 'completed' : 'needs_review'} label={auditById[m.id].complete ? 'COMPLETE' : `${auditById[m.id].passed}/${auditById[m.id].total}`} /> : <small>…</small>}</td>
                        <td>{m.passed}/{m.total}</td>
                        <td className="text-right"><Button size="xs" variant="secondary" disabled={verifying === m.id} onClick={() => verifyActivation(m.id)}>{verifying === m.id ? 'Checking…' : 'Verify'}</Button></td>
                      </tr>
                      <tr><td colSpan={7}>
                        <details>
                          <summary style={{ cursor: 'pointer' }}>Checklist — {m.envSpecs.length} env var(s), {m.consoleSteps.length} console step(s), {m.deploySteps.length} deploy step(s)</summary>
                          <div className="stack" style={{ padding: '10px 0' }}>
                            {m.envSpecs.length > 0 && <div><strong>Environment</strong><ul className="env-list">{m.envSpecs.map((s) => <li key={s.key}><code>{s.key}</code> {s.set ? '✓ set' : '· not set'} {s.secret ? '(secret)' : ''} — <small>{s.description}</small></li>)}</ul></div>}
                            {m.callbacks.length > 0 && <div><strong>Exact callback URLs</strong><ul className="env-list">{m.callbacks.map((c) => <li key={c.key}>{c.label}<br /><code>{c.url}</code></li>)}</ul></div>}
                            {m.permissions.length > 0 && <div><strong>Scopes</strong><div className="row row-wrap">{m.permissions.map((p) => <code key={p}>{p}</code>)}</div></div>}
                            {m.consoleSteps.length > 0 && <div><strong>Provider console</strong><ol>{m.consoleSteps.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.detail}</li>)}</ol></div>}
                            {m.deploySteps.length > 0 && <div><strong>Deployment</strong><ol>{m.deploySteps.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.detail}</li>)}</ol></div>}
                            {m.verify.length > 0 && <div><strong>Verify it works</strong><ol>{m.verify.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.detail}</li>)}</ol></div>}
                            {m.docs.length > 0 && <div className="row row-wrap">{m.docs.map((d) => <a key={d.url} href={d.url} target="_blank" rel="noreferrer">{d.label}</a>)}</div>}
                            {auditById[m.id] && <div><strong>Completion criteria — {auditById[m.id].passed}/{auditById[m.id].total} met {auditById[m.id].complete ? '✓ COMPLETE' : ''}</strong>
                              <ul className="env-list">{auditById[m.id].checks.map((c) => <li key={c.id}><StatusBadge status={c.status === 'pass' ? 'completed' : 'needs_review'} label={c.status === 'pass' ? 'DONE' : 'TODO'} /> <strong>{c.label}</strong> — <small>{c.detail}</small>{c.ownerLabel && <small style={{ display: 'block' }}>Owner: {c.ownerLabel}</small>}{c.action && <small style={{ display: 'block' }}>→ {c.action}</small>}{c.command && <small style={{ display: 'block' }}><code>{c.command}</code></small>}</li>)}</ul>
                              {auditById[m.id].confirmation
                                ? <Button size="xs" variant="ghost" disabled={confirming === m.id} onClick={() => confirmActivation(m.id, false)}>Undo steps-done confirmation</Button>
                                : (m.consoleSteps.length + m.deploySteps.length > 0) && <Button size="xs" variant="secondary" disabled={confirming === m.id} onClick={() => confirmActivation(m.id, true)}>Mark steps done</Button>}
                            </div>}
                          </div>
                        </details>
                        {v && <div className="stack" style={{ padding: '8px 0' }}>
                          <strong>Live check — {v.status.toUpperCase()}</strong>
                          <small>{v.summary}</small>
                          {v.checks.map((c) => <div key={c.name}><StatusBadge status={c.status === 'pass' ? 'completed' : c.status === 'fail' ? 'failed' : 'draft'} label={c.status.toUpperCase()} /> <small><strong>{c.name}</strong> — {c.detail}</small></div>)}
                          {v.action && <small><strong>Next:</strong> {v.action}</small>}
                        </div>}
                      </td></tr>
                    </React.Fragment>);
                  })}</tbody>
                </table></div>
                <div className="stack" style={{ marginTop: 14 }}>{data.global.map((g) => <div key={g.id}><StatusBadge status={g.status === 'pass' ? 'completed' : g.status === 'fail' ? 'failed' : 'draft'} label={g.status.toUpperCase()} /> <small><strong>{g.label}</strong> — {g.detail}</small></div>)}</div>
              </Card>}
              {tab === 'logs' && <Card title="Audit logs" icon={ShieldCheck}><div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>User</th><th>Details</th></tr></thead><tbody>{(data?.logs || []).map((log) => <tr key={log.id}><td><small>{formatDate(log.createdAt)}</small></td><td>{log.action}</td><td>{log.entityType}<br /><small>{log.entityId}</small></td><td><small>{log.userId}</small></td><td><small className="mono">{JSON.stringify(log.details).slice(0, 120)}</small></td></tr>)}</tbody></table></div></Card>}
              {tab === 'messages' && <Card title="Website messages" icon={Mail} subtitle="Messages submitted through the public contact form." action={<Button size="sm" variant="ghost" onClick={() => reload()}><RefreshCw size={14} /> Refresh</Button>}>
                {(data?.messages || []).length === 0 ? <EmptyState icon={Mail} title="No messages yet" description="Contact form submissions will appear here and notify administrators." /> : (
                  <div className="contact-admin-list">{data.messages.map((message) => (
                    <article className="contact-admin-item" key={message.id}>
                      <div className="contact-admin-head">
                        <div><strong>{message.topicLabel}</strong><span>{message.name} · <a href={`mailto:${message.email}`}>{message.email}</a> · {formatDate(message.createdAt)}</span></div>
                        <span className={`contact-status ${message.status}`}>{message.status}</span>
                      </div>
                      <p>{message.message}</p>
                      <div className="row row-wrap">
                        <Button size="xs" variant="secondary" disabled={busy || message.status === 'reviewed'} onClick={() => setContactStatus(message.id, 'reviewed')}>Mark reviewed</Button>
                        <Button size="xs" variant="ghost" disabled={busy || message.status === 'archived'} onClick={() => setContactStatus(message.id, 'archived')}>Archive</Button>
                        <Button size="xs" variant="ghost" href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.topicLabel}`)}`}>Reply by email</Button>
                      </div>
                    </article>
                  ))}</div>
                )}
              </Card>}
              {tab === 'film' && data?.providers && (
                <>
                  <Card title="Video providers" icon={Clapperboard} subtitle="Disabling a provider removes it from routing immediately — requests fail honestly with 503 instead of silently falling back." action={<><Button size="sm" variant="ghost" disabled={healthBusy} onClick={checkFilmHealth}>{healthBusy ? <Spinner size={13} /> : <><Activity size={14} /> Check health</>}</Button><Button size="sm" variant="ghost" onClick={() => reload()}><RefreshCw size={14} /> Refresh</Button></>}>
                    <div className="list">
                      {data.providers.video.map((provider) => (
                        <div className="list-item" key={provider.id}>
                          <div className="list-main">
                            <strong>{provider.label || provider.id}</strong>
                            <small>{provider.configured ? 'Credential present' : 'No credential'} · {provider.disabled ? 'disabled in admin' : 'available'}</small>
                          </div>
                          <Toggle checked={!provider.disabled} disabled={busy} onChange={(next) => setFilmProvider(provider.id, next)} label={`Enable ${provider.id}`} />
                        </div>
                      ))}
                    </div>
                    {!data.providers.video.length && <EmptyState icon={Clapperboard} title="No video providers registered" description="The provider registry is empty — check server/film/videoProviders.js." />}
                    {health && (
                      <div className="list" style={{ marginTop: 10 }}>
                        {health.providers.map((item) => (
                          <div className="list-item" key={item.id}>
                            <div className="list-main">
                              <strong>{item.id}</strong>
                              <small>{item.checked ? `${item.reachable ? 'reachable' : 'unreachable'}${item.status ? ` · HTTP ${item.status}` : ''} · ${item.latencyMs} ms` : item.reason}</small>
                            </div>
                            <span className={`status-dot ${item.checked ? (item.reachable ? 'good' : 'warn') : ''}`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                  <Card title="Render queue" icon={ListChecks} subtitle="Film jobs by type and status.">
                    {Object.keys(data.queue || {}).length === 0
                      ? <EmptyState icon={ListChecks} title="Queue is empty" description="No film jobs have run yet." />
                      : (
                        <div className="table-wrap"><table><thead><tr><th>Job type</th><th>Statuses</th></tr></thead><tbody>
                          {Object.entries(data.queue).map(([type, statuses]) => (
                            <tr key={type}><td>{type}</td><td>{Object.entries(statuses).map(([status, count]) => `${status}: ${count}`).join(' · ')}</td></tr>
                          ))}
                        </tbody></table></div>
                      )}
                  </Card>
                  <Card title="Failed film jobs" icon={AlertCircle} subtitle={`${data.renderedFilms} rendered final cut(s)`} action={<Button size="sm" variant="secondary" disabled={busy} onClick={retryFilmJobs}><RefreshCw size={14} /> Requeue failed</Button>}>
                    {(data.failed || []).length === 0
                      ? <EmptyState icon={CheckCircle2} title="Nothing failed" description="Every film job either finished or is still queued." />
                      : (
                        <div className="list">
                          {data.failed.map((job) => (
                            <div className="list-item" key={job.id}>
                              <div className="list-main"><strong>{job.type}</strong><small>{job.attempts}/{job.maxAttempts} attempts · {job.lastError}</small></div>
                              <small>{formatDate(job.updated_at)}</small>
                            </div>
                          ))}
                        </div>
                      )}
                  </Card>
                  <Card title="Production snapshot" icon={BarChart3}>
                    <div className="grid grid-2">
                      <KeyValue label="Productions" value={Object.entries(data.productions || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'} />
                      <KeyValue label="Scenes" value={Object.entries(data.scenes || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'} />
                    </div>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        title="Broadcast notification"
        description="Send an in-app notification to all active users."
        footer={<><Button variant="ghost" onClick={() => setBroadcastOpen(false)}>Cancel</Button><Button variant="primary" onClick={sendBroadcast} disabled={busy}>Send broadcast</Button></>}
      >
        <div className="stack">
          <Field label="Title" required><input value={broadcast.title} onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} /></Field>
          <Field label="Message" required><textarea value={broadcast.body} onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })} /></Field>
          <div className="grid grid-2"><Field label="Type"><select value={broadcast.type} onChange={(e) => setBroadcast({ ...broadcast, type: e.target.value })}><option value="info">Info</option><option value="success">Success</option><option value="attention">Attention</option><option value="error">Error</option></select></Field><Field label="Action URL"><input value={broadcast.actionUrl} onChange={(e) => setBroadcast({ ...broadcast, actionUrl: e.target.value })} /></Field></div>
        </div>
      </Modal>
    </>
  );
}
