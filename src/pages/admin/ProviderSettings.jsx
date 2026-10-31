import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, KeyRound, PlugZap, RefreshCw, RotateCcw, Save, ShieldCheck,
} from 'lucide-react';
import { get, post, put } from '../../api.js';
import { useLoad } from '../../hooks.js';
import { Button, Card, ErrorBanner, Field, InfoBanner, Spinner, StatusBadge, useToast } from '../../components/ui.jsx';

const SOURCE_LABEL = {
  dashboard: 'Set in dashboard',
  environment: 'From environment',
};

function sourceBadge(source) {
  if (source === 'dashboard') return 'connected';
  if (source === 'environment') return 'processing';
  return 'needs_review';
}

/**
 * Super Admin provider configuration.
 *
 * This is the only screen that writes provider credentials. Values are submitted
 * once and never returned: the API reports presence, provenance and the last four
 * characters only, so a key can be replaced but never read back.
 */
export default function ProviderSettings() {
  const { showToast } = useToast();
  const { data, loading, error, reload } = useLoad(() => get('/api/admin/providers'), []);
  const [active, setActive] = useState({});
  const [models, setModels] = useState({});
  const [secretInputs, setSecretInputs] = useState({});
  const [clearSecrets, setClearSecrets] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [testResults, setTestResults] = useState({});

  useEffect(() => {
    if (!data) return;
    setActive(Object.fromEntries(data.modalities.map((modality) => [modality.id, modality.active])));
    setModels(Object.fromEntries(data.models.map((field) => [field.id, field.source === 'dashboard' ? field.value : ''])));
    setSecretInputs({});
    setClearSecrets({});
  }, [data]);

  // A choice is only offered as saveable when its credential exists, unless this
  // very request is about to add that credential.
  const readiness = useMemo(() => {
    const credentials = new Map((data?.secrets || []).map((secret) => [secret.id, secret.configured]));
    for (const [id, value] of Object.entries(secretInputs)) {
      if (value.trim()) credentials.set(id, true);
      if (clearSecrets[id]) credentials.delete(id);
    }
    return (modality) => Object.fromEntries(modality.options.map((option) => [
      option.id,
      option.credential ? Boolean(credentials.get(option.credential)) : true,
    ]));
  }, [data, secretInputs, clearSecrets]);

  const dirty = useMemo(() => {
    if (!data) return false;
    const activeChanged = data.modalities.some((modality) => (active[modality.id] || modality.active) !== modality.active);
    const modelsChanged = data.models.some((field) => (models[field.id] || '') !== (field.source === 'dashboard' ? field.value : ''));
    const secretsChanged = Object.values(secretInputs).some((value) => value.trim()) || Object.values(clearSecrets).some(Boolean);
    return activeChanged || modelsChanged || secretsChanged;
  }, [data, active, models, secretInputs, clearSecrets]);

  async function save() {
    if (!data) return;
    const payload = { active: {}, models: {}, secrets: {} };
    for (const modality of data.modalities) {
      if ((active[modality.id] || modality.active) === modality.active) continue;
      payload.active[modality.id] = active[modality.id] || modality.active;
    }
    for (const field of data.models) {
      const next = models[field.id] || '';
      const current = field.source === 'dashboard' ? field.value : '';
      if (next !== current) payload.models[field.id] = next;
    }
    for (const [id, value] of Object.entries(secretInputs)) {
      if (value.trim()) payload.secrets[id] = value.trim();
    }
    for (const [id, clear] of Object.entries(clearSecrets)) {
      if (clear) payload.secrets[id] = null;
    }
    if (!Object.keys(payload.active).length && !Object.keys(payload.models).length && !Object.keys(payload.secrets).length) {
      showToast('Nothing to save.', 'info');
      return;
    }
    setSaving(true);
    try {
      await put('/api/admin/providers', payload);
      setSecretInputs({});
      setClearSecrets({});
      setTestResults({});
      await reload({ silent: true });
      showToast('Provider configuration saved and active now.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testCredential(id) {
    setTesting(id);
    try {
      const result = await post('/api/admin/providers/test', { target: id });
      setTestResults((prev) => ({ ...prev, [id]: result }));
      showToast(result.message, result.ok ? 'success' : result.checked === false ? 'info' : 'error');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setTesting(null);
    }
  }

  if (loading && !data) return <Card><Spinner label="Loading provider configuration…" /></Card>;

  return (
    <div className="stack">
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <InfoBanner icon={ShieldCheck}>
        <strong>Operator-only provider configuration.</strong>
        <span> Credentials saved here are encrypted with <code>APP_ENCRYPTION_KEY</code> and override the server environment.
          Clearing a credential falls back to the environment value; nothing is ever shown again after saving.
          Changes apply immediately on this server, with no restart.</span>
      </InfoBanner>

      {!data?.encryptionActive && (
        <div className="banner banner-warning">
          <AlertCircle size={18} />
          <div>
            <strong>APP_ENCRYPTION_KEY is not set.</strong>
            <span> Stored credentials could not be decrypted after a restart. Set a stable 32-byte key before saving provider keys.</span>
          </div>
        </div>
      )}

      <Card
        title="Active providers"
        icon={PlugZap}
        subtitle="What this server uses for each modality. A provider can only be selected once its credential exists."
        action={<Button size="sm" variant="primary" onClick={save} disabled={saving || !dirty}><Save size={14} /> {saving ? 'Saving…' : 'Save changes'}</Button>}
      >
        <div className="provider-choices">
          {data.modalities.map((modality) => {
            const ready = readiness(modality);
            const chosen = active[modality.id] || modality.active;
            return (
              <div className="provider-choice" key={modality.id}>
                <div className="provider-choice-head">
                  <div>
                    <strong>{modality.label}</strong>
                    <small>{modality.description}</small>
                  </div>
                  <StatusBadge
                    status={selectedReady(modality, chosen, ready) ? sourceBadge(modality.source) : 'needs_review'}
                    label={selectedReady(modality, chosen, ready) ? SOURCE_LABEL[modality.source] : 'Needs a credential'}
                  />
                </div>
                <Field label="Provider" hint={`Environment fallback: ${modality.inherited || '—'} · ${modality.env}`}>
                  <select className="input" value={chosen} onChange={(event) => setActive({ ...active, [modality.id]: event.target.value })}>
                    {modality.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}{ready[option.id] ? '' : ' — credential missing'}
                      </option>
                    ))}
                  </select>
                </Field>
                {modality.options.find((option) => option.id === chosen)?.note && (
                  <p className="tiny">{modality.options.find((option) => option.id === chosen).note}</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Credentials"
        icon={KeyRound}
        subtitle="Write-only. The server reports whether a key exists and where it came from, never the value."
        action={<Button size="sm" variant="ghost" onClick={() => reload().catch(() => {})}><RefreshCw size={14} /> Refresh</Button>}
      >
        <div className="provider-secrets">
          {data.secrets.map((secret) => {
            const result = testResults[secret.id];
            const willClear = Boolean(clearSecrets[secret.id]);
            return (
              <div className="provider-secret" key={secret.id}>
                <div className="provider-secret-head">
                  <div className="list-main">
                    <strong>{secret.label}</strong>
                    <small>
                      {secret.env}
                      {secret.source === 'dashboard' && secret.last4 ? ` · ••••${secret.last4}` : ''}
                      {secret.source === 'environment' ? ' · inherited from the environment (not shown)' : ''}
                    </small>
                  </div>
                  <div className="row">
                    <StatusBadge
                      status={willClear ? 'needs_review' : sourceBadge(secret.source)}
                      label={willClear ? 'Will be cleared' : SOURCE_LABEL[secret.source] || 'Not configured'}
                    />
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => testCredential(secret.id)}
                      disabled={testing === secret.id || !secret.configured || willClear}
                    >
                      {testing === secret.id ? <Spinner size={12} /> : 'Test'}
                    </Button>
                    {secret.source === 'dashboard' && (
                      <Button
                        size="xs"
                        variant={willClear ? 'ghost' : 'danger'}
                        onClick={() => setClearSecrets({ ...clearSecrets, [secret.id]: !willClear })}
                      >
                        {willClear ? 'Keep' : 'Remove'}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="provider-secret-input">
                  <Field label={secret.source === 'dashboard' ? 'Replace credential' : 'Add credential'} hint={result ? result.message : 'Paste the key. It is encrypted before it is stored.'}>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck="false"
                      placeholder={secret.placeholder || 'Paste key'}
                      value={secretInputs[secret.id] || ''}
                      disabled={willClear}
                      onChange={(event) => setSecretInputs({ ...secretInputs, [secret.id]: event.target.value })}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Model overrides"
        icon={CheckCircle2}
        subtitle="Optional. Leave a field empty to use the environment default."
      >
        <div className="provider-models">
          {data.models.map((field) => (
            <Field
              key={field.id}
              label={field.label}
              hint={`${field.env}${field.inherited ? ` · default ${field.inherited}` : ''}`}
            >
              <div className="row">
                <input
                  value={models[field.id] || ''}
                  placeholder={field.inherited || 'Environment default'}
                  onChange={(event) => setModels({ ...models, [field.id]: event.target.value })}
                />
                {field.source === 'dashboard' && (
                  <Button size="xs" variant="ghost" onClick={() => setModels({ ...models, [field.id]: '' })}>
                    <RotateCcw size={13} /> Default
                  </Button>
                )}
              </div>
            </Field>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Button variant="primary" onClick={save} disabled={saving || !dirty}><Save size={15} /> {saving ? 'Saving…' : 'Save changes'}</Button>
          {dirty && <span className="tiny">Unsaved changes.</span>}
        </div>
      </Card>
    </div>
  );
}

function selectedReady(modality, chosen, ready) {
  const option = modality.options.find((item) => item.id === chosen);
  if (!option) return false;
  return option.credential ? Boolean(ready[option.id]) : true;
}
