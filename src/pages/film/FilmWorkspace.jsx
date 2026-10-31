import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Clapperboard, Coins, Download,
  Film as FilmIcon, Info, Music, Pause, Play, Plus, RefreshCw, Save, Scissors, Sparkles,
  Square, Trash2, Upload, Users, Volume2, WandSparkles, X,
} from 'lucide-react';
import { get, post, patch, put, del, api, formatDate } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Modal,
  ProgressBar, Spinner, StatusBadge, Toggle, useToast,
} from '../../components/ui.jsx';
import { StoryboardStep, VoiceStep, TimelineStep } from './StoryboardPanels.jsx';
import {
  FilmShell, bumpCredits, pretty, useFilmConfig,
  DURATION_PRESETS, formatDuration, planForDuration, estimateCreditsFor,
} from './FilmStudio.jsx';

// The ten production steps agreed in the brief. Each one is a real screen that
// reads and writes server state; none of them is a stub.
const STEPS = [
  { id: 'setup', label: '1 · Setup' },
  { id: 'write', label: '2 · Screenplay' },
  { id: 'cast', label: '3 · Cast' },
  { id: 'locations', label: '4 · Locations' },
  { id: 'storyboard', label: '5 · Storyboard' },
  { id: 'scenes', label: '6 · Direct & generate' },
  { id: 'voice', label: '7 · Voice' },
  { id: 'timeline', label: '8 · Timeline' },
  { id: 'render', label: '9 · Assemble' },
  { id: 'preview', label: '10 · Preview' },
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
    sceneProvider: film.sceneProvider || '',
  });
  const plan = planForDuration(config?.limits || film.limits, form.targetDurationSeconds);
  const configuredProviders = (config?.videoProvider?.catalog || []).filter((item) => item.configured);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const update = (k, v) => setForm((c) => ({ ...c, [k]: v }));
  async function save(e) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      await patch(`/api/films/${film.id}`, { ...form, targetDurationSeconds: Number(form.targetDurationSeconds), sceneProvider: form.sceneProvider || null });
      await reload({ silent: true }); showToast('Project settings saved.', 'success');
    } catch (err) { setError(err); } finally { setPending(false); }
  }
  async function upload(kind, file, name) {
    const body = new FormData();
    body.append('kind', kind); body.append('file', file);
    if (name) body.append('name', name);
    try {
      await api(`/api/films/${film.id}/upload`, { method: 'POST', body });
      await reload({ silent: true });
      const label = kind === 'music' ? 'Music' : kind === 'sfx' ? 'Sound effect' : 'Reference image';
      showToast(`${label} saved.`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
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
            <Field label="Film length" className="span-2" hint={`Planned as ${plan.sceneCount} clips of ~${plan.sceneSeconds}s. The plan is never silently truncated.`}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {DURATION_PRESETS.filter((preset) => preset.seconds <= (config?.limits?.maxProjectSeconds || 3600)).map((preset) => (
                  <button key={preset.seconds} type="button" className={`film-chip ${Number(form.targetDurationSeconds) === preset.seconds ? 'good' : ''}`} style={{ cursor: 'pointer' }} onClick={() => update('targetDurationSeconds', preset.seconds)}>{preset.label}</button>
                ))}
              </div>
              <input className="input" type="number" min={config?.limits?.minProjectSeconds || 5} max={config?.limits?.maxProjectSeconds || 3600} value={form.targetDurationSeconds} onChange={(e) => update('targetDurationSeconds', e.target.value)} aria-label="Target duration in seconds" />
            </Field>
            <Field label="Video provider" hint="Scene clips are generated by the selected provider. Keys stay server-side.">
              <select className="input" value={form.sceneProvider} onChange={(e) => update('sceneProvider', e.target.value)}>
                <option value="">Server default{config?.videoProvider?.configured ? ` (${pretty(config.videoProvider.provider)})` : ''}</option>
                {configuredProviders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
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
            <div className="film-breakdown-row"><span>Sound effects</span><strong>{film.sfxAssets?.length || 0} uploaded</strong></div>
            <label className="btn btn-secondary btn-sm btn-block" style={{ cursor: 'pointer' }}><Volume2 size={14} /> Upload sound effect<input type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('sfx', f, f.name); e.target.value = ''; }} /></label>
            {film.sfxAssets?.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                {film.sfxAssets.map((asset) => (
                  <div key={asset.id} className="film-breakdown-row">
                    <span>{asset.name} · {Number(asset.durationSeconds || 0).toFixed(1)}s</span>
                    <Button size="xs" variant="ghost" onClick={async () => { await del(`/api/films/${film.id}/sfx/${asset.id}`); await reload({ silent: true }); }} aria-label={`Delete ${asset.name}`}><Trash2 size={12} /></Button>
                  </div>
                ))}
              </div>
            )}
            <p className="film-hint">Sound effects are real audio files mixed under the scene you attach them to. Nothing is synthesised or invented at render time.</p>
          </div>
        </Card>
        <Card title="Production limits" subtitle="Real AI video models produce short clips" icon={Info}>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Max clip length</span><strong>{config?.limits?.maxSceneSeconds ?? film.limits?.maxSceneSeconds}s</strong></div>
            <div className="film-breakdown-row"><span>Max scenes / project</span><strong>{config?.limits?.maxScenes ?? film.limits?.maxScenes}</strong></div>
            <div className="film-breakdown-row"><span>Planned scenes</span><strong>{film.scenePlan}</strong></div>
            <div className="film-breakdown-row"><span>Longest producible film</span><strong>{formatDuration(config?.limits?.maxProducibleSeconds ?? 0)}</strong></div>
            <div className="film-breakdown-row"><span>Parallel scene jobs</span><strong>{config?.limits?.sceneConcurrency ?? '—'}</strong></div>
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

const EMPTY_CHARACTER = {
  name: '', role: 'supporting', description: '', appearancePrompt: '', voicePreset: 'nova',
  wardrobe: '', ageRange: '', expressionsText: '', relationshipsText: '', isLibrary: false,
};

function parseLines(value, keyName = 'name') {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [head, ...rest] = line.split(':');
    return { [keyName]: head.trim().slice(0, 120), description: rest.join(':').trim().slice(0, 300) };
  });
}

function CastStep({ film, reload }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(EMPTY_CHARACTER);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [libraryPick, setLibraryPick] = useState('');
  const { data: library, reload: reloadLibrary } = useLoad(() => get('/api/films/cast-library'), [], { initial: { characters: [] } });
  const update = (k, v) => setForm((c) => ({ ...c, [k]: v }));
  async function add(e) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      await post('/api/films/characters', {
        ...form,
        filmId: film.id,
        seriesId: film.seriesId,
        expressions: parseLines(form.expressionsText),
        relationships: parseLines(form.relationshipsText, 'with').map((row) => ({ with: row.with, kind: row.description })),
      });
      setForm(EMPTY_CHARACTER);
      await reload({ silent: true }); await reloadLibrary({ silent: true });
      showToast('Character added. Their appearance and wardrobe are reused in every scene prompt.', 'success');
    } catch (err) { setError(err); } finally { setPending(false); }
  }
  async function addConcept(character) {
    setPending(`concept-${character.id}`); setError(null);
    try {
      const result = await post(`/api/films/${film.id}/characters/${character.id}/concept`, {});
      await reload({ silent: true });
      showToast(result.usedAsReference
        ? 'Portrait saved and set as the face reference.'
        : 'Concept art saved. Procedural art is never used as a face reference.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(false); }
  }
  async function bringFromLibrary() {
    if (!libraryPick) return;
    setPending('clone'); setError(null);
    try {
      await post(`/api/films/characters/${libraryPick}/clone`, { filmId: film.id });
      setLibraryPick('');
      await reload({ silent: true });
      showToast('Character copied into this project with their wardrobe and relationships.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(false); }
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
              <div className="film-row-main">
                <strong>{character.name} <span className="film-chip">{pretty(character.role)}</span>{character.isLibrary && <span className="film-chip good">library</span>}</strong>
                <small>{character.appearancePrompt || 'No appearance prompt'}</small>
                <small>
                  {character.ageRange ? `Age ${character.ageRange} · ` : ''}{character.wardrobe ? `Wardrobe: ${character.wardrobe} · ` : ''}
                  {character.expressions?.length ? `${character.expressions.length} expression(s) · ` : ''}
                  {character.relationships?.length ? `${character.relationships.length} relationship(s) · ` : ''}
                  Voice: {character.voicePreset}{character.hasReferenceImage ? ' · reference image saved' : ''}
                </small>
              </div>
              <div className="film-row-actions">
                <Button size="sm" variant="ghost" onClick={() => addConcept(character)} disabled={pending === `concept-${character.id}`} aria-label={`Concept art for ${character.name}`}>
                  {pending === `concept-${character.id}` ? <Spinner size={13} /> : <Sparkles size={13} />}
                </Button>
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
          <Field label="Wardrobe" hint="Costume continuity: the same outfit description reaches every scene prompt.">
            <input className="input" value={form.wardrobe} onChange={(e) => update('wardrobe', e.target.value)} placeholder="Chocolate-brown Ankara dress, gold hoops" />
          </Field>
          <Field label="Age range"><input className="input" value={form.ageRange} onChange={(e) => update('ageRange', e.target.value)} placeholder="28-34" /></Field>
          <Field label="Expressions" hint="One per line: name: description. Used for expression-specific coverage.">
            <textarea className="input" rows={2} value={form.expressionsText} onChange={(e) => update('expressionsText', e.target.value)} placeholder={'resolve: jaw set, eyes steady\nfear: wide eyes, shallow breath'} />
          </Field>
          <Field label="Relationships" hint="One per line: character: relationship.">
            <textarea className="input" rows={2} value={form.relationshipsText} onChange={(e) => update('relationshipsText', e.target.value)} placeholder={'Kofi: younger brother\nMadam Bisi: employer'} /></Field>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.isLibrary} onChange={(e) => update('isLibrary', e.target.checked)} />
            <span>Add to my cast library for reuse in other projects</span>
          </label>
          <Button type="submit" disabled={pending || form.name.trim().length < 1}>{pending ? <Spinner size={15} /> : <><Plus size={15} /> Add character</>}</Button>
        </form>
        <div style={{ marginTop: 16 }}>
          <Field label="Bring a character from your cast library" hint="Copies wardrobe, expressions, relationships and voice into this project. The original is untouched.">
            <select className="input" value={libraryPick} onChange={(e) => setLibraryPick(e.target.value)}>
              <option value="">Choose a saved character…</option>
              {(library.data?.characters || []).map((character) => (
                <option key={character.id} value={character.id}>{character.name}{character.wardrobe ? ` — ${character.wardrobe}` : ''}</option>
              ))}
            </select>
          </Field>
          <Button size="sm" variant="secondary" style={{ marginTop: 8 }} onClick={bringFromLibrary} disabled={!libraryPick || pending === 'clone'}>
            {pending === 'clone' ? <Spinner size={13} /> : <><Users size={13} /> Copy into this project</>}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SceneCard({ scene, film, index, total, reload, onMove, onDelete, perVideoSecond = 10 }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const cine = config?.cinematography || {};
  const [draft, setDraft] = useState({
    heading: scene.heading, location: scene.location, description: scene.description,
    visual_prompt: scene.visualPrompt, camera_movement: scene.cameraMovement,
    duration_seconds: scene.durationSeconds, dialogue: scene.dialogue || [],
    cast: (scene.cast || []).join(', '), sfx: scene.sfx || [],
    location_id: scene.locationId || '',
    shot_size: scene.shotSize || '', camera_angle: scene.cameraAngle || '',
    lens: scene.lens || '', lighting: scene.lighting || '',
    color_grade: scene.colorGrade || '', composition: scene.composition || '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sfxAsset, setSfxAsset] = useState('');
  const [sfxAt, setSfxAt] = useState('0');
  const busy = ['queued', 'processing'].includes(scene.status);
  const queued = scene.status === 'planned';
  const wide = film.aspectRatio !== '9:16';
  async function save() {
    setSaving(true); setError(null);
    try {
      await patch(`/api/films/${film.id}/scenes/${scene.id}`, {
        heading: draft.heading, location: draft.location, description: draft.description,
        visual_prompt: draft.visual_prompt, camera_movement: draft.camera_movement,
        location_id: draft.location_id || null,
        shot_size: draft.shot_size, camera_angle: draft.camera_angle, lens: draft.lens,
        lighting: draft.lighting, color_grade: draft.color_grade, composition: draft.composition,
        duration_seconds: Number(draft.duration_seconds),
        dialogue: draft.dialogue.filter((d) => d.character && d.line).map((d) => ({ character: d.character, line: d.line, emotion: d.emotion || '' })),
        cast: String(draft.cast || '').split(',').map((name) => name.trim()).filter(Boolean),
        sfx: draft.sfx,
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
  async function cancel() {
    setPending(true); setError(null);
    try {
      const res = await post(`/api/films/${film.id}/scenes/${scene.id}/cancel`, {});
      bumpCredits(); await reload({ silent: true });
      showToast(`Scene ${index + 1} cancelled. ${res.refunded || 0} credits refunded.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(false); }
  }
  function updateDialogue(i, key, value) {
    setDraft((c) => ({ ...c, dialogue: c.dialogue.map((d, j) => j === i ? { ...d, [key]: value } : d) }));
  }
  const assets = film.sfxAssets || [];
  return (
    <div className="film-scene-card">
      <div className="film-scene-head">
        <span className="film-scene-ordinal">{scene.ordinal}</span>
        <div className="fs-title"><strong>{scene.heading || `Scene ${scene.ordinal}`}</strong><small>{scene.location}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''} · {scene.durationSeconds}s · {scene.creditsCost} credits{scene.provider ? ` · ${scene.provider}` : ''}</small></div>
        <StatusBadge status={scene.status} />
        {scene.hasClip && <span className="film-chip good"><CheckCircle2 size={12} /> Real AI clip</span>}
        <div className="film-row-actions">
          <Button size="sm" variant="ghost" disabled={index === 0 || busy || queued} onClick={() => onMove(scene.id, -1)} aria-label="Move scene up"><ArrowUp size={13} /></Button>
          <Button size="sm" variant="ghost" disabled={index === total - 1 || busy || queued} onClick={() => onMove(scene.id, 1)} aria-label="Move scene down"><ArrowDown size={13} /></Button>
          <Button size="sm" variant="ghost" disabled={busy || queued} onClick={() => onDelete(scene.id)} aria-label="Delete scene"><Trash2 size={13} /></Button>
        </div>
      </div>
      <div className="film-scene-body">
        <div className="film-scene-fields">
          <Field label="Heading"><input className="input" value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} /></Field>
          <div className="film-form-grid">
            <Field label="Saved location" hint="Linking a location keeps production design identical across scenes and episodes.">
              <select className="input" value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
                <option value="">Free-text location</option>
                {(film.locations || []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </Field>
            <Field label="Location note"><input className="input" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Rooftop, Lagos at dusk" /></Field>
          </div>
          <div className="film-form-grid">
            <Field label="Shot size">
              <select className="input" value={draft.shot_size} onChange={(e) => setDraft({ ...draft, shot_size: e.target.value })}>
                <option value="">Not directed</option>
                {(cine.shotSizes || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Camera angle">
              <select className="input" value={draft.camera_angle} onChange={(e) => setDraft({ ...draft, camera_angle: e.target.value })}>
                <option value="">Not directed</option>
                {(cine.cameraAngles || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="film-form-grid">
            <Field label="Lens">
              <select className="input" value={draft.lens} onChange={(e) => setDraft({ ...draft, lens: e.target.value })}>
                <option value="">Default</option>
                {(cine.lenses || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Camera movement">
              <select className="input" value={draft.camera_movement} onChange={(e) => setDraft({ ...draft, camera_movement: e.target.value })}>
                <option value="">Cinematic (default)</option>
                {(cine.cameraMovements || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="film-form-grid">
            <Field label="Lighting">
              <select className="input" value={draft.lighting} onChange={(e) => setDraft({ ...draft, lighting: e.target.value })}>
                <option value="">Natural</option>
                {(cine.lighting || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Colour grade">
              <select className="input" value={draft.color_grade} onChange={(e) => setDraft({ ...draft, color_grade: e.target.value })}>
                <option value="">Neutral</option>
                {(cine.colorGrades || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Composition note" hint="Framing instruction sent to the video model, e.g. subject left third, negative space right.">
            <input className="input" value={draft.composition} onChange={(e) => setDraft({ ...draft, composition: e.target.value })} />
          </Field>
          <Field label="Action / description"><textarea className="input" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label="AI visual prompt" hint="This exact prompt is sent to the AI video provider. Include cast appearance, lighting and lens."><textarea className="input" rows={3} value={draft.visual_prompt} onChange={(e) => setDraft({ ...draft, visual_prompt: e.target.value })} /></Field>
          <Field label="Cast in this scene" hint="Names are matched to the recurring cast so faces, wardrobe and voices stay consistent. Comma separated.">
            <input className="input" value={draft.cast} onChange={(e) => setDraft({ ...draft, cast: e.target.value })} placeholder="Amara, Kofi" />
          </Field>
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
          <div>
            <div className="field-label">Sound effects ({draft.sfx.length})</div>
            {draft.sfx.map((cue, i) => {
              const asset = assets.find((item) => item.id === cue.assetId);
              return (
                <div key={`${cue.assetId}-${i}`} className="film-breakdown-row" style={{ marginBottom: 5 }}>
                  <span><Volume2 size={12} /> {asset?.name || cue.assetId} at {Number(cue.atSeconds || 0).toFixed(1)}s</span>
                  <button className="icon-btn" aria-label="Remove sound effect" onClick={() => setDraft({ ...draft, sfx: draft.sfx.filter((_, j) => j !== i) })}><X size={13} /></button>
                </div>
              );
            })}
            {assets.length === 0
              ? <p className="film-hint">Upload sound effects in Setup → Visual references & audio, then attach them here.</p>
              : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="input" value={sfxAsset} onChange={(e) => setSfxAsset(e.target.value)} aria-label="Sound effect asset" style={{ flex: 1, minWidth: 140 }}>
                    <option value="">Choose a sound effect…</option>
                    {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                  </select>
                  <input className="input" type="number" min="0" max={draft.duration_seconds} step="0.1" value={sfxAt} onChange={(e) => setSfxAt(e.target.value)} aria-label="Sound effect start seconds" style={{ width: 86 }} />
                  <Button size="xs" variant="secondary" disabled={!sfxAsset} onClick={() => { setDraft({ ...draft, sfx: [...draft.sfx, { assetId: sfxAsset, atSeconds: Number(sfxAt) || 0, gain: 1 }] }); setSfxAsset(''); }}><Plus size={12} /> Add cue</Button>
                </div>
              )}
          </div>
          <div className="film-scene-actions">
            <Button size="sm" variant="secondary" onClick={save} disabled={saving || busy}>{saving ? <Spinner size={14} /> : <><Save size={13} /> Save scene</>}</Button>
            <Button size="sm" onClick={generate} disabled={pending || busy || queued}>{pending ? <Spinner size={14} label="Queueing…" /> : busy || queued ? <><RefreshCw size={13} className="spin" /> Generating</> : <><WandSparkles size={13} /> {scene.hasClip ? 'Regenerate this scene' : 'Generate scene'}</>}</Button>
            {(busy || queued) && <Button size="sm" variant="danger" onClick={cancel} disabled={pending}><Square size={13} /> Cancel</Button>}
            <span className="film-chip">~{Math.ceil(Number(draft.duration_seconds || 6) * perVideoSecond)} credits</span>
          </div>
          {busy && <ProgressBar value={scene.progress} label={scene.detail || 'Provider generating'} />}
          {queued && <div className="film-scene-detail">{scene.detail || 'Waiting for a free provider slot…'}</div>}
          {scene.detail && !busy && !queued && <div className="film-scene-detail">{scene.detail}</div>}
          {scene.error && <div className="film-scene-error"><strong>Generation failed — credits refunded.</strong><br />{scene.error}</div>}
          <ErrorBanner error={error} />
        </div>
        <div>
          {scene.hasClip
            ? <video className={`film-scene-preview ${wide ? 'wide' : ''}`} src={`/api/films/${film.id}/scenes/${scene.id}/clip`} poster={scene.hasPoster ? `/api/films/${film.id}/scenes/${scene.id}/poster` : undefined} controls preload="metadata" />
            : scene.hasPoster
              ? <img className={`film-scene-preview ${wide ? 'wide' : ''}`} src={`/api/films/${film.id}/scenes/${scene.id}/poster`} alt="" />
              : <div className={`film-scene-preview ${wide ? 'wide' : ''} film-thumb-placeholder`} style={{ display: 'grid', placeItems: 'center', aspectRatio: wide ? '16/9' : '9/16', color: 'var(--muted-2)', fontSize: 11, textAlign: 'center', padding: 12 }}>No AI clip yet<br />{scene.status}</div>}
          <Field label="Clip length (seconds)" hint={`Provider max ${film.limits?.maxSceneSeconds ?? 10}s`}><input className="input" type="number" min={film.limits?.minSceneSeconds || 4} max={film.limits?.maxSceneSeconds || 10} value={draft.duration_seconds} onChange={(e) => setDraft({ ...draft, duration_seconds: e.target.value })} /></Field>
          {(scene.cast || []).length > 0 && <div className="film-chip-row" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>{scene.cast.map((name) => <span key={name} className="film-chip"><Users size={11} /> {name}</span>)}</div>}
        </div>
      </div>
    </div>
  );
}

function GenerationControls({ film, reload }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const { data: progress, reload: reloadProgress } = useLoad(
    () => get(`/api/films/${film.id}/progress`), [film.id], { initial: null, refreshMs: 3000 },
  );
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const scenes = film.scenes || [];
  const counts = progress?.counts || {
    total: film.sceneCount, ready: film.readyScenes, failed: film.failedScenes,
    planned: film.plannedScenes, queued: film.queuedScenes, processing: 0, cancelled: film.cancelledScenes || 0,
  };
  const runState = progress?.runState || film.runState || 'idle';
  const pendingScenes = scenes.filter((scene) => ['draft', 'failed', 'cancelled'].includes(scene.status));
  const pendingCost = pendingScenes.reduce((n, scene) => n + Math.ceil(scene.durationSeconds * (config?.credits?.perVideoSecond || 10)), 0);
  const canGenerate = Boolean(config?.videoProvider?.configured || config?.videoProvider?.anyConfigured);
  const eta = progress?.etaSeconds;
  const active = (counts.queued || 0) + (counts.processing || 0);
  const finished = counts.total > 0 && counts.ready >= counts.total;
  const etaLabel = eta ? formatDuration(eta)
    : finished ? 'done'
    : (runState === 'running' || runState === 'paused') ? 'measuring…' : '—';

  async function act(kind, path, body = {}) {
    setPending(kind); setError(null);
    try {
      const res = await post(`/api/films/${film.id}${path}`, body);
      bumpCredits();
      await Promise.all([reload({ silent: true }), reloadProgress({ silent: true }).catch(() => {})]);
      setConfirm(false);
      if (kind === 'start') {
        showToast(`${res.queued || 0} scene(s) started now, ${res.planned || 0} queued. Credits are reserved per scene as it starts.`, 'success');
        if (res.errors?.length) showToast(`${res.errors.length} scene(s) could not be queued: ${res.errors[0].message}`, 'error');
      } else if (kind === 'pause') showToast('Generation paused. In-flight scenes will finish.', 'success');
      else if (kind === 'resume') showToast(`Resumed${res.started ? ` — ${res.started} scene(s) started` : ''}.`, 'success');
      else if (kind === 'cancel') showToast(`Run cancelled. ${res.refunded || 0} credits refunded; finished clips were kept.`, 'success');
      else if (kind === 'retry') showToast(`${res.retried || 0} failed scene(s) requeued.`, 'success');
      return res;
    } catch (err) {
      setError(err); showToast(err.message, 'error');
      return null;
    } finally { setPending(null); }
  }

  return (
    <Card
      title="Generation control"
      subtitle={`${counts.ready}/${counts.total} clips ready · ${active} generating · ${counts.planned || 0} queued · ${counts.failed || 0} failed`}
      icon={WandSparkles}
      action={<Button size="sm" variant="ghost" onClick={() => { reload({ silent: true }); reloadProgress({ silent: true }).catch(() => {}); }}><RefreshCw size={13} /> Refresh</Button>}
    >
      <ErrorBanner error={error} />
      {!canGenerate && <InfoBanner tone="warning" icon={Info}><strong>No AI video provider configured.</strong><div className="film-provider-note">Scene generation is disabled; the server will not fabricate clips. Ask an administrator to configure FILM_VIDEO_PROVIDER, FAL_API_KEY, REPLICATE_API_TOKEN or GOOGLE_VEO_API_KEY.</div></InfoBanner>}
      <ProgressBar value={progress?.progress ?? film.progress} label={progress?.detail || film.detail || 'Scene progress'} />
      <div className="film-breakdown" style={{ margin: '12px 0' }}>
        <div className="film-breakdown-row"><span>Run state</span><strong><StatusBadge status={runState === 'idle' ? 'draft' : runState} label={pretty(runState)} /></strong></div>
        <div className="film-breakdown-row"><span>Ready / generating / queued</span><strong>{counts.ready} / {active} / {counts.planned || 0}</strong></div>
        <div className="film-breakdown-row"><span>Failed / cancelled</span><strong>{counts.failed || 0} / {counts.cancelled || 0}</strong></div>
        <div className="film-breakdown-row"><span>Parallel slots</span><strong>{progress?.sceneConcurrency ?? config?.limits?.sceneConcurrency ?? '—'}</strong></div>
        <div className="film-breakdown-row"><span>Estimated remaining</span><strong>{etaLabel}</strong></div>
      </div>
      {progress?.activeScenes?.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {progress.activeScenes.slice(0, 5).map((scene) => (
            <ProgressBar key={scene.id} compact value={scene.progress} label={`Scene ${scene.ordinal} · ${scene.detail || scene.status}`} />
          ))}
          {progress.activeScenes.length > 5 && <p className="film-hint">…and {progress.activeScenes.length - 5} more in flight.</p>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => setConfirm(true)} disabled={pending || !pendingScenes.length || !canGenerate}>
          <Sparkles size={15} /> Generate remaining scenes ({pendingScenes.length})
        </Button>
        {runState !== 'paused'
          ? <Button variant="secondary" disabled={pending || !active && !(counts.planned > 0)} onClick={() => act('pause', '/generation/pause')}><Pause size={14} /> Pause</Button>
          : <Button variant="secondary" disabled={pending} onClick={() => act('resume', '/generation/resume')}><Play size={14} /> Resume</Button>}
        <Button variant="danger" disabled={pending || (runState !== 'running' && !active && !(counts.planned > 0))} onClick={() => act('cancel', '/generation/cancel')}><Square size={14} /> Cancel run</Button>
        {(counts.failed > 0 || counts.cancelled > 0) && <Button variant="secondary" disabled={pending || !canGenerate} onClick={() => act('retry', '/scenes/retry-failed')}><RefreshCw size={14} /> Retry failed ({counts.failed + (counts.cancelled || 0)})</Button>}
        <span className="film-chip">~{pendingCost} credits for unfinished scenes</span>
        <span className="film-chip">Balance {film.balance}</span>
      </div>
      <p className="film-provider-note">Each scene is a separate real AI prediction. The run starts at most {config?.limits?.sceneConcurrency ?? 4} scenes at once; the rest stay queued. Pausing stops new scenes (in-flight ones finish). Cancelling stops provider jobs where the API allows it, refunds reserved credits and keeps every finished clip.</p>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Generate remaining scenes" description="Credits are reserved before each scene starts and refunded automatically if it fails or is cancelled." size="md"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={() => act('start', '/generation/start')} disabled={pending}>{pending ? <Spinner size={14} /> : `Queue ${pendingScenes.length} scenes`}</Button></>}>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Scenes to generate</span><strong>{pendingScenes.length}</strong></div>
          <div className="film-breakdown-row"><span>Estimated credits</span><strong>{pendingCost}</strong></div>
          <div className="film-breakdown-row"><span>Your balance</span><strong>{film.balance}</strong></div>
          <div className="film-breakdown-row"><span>Video provider</span><strong>{pretty(film.sceneProvider || config?.videoProvider?.provider || 'default')}</strong></div>
          <div className="film-breakdown-row"><span>Parallel scene jobs</span><strong>{config?.limits?.sceneConcurrency ?? '—'}</strong></div>
          <div className="film-breakdown-row"><span>Planned runtime</span><strong>{formatDuration(Number(film.targetDurationSeconds))}</strong></div>
        </div>
        <p className="film-provider-note">Real AI clips, up to {film.limits?.maxSceneSeconds}s each. A {formatDuration(Number(film.targetDurationSeconds))} film is assembled from {film.scenePlan} clips — one request never produces a whole movie.</p>
      </Modal>
    </Card>
  );
}

function ScenesStep({ film, reload }) {
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [visible, setVisible] = useState(24);
  const scenes = film.scenes || [];

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
      <GenerationControls film={film} reload={reload} />
      <div className="film-section-title">
        <h2>Storyboard</h2>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <span className="film-chip">{scenes.length} scenes</span>
          <Button size="sm" variant="secondary" onClick={addScene} disabled={adding}><Plus size={13} /> Add scene</Button>
        </div>
      </div>
      {!scenes.length
        ? <EmptyState icon={Scissors} title="No scenes yet" description="Write a screenplay first, or add scenes manually." action={<Button to={`/app/films/project/${film.id}?step=write`}>Write screenplay</Button>} />
        : (
          <>
            <div className="film-scene-grid">{scenes.slice(0, visible).map((scene, i) => <SceneCard key={scene.id} scene={scene} film={film} index={i} total={scenes.length} reload={reload} onMove={move} onDelete={remove} perVideoSecond={film.videoProvider?.provider === 'veo' ? 10 : 10} />)}</div>
            {scenes.length > visible && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                <Button variant="secondary" onClick={() => setVisible((value) => value + 24)}>Show next 24 scenes ({scenes.length - visible} remaining)</Button>
              </div>
            )}
          </>
        )}
    </>
  );
}


function PropsContinuity({ film, reload }) {
  const { showToast } = useToast();
  const props = film.props || [];
  const scenes = film.scenes || [];
  const [form, setForm] = useState({ name: '', description: '', color: '' });
  const [sceneId, setSceneId] = useState(scenes[0]?.id || '');
  const [selection, setSelection] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sceneId && scenes[0]) setSceneId(scenes[0].id);
  }, [scenes, sceneId]);
  useEffect(() => {
    const linked = film.sceneProps?.[sceneId] || [];
    setSelection(Object.fromEntries(linked.map((prop) => [prop.id, prop.state || ''])));
  }, [sceneId, film.sceneProps]);

  async function add(event) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      await post('/api/films/props', { ...form, filmId: film.id });
      setForm({ name: '', description: '', color: '' });
      await reload({ silent: true });
      showToast('Prop saved. Link it to every scene where it appears.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function saveLinks() {
    if (!sceneId) return;
    setSaving(true); setError(null);
    try {
      await put(`/api/films/${film.id}/scenes/${sceneId}/props`, {
        props: Object.entries(selection).map(([propId, state]) => ({ propId, state: state || '' })),
      });
      await reload({ silent: true });
      showToast('Prop continuity saved for this scene.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  const toggle = (propId) => setSelection((current) => {
    const next = { ...current };
    if (propId in next) delete next[propId];
    else next[propId] = '';
    return next;
  });

  return (
    <Card title="Props continuity" subtitle={`${props.length} prop(s) · linked per scene`} icon={Clapperboard}>
      <ErrorBanner error={error} />
      {!props.length
        ? <div className="film-empty-mini">Save an object once — a letter, a ring, a phone — and link it to every scene it appears in. The prop name, material and colour are added to the image and video prompt so it cannot change between shots.</div>
        : (
          <div className="film-list">
            {props.map((prop) => (
              <div className="film-row" key={prop.id}>
                <div className="film-row-main">
                  <strong>{prop.name} <span className="film-chip">{prop.category}</span></strong>
                  <small>{prop.description || 'No description'}{prop.color ? ` · ${prop.color}` : ''}</small>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Delete ${prop.name}`} onClick={async () => {
                  await del(`/api/films/props/${prop.id}`);
                  await reload({ silent: true });
                  showToast('Prop deleted.', 'success');
                }}><Trash2 size={13} /></Button>
              </div>
            ))}
          </div>
        )}

      <form onSubmit={add} className="film-inline-form" style={{ marginTop: 14 }}>
        <Field label="Prop name"><input className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="The letter" /></Field>
        <Field label="Look"><input className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Folded blue aerogram, ink smudged" /></Field>
        <Field label="Colour"><input className="input" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} placeholder="indigo" /></Field>
        <Button type="submit" size="sm" disabled={saving || !form.name.trim()}>{saving ? <Spinner size={13} /> : <><Plus size={13} /> Save prop</>}</Button>
      </form>

      {scenes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Field label="Prop sheet for a scene" hint="Tick every prop that is visible. The optional state is how it looks in this scene: folded, torn, burning.">
            <select className="input" value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
              {scenes.map((scene) => <option key={scene.id} value={scene.id}>Scene {scene.ordinal} — {scene.heading || 'Untitled'}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {props.map((prop) => (
              <div key={prop.id} className="film-inline-form" style={{ alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
                  <input type="checkbox" checked={prop.id in selection} onChange={() => toggle(prop.id)} />
                  <span>{prop.name}</span>
                </label>
                {prop.id in selection && (
                  <input className="input" style={{ maxWidth: 220 }} value={selection[prop.id]} onChange={(event) => setSelection({ ...selection, [prop.id]: event.target.value })} placeholder="state in this scene (optional)" />
                )}
              </div>
            ))}
          </div>
          {props.length > 0 && <Button size="sm" variant="secondary" style={{ marginTop: 10 }} onClick={saveLinks} disabled={saving}><Save size={13} /> Save prop sheet</Button>}
        </div>
      )}
    </Card>
  );
}

function LocationsStep({ film, reload }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', description: '', timeOfDay: '', weather: '', palette: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const locations = film.locations || [];
  const usage = useMemo(() => {
    const counts = {};
    for (const scene of film.scenes || []) if (scene.locationId) counts[scene.locationId] = (counts[scene.locationId] || 0) + 1;
    return counts;
  }, [film.scenes]);

  async function add(event) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      await post(`/api/films/${film.id}/locations`, form);
      setForm({ name: '', description: '', timeOfDay: '', weather: '', palette: '' });
      await reload({ silent: true });
      showToast('Location saved to the production library.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }
  async function remove(location) {
    try {
      const res = await del(`/api/films/${film.id}/locations/${location.id}`);
      await reload({ silent: true });
      showToast(`Location removed${res.detachedScenes ? `; ${res.detachedScenes} scene(s) unlinked` : ''}.`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Production locations" subtitle={`${locations.length} saved · reused by every scene and episode`} icon={Clapperboard}>
        <ErrorBanner error={error} />
        {!locations.length
          ? <EmptyState icon={Clapperboard} title="No locations yet" description="Save the sets you film in once — the description, palette and time of day are reused by every scene set there, so episodes match." />
          : (
            <div className="film-list">
              {locations.map((location) => (
                <div className="film-row" key={location.id}>
                  <div className="film-row-main">
                    <strong>{location.name}</strong>
                    <small>{location.description || 'No description'} · {location.timeOfDay || 'any time'} · {usage[location.id] || 0} scene(s)</small>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(location)} aria-label={`Delete ${location.name}`}><Trash2 size={13} /></Button>
                </div>
              ))}
            </div>
          )}
        <form onSubmit={add} style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <Field label="Location name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Amara's apartment" /></Field>
          <Field label="Set description" hint="Architecture, furniture, props and atmosphere. Sent to the video model for every scene filmed here.">
            <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Small Lagos apartment, worn sofa, lace curtains, framed family photos" />
          </Field>
          <div className="film-form-grid">
            <Field label="Time of day"><input className="input" value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} placeholder="dusk" /></Field>
            <Field label="Weather"><input className="input" value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} placeholder="humid, light rain" /></Field>
          </div>
          <Field label="Palette"><input className="input" value={form.palette} onChange={(e) => setForm({ ...form, palette: e.target.value })} placeholder="warm amber and deep green" /></Field>
          <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? <Spinner size={14} /> : <><Plus size={14} /> Save location</>}</Button>
        </form>
      </Card>
      <PropsContinuity film={film} reload={reload} />
      <Card title="How continuity works" subtitle="Why saved locations matter" icon={Info}>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Locations saved</span><strong>{locations.length}</strong></div>
          <div className="film-breakdown-row"><span>Scenes linked</span><strong>{(film.scenes || []).filter((scene) => scene.locationId).length} / {film.sceneCount}</strong></div>
          <div className="film-breakdown-row"><span>Scenes using free text</span><strong>{(film.scenes || []).filter((scene) => !scene.locationId).length}</strong></div>
        </div>
        <p className="film-provider-note">A linked location replaces the scene's free-text setting in the provider prompt with the saved set description, time of day, weather and palette. That is what keeps Episode 2 in the same room as Episode 1 instead of a freshly imagined one.</p>
        <Button size="sm" variant="secondary" className="btn-block" to={`/app/films/project/${film.id}?step=scenes`}><Scissors size={14} /> Direct scenes</Button>
      </Card>
    </div>
  );
}

function QCPanel({ film }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useLoad(() => get(`/api/films/${film.id}/qc`), [film.id, film.readyScenes, film.status], { initial: null });
  if (!qc.data) return null;
  const tone = qc.data.status === 'pass' ? 'good' : qc.data.status === 'fail' ? 'danger' : 'warning';
  const shown = expanded ? qc.data.checks : qc.data.checks.slice(0, 4);
  return (
    <Card title="Quality control" subtitle={`Continuity & completeness · ${qc.data.score}% · ${qc.data.summary.failed} blocking, ${qc.data.summary.warnings} warning(s)`} icon={CheckCircle2}>
      <div className={`film-chip ${tone}`} style={{ marginBottom: 10 }}>
        {qc.data.status === 'pass' ? <CheckCircle2 size={13} /> : <Info size={13} />} {pretty(qc.data.status)}
      </div>
      <div className="film-breakdown">
        {shown.map((item) => (
          <div className="film-breakdown-row" key={item.id}>
            <span title={item.detail}>
              <span className={`film-chip ${item.status === 'pass' ? 'good' : item.status === 'fail' ? 'danger' : item.status === 'warn' ? 'warning' : ''}`} style={{ marginRight: 6 }}>{item.status}</span>
              {item.label}
            </span>
            <strong style={{ maxWidth: '55%', textAlign: 'right', fontWeight: 500 }}>{item.detail}</strong>
          </div>
        ))}
      </div>
      {qc.data.checks.length > 4 && (
        <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : `Show all ${qc.data.checks.length} checks`}</Button>
      )}
      <Button size="sm" variant="ghost" className="btn-block" style={{ marginTop: 8 }} onClick={() => qc.reload({ silent: true })}><RefreshCw size={13} /> Re-run QC</Button>
    </Card>
  );
}

function RenderStep({ film, reload }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [subtitleMode, setSubtitleMode] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const pre = useLoad(() => get(`/api/films/${film.id}/preflight`), [film.id, film.readyScenes], { initial: null, refreshMs: film.status === 'assembling' ? 4000 : 0 });
  const busy = film.status === 'assembling';
  const recommended = pre.data?.burnInRecommended === false ? 'soft' : 'burn';
  const mode = subtitleMode || (film.metadata?.subtitles === false ? 'none' : recommended);
  const megabytes = pre.data?.estimatedRenderBytes ? Math.ceil(pre.data.estimatedRenderBytes / 1e6) : null;

  async function assemble() {
    setPending('assemble'); setError(null);
    try {
      const res = await post(`/api/films/${film.id}/assemble`, { subtitles: mode !== 'none', burnSubtitles: mode === 'burn' });
      bumpCredits(); await reload({ silent: true }); pre.reload({ silent: true }).catch(() => {}); setConfirm(false);
      showToast(`Render queued in ${res.segments || 1} segment(s); ${res.creditsReserved} credits reserved.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }
  async function cancelRender() {
    setPending('cancel'); setError(null);
    try {
      await post(`/api/films/${film.id}/assembly/cancel`, {});
      await reload({ silent: true });
      showToast('Cancelling the render. Reserved credits will be refunded.', 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="Assemble the complete film" subtitle="Real clips joined into one downloadable MP4" icon={Clapperboard}>
        <ErrorBanner error={error || pre.error} onRetry={() => pre.reload()} />
        <ProgressBar value={busy ? film.progress : film.status === 'completed' || film.status === 'published' ? 100 : 0} label={busy ? film.detail || 'Rendering' : film.status === 'completed' ? 'Film ready' : 'Not rendered yet'} />
        <div className="film-breakdown" style={{ margin: '16px 0' }}>
          <div className="film-breakdown-row"><span>Scenes with real clips</span><strong>{film.readyScenes} / {film.sceneCount}</strong></div>
          <div className="film-breakdown-row"><span>Final duration</span><strong>{formatDuration(pre.data?.durationSeconds ?? film.estimate?.sceneSeconds ?? 0)}</strong></div>
          <div className="film-breakdown-row"><span>Render segments</span><strong>{pre.data?.segments ?? '—'}</strong></div>
          <div className="film-breakdown-row"><span>Temporary disk needed</span><strong>{megabytes ? `${megabytes} MB` : '—'}</strong></div>
          <div className="film-breakdown-row"><span>Sound effects attached</span><strong>{pre.data?.sfxCount ?? film.preflight?.sfxCount ?? 0}</strong></div>
          <div className="film-breakdown-row"><span>Voice engine</span><strong>{film.ttsProvider}</strong></div>
          <div className="film-breakdown-row"><span>Render credits</span><strong>{pre.data?.assemblyCredits ?? '—'}</strong></div>
          <div className="film-breakdown-row"><span>Your balance</span><strong>{film.balance}</strong></div>
        </div>
        <Field label="Subtitles" hint={mode === 'burn' ? 'Burned into the picture (re-encodes the video). Best for short films.' : mode === 'soft' ? 'Muxed as a real subtitle track plus a downloadable .srt — no full re-encode, ideal for long films.' : 'No subtitle track is added; dialogue audio only.'}>
          <select className="input" value={mode} onChange={(e) => setSubtitleMode(e.target.value)} disabled={busy}>
            <option value="burn">Burn into the picture (short films)</option>
            <option value="soft">Soft subtitle track + .srt</option>
            <option value="none">No subtitles</option>
          </select>
        </Field>
        {pre.data?.burnInRecommended === false && <InfoBanner tone="info" icon={Info}><strong>Long film: soft subtitles recommended.</strong><div className="film-provider-note">This cut is longer than the burn-in threshold, so burning subtitles would re-encode the entire timeline. A soft track keeps the render fast and lossless while still giving viewers subtitles and a downloadable .srt.</div></InfoBanner>}
        {(pre.data?.unresolvedSfx || film.preflight?.unresolvedSfx) > 0 && <InfoBanner tone="warning" icon={Info}><strong>{pre.data?.unresolvedSfx || film.preflight?.unresolvedSfx} sound-effect cue(s) reference a missing file.</strong><div className="film-provider-note">Those cues will be skipped. Re-upload the asset or remove the cue from the scene.</div></InfoBanner>}
        {film.missingScenes?.length > 0 && <InfoBanner tone="warning" icon={Info}><strong>{film.missingScenes.length} scene(s) still need a real AI clip.</strong><div className="film-provider-note">The renderer will not invent missing footage. Go to <Link to={`/app/films/project/${film.id}?step=scenes`}>Scenes</Link> to generate them.</div></InfoBanner>}
        {film.error && <div className="film-scene-error">{film.error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Button onClick={() => setConfirm(true)} disabled={pending || busy || !film.assemblyReady}><Sparkles size={15} /> {film.hasVideo ? 'Re-render film' : 'Assemble film'}</Button>
          {busy && <Button variant="danger" onClick={cancelRender} disabled={pending}><Square size={14} /> Cancel render</Button>}
          <Button variant="ghost" onClick={() => { pre.reload({ silent: true }).catch(() => {}); reload({ silent: true }); }}><RefreshCw size={14} /> Refresh status</Button>
        </div>
        <p className="film-provider-note">The renderer normalises every provider clip to one canvas and frame rate, builds the voice and sound-effect timeline scene by scene, renders in segments, mixes optional music, adds subtitles, and exports a verified H.264/AAC MP4 with a thumbnail and .srt file. Long films never hold the full soundtrack in memory and never overwrite a previous cut until the new one is verified.</p>
      </Card>
      <Card title="Missing scenes" subtitle="Assembly is blocked until all clips exist" icon={Info}>
        {!film.missingScenes?.length
          ? <div className="film-chip good"><CheckCircle2 size={13} /> All scenes have real AI clips</div>
          : <div className="film-list">{film.missingScenes.map((s) => <div className="film-row" key={s.id}><div className="film-row-main"><strong>Scene {s.ordinal}</strong><small>{s.heading || 'Untitled'}</small></div><Button size="sm" variant="secondary" to={`/app/films/project/${film.id}?step=scenes`}>Generate</Button></div>)}</div>}
        <div className="film-section-title"><h2>Audio & sound design</h2></div>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Default voice</span><strong>{film.metadata?.voice || 'nova'}</strong></div>
          <div className="film-breakdown-row"><span>Music track</span><strong>{film.hasMusic ? 'Uploaded' : 'None'}</strong></div>
          <div className="film-breakdown-row"><span>Sound effects library</span><strong>{film.sfxAssets?.length || 0}</strong></div>
          <div className="film-breakdown-row"><span>Reference image</span><strong>{film.hasReferenceImage ? 'Uploaded' : 'None'}</strong></div>
        </div>
        <Button size="sm" variant="secondary" className="btn-block" style={{ marginTop: 12 }} to={`/app/films/project/${film.id}?step=setup`}>Manage audio & references</Button>
      </Card>
      <QCPanel film={film} />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Render this film?" description="FFmpeg assembly of your real AI clips. Nothing is re-generated." size="md"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={assemble} disabled={pending}>{pending ? <Spinner size={14} /> : 'Queue render'}</Button></>}>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>Scenes</span><strong>{film.sceneCount}</strong></div>
          <div className="film-breakdown-row"><span>Estimated duration</span><strong>{formatDuration(pre.data?.durationSeconds ?? 0)}</strong></div>
          <div className="film-breakdown-row"><span>Segments</span><strong>{pre.data?.segments ?? 1}</strong></div>
          <div className="film-breakdown-row"><span>Subtitles</span><strong>{mode === 'burn' ? 'Burned in' : mode === 'soft' ? 'Soft track + .srt' : 'None'}</strong></div>
          <div className="film-breakdown-row"><span>Credits reserved</span><strong>{pre.data?.assemblyCredits ?? '—'}</strong></div>
          <div className="film-breakdown-row"><span>Balance after</span><strong>{film.balance - (pre.data?.assemblyCredits || 0)}</strong></div>
        </div>
        <p className="film-provider-note">If rendering fails or is cancelled, reserved credits are refunded automatically and the previous finished cut is kept untouched.</p>
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
      <Card title="Preview & export" subtitle={film.hasVideo ? `${formatDuration(film.durationSeconds)} · ${film.sceneCount} scenes · ${film.aspectRatio}` : 'No final video yet'} icon={FilmIcon}>
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
      {step === 'locations' && <LocationsStep film={film} reload={reload} />}
      {step === 'storyboard' && <StoryboardStep film={film} />}
      {step === 'scenes' && <ScenesStep film={film} reload={reload} />}
      {step === 'voice' && <VoiceStep film={film} />}
      {step === 'timeline' && <TimelineStep film={film} reload={reload} />}
      {step === 'render' && <RenderStep film={film} reload={reload} />}
      {step === 'preview' && <PreviewStep film={film} reload={reload} />}
    </FilmShell>
  );
}
