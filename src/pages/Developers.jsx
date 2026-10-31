import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, CheckCircle2, Download, ExternalLink, KeyRound,
  Plus, ShieldCheck, Trash2,
} from 'lucide-react';
import { del, get, post, formatDate } from '../api.js';
import { useLoad } from '../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, InfoBanner, Modal, PageHeader,
  Spinner, StatusBadge, useToast,
} from '../components/ui.jsx';
import { CodeBlock } from '../components/CodeBlock.jsx';

const SCOPE_CHOICES = [
  { id: 'read', label: 'Read', description: 'List and read your projects, posts, films and channels.' },
  { id: 'write', label: 'Write', description: 'Create projects, video posts and film projects.' },
  { id: 'publish', label: 'Publish', description: 'Approve, schedule and start scene generation.' },
];

export default function Developers() {
  const { showToast } = useToast();
  const { data, loading, error, reload } = useLoad(() => get('/api/developer/keys'), [], {
    initial: { keys: [], scopes: SCOPE_CHOICES, limits: { maxKeys: 10, requestsPerMinute: 120 }, baseUrl: '' },
  });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['read', 'write', 'publish']);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const keys = data?.keys || [];
  const activeKeys = keys.filter((key) => key.active);
  const baseUrl = data?.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  function toggleScope(id) {
    setScopes((current) => (current.includes(id) ? current.filter((scope) => scope !== id) : [...current, id]));
  }

  async function createKey(event) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const created = await post('/api/developer/keys', { name: name.trim(), scopes });
      setRevealed(created);
      setName('');
      setScopes(['read', 'write', 'publish']);
      await reload({ silent: true });
      showToast('API key created. Copy it now — it is shown only once.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await del(`/api/developer/keys/${revokeTarget.id}`);
      showToast(`“${revokeTarget.name}” revoked. Requests with it now fail with 401.`, 'success');
      setRevokeTarget(null);
      await reload({ silent: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setRevoking(false);
    }
  }

  const quickStart = `export FCL_API_KEY="${revealed?.token || 'fcl_live_…'}"
curl "${baseUrl}/api/v1/me" -H "Authorization: Bearer $FCL_API_KEY"`;

  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="Developer API"
        description="Create scoped API keys for the public REST API. Keys authenticate /api/v1 with a bearer token — every request is limited to this account and nothing else."
        actions={(
          <>
            <Link to="/developers" className="btn btn-secondary"><BookOpen size={15} /> API reference</Link>
            <a className="btn btn-secondary" href="/api/developer/openapi.json" download="film-club-lens-openapi.json"><Download size={15} /> OpenAPI</a>
          </>
        )}
      />

      {error && <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />}

      {revealed && (
        <div className="api-reveal">
          <div className="api-reveal-head">
            <CheckCircle2 size={18} />
            <div>
              <strong>Copy “{revealed.key.name}” now — this is the only time the secret is shown.</strong>
              <span>Only a SHA-256 hash is stored. If you lose it, revoke the key and create a new one.</span>
            </div>
          </div>
          <CodeBlock label="your API key" code={revealed.token} />
          <div className="api-reveal-foot">
            <span className="tiny">Scopes: {revealed.key.scopes.join(', ')}</span>
            <Button variant="secondary" size="sm" onClick={() => setRevealed(null)}>I have stored it</Button>
          </div>
        </div>
      )}

      <div className="grid-2 api-dev-grid">
        <Card
          title="API keys"
          subtitle={`${activeKeys.length} active of ${keys.length} · up to ${data?.limits?.maxKeys || 10} per account`}
          icon={KeyRound}
        >
          {loading && !keys.length && <Spinner label="Loading keys…" />}
          {!loading && keys.length === 0 && (
            <EmptyState icon={KeyRound} title="No API keys yet" description="Name a key below and choose the scopes it needs. Start with read + write; add publish only when your integration is ready to go live." />
          )}
          {keys.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Key</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Requests</th><th /></tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <strong>{key.name}</strong>
                        {key.revokedAt && <div><StatusBadge status="revoked" label="Revoked" /></div>}
                      </td>
                      <td><code>{key.prefix}</code></td>
                      <td><div className="chip-row">{key.scopes.map((scope) => <span key={scope} className="chip">{scope}</span>)}</div></td>
                      <td className="tiny">{formatDate(key.createdAt)}</td>
                      <td className="tiny">{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</td>
                      <td>{key.requestCount}</td>
                      <td>
                        {key.active && (
                          <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(key)} aria-label={`Revoke ${key.name}`}>
                            <Trash2 size={14} /> Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="api-key-form" onSubmit={createKey}>
            <h3><Plus size={15} /> Create a key</h3>
            <label className="field">
              <span className="field-label">Key name</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Build pipeline"
                maxLength={80}
                minLength={2}
                required
              />
              <span className="field-hint">Something you will recognise later, for example “Zapier” or “Nightly render”.</span>
            </label>
            <fieldset className="api-scope-picker">
              <legend>Scopes</legend>
              {SCOPE_CHOICES.map((scope) => (
                <label key={scope.id} className={scopes.includes(scope.id) ? 'api-scope-option active' : 'api-scope-option'}>
                  <input type="checkbox" checked={scopes.includes(scope.id)} onChange={() => toggleScope(scope.id)} />
                  <span><strong>{scope.label}</strong><em>{scope.description}</em></span>
                </label>
              ))}
            </fieldset>
            <div className="row-between">
              <span className="tiny">{data?.limits?.requestsPerMinute || 120} requests / minute per key</span>
              <Button type="submit" disabled={creating || scopes.length === 0}>
                <KeyRound size={15} /> {creating ? 'Creating…' : 'Create key'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="stack">
          <Card title="Use your key" subtitle="Copy-paste this into a terminal" icon={ShieldCheck}>
            <CodeBlock label="shell" code={quickStart} dense />
            <ul className="api-checklist">
              <li><strong>Send the key in a header</strong>, never in a URL: <code>Authorization: Bearer …</code>.</li>
              <li><strong>Server-side only.</strong> A browser or mobile binary cannot keep a secret.</li>
              <li><strong>Revocation is immediate.</strong> The next request with a revoked key returns 401.</li>
            </ul>
          </Card>

          <Card title="Reference" subtitle="Generated from the running server" icon={BookOpen}>
            <div className="link-list">
              <Link to="/developers" className="link-row"><span><strong>API reference</strong><em>Endpoints, examples, errors, webhooks</em></span><ExternalLink size={15} /></Link>
              <a href="/api/developer/spec" className="link-row" target="_blank" rel="noreferrer"><span><strong>Live specification</strong><em>/api/developer/spec</em></span><ExternalLink size={15} /></a>
              <a href="/api/developer/openapi.json" className="link-row" download="film-club-lens-openapi.json"><span><strong>OpenAPI 3.1 document</strong><em>Import into Postman or a client generator</em></span><Download size={15} /></a>
              <a href="/api/meta/status" className="link-row" target="_blank" rel="noreferrer"><span><strong>Provider status</strong><em>Which AI and publishing providers this deployment has</em></span><ExternalLink size={15} /></a>
            </div>
            <InfoBanner>
              Generation and publishing are asynchronous. Create work with this API and poll the resource — the endpoints never claim a render finished before it did.
            </InfoBanner>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title={`Revoke “${revokeTarget?.name || ''}”?`}
        description="Requests using this key stop working immediately. This cannot be undone."
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={revoke} disabled={revoking}>{revoking ? 'Revoking…' : 'Revoke key'}</Button>
          </>
        )}
      >
        <div className="banner banner-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Check your integrations first</strong>
            <span>Anything still sending this key will start receiving <code>401 unauthorized</code>.</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
