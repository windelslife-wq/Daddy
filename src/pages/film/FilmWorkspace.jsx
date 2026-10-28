import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Clapperboard, Coins, Download,
  Film as FilmIcon, Info, Music, Plus, RefreshCw, Save, Scissors, Sparkles,
  Trash2, Upload, Users, WandSparkles, X,
} from 'lucide-react';
import { get, post, patch, put, del, api, formatDate } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Modal,
  ProgressBar, Spinner, StatusBadge, Toggle, useToast,
} from '../../components/ui.jsx';
import { FilmShell, bumpCredits, pretty, useFilmConfig } from './FilmStudio.jsx';

const STEPS = [
  { id: 'setup', label: '1 · Setup' },
  { id: 'write', label: '2 · Screenplay' },
  { id: 'cast', label: '3 · Cast' },
  { id: 'scenes', label: '4 · Scenes' },
  { id: 'render', label: '5 · Assemble' },
  { id: 'preview', label: '6 · Preview' },
];

function StepNav({ filmId, active }) {
  return (
    <div className="film-steps">
      {STEPS.map((step) => (
        <Link key={step.id} to={`/app/films/project/${filmId}?step=${step.id}`} className={`film-step ${active === step.id ? 'active' : ''}`}>
          {step.label}
        </Link>
      ))}
    </div>
  );
}

function SetupStep({ film, reload }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const [form, setForm] = useState({
    title: film.title, genre: film.genre, language: film.language, style: film.style,
    aspectRatio: film.aspectRatio, targetPlatform: film.targetPlatform,
    targetDurationSeconds: film.targetDurationSeconds,
    voice: film.metadata?.voice || 'nova', subtitles: film.metadata?.subtitles !== false,
    logline: film.logline,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const update = (k, v) => setForm((c) => ({ ...c, [k]: v }));
  async function save(e) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      await patch(`/api/films/${film.id}`, { ...form, targetDurationSeconds: Number(form.targetDurationSeconds) });
      await reload({ silent: true }); showToast('Project settings saved.', 'success');
    } catch (err) { setError(err); } finally { setPending(false); }
  }
  async function upload(kind, file) {
    const body = new FormData();
    body.append('kind', kind); body.append('file', file);
    try { await api(`/api/films/${film.id}/upload`, { method: 'POST', body }); await reload({ silent: true }); showToast(`${kind === 'music' ? 'Music' : 'Reference image'} saved.`, 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Project setup" subtitle="Format, style, platform and duration" icon={Clapperboard}>
        <form className="film-inline-form" onSubmit={save}>
          <ErrorBanner error={error} />
          <div className="film-form-grid">
            <Field label="Title" className="span-2" required><input className="input" value={form.title} onChange={(e) => update('title', e.target.value)} required /></Field>
            <Field label="Logline" className="span-2"><textarea className="input" rows={2} value={form.logline} onChange={(e) => update('logline', e.target.value)} /></Field>
            <Field label="Genre"><select className="input" value={form.genre} onChange={(e) => update('genre', e.target.value)}>{(config?.genres || ['drama']).map((g) => <option key={g} value={g}>{pretty(g)}</option>)}</select></Field>
            <Field label="Visual style"><select className="input" value={form.style} onChange={(e) => update('style', e.target.value)}>{(config?.styles || ['cinematic']).map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></Field>
            <Field label="Language"><select className="input" value={form.language} onChange={(e) => update('language', e.target.value)}>{(config?.languages || ['en']).map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></Field>
            <Field label="Aspect ratio"><select className="input" value={form.aspectRatio} onChange={(e) => update('aspectRatio', e.target.value)}>{['9:16', '16:9', '1:1'].map((a) => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Target platform"><select className="input" value={form.targetPlatform} onChange={(e) => update('targetPlatform', e.target.value)}>{(config?.platforms || ['tiktok']).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select></Field>
            <Field label="Target duration (seconds)"><input className="input" type="number" min="5" max={config?.limits?.maxProjectSeconds || 3600} value={form.targetDurationSeconds} onChange={(e) => update('targetDurationSeconds', e.target.value)} /></Field>
            <Field label="Default voice"><select className="input" value={form.voice} onChange={(e) => update('voice', e.target.value)}>{['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer', 'sage', 'eleven-default'].map((v) => <option key={v}>{v}</option>)}</select></Field>
            <div className="field"><span className="field-label">Subtitles</span><Toggle checked={form.subtitles} onChange={(v) => update('subtitles', v)} label="Burn in subtitles" description="Dialogue is timed per scene and rendered into the MP4." /></div>
          </div>
          <Button type="submit" disabled={pending}>{pending ? <Spinner size={15} label="Saving…" /> : <><Save size={15} /> Save settings</>}</Button>
        </form>
      </Card>
      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Visual references & audio" subtitle="Optional inputs used during generation and render" icon={Upload}>
          <div className="film-inline-form">
            <div className="film-breakdown-row"><span>Reference image</span><strong>{film.hasReferenceImage ? 'Uploaded' : 'None'}</strong></div>
            <label className="btn btn-secondary btn-sm btn-block" style={{ cursor: 'pointer' }}><Upload size={14} /> Upload reference image<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('reference', f); e.target.value = ''; }} /></label>
            <p className="film-hint">A story or character reference image is sent to image-to-video models. Text-to-video models ignore it.</p>
            <div className="film-breakdown-row"><span>Background music</span><strong>{film.hasMusic ? 'Uploaded' : 'None'}</strong></div>
            <label className="btn btn-secondary btn-sm btn-block" style={{ cursor: 'pointer' }}><Music size={14} /> Upload music track<input type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('music', f); e.target.value = ''; }} /></label>
            <p className="film-hint">Music is looped quietly under dialogue. Only upload audio you are licensed to use commercially.</p>
          </div>
        </Card>
        <Card title="Production limits" subtitle="Real AI video models produce short clips" icon={Info}>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Max clip length</span><strong>{config?.limits?.maxSceneSeconds ?? film.limits?.maxSceneSeconds}s</strong></div>
            <div className="film-breakdown-row"><span>Max scenes / project</span><strong>{config?.limits?.maxScenes ?? film.limits?.maxScenes}</strong></div>
            <div className="film-breakdown-row"><span>Planned scenes</span><strong>{film.scenePlan}</strong></div>
            <div className="film-breakdown-row"><span>Current TTS</span><strong>{film.ttsProvider}</strong></div>
          </div>
          <p className="film-provider-note">{film.limits?.note}</p>
        </Card>
      </div>
    </div>
  );
}

function WriteStep({ film, reload }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const [idea, setIdea] = useState(film.metadata?.idea || film.logline || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const scenes = film.screenplay?.scenes || [];
  async function write() { await doWrite(false); }
  async function applyTitle() {
    try {
      await patch(`/api/films/${film.id}`, { title: result.screenplay.title });
      await reload({ silent: true }); showToast('Project title updated.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function doWrite(allowTemplate) {
    setPending(true); setError(null);
    try {
      const res = await post(`/api/films/${film.id}/screenplay`, {
        idea: idea || film.logline || film.title, type: film.type, genre: film.genre,
        language: film.language, style: film.style, aspectRatio: film.aspectRatio,
        platform: film.targetPlatform, targetDurationSeconds: film.targetDurationSeconds,
        allowTemplate,
      });
      setResult(res); setConfirm(false); bumpCredits(); await reload({ silent: true });
      showToast('Screenplay saved with scenes and cast.', 'success');
    } catch (err) {
      if (err.code === 'ai_provider_required') setConfirm(true); else setError(err);
    } finally { setPending(false); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Write the screenplay" subtitle="An idea becomes a scene-by-scene shooting script" icon={WandSparkles}>
        <form className="film-inline-form" onSubmit={(e) => { e.preventDefault(); write(); }}>
          <ErrorBanner error={error} />
          <Field label="Story idea" required hint="Include the setting, the main characters, and the central conflict."><textarea className="input" rows={6} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Two siblings uncover a secret in their late father's workshop…" required /></Field>
          {!config?.aiScreenplayConfigured && <InfoBanner tone="warning" icon={Info}><strong>No AI text provider configured.</strong><div className="film-provider-note">The result will be a deterministic local template draft, clearly labelled as not AI-generated. Set AI_PROVIDER and its key for real AI writing.</div></InfoBanner>}
          {film.readyScenes > 0 && <InfoBanner tone="warning" icon={Info}><strong>Writing a new screenplay replaces all {film.sceneCount} scenes.</strong><div className="film-provider-note">Existing AI clips will be discarded. Generate scenes again after rewriting.</div></InfoBanner>}
          <Button type="submit" disabled={pending || idea.trim().length < 3}>{pending ? <Spinner size={15} label="Writing screenplay…" /> : <><Sparkles size={15} /> Write screenplay</>}</Button>
          {result && <div className={result.aiGenerated ? 'film-chip good' : 'film-chip warn'}>{result.aiGenerated ? `AI-generated by ${result.provider}` : 'Local template draft — NOT AI-generated'}</div>}
          {result && result.screenplay.title !== film.title && (
            <div className="film-breakdown-row"><span>Suggested title: <strong>{result.screenplay.title}</strong></span><Button size="xs" variant="ghost" onClick={applyTitle}>Use this title</Button></div>
          )}
        </form>
      </Card>
      <Card title="Current screenplay" subtitle={scenes.length ? `${scenes.length} scenes · ${film.estimate?.sceneSeconds || 0}s` : 'No screenplay yet'} icon={FilmIcon}>
        {!scenes.length ? <div className="film-empty-mini">Write a screenplay to create your scene breakdown, dialogue and recurring cast.</div> : (
          <>
            <div className="film-total"><span>Estimated cost to produce</span><strong>{film.estimate?.total ?? '—'} credits</strong></div>
            <div className="film-breakdown" style={{ margin: '12px 0 16px' }}>
              <div className="film-breakdown-row"><span>AI video clips</span><strong>{film.estimate?.breakdown?.video?.credits ?? 0}</strong></div>
              <div className="film-breakdown-row"><span>Voices</span><strong>{film.estimate?.breakdown?.voice?.credits ?? 0}</strong></div>
              <div className="film-breakdown-row"><span>Final render</span><strong>{film.estimate?.breakdown?.assembly?.credits ?? 0}</strong></div>
              <div className="film-breakdown-row"><span>Your balance</span><strong>{film.balance}</strong></div>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
              {scenes.slice(0, 40).map((scene, i) => (
                <div className="film-script-scene" key={i}>
                  <strong>Scene {i + 1} · {scene.heading || scene.location || 'Untitled'} ({scene.duration_seconds}s)</strong>
                  <p>{scene.description}</p>
                  <ul className="film-dialogue">{(scene.dialogue || []).slice(0, 3).map((line, j) => <li key={j}><b>{line.character}:</b> {line.line}</li>)}</ul>
                </div>
              ))}
              {scenes.length > 40 && <p className="film-hint">…and {scenes.length - 40} more scenes.</p>}
            </div>
          </>
        )}
      </Card>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Use a local template draft?" description="No AI text provider is configured on this server." size="md"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={() => doWrite(true)}>Use labelled template</Button></>}>
        <p className="film-hint">We will not pretend a deterministic draft is AI output. The script will be clearly labelled “local template — not AI-generated”. Configure AI_PROVIDER on the server for genuine AI screenwriting.</p>
      </Modal>
    </div>
  );
}

function CastStep({ film, reload }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', role: 'supporting', description: '', appearancePrompt: '', voicePreset: 'nova' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const update = (k, v) => setForm((c) => ({ ...c, [k]: v }));
  async function add(e) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      await post('/api/films/characters', { ...form, filmId: film.id, seriesId: film.seriesId });
      setForm({ name: '', role: 'supporting', description: '', appearancePrompt: '', voicePreset: 'nova' });
      await reload({ silent: true }); showToast('Character added. Their appearance will be reused in every scene prompt.', 'success');
    } catch (err) { setError(err); } finally { setPending(false); }
  }
  async function uploadImage(character, file) {
    const body = new FormData();
    body.append('kind', 'character'); body.append('characterId', character.id); body.append('file', file);
    try { await api(`/api/films/${film.id}/upload`, { method: 'POST', body }); await reload({ silent: true }); showToast('Reference image saved.', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Recurring cast" subtitle={`${film.characters?.length || 0} character(s) linked to this project`} icon={Users}>
        {!film.characters?.length ? <div className="film-empty-mini">Add characters here or write a screenplay — generated cast members are saved automatically. Consistent appearance prompts keep faces stable across scenes.</div> : (
          <div className="film-list">{film.characters.map((character) => (
            <div className="film-row" key={character.id}>
              <div className="film-thumb film-thumb-placeholder"><Users size={19} /></div>
              <div className="film-row-main"><strong>{character.name} <span className="film-chip">{pretty(character.role)}</span></strong><small>{character.appearancePrompt || 'No appearance prompt'}</small><small>Voice: {character.voicePreset} {character.hasReferenceImage && '· reference image saved'}</small></div>
              <div className="film-row-actions">
                <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}><Upload size={13} /> Image<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(character, f); e.target.value = ''; }} /></label>
                <Button size="sm" variant="danger" onClick={async () => { await del(`/api/films/characters/${character.id}`); await reload({ silent: true }); }}><Trash2 size={13} /></Button>
              </div>
            </div>))}</div>)}
        <InfoBanner tone="info" icon={Info}><div className="film-provider-note">Character appearance prompts are injected into every scene's AI video prompt. Provider-level identity/lip-sync features are only available on supported models (for example Google Veo) and are never implied where the provider does not support them.</div></InfoBanner>
      </Card>
      <Card title="Add a character" subtitle="Saved by name for continuity" icon={Plus}>
        <form className="film-inline-form" onSubmit={add}>
          <ErrorBanner error={error} />
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Amara" required /></Field>
          <Field label="Role"><select className="input" value={form.role} onChange={(e) => update('role', e.target.value)}>{['lead', 'supporting', 'antagonist', 'narrator', 'extra'].map((r) => <option key={r} value={r}>{pretty(r)}</option>)}</select></Field>
          <Field label="Voice preset"><select className="input" value={form.voicePreset} onChange={(e) => update('voicePreset', e.target.value)}>{['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer', 'sage', 'eleven-default'].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Description"><textarea className="input" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} /></Field>
          <Field label="Appearance prompt"><textarea className="input" rows={4} value={form.appearancePrompt} onChange={(e) => update('appearancePrompt', e.target.value)} placeholder="Adult woman, short natural black hair, amber linen jacket, warm brown eyes…" /></Field>
          <Button type="submit" disabled={pending || form.name.trim().length < 1}>{pending ? <Spinner size={15} /> : <><Plus size={15} /> Add character</>}</Button>
        </form>
      </Card>
    </div>
  );
}

function SceneCard({ scene, film, index, total, reload, onMove, onDelete, perVideoSecond = 10 }) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState({
    heading: scene.heading, location: scene.location, description: scene.description,
    visual_prompt: scene.visualPrompt, camera_movement: scene.cameraMovement,
    duration_seconds: scene.durationSeconds, dialogue: scene.dialogue || [],
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = ['queued', 'processing'].includes(scene.status);
  const wide = film.aspectRatio !== '9:16';
  async function save() {
    setSaving(true); setError(null);
    try {
      await patch(`/api/films/${film.id}/scenes/${scene.id}`, {
        heading: draft.heading, location: draft.location, description: draft.description,
        visual_prompt: draft.visual_prompt, camera_movement: draft.camera_movement,
        duration_seconds: Number(draft.duration_seconds),
        dialogue: draft.dialogue.filter((d) => d.character && d.line).map((d) => ({ character: d.character, line: d.line, emotion: d.emotion || '' })),
      });
      await reload({ silent: true }); showToast(`Scene ${index + 1} saved.`, 'success');
    } catch (err) { setError(err); } finally { setSaving(false); }
  }
  async function generate() {
    setPending(true); setError(null);
    try {
      await post(`/api/films/${film.id}/scenes/${scene.id}/generate`, {});
      bumpCredits(); await reload({ silent: true });
      showToast(`Scene ${index + 1} queued for real AI generation. Credits reserved.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(false); }
  }
  function updateDialogue(i, key, value) {
    setDraft((c) => ({ ...c, dialogue: c.dialogue.map((d, j) => j === i ? { ...d, [key]: value } : d) }));
  }
  return (
    <div className="film-scene-card">
      <div className="film-scene-head">
        <span className="film-scene-ordinal">{scene.ordinal}</span>
        <div className="fs-title"><strong>{scene.heading || `Scene ${scene.ordinal}`}</strong><small>{scene.location}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''} · {scene.durationSeconds}s · {scene.creditsCost} credits</small></div>
        <StatusBadge status={scene.status} />
        {scene.hasClip && <span className="film-chip good"><CheckCircle2 size={12} /> Real AI clip</span>}
        <div className="film-row-actions">
          <Button size="sm" variant="ghost" disabled={index === 0 || busy} onClick={() => onMove(scene.id, -1)} aria-label="Move scene up"><ArrowUp size={13} /></Button>
          <Button size="sm" variant="ghost" disabled={index === total - 1 || busy} onClick={() => onMove(scene.id, 1)} aria-label="Move scene down"><ArrowDown size={13} /></Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(scene.id)} aria-label="Delete scene"><Trash2 size={13} /></Button>
        </div>
      </div>
      <div className="film-scene-body">
        <div className="film-scene-fields">
          <Field label="Heading"><input className="input" value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} /></Field>
          <div className="film-form-grid">
            <Field label="Location"><input className="input" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></Field>
            <Field label="Camera movement"><input className="input" value={draft.camera_movement} onChange={(e) => setDraft({ ...draft, camera_movement: e.target.value })} /></Field>
          </div>
          <Field label="Action / description"><textarea className="input" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label="AI visual prompt" hint="This exact prompt is sent to the AI video provider. Include cast appearance, lighting and lens."><textarea className="input" rows={3} value={draft.visual_prompt} onChange={(e) => setDraft({ ...draft, visual_prompt: e.target.value })} /></Field>
          <div>
            <div className="field-label">Dialogue ({draft.dialogue.length} lines)</div>
            {draft.dialogue.map((line, i) => (
              <div className="film-form-grid" key={i} style={{ marginBottom: 6 }}>
                <input className="input" value={line.character} onChange={(e) => updateDialogue(i, 'character', e.target.value)} placeholder="Character" aria-label={`Line ${i + 1} character`} />
                <div style={{ display: 'flex', gap: 5 }}>
                  <input className="input" value={line.line} onChange={(e) => updateDialogue(i, 'line', e.target.value)} placeholder="Spoken line" aria-label={`Line ${i + 1} text`} />
                  <button className="icon-btn" onClick={() => setDraft({ ...draft, dialogue: draft.dialogue.filter((_, j) => j !== i) })} aria-label="Remove line"><X size={14} /></button>
                </div>
              </div>
            ))}
            <Button size="xs" variant="ghost" onClick={() => setDraft({ ...draft, dialogue: [...draft.dialogue, { character: '', line: '' }] })}><Plus size={12} /> Add line</Button>
          </div>
          <div className="film-scene-actions">
            <Button size="sm" variant="secondary" onClick={save} disabled={saving || busy}>{saving ? <Spinner size={14} /> : <><Save size={13} /> Save scene</>}</Button>
            <Button size="sm" onClick={generate} disabled={pending || busy}>{pending ? <Spinner size={14} label="Queueing…" /> : busy ? <><RefreshCw size={13} className="spin" /> Generating</> : <><WandSparkles size={13} /> {scene.hasClip ? 'Regenerate this scene' : 'Generate scene'}</>}</Button>
            <span className="film-chip">~{Math.ceil(Number(draft.duration_seconds || 6) * perVideoSecond)} credits</span>
          </div>
          {busy && <ProgressBar value={scene.progress} label={scene.detail || 'Provider generating'} />}
          {scene.detail && !busy && <div className="film-scene-detail">{scene.detail}</div>}
          {scene.error && <div className="film-scene-error"><strong>Generation failed — credits refunded.</strong><br />{scene.error}</div>}
          <ErrorBanner error={error} />
        </div>
        <div>
          {scene.hasClip
            ? <video className={`film-scene-preview ${wide ? 'wide' : ''}`} src={`/api/films/${film.id}/scenes/${scene.id}/clip`} poster={scene.hasPoster ? `/api/films/${film.id}/scenes/${scene.id}/poster` : undefined} controls preload="metadata" />
            : scene.hasPoster
              ? <img className={`film-scene-preview ${wide ? 'wide' : ''}`} src={`/api/films/${film.id}/scenes/${scene.id}/poster`} alt="" />
              : <div className={`film-scene-preview ${wide ? 'wide' : ''} film-thumb-placeholder`} style={{ display: 'grid', placeItems: 'center', aspectRatio: wide ? '16/9' : '9/16', color: 'var(--muted-2)', fontSize: 11, textAlign: 'center', padding: 12 }}>No AI clip yet<br />{scene.status}</div>}
          <Field label="Clip length (seconds)" hint={`Provider max ${film.limits?.maxSceneSeconds ?? 10}s`}><input className="input" type="number" min="4" max={film.limits?.maxSceneSeconds || 10} value={draft.duration_seconds} onChange={(e) => setDraft({ ...draft, duration_seconds: e.target.value })} /></Field>
        </div>
      </div>
    </div>
  );
}

function ScenesStep({ film, reload }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const scenes = film.scenes || [];
  const pendingCount = scenes.filter((s) => !['ready', 'queued', 'processing'].includes(s.status)).length;
  const pendingCost = scenes.filter((s) => !['ready', 'queued', 'processing'].includes(s.status)).reduce((n, s) => n + Math.ceil(s.durationSeconds * (config?.credits?.perVideoSecond || 10)), 0);

  async function generateAll() {
    setPending(true); setError(null);
    try {
      const res = await post(`/api/films/${film.id}/scenes/generate-all`, {});
      bumpCredits(); await reload({ silent: true }); setConfirm(false);
      showToast(`${res.queued} scene(s) queued. ${res.skipped} already ready or in progress.`, 'success');
      if (res.errors?.length) showToast(`${res.errors.length} scene(s) could not be queued.`, 'error');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(false); }
  }
  async function move(sceneId, direction) {
    const order = scenes.map((s) => s.id);
    const from = order.indexOf(sceneId);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    try { await post(`/api/films/${film.id}/scenes/reorder`, { orderedIds: order }); await reload({ silent: true }); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function remove(sceneId) {
    try { await del(`/api/films/${film.id}/scenes/${sceneId}`); await reload({ silent: true }); showToast('Scene removed.', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function addScene() {
    setAdding(true);
    try { await post(`/api/films/${film.id}/scenes`, { heading: `SCENE ${scenes.length + 1}`, visual_prompt: `${film.style} ${film.genre} scene, cinematic lighting, no text.`, duration_seconds: film.limits?.maxSceneSeconds || 10 }); await reload({ silent: true }); showToast('Scene added.', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setAdding(false); }
  }
  return (
    <>
      <Card title="Scene-by-scene generation" subtitle={`${film.readyScenes}/${film.sceneCount} clips ready · ${film.failedScenes} failed · ${film.balance} credits available`} icon={WandSparkles}
        action={<div style={{ display: 'flex', gap: 7 }}><Button size="sm" variant="ghost" onClick={() => reload({ silent: true })}><RefreshCw size={13} /> Refresh</Button><Button size="sm" variant="secondary" onClick={addScene} disabled={adding}><Plus size={13} /> Add scene</Button></div>}>
        <ErrorBanner error={error} />
        <ProgressBar value={film.progress} label={film.detail || 'Scene progress'} />
        {!config?.videoProvider?.configured && <InfoBanner tone="warning" icon={Info}><strong>Video provider missing.</strong><div className="film-provider-note">Scene generation is disabled. The server will not fabricate clips. Ask an administrator to configure FILM_VIDEO_PROVIDER.</div></InfoBanner>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <Button onClick={() => setConfirm(true)} disabled={pending || pendingCount === 0 || !config?.videoProvider?.configured}><Sparkles size={15} /> Generate all remaining scenes ({pendingCount})</Button>
          <span className="film-chip">Estimated {pendingCost} credits for those scenes</span>
          <span className="film-chip">Balance {film.balance}</span>
        </div>
        <p className="film-provider-note">Each scene is a separate real AI provider prediction. You can regenerate one scene without rebuilding the whole project. Failed jobs refund their reserved credits automatically. Progress and clips are saved to disk, so a server restart does not lose finished work.</p>
      </Card>
      <div className="film-section-title"><h2>Storyboard</h2><span className="film-chip">{scenes.length} scenes</span></div>
      {!scenes.length
        ? <EmptyState icon={Scissors} title="No scenes yet" description="Write a screenplay first, or add scenes manually." action={<Button to={`/app/films/project/${film.id}?step=write`}>Write screenplay</Button>} />
        : <div className="film-scene-grid">{scenes.map((scene, i) => <SceneCard key={scene.id} scene={scene} film={film} index={i} total={scenes.length} reload={reload} onMove={move} onDelete={remove} perVideoSecond={config?.credits?.perVideoSecond || 10} />)}</div>}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Generate remaining scenes" description="Credits are reserved before each job starts." size="md"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={generateAll} disabled={pending}>{pending ? <Spinner size={14} /> : `Queue ${pendingCount} scenes`}</Button></>}>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Scenes to generate</span><strong>{pendingCount}</strong></div>
          <div className="film-breakdown-row"><span>Estimated credits</span><strong>{pendingCost}</strong></div>
          <div className="film-breakdown-row"><span>Your balance</span><strong>{film.balance}</strong></div>
          <div className="film-breakdown-row"><span>Video provider</span><strong>{config?.videoProvider?.configured ? pretty(config.videoProvider.provider) : 'Not configured'}</strong></div>
        </div>
        <p className="film-provider-note">Real AI clips, up to {film.limits?.maxSceneSeconds}s each. Long films are assembled from many clips — one request never produces a whole movie.</p>
      </Modal>
    </>
  );
}

function RenderStep({ film, reload }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [subtitles, setSubtitles] = useState(film.metadata?.subtitles !== false);
  const [confirm, setConfirm] = useState(false);
  const pre = useLoad(() => get(`/api/films/${film.id}/preflight`), [film.id, film.readyScenes], { initial: null });
  const busy = film.status === 'assembling';
  async function assemble() {
    setPending(true); setError(null);
    try {
      await post(`/api/films/${film.id}/assemble`, { subtitles });
      bumpCredits(); await reload({ silent: true }); setConfirm(false);
      showToast('Assembly queued. The worker is rendering your film offline.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(false); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Assemble the complete film" subtitle="Real clips joined into one playable MP4" icon={Clapperboard}>
        <ErrorBanner error={error || pre.error} onRetry={() => pre.reload()} />
        <ProgressBar value={busy ? film.progress : film.status === 'completed' || film.status === 'published' ? 100 : 0} label={busy ? film.detail || 'Rendering' : film.status === 'completed' ? 'Film ready' : 'Not rendered yet'} />
        <div className="film-breakdown" style={{ margin: '16px 0' }}>
          <div className="film-breakdown-row"><span>Scenes with real clips</span><strong>{film.readyScenes} / {film.sceneCount}</strong></div>
          <div className="film-breakdown-row"><span>Final duration</span><strong>{pre.data?.durationSeconds ?? film.estimate?.sceneSeconds ?? '—'}s</strong></div>
          <div className="film-breakdown-row"><span>Voice engine</span><strong>{film.ttsProvider}</strong></div>
          <div className="film-breakdown-row"><span>Subtitle track</span><strong>{pre.data?.ttsProvider ? 'Generated from dialogue' : '—'}</strong></div>
          <div className="film-breakdown-row"><span>Render credits</span><strong>{pre.data?.assemblyCredits ?? '—'}</strong></div>
          <div className="film-breakdown-row"><span>Your balance</span><strong>{film.balance}</strong></div>
        </div>
        <Toggle checked={subtitles} onChange={setSubtitles} label="Burn in subtitles" description="Dialogue is timed per scene with an accompanying downloadable .srt file." disabled={busy} />
        {film.missingScenes?.length > 0 && <InfoBanner tone="warning" icon={Info}><strong>{film.missingScenes.length} scene(s) still need a real AI clip.</strong><div className="film-provider-note">The renderer will not invent missing footage. Go to <Link to={`/app/films/project/${film.id}?step=scenes`}>Scenes</Link> to generate them.</div></InfoBanner>}
        {film.error && <div className="film-scene-error">{film.error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Button onClick={() => setConfirm(true)} disabled={pending || busy || !film.assemblyReady}><Sparkles size={15} /> {film.hasVideo ? 'Re-render film' : 'Assemble film'}</Button>
          <Button variant="ghost" onClick={() => { pre.reload({ silent: true }); reload({ silent: true }); }}><RefreshCw size={14} /> Refresh status</Button>
        </div>
        <p className="film-provider-note">The renderer normalises every provider clip to one canvas and frame rate, concatenates them in storyboard order, mixes per-character voices with optional music, burns subtitles, and exports an H.264/AAC MP4 with a thumbnail and .srt file. This is local FFmpeg work — no additional AI provider is involved.</p>
      </Card>
      <Card title="Missing scenes" subtitle="Assembly is blocked until all clips exist" icon={Info}>
        {!film.missingScenes?.length
          ? <div className="film-chip good"><CheckCircle2 size={13} /> All scenes have real AI clips</div>
          : <div className="film-list">{film.missingScenes.map((s) => <div className="film-row" key={s.id}><div className="film-row-main"><strong>Scene {s.ordinal}</strong><small>{s.heading || 'Untitled'}</small></div><Button size="sm" variant="secondary" to={`/app/films/project/${film.id}?step=scenes`}>Generate</Button></div>)}</div>}
        <div className="film-section-title"><h2>Audio</h2></div>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Default voice</span><strong>{film.metadata?.voice || 'nova'}</strong></div>
          <div className="film-breakdown-row"><span>Music track</span><strong>{film.hasMusic ? 'Uploaded' : 'None'}</strong></div>
          <div className="film-breakdown-row"><span>Reference image</span><strong>{film.hasReferenceImage ? 'Uploaded' : 'None'}</strong></div>
        </div>
        <Button size="sm" variant="secondary" className="btn-block" style={{ marginTop: 12 }} to={`/app/films/project/${film.id}?step=setup`}>Manage audio & references</Button>
      </Card>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Render this film?" description="One final FFmpeg pass over your real AI clips." size="md"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={assemble} disabled={pending}>{pending ? <Spinner size={14} /> : 'Queue render'}</Button></>}>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Scenes</span><strong>{film.sceneCount}</strong></div>
          <div className="film-breakdown-row"><span>Estimated duration</span><strong>{pre.data?.durationSeconds ?? '—'}s</strong></div>
          <div className="film-breakdown-row"><span>Credits reserved</span><strong>{pre.data?.assemblyCredits ?? '—'}</strong></div>
          <div className="film-breakdown-row"><span>Balance after</span><strong>{film.balance - (pre.data?.assemblyCredits || 0)}</strong></div>
        </div>
        <p className="film-provider-note">If rendering fails, reserved credits are refunded automatically and the error is shown here.</p>
      </Modal>
    </div>
  );
}

function PreviewStep({ film, reload }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const wide = film.aspectRatio !== '9:16';
  async function publish() {
    setPending(true); setError(null);
    try { await post(`/api/films/${film.id}/publish`, {}); await reload({ silent: true }); showToast('Film marked as published.', 'success'); }
    catch (err) { setError(err); } finally { setPending(false); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Preview & export" subtitle={film.hasVideo ? `${film.durationSeconds}s · ${film.sceneCount} scenes` : 'No final video yet'} icon={FilmIcon}>
        <ErrorBanner error={error} />
        {film.hasVideo ? (
          <>
            <video className={`film-video-frame ${wide ? '' : 'vertical'}`} src={`/api/films/${film.id}/media/video`} poster={film.hasThumbnail ? `/api/films/${film.id}/media/thumbnail` : undefined} controls playsInline preload="metadata" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <Button href={`/api/films/${film.id}/download`} download><Download size={15} /> Download MP4</Button>
              {film.hasCaptions && <Button variant="secondary" href={`/api/films/${film.id}/media/captions?download=1`} download><Download size={15} /> Subtitles (.srt)</Button>}
              {film.hasThumbnail && <Button variant="secondary" href={`/api/films/${film.id}/media/thumbnail?download=1`} download><Download size={15} /> Thumbnail</Button>}
            </div>
          </>
        ) : <EmptyState icon={FilmIcon} title="Nothing to preview yet" description="Generate every scene and assemble the film first." action={<Button to={`/app/films/project/${film.id}?step=render`}>Go to assembly</Button>} />}
      </Card>
      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Publishing" subtitle="Mark the film ready for distribution" icon={Coins}>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Status</span><strong><StatusBadge status={film.status} /></strong></div>
            <div className="film-breakdown-row"><span>Credits spent</span><strong>{film.creditsSpent}</strong></div>
            <div className="film-breakdown-row"><span>Credits estimated</span><strong>{film.creditsEstimated}</strong></div>
            <div className="film-breakdown-row"><span>Completed</span><strong>{film.completedAt ? formatDate(film.completedAt) : '—'}</strong></div>
          </div>
          <Button className="btn-block" style={{ marginTop: 12 }} disabled={pending || !film.hasVideo || film.status === 'published'} onClick={publish}>
            {pending ? <Spinner size={14} /> : film.status === 'published' ? 'Published' : 'Mark as published'}
          </Button>
          <p className="film-provider-note">Publishing records the film (and marks a linked series episode complete). Pushing to TikTok, YouTube or other networks requires connected accounts and official API review in the existing publishing workspace — it is not silently simulated.</p>
          <Button size="sm" variant="ghost" className="btn-block" style={{ marginTop: 8 }} to="/app/publishing">Open publishing workspace</Button>
        </Card>
        <Card title="Next steps" subtitle="You can always resume this project" icon={Sparkles}>
          <div className="film-inline-form">
            <Button size="sm" variant="secondary" to={`/app/films/project/${film.id}?step=scenes`}><WandSparkles size={14} /> Regenerate any scene</Button>
            <Button size="sm" variant="secondary" to={`/app/films/project/${film.id}?step=render`}><RefreshCw size={14} /> Re-render after edits</Button>
            <Button size="sm" variant="ghost" to="/app/films/projects">Back to all projects</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function FilmWorkspace() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const step = STEPS.some((s) => s.id === params.get('step')) ? params.get('step') : 'setup';
  const navigate = useNavigate();
  const { data: film, loading, error, reload } = useLoad(() => get(`/api/films/${id}`), [id], { initial: null, refreshMs: 5000 });

  if (loading && !film) return <FilmShell view="projects" title="Loading project…"><Spinner label="Opening your saved project…" /></FilmShell>;
  if (error && !film) return <FilmShell view="projects" title="Project unavailable"><ErrorBanner error={error} onRetry={() => reload()} /><Button variant="ghost" to="/app/films/projects">Back to projects</Button></FilmShell>;
  if (!film) return null;

  return (
    <FilmShell view="projects" title={film.title} subtitle={`${pretty(film.type)} · ${film.sceneCount} scenes · ${pretty(film.genre)} · ${film.aspectRatio} · saved ${formatDate(film.updatedAt)}`}
      actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className="film-chip"><Coins size={12} /> {film.balance} credits</span><StatusBadge status={film.status} /><Button size="sm" variant="ghost" onClick={() => navigate('/app/films/projects')}><ArrowLeft size={13} /> Projects</Button></div>}>
      <StepNav filmId={id} active={step} />
      {film.error && step !== 'render' && <InfoBanner tone="warning" icon={Info}><strong>{film.error}</strong></InfoBanner>}
      {step === 'setup' && <SetupStep film={film} reload={reload} />}
      {step === 'write' && <WriteStep film={film} reload={reload} />}
      {step === 'cast' && <CastStep film={film} reload={reload} />}
      {step === 'scenes' && <ScenesStep film={film} reload={reload} />}
      {step === 'render' && <RenderStep film={film} reload={reload} />}
      {step === 'preview' && <PreviewStep film={film} reload={reload} />}
    </FilmShell>
  );
}
