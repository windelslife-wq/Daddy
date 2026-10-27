import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, Link2, RefreshCw, ShieldCheck, Trash2, Users, Zap } from 'lucide-react';
import { useLoad } from '../hooks.js';
import { del, get, patch, post, formatDate, safeHref } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, InfoBanner, Modal, PageHeader, Spinner, StatusBadge, Toggle, useToast } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Accounts() {
  const { showToast } = useToast();
  const { providerStatus, options } = useAuth();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(null);
  const [disconnectTarget, setDisconnectTarget] = useState(null);
  const { data, loading, error, reload } = useLoad(() => Promise.all([
    get('/api/accounts'),
    get('/api/accounts/status'),
  ]).then(([accounts, status]) => ({ ...accounts, status })), [], { refreshMs: 30000, initial: { accounts: [], status: { integrations: {} } } });
  const accounts = data?.accounts || [];
  const integrations = data?.status?.integrations || {};
  const oauthResult = params.get('oauth');
  const oauthMessage = params.get('message');
  const envRequirements = {
    sandbox: [],
    facebook: ['META_APP_ID', 'META_APP_SECRET'],
    instagram: ['META_APP_ID', 'META_APP_SECRET', 'PUBLIC_BASE_URL (HTTPS)'],
    youtube: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    x: ['X_CONSUMER_KEY', 'X_CONSUMER_SECRET'],
  };

  async function updateAccount(id, changes) {
    setBusy(id);
    try { await patch(`/api/accounts/${id}`, changes); await reload({ silent: true }); showToast('Account settings updated.', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(null); }
  }
  async function testAccount(id) {
    setBusy(id);
    try { await post(`/api/accounts/${id}/test`, {}); showToast('Connection verified.', 'success'); await reload({ silent: true }); }
    catch (err) { showToast(err.message, 'error'); await reload({ silent: true }); }
    finally { setBusy(null); }
  }
  async function disconnect() {
    if (!disconnectTarget) return;
    setBusy(disconnectTarget.id);
    try {
      const result = await del(`/api/accounts/${disconnectTarget.id}`);
      showToast(result.revoke?.revoked ? 'Account disconnected and provider authorization revoked.' : 'Account disconnected; stored tokens removed.', 'success');
      setDisconnectTarget(null);
      await reload({ silent: true });
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Connections"
        title="Connected accounts"
        description="Connect official social accounts through server-side OAuth. Tokens are encrypted at rest and never exposed to the browser."
        actions={<Button href="/api/oauth/sandbox/connect" variant="primary"><Link2 size={16} /> Connect sandbox channel</Button>}
      />
      {oauthResult === 'success' && <div className="banner banner-success"><CheckCircle2 size={18} /><div><strong>Connection complete</strong><span>{oauthMessage || 'Your account is ready.'}</span></div><Button size="sm" variant="ghost" onClick={() => setParams({})}>Dismiss</Button></div>}
      {oauthResult === 'error' && <div className="banner banner-error"><AlertCircle size={18} /><div><strong>Connection failed</strong><span>{oauthMessage || 'Review your server OAuth settings.'}</span></div><Button size="sm" variant="ghost" onClick={() => setParams({})}>Dismiss</Button></div>}
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />

      <InfoBanner icon={KeyRound} action={<Button href="/api/oauth/status" external size="sm" variant="ghost">View server status</Button>}>
        <strong>OAuth callback base URL: {providerStatus?.publicBaseUrl || 'not set'}</strong>
        <span>Register this base URL and the matching <code>/api/oauth/&lt;provider&gt;/callback</code> path in each provider console. Instagram and other media-fetch APIs require a public HTTPS URL.</span>
      </InfoBanner>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        {Object.entries(integrations).map(([key, integration]) => (
          <Card key={key} title={integration.label} subtitle={key === 'sandbox' ? 'Built-in local HTTP publishing target for real end-to-end tests.' : 'Official platform OAuth integration.'}>
            <div className="row-between" style={{ marginBottom: 14 }}>
              <StatusBadge status={integration.configured ? 'connected' : 'needs_review'} label={integration.configured ? 'Server configured' : 'Keys required'} />
              <span className="tiny">{integration.connectedCount || 0} connected</span>
            </div>
            <div className="stack" style={{ gap: 9 }}>
              {!integration.configured && (envRequirements[key] || []).map((reason) => <small key={reason} className="row"><AlertCircle size={12} /> Set {reason}</small>)}
              {options.platforms?.[key]?.requirements && <small className="tiny">{options.platforms[key].requirements}</small>}
              <Button href={integration.connectUrl} variant={integration.configured ? 'primary' : 'secondary'} disabled={!integration.configured} className="btn-block">
                <Link2 size={15} /> {integration.configured ? `Connect ${integration.label}` : 'Needs server keys'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Your accounts" subtitle="Toggle automation per account, verify credentials, or disconnect safely." icon={Users} action={<Button variant="ghost" size="sm" onClick={() => reload()}><RefreshCw size={14} /> Refresh</Button>}>
        {loading && !accounts.length ? <Spinner label="Loading accounts…" /> : accounts.length === 0 ? (
          <EmptyState icon={Users} title="No accounts connected" description="Connect the sandbox channel first to test generation, scheduling, and publishing end to end." action={<Button href="/api/oauth/sandbox/connect" variant="primary">Connect sandbox channel</Button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Platform</th><th>Status</th><th>Automation</th><th>Token</th><th>Verified</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td><strong>{account.displayName}</strong><small className="tiny" style={{ display: 'block' }}>{account.handle || account.externalId}</small></td>
                    <td><span className="badge badge-neutral">{account.platformName}</span></td>
                    <td><StatusBadge status={account.status} />{account.lastError && <div className="error-text truncate" style={{ maxWidth: 200 }}>{account.lastError}</div>}</td>
                    <td>
                      <div className="stack" style={{ gap: 2 }}>
                        <Toggle checked={account.active} onChange={(v) => updateAccount(account.id, { active: v })} label="Active" />
                        <Toggle checked={account.automationEnabled} onChange={(v) => updateAccount(account.id, { automationEnabled: v })} label="Autopilot" />
                      </div>
                    </td>
                    <td><small>{account.tokenExpiresAt ? formatDate(account.tokenExpiresAt) : account.status === 'connected' ? 'Long-lived / refreshable' : '—'}</small></td>
                    <td><small>{formatDate(account.lastVerifiedAt)}</small></td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="xs" variant="secondary" onClick={() => testAccount(account.id)} disabled={busy === account.id || account.status !== 'connected'}><Zap size={13} /> Test</Button>
                        <Button size="xs" variant="danger" onClick={() => setDisconnectTarget(account)} disabled={busy === account.id}><Trash2 size={13} /> Disconnect</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        title="Disconnect account?"
        description="Stored tokens are removed immediately. Provider-side authorization is revoked where the official API supports it."
        footer={<><Button variant="ghost" onClick={() => setDisconnectTarget(null)}>Cancel</Button><Button variant="danger" onClick={disconnect} disabled={Boolean(busy)}>{busy ? <Spinner size={15} /> : <Trash2 size={15} />} Disconnect</Button></>}
      >
        <p><strong>{disconnectTarget?.displayName}</strong> will no longer be used for publishing or metrics. Published posts remain in your history.</p>
      </Modal>
    </>
  );
}
