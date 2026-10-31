import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Info, Megaphone, Plus, RefreshCw, Sparkles, Trash2,
} from 'lucide-react';
import { get, post, del } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Spinner, useToast,
} from '../../components/ui.jsx';
import { FilmShell, pretty } from './FilmStudio.jsx';

const EMPTY_KIT = { name: '', product: '', tagline: '', description: '', audience: '', colorsText: '' };

export default function AdStudio() {
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const filmId = params.get('film') || '';
  const [form, setForm] = useState(EMPTY_KIT);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  const kits = useLoad(() => get('/api/films/brand-kits'), [], { initial: { brandKits: [] } });
  const projects = useLoad(() => get('/api/films?type=advertisement'), [], { initial: { films: [] } });
  const [attachId, setAttachId] = useState('');
  const ads = useLoad(
    () => (filmId ? get(`/api/films/${filmId}/ads`) : Promise.resolve(null)),
    [filmId],
    { initial: null },
  );

  useEffect(() => {
    if (!filmId) return;
    const kit = ads.data?.brandKit;
    if (kit) setAttachId(kit.id);
  }, [filmId, ads.data]);

  async function createKit(event) {
    event.preventDefault();
    setPending('kit'); setError(null);
    try {
      await post('/api/films/brand-kits', {
        name: form.name, product: form.product, tagline: form.tagline,
        description: form.description, audience: form.audience,
        colors: form.colorsText.split(',').map((value) => value.trim()).filter(Boolean),
      });
      setForm(EMPTY_KIT);
      await kits.reload({ silent: true });
      showToast('Brand kit saved.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  async function removeKit(kit) {
    await del(`/api/films/brand-kits/${kit.id}`);
    await kits.reload({ silent: true });
    if (attachId === kit.id) setAttachId('');
    showToast('Brand kit deleted.', 'success');
  }

  async function attach() {
    if (!filmId) return;
    setPending('attach'); setError(null);
    try {
      await post(`/api/films/${filmId}/ads/attach`, { brandKitId: attachId || null });
      await ads.reload({ silent: true });
      showToast(attachId ? 'Brand kit attached to this campaign.' : 'Brand kit detached.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  async function variations() {
    if (!filmId) return;
    setPending('variations'); setError(null);
    try {
      const result = await post(`/api/films/${filmId}/ads/variations`, { count: 3 });
      await ads.reload({ silent: true });
      showToast(`${result.variants.length} creative angle(s) written. Apply the one you like.`, 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  async function apply(variant) {
    setPending(`apply-${variant.id}`); setError(null);
    try {
      const result = await post(`/api/films/${filmId}/ads/variations/${variant.id}/apply`, {});
      showToast(`Applied "${variant.label}" — ${result.scenes} scene(s) written into the project.`, 'success');
      await ads.reload({ silent: true });
      await projects.reload({ silent: true });
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  const campaigns = projects.data?.films || [];
  const chosen = campaigns.find((film) => film.id === filmId);

  return (
    <FilmShell
      view="ads"
      title="Ad & Marketing Studio"
      subtitle="Brand kits, product intake and real creative variations for advertisement projects."
    >
      <div className="grid grid-studio">
        <div style={{ display: 'grid', gap: 18 }}>
          <Card
            title={chosen ? chosen.title : 'Choose a campaign'}
            subtitle={chosen ? `${pretty(chosen.type)} · ${chosen.status}` : 'Only advertisement projects can run variations'}
            icon={Megaphone}
          >
            <ErrorBanner error={error} />
            <Field label="Advertisement project">
              <select className="input" value={filmId} onChange={(event) => setParams(event.target.value ? { film: event.target.value } : {})}>
                <option value="">Select an advertisement project…</option>
                {campaigns.map((film) => <option key={film.id} value={film.id}>{film.title}</option>)}
              </select>
            </Field>
            {!campaigns.length && (
              <InfoBanner tone="info" icon={Info}>
                <strong>No advertisement projects yet.</strong>
                <div className="film-provider-note">Create one from the hub with the Advertisement format (30-second vertical is the default), then come back here to attach a brand kit.</div>
                <Button size="sm" variant="secondary" style={{ marginTop: 8 }} to="/app/films">Open the film studio hub</Button>
              </InfoBanner>
            )}

            {chosen && (
              <>
                <div className="film-inline-form" style={{ marginTop: 12 }}>
                  <Field label="Brand kit" hint="Adds product, tagline and brand colours to every prompt.">
                    <select className="input" value={attachId} onChange={(event) => setAttachId(event.target.value)}>
                      <option value="">No brand kit</option>
                      {(kits.data?.brandKits || []).map((kit) => <option key={kit.id} value={kit.id}>{kit.name}{kit.product ? ` — ${kit.product}` : ''}</option>)}
                    </select>
                  </Field>
                  <Button size="sm" variant="secondary" onClick={attach} disabled={pending === 'attach'}>
                    {pending === 'attach' ? <Spinner size={13} /> : <>Attach</>}
                  </Button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <Button onClick={variations} disabled={pending === 'variations' || !ads.data?.brandKit}>
                    {pending === 'variations' ? <Spinner size={14} /> : <><Sparkles size={14} /> Write 3 variations</>}
                  </Button>
                  <Button variant="ghost" onClick={() => ads.reload({ silent: true })}><RefreshCw size={13} /> Refresh</Button>
                  <Button variant="ghost" to={`/app/films/project/${filmId}?step=write`}>Open script <ArrowRight size={13} /></Button>
                </div>
                {!ads.data?.brandKit && <p className="film-provider-note">Attach a brand kit first — variations advertise the product it describes, not a guess.</p>}
              </>
            )}
          </Card>

          {filmId && ads.data && (
            <Card title="Creative angles" subtitle={ads.data.variants.length ? `${ads.data.variants.length} generated` : 'Not generated yet'} icon={Sparkles}>
              {!ads.data.variants.length
                ? <div className="film-empty-mini">Variations are written by the same screenplay engine as the rest of the studio. With no AI key the draft is clearly labelled as a deterministic template — it is never passed off as model output.</div>
                : (
                  <div className="film-list">
                    {ads.data.variants.map((variant) => (
                      <div className="film-row" key={variant.id} style={{ alignItems: 'flex-start' }}>
                        <div className="film-row-main">
                          <strong>{variant.label} <span className={`film-chip ${variant.aiGenerated ? 'good' : ''}`}>{variant.aiGenerated ? 'AI' : 'template'}</span></strong>
                          <small>{variant.hook} · CTA: “{variant.cta}” · {variant.scenes} scenes · {variant.provider}</small>
                          <small>{variant.logline}</small>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => apply(variant)} disabled={pending === `apply-${variant.id}`}>
                          {pending === `apply-${variant.id}` ? <Spinner size={13} /> : <><CheckCircle2 size={13} /> Apply</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
            </Card>
          )}
        </div>

        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <Card title="New brand kit" subtitle="Saved to your account" icon={Plus}>
            <form onSubmit={createKit} style={{ display: 'grid', gap: 10 }}>
              <Field label="Brand name" required><input className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Glow" /></Field>
              <Field label="Product"><input className="input" value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} placeholder="Glow vitamin-C serum" /></Field>
              <Field label="Tagline"><input className="input" value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} placeholder="Glow every day" /></Field>
              <Field label="Description"><textarea className="input" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Lightweight serum for oily skin, 30ml amber bottle" /></Field>
              <Field label="Audience"><input className="input" value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} placeholder="Young professionals in Lagos" /></Field>
              <Field label="Brand colours" hint="Comma separated hex values."><input className="input" value={form.colorsText} onChange={(event) => setForm({ ...form, colorsText: event.target.value })} placeholder="#f4b400, #111111" /></Field>
              <Button type="submit" disabled={pending === 'kit' || !form.name.trim()}>{pending === 'kit' ? <Spinner size={14} /> : <><Plus size={14} /> Save brand kit</>}</Button>
            </form>
          </Card>

          <Card title="Your brand kits" subtitle="Reusable across campaigns" icon={Megaphone}>
            {!kits.data?.brandKits?.length
              ? <EmptyState icon={Megaphone} title="No brand kits" description="A kit stores the product, tagline, audience and colours once, then every campaign reuses them." />
              : (
                <div className="film-list">
                  {kits.data.brandKits.map((kit) => (
                    <div className="film-row" key={kit.id}>
                      <div className="film-row-main">
                        <strong>{kit.name}</strong>
                        <small>{kit.product || 'No product'} · {kit.tagline || 'No tagline'}{kit.colors?.length ? ` · ${kit.colors.join(' ')}` : ''}</small>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => removeKit(kit)} aria-label={`Delete ${kit.name}`}><Trash2 size={13} /></Button>
                    </div>
                  ))}
                </div>
              )}
          </Card>

          <Card title="What is real here" subtitle="No mock advertising" icon={Info}>
            <div className="film-breakdown">
              <div className="film-breakdown-row"><span>Brand kit storage</span><strong>Database, per user</strong></div>
              <div className="film-breakdown-row"><span>Variations</span><strong>Screenplay engine</strong></div>
              <div className="film-breakdown-row"><span>Applying a variant</span><strong>Rewrites the scenes</strong></div>
              <div className="film-breakdown-row"><span>Brand colours in prompts</span><strong>Yes</strong></div>
            </div>
            <p className="film-provider-note">Product photography, logo compositing and platform ad-account delivery are not implemented; those need an image model and the existing publishing integrations.</p>
          </Card>
        </div>
      </div>
    </FilmShell>
  );
}
