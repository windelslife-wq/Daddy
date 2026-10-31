import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Clapperboard, Coins, Download, Film as FilmIcon,
  Image as ImageIcon, Info, Layers, Mic2, Music, PenLine, Play, Plus, RefreshCw,
  Scissors, Smartphone, Sparkles, Trash2, Upload, Users, WandSparkles,
} from 'lucide-react';
import { get, post, patch, put, del, api, formatDate } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Modal, PageHeader,
  ProgressBar, Spinner, StatusBadge, Tabs, Toggle, useToast,
} from '../../components/ui.jsx';
import { Icon } from '../../components/Icon.jsx';
import { FILM_PAGES } from '../../config/site.js';
import './film.css';

export const CREDIT_EVENT = 'film-credits-changed';
export const bumpCredits = () => window.dispatchEvent(new Event(CREDIT_EVENT));

export const pretty = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const TYPE_LABELS = {
  short_drama: 'Short drama', long_drama: 'Long drama', movie: 'Movie', episode: 'Series episode',
  advertisement: 'Advertisement', music_video: 'Music video', cinematic_scene: 'Cinematic scene',
};

const FORMATS = [
  { id: 'short_drama', icon: Smartphone, title: 'Short Drama', body: '45–90 second vertical dramas for TikTok, Shorts, Reels and Facebook.', tag: '9:16 · 1–3 min', colour: 'primary' },
  { id: 'long_drama', icon: FilmIcon, title: 'Long Drama', body: 'Multi-scene stories assembled scene-by-scene into one continuous film.', tag: '16:9 or 9:16 · 5–60 min', colour: 'cyan' },
  { id: 'movie', icon: Clapperboard, title: 'Movie', body: 'Feature-length projects built from hundreds of real AI clips, with cast continuity, sound design and subtitles.', tag: '16:9 · 30–60 min', colour: 'amber' },
  { id: 'series', icon: Layers, title: 'Episodic Series', body: 'Seasons, episodes, story bibles, recurring characters, thumbnails and credits.', tag: 'Seasons & episodes', colour: 'green' },
  { id: 'advertisement', icon: Sparkles, title: 'Advertisement', body: 'Product films, brand campaigns and social ads with consistent characters and locations.', tag: '15–120 s · 9:16 or 16:9', colour: 'primary' },
  { id: 'music_video', icon: Music, title: 'Music Video', body: 'Beat-driven visuals, performance scenes and cinematic transitions edited on one timeline.', tag: '1–5 min', colour: 'cyan' },
  { id: 'cinematic_scene', icon: Clapperboard, title: 'Cinematic Scene', body: 'A single directed scene or trailer beat — shot list, camera direction and sound design.', tag: '1–3 min', colour: 'amber' },
];

/** Long-form duration shortcuts, in seconds. Any value between the limits works. */
export const DURATION_PRESETS = [
  { label: '1 min', seconds: 60 },
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
  { label: '20 min', seconds: 1200 },
  { label: '30 min', seconds: 1800 },
  { label: '45 min', seconds: 2700 },
  { label: '60 min', seconds: 3600 },
];

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Scene plan for a duration. Mirrors the server planner: ceil(duration / max
 * clip length), never truncated to a hidden cap.
 */
export function planForDuration(limits, seconds) {
  const perClip = Math.max(1, Number(limits?.maxSceneSeconds) || 10);
  const duration = Math.max(1, Number(seconds) || perClip);
  const sceneCount = Math.max(1, Math.ceil(duration / perClip));
  const sceneSeconds = Math.max(1, Math.min(perClip, Math.ceil(duration / sceneCount)));
  const maxScenes = Number(limits?.maxScenes) || sceneCount;
  return { sceneCount, sceneSeconds, maxScenes, exceeds: sceneCount > maxScenes, duration };
}

export function estimateCreditsFor(limits, credits, seconds) {
  const plan = planForDuration(limits, seconds);
  const perSecond = Number(credits?.perVideoSecond) || 10;
  return plan.sceneCount * plan.sceneSeconds * perSecond;
}

export function useFilmConfig() {
  return useLoad(() => get('/api/films/config'), [], { initial: null });
}

export function FilmShell({ view = 'hub', title, subtitle, actions, children }) {
  const { data: config, reload } = useFilmConfig();
  useEffect(() => {
    const handler = () => reload({ silent: true }).catch(() => {});
    window.addEventListener(CREDIT_EVENT, handler);
    return () => window.removeEventListener(CREDIT_EVENT, handler);
  }, [reload]);
  const video = config?.videoProvider;
  return (
    <div className="film-shell">
      <div className="film-topbar">
        <div>
          <h1>{title || 'AI Filmmaking Studio'}</h1>
          <p>{subtitle || 'Short dramas, long dramas, episodic series and full movies — one production pipeline.'}</p>
        </div>
        <div className="film-topbar-meta">
          <span className={video?.configured ? 'film-chip good' : 'film-chip warn'}>
            <span className={video?.configured ? 'status-dot good' : 'status-dot warn'} />
            {video?.configured ? `${pretty(video.provider)} video ready` : 'Video provider not configured'}
          </span>
          <Link className="film-credit-pill" to="/app/films/credits"><Coins size={15} /><strong>{config?.credits?.balance ?? '—'}</strong> credits</Link>
        </div>
      </div>
      <nav className="film-nav" aria-label="Film studio sections">
        {FILM_PAGES.map((page) => (
          <Link key={page.path} to={page.path} className={view === page.path.split('/').pop() || (view === 'hub' && page.path === '/app/films') ? 'active' : ''}>
            <Icon name={page.icon} size={14} />{page.label}
          </Link>
        ))}
      </nav>
      {config && !video?.configured && (
        <InfoBanner tone="warning" icon={Info}>
          <strong>Real AI video generation is not configured on this server.</strong>
          <div className="film-provider-note">
            Screenwriting, scene planning, credits, assembly and export still work, but no clip will ever be fabricated.
            An administrator must set <code>FILM_VIDEO_PROVIDER</code> plus <code>REPLICATE_API_TOKEN</code>, <code>FAL_API_KEY</code> or <code>GOOGLE_VEO_API_KEY</code>.
            See <Link to="/docs">documentation</Link>.
          </div>
        </InfoBanner>
      )}
      {config && !config.aiScreenplayConfigured && (
        <InfoBanner tone="info" icon={Sparkles} action={<div style={{ marginTop: 8 }} />}>
          <strong>AI screenwriting is in local-template mode.</strong>
          <div className="film-provider-note">Scripts are clearly labelled deterministic drafts, not AI output. Configure <code>AI_PROVIDER=openai|anthropic|gemini</code> and its key for genuine AI stories.</div>
        </InfoBanner>
      )}
      {actions && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>{actions}</div>}
      {children}
    </div>
  );
}

export function FilmRow({ film, onOpen, showDownload = true }) {
  const navigate = useNavigate();
  const href = `/app/films/project/${film.id}`;
  return (
    <div className="film-row">
      {film.hasThumbnail
        ? <img className="film-thumb" src={`/api/films/${film.id}/media/thumbnail`} alt="" />
        : <div className="film-thumb film-thumb-placeholder"><FilmIcon size={20} /></div>}
      <div className="film-row-main">
        <strong>{film.title}</strong>
        <small>{TYPE_LABELS[film.type] || film.type} · {film.sceneCount} scenes · {pretty(film.genre)} · {film.aspectRatio} · updated {formatDate(film.updatedAt)}</small>
        {film.sceneCount > 0 && <ProgressBar value={film.progress} compact />}
      </div>
      <div className="film-row-meta">
        <StatusBadge status={film.status} />
        {film.error && <span className="film-chip warn" title={film.error}>Has error</span>}
      </div>
      <div className="film-row-actions">
        <Button size="sm" variant="secondary" onClick={() => onOpen ? onOpen(film) : navigate(href)}>Open <ArrowRight size={13} /></Button>
        {showDownload && film.hasVideo && <Button size="sm" variant="ghost" href={`/api/films/${film.id}/download`} download><Download size={13} /> MP4</Button>}
      </div>
    </div>
  );
}

function ProjectList({ type, types, status, emptyTitle = 'No projects yet', emptyBody, newType, predicate }) {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(() => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    return get(`/api/films?${params.toString()}`);
  }, [type, status], { initial: { films: [] } });
  const [creating, setCreating] = useState(false);
  const films = (data?.films || []).filter((film) => (!types || types.includes(film.type)) && (!predicate || predicate(film)));
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="film-hint">{loading ? 'Loading…' : `${films.length} project(s) — all progress is saved automatically.`}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => reload()}><RefreshCw size={14} /> Refresh</Button>
          <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> New project</Button>
        </div>
      </div>
      <ErrorBanner error={error} onRetry={() => reload()} />
      {!loading && !films.length
        ? <EmptyState icon={FilmIcon} title={emptyTitle} description={emptyBody || 'Create a project, write a screenplay, then generate each scene.'} action={<Button onClick={() => setCreating(true)}><Plus size={15} /> Create project</Button>} />
        : <div className="film-list">{films.map((film) => <FilmRow key={film.id} film={film} onOpen={() => navigate(`/app/films/project/${film.id}`)} />)}</div>}
      {creating && <NewProjectModal defaultType={newType || type || 'short_drama'} onClose={() => setCreating(false)} onCreated={(film) => navigate(`/app/films/project/${film.id}`)} />}
    </>
  );
}

export function NewProjectModal({ defaultType = 'short_drama', onClose, onCreated }) {
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    type: defaultType === 'series' ? 'episode' : defaultType,
    title: '', idea: '', genre: 'african_stories', language: 'en', style: 'cinematic',
    aspectRatio: ['short_drama', 'advertisement'].includes(defaultType) ? '9:16' : '16:9',
    targetPlatform: ['short_drama', 'advertisement'].includes(defaultType) ? 'tiktok' : 'youtube',
    targetDurationSeconds: defaultType === 'advertisement' ? 30 : defaultType === 'music_video' ? 180
      : defaultType === 'cinematic_scene' ? 90 : defaultType === 'short_drama' ? 60 : defaultType === 'long_drama' ? 600 : 1800,
    sceneProvider: '',
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const plan = planForDuration(config?.limits, form.targetDurationSeconds);
  const scenePlan = config ? plan.sceneCount : '—';
  const estimatedCredits = config ? estimateCreditsFor(config.limits, config.credits, form.targetDurationSeconds) + (config.credits?.perAssembly || 0) : null;
  const configuredProviders = (config?.videoProvider?.catalog || []).filter((item) => item.configured);

  async function submit(event) {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      const created = await post('/api/films', {
        type: form.type, title: form.title.trim(), genre: form.genre, language: form.language,
        style: form.style, aspectRatio: form.aspectRatio, targetPlatform: form.targetPlatform,
        targetDurationSeconds: Number(form.targetDurationSeconds),
        sceneProvider: form.sceneProvider || null,
      });
      if (form.idea.trim().length >= 3) {
        await post(`/api/films/${created.film.id}/screenplay`, {
          idea: form.idea.trim(), type: form.type, genre: form.genre, language: form.language,
          style: form.style, aspectRatio: form.aspectRatio, platform: form.targetPlatform,
          targetDurationSeconds: Number(form.targetDurationSeconds), allowTemplate: true,
        });
      }
      showToast('Project created. Your progress is saved.', 'success');
      onCreated?.(created.film);
      onClose?.();
    } catch (err) { setError(err); }
    finally { setPending(false); }
  }

  return (
    <Modal open onClose={onClose} title="New film project" description="Choose a format, describe the story, and we'll break it into short producible scenes." size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={pending || form.title.trim().length < 2}>{pending ? <Spinner size={15} label="Creating…" /> : <><Plus size={15} /> Create project</>}</Button></>}>
      <form className="film-inline-form" onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="film-form-grid">
          <Field label="Project title" required><input className="input" value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="e.g. The Last Message" required /></Field>
          <Field label="Format"><select className="input" value={form.type} onChange={(e) => update('type', e.target.value)}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></Field>
          <Field label="Genre"><select className="input" value={form.genre} onChange={(e) => update('genre', e.target.value)}>
            {(config?.genres || ['drama']).map((item) => <option key={item} value={item}>{pretty(item)}</option>)}
          </select></Field>
          <Field label="Visual style"><select className="input" value={form.style} onChange={(e) => update('style', e.target.value)}>
            {(config?.styles || ['cinematic']).map((item) => <option key={item} value={item}>{pretty(item)}</option>)}
          </select></Field>
          <Field label="Language"><select className="input" value={form.language} onChange={(e) => update('language', e.target.value)}>
            {(config?.languages || ['en']).map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
          </select></Field>
          <Field label="Aspect ratio"><select className="input" value={form.aspectRatio} onChange={(e) => update('aspectRatio', e.target.value)}>
            <option value="9:16">Vertical 9:16 (TikTok / Shorts / Reels)</option><option value="16:9">Horizontal 16:9 (YouTube / movies)</option><option value="1:1">Square 1:1</option>
          </select></Field>
          <Field label="Target platform"><select className="input" value={form.targetPlatform} onChange={(e) => update('targetPlatform', e.target.value)}>
            {(config?.platforms || ['tiktok']).map((item) => <option key={item} value={item}>{pretty(item)}</option>)}
          </select></Field>
          <Field label="Film length" className="span-2" hint={`Planned as ${scenePlan} AI clips of ~${plan.sceneSeconds}s each. Long films are always generated scene by scene.`}>
            <div className="film-preset-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {DURATION_PRESETS.filter((preset) => preset.seconds <= (config?.limits?.maxProjectSeconds || 3600)).map((preset) => (
                <button key={preset.seconds} type="button"
                  className={`film-chip ${Number(form.targetDurationSeconds) === preset.seconds ? 'good' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => update('targetDurationSeconds', preset.seconds)}>
                  {preset.label}
                </button>
              ))}
            </div>
            <input className="input" type="number" min={config?.limits?.minProjectSeconds || 5} max={config?.limits?.maxProjectSeconds || 3600} value={form.targetDurationSeconds} onChange={(e) => update('targetDurationSeconds', e.target.value)} aria-label="Target duration in seconds" />
          </Field>
          <Field label="Video provider" hint="Only providers configured on this server can be selected.">
            <select className="input" value={form.sceneProvider} onChange={(e) => update('sceneProvider', e.target.value)}>
              <option value="">Server default{config?.videoProvider?.configured ? ` (${pretty(config.videoProvider.provider)})` : ''}</option>
              {configuredProviders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Story idea" className="span-2" hint="Optional — you can also write the script later in the AI Script Writer.">
            <textarea className="input" rows={3} value={form.idea} onChange={(e) => update('idea', e.target.value)} placeholder="Two siblings uncover a secret in their late father's workshop…" />
          </Field>
        </div>
        <div className="film-breakdown" style={{ marginTop: 10 }}>
          <div className="film-breakdown-row"><span>Planned clips</span><strong>{scenePlan}{plan.exceeds ? ' (over limit)' : ''}</strong></div>
          <div className="film-breakdown-row"><span>Runtime</span><strong>{formatDuration(Number(form.targetDurationSeconds))}</strong></div>
          {estimatedCredits !== null && <div className="film-breakdown-row"><span>Estimated credits</span><strong>{estimatedCredits}</strong></div>}
          <div className="film-breakdown-row"><span>Longest film this server can produce</span><strong>{config ? formatDuration((config.limits.maxProducibleSeconds) || 0) : '—'}</strong></div>
        </div>
        {plan.exceeds && <InfoBanner tone="warning" icon={Info}><strong>This length needs {plan.sceneCount} scenes; the server allows {plan.maxScenes}.</strong><div className="film-provider-note">Shorten the film or raise FILM_MAX_SCENES and FILM_MAX_PROJECT_SECONDS together. The project will be rejected rather than silently shortened.</div></InfoBanner>}
        <div className="film-hint">A {formatDuration(Number(form.targetDurationSeconds))} film is planned as {scenePlan} real AI clips of up to {config?.limits?.maxSceneSeconds || 10}s, rendered scene by scene and assembled into one MP4. Each scene can be reviewed and regenerated later.</div>
      </form>
    </Modal>
  );
}

function Hub() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(null);
  const { data, loading, error, reload } = useLoad(() => get('/api/films?limit=6'), [], { initial: { films: [] } });
  const { data: series } = useLoad(() => get('/api/films/series'), [], { initial: { series: [] } });
  const { data: credits } = useFilmConfig();
  return (
    <>
      <div className="film-format-grid">
        {FORMATS.map((format) => (
          <button key={format.id} className="film-format-card" onClick={() => format.id === 'series' ? navigate('/app/films/series') : setCreating(format.id)}>
            <span className="ff-icon"><format.icon size={21} /></span>
            <h3>{format.title}</h3>
            <p>{format.body}</p>
            <span className="ff-tag">{format.tag} →</span>
          </button>
        ))}
      </div>

      <div className="film-section-title"><h2>Recent projects</h2><Button size="sm" variant="ghost" onClick={() => navigate('/app/films/projects')}>View all <ArrowRight size={13} /></Button></div>
      <ErrorBanner error={error} onRetry={() => reload()} />
      {loading ? <Spinner label="Loading projects…" /> : data?.films?.length
        ? <div className="film-list">{data.films.map((film) => <FilmRow key={film.id} film={film} onOpen={() => navigate(`/app/films/project/${film.id}`)} />)}</div>
        : <EmptyState icon={Clapperboard} title="Start your first film" description="Pick a format above. Your project, screenplay, cast, scenes and credits are saved at every step." action={<Button onClick={() => setCreating('short_drama')}><Plus size={15} /> New short drama</Button>} />}

      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <Card title="Your series" subtitle="Seasons, episodes and story bibles" icon={Layers} action={<Button size="sm" variant="ghost" to="/app/films/series">Manage</Button>}>
          {series?.series?.length
            ? <div className="film-list">{series.series.slice(0, 4).map((s) => (
              <div className="film-row" key={s.id}>
                <div className="film-row-main"><strong>{s.title}</strong><small>{s.episodeCount} episodes · {s.seasons.length} season(s) · {pretty(s.genre)}</small></div>
                <Button size="sm" variant="secondary" to="/app/films/series">Open</Button>
              </div>))}</div>
            : <div className="film-empty-mini">No series yet. Create one to manage recurring characters, seasons, episodes, thumbnails and credits.</div>}
        </Card>
        <Card title="Credits & generation cost" subtitle="You always see the estimate before an expensive job" icon={Coins} action={<Button size="sm" variant="ghost" to="/app/films/credits">Details</Button>}>
          <div className="film-total"><span>Available balance</span><strong>{credits?.credits?.balance ?? '—'} credits</strong></div>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>AI video clip</span><strong>{credits?.credits?.perVideoSecond ?? '—'} credits / second</strong></div>
            <div className="film-breakdown-row"><span>Voice dialogue</span><strong>{credits?.credits?.perTtsThousandChars ?? '—'} credits / 1k chars</strong></div>
            <div className="film-breakdown-row"><span>Final render</span><strong>{credits?.credits?.perAssembly ?? '—'} credits</strong></div>
          </div>
          <p className="film-provider-note">Credits are reserved before a job starts and refunded automatically if the provider fails. Estimates are shown per project and per scene.</p>
        </Card>
      </div>
      {creating && <NewProjectModal defaultType={creating} onClose={() => setCreating(null)} onCreated={(film) => navigate(`/app/films/project/${film.id}`)} />}
    </>
  );
}

function ScriptWriter() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const [form, setForm] = useState({ idea: '', type: 'short_drama', genre: 'african_stories', language: 'en', style: 'cinematic', aspectRatio: '9:16', platform: 'tiktok', targetDurationSeconds: 60, allowTemplate: true });
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const update = (k, v) => setForm((c) => ({ ...c, [k]: v }));
  async function generate(e) {
    e.preventDefault(); setPending(true); setError(null); setResult(null);
    try { setResult(await post('/api/films/screenplay', { ...form, targetDurationSeconds: Number(form.targetDurationSeconds) })); }
    catch (err) { setError(err); }
    finally { setPending(false); }
  }
  async function makeProject() {
    setPending(true); setError(null);
    try {
      const created = await post('/api/films', {
        type: form.type === 'episode' ? 'episode' : form.type,
        title: result.screenplay.title, logline: result.screenplay.logline,
        genre: form.genre, language: form.language, style: form.style,
        aspectRatio: form.aspectRatio, targetPlatform: form.platform,
        targetDurationSeconds: Number(form.targetDurationSeconds),
      });
      await put(`/api/films/${created.film.id}/screenplay`, { screenplay: result.screenplay });
      showToast('Screenplay saved to a new project.', 'success');
      navigate(`/app/films/project/${created.film.id}?step=cast`);
    } catch (err) { setError(err); }
    finally { setPending(false); }
  }
  const scenes = result?.screenplay?.scenes || [];
  return (
    <div className="grid grid-studio">
      <Card title="AI Script Writer" subtitle="Turn an idea into a structured, shootable screenplay" icon={PenLine}>
        <form className="film-inline-form" onSubmit={generate}>
          <ErrorBanner error={error} />
          <Field label="Story idea" required hint="Describe the premise, characters and the emotional turn."><textarea className="input" rows={4} value={form.idea} onChange={(e) => update('idea', e.target.value)} placeholder="A young chef returns home and discovers her family's restaurant is about to be sold…" required /></Field>
          <div className="film-form-grid">
            <Field label="Format"><select className="input" value={form.type} onChange={(e) => update('type', e.target.value)}>{Object.keys(TYPE_LABELS).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></Field>
            <Field label="Genre"><select className="input" value={form.genre} onChange={(e) => update('genre', e.target.value)}>{(config?.genres || ['drama']).map((g) => <option key={g} value={g}>{pretty(g)}</option>)}</select></Field>
            <Field label="Language"><select className="input" value={form.language} onChange={(e) => update('language', e.target.value)}>{(config?.languages || ['en']).map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></Field>
            <Field label="Visual style"><select className="input" value={form.style} onChange={(e) => update('style', e.target.value)}>{(config?.styles || ['cinematic']).map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></Field>
            <Field label="Aspect ratio"><select className="input" value={form.aspectRatio} onChange={(e) => update('aspectRatio', e.target.value)}>{['9:16', '16:9', '1:1'].map((a) => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Platform"><select className="input" value={form.platform} onChange={(e) => update('platform', e.target.value)}>{(config?.platforms || ['tiktok']).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select></Field>
            <Field label="Duration (seconds)" className="span-2"><input className="input" type="number" min="5" max={config?.limits?.maxProjectSeconds || 3600} value={form.targetDurationSeconds} onChange={(e) => update('targetDurationSeconds', e.target.value)} /></Field>
          </div>
          {!config?.aiScreenplayConfigured && <InfoBanner tone="warning" icon={Info}><strong>Local template mode.</strong><div className="film-provider-note">No AI provider is configured, so the result is a deterministic draft clearly labelled “local template”, not AI-generated writing. Configure AI_PROVIDER for genuine AI scripts.</div></InfoBanner>}
          <Button type="submit" disabled={pending || form.idea.trim().length < 3}>{pending ? <Spinner size={15} label="Writing…" /> : <><WandSparkles size={15} /> Write screenplay</>}</Button>
        </form>
      </Card>
      <Card title="Result" subtitle={result ? `${result.screenplay.title} · ${scenes.length} scenes` : 'Your screenplay appears here'} icon={Sparkles}>
        {!result ? <div className="film-empty-mini">Write a screenplay to see scenes, dialogue, cast and the credit estimate. Nothing is charged for scriptwriting.</div> : (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className={result.aiGenerated ? 'film-chip good' : 'film-chip warn'}>{result.aiGenerated ? `AI · ${result.provider}` : `Local template · not AI`}</span>
              <span className="film-chip">{scenes.length} scenes</span>
              <span className="film-chip">{result.estimate.total} credits to produce</span>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
              {scenes.slice(0, 30).map((scene, i) => (
                <div className="film-script-scene" key={i}>
                  <strong>Scene {i + 1} · {scene.heading || scene.location || 'Untitled'}</strong>
                  <p>{scene.description}</p>
                  <ul className="film-dialogue">{scene.dialogue?.slice(0, 3).map((line, j) => <li key={j}><b>{line.character}:</b> {line.line}</li>)}</ul>
                </div>
              ))}
              {scenes.length > 30 && <p className="film-hint">…and {scenes.length - 30} more scenes inside the project.</p>}
            </div>
            <Button className="btn-block" style={{ marginTop: 14 }} onClick={makeProject} disabled={pending}><Plus size={15} /> Create project from this script</Button>
          </>
        )}
      </Card>
    </div>
  );
}

function CharacterStudio() {
  const { showToast } = useToast();
  const { data, loading, error, reload } = useLoad(() => get('/api/films/characters'), [], { initial: { characters: [] } });
  const { data: films } = useLoad(() => get('/api/films?limit=100'), [], { initial: { films: [] } });
  const [form, setForm] = useState({ name: '', role: 'lead', description: '', appearancePrompt: '', voicePreset: 'nova', filmId: '' });
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState(null);
  const [uploadFor, setUploadFor] = useState(null);
  const update = (k, v) => setForm((c) => ({ ...c, [k]: v }));
  async function save(e) {
    e.preventDefault(); setPending(true); setErr(null);
    try {
      await post('/api/films/characters', { ...form, filmId: form.filmId || null });
      showToast('Character saved. It can be reused across episodes.', 'success');
      setForm({ name: '', role: 'lead', description: '', appearancePrompt: '', voicePreset: 'nova', filmId: '' });
      await reload({ silent: true });
    } catch (error2) { setErr(error2); }
    finally { setPending(false); }
  }
  async function uploadImage(character, file) {
    if (!form.filmId && !character.filmId) { showToast('Choose a project above before uploading a reference image.', 'error'); return; }
    const filmId = form.filmId || character.filmId;
    const body = new FormData();
    body.append('kind', 'character'); body.append('characterId', character.id); body.append('file', file);
    try {
      await api(`/api/films/${filmId}/upload`, { method: 'POST', body });
      showToast('Reference image saved.', 'success');
      await reload({ silent: true });
    } catch (error2) { showToast(error2.message, 'error'); }
  }
  return (
    <div className="grid grid-studio">
      <Card title="My Characters" subtitle="Recurring cast with consistent appearance prompts and voices" icon={Users}>
        <ErrorBanner error={error} onRetry={() => reload()} />
        {loading ? <Spinner label="Loading characters…" /> : !data?.characters?.length
          ? <div className="film-empty-mini">No characters yet. Add one on the right, or generate a screenplay — its cast is saved automatically.</div>
          : <div className="film-list">{data.characters.map((character) => (
            <div className="film-row" key={character.id}>
              <div className="film-thumb film-thumb-placeholder"><Users size={19} /></div>
              <div className="film-row-main"><strong>{character.name} <span className="film-chip">{pretty(character.role)}</span></strong><small>{character.appearancePrompt || character.description || 'No appearance prompt yet'}</small><small>Voice: {character.voicePreset} {character.hasReferenceImage && ' · reference image saved'}</small></div>
              <div className="film-row-actions">
                <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}><Upload size={13} /> Image<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(character, f); e.target.value = ''; }} /></label>
                <Button size="sm" variant="danger" onClick={async () => { await del(`/api/films/characters/${character.id}`); await reload({ silent: true }); showToast('Character deleted.', 'success'); }}><Trash2 size={13} /></Button>
              </div>
            </div>))}</div>}
      </Card>
      <Card title="Add / update character" subtitle="Matched by name, so re-saving updates continuity" icon={Plus}>
        <form className="film-inline-form" onSubmit={save}>
          <ErrorBanner error={err} />
          <Field label="Attach to project" hint="Used to store reference images and share the cast with episodes."><select className="input" value={form.filmId} onChange={(e) => update('filmId', e.target.value)}><option value="">Not attached</option>{films?.films?.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></Field>
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Amara" required /></Field>
          <Field label="Role"><select className="input" value={form.role} onChange={(e) => update('role', e.target.value)}>{['lead', 'supporting', 'antagonist', 'narrator', 'extra'].map((r) => <option key={r} value={r}>{pretty(r)}</option>)}</select></Field>
          <Field label="Description"><textarea className="input" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Determined protagonist facing a turning point." /></Field>
          <Field label="Appearance prompt" hint="Describe wardrobe, hair, age and features exactly — this is injected into every scene prompt for visual consistency."><textarea className="input" rows={3} value={form.appearancePrompt} onChange={(e) => update('appearancePrompt', e.target.value)} placeholder="Adult woman, short natural black hair, amber linen jacket…" /></Field>
          <Field label="Voice preset"><select className="input" value={form.voicePreset} onChange={(e) => update('voicePreset', e.target.value)}>{['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer', 'sage', 'eleven-default'].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Button type="submit" disabled={pending || form.name.trim().length < 1}>{pending ? <Spinner size={15} label="Saving…" /> : 'Save character'}</Button>
        </form>
      </Card>
    </div>
  );
}

function ToolPicker({ step, icon: ToolIcon, title, description }) {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(() => get('/api/films?limit=100'), [], { initial: { films: [] } });
  return (
    <Card title={title} subtitle={description} icon={ToolIcon}>
      <ErrorBanner error={error} onRetry={() => reload()} />
      {loading ? <Spinner label="Loading projects…" /> : !data?.films?.length
        ? <EmptyState icon={FilmIcon} title="No projects yet" description="Create a project first, then use this tool on its scenes." action={<Button to="/app/films">Go to Film Studio</Button>} />
        : <div className="film-list">{data.films.map((film) => <FilmRow key={film.id} film={film} onOpen={() => navigate(`/app/films/project/${film.id}?step=${step}`)} />)}</div>}
      <p className="film-provider-note">Opening a project takes you directly to the {title.toLowerCase()} step. All work is saved to that project.</p>
    </Card>
  );
}

function CreditsView() {
  const { data, loading, error, reload } = useLoad(() => get('/api/films/credits'), [], { initial: { balance: 0, history: [] } });
  const { data: config } = useFilmConfig();
  return (
    <div className="grid grid-studio">
      <Card title="Credit ledger" subtitle="Every reservation, charge and refund" icon={Coins}>
        <ErrorBanner error={error} onRetry={() => reload()} />
        <div className="film-total" style={{ marginBottom: 14 }}><span>Available balance</span><strong>{data?.balance ?? 0} credits</strong></div>
        {loading ? <Spinner label="Loading ledger…" /> : !data?.history?.length ? <div className="film-empty-mini">No credit activity yet.</div> : (
          <div className="film-ledger">{data.history.map((entry) => (
            <div className="film-ledger-row" key={entry.id}>
              <div><strong>{pretty(entry.reason)}</strong><div className="film-hint">{formatDate(entry.createdAt)} · {entry.referenceType || 'account'}</div></div>
              <span className={entry.amount >= 0 ? 'pos' : 'neg'}>{entry.amount >= 0 ? '+' : ''}{entry.amount}</span>
            </div>))}</div>)}
      </Card>
      <Card title="Pricing & subscriptions" subtitle="Know the cost before you generate" icon={Coins}>
        <div className="film-breakdown">
          <div className="film-breakdown-row"><span>AI video clip</span><strong>{config?.credits?.perVideoSecond ?? '—'} credits / second</strong></div>
          <div className="film-breakdown-row"><span>Voice dialogue</span><strong>{config?.credits?.perTtsThousandChars ?? '—'} credits / 1,000 chars</strong></div>
          <div className="film-breakdown-row"><span>Final FFmpeg render</span><strong>{config?.credits?.perAssembly ?? '—'} credits</strong></div>
          <div className="film-breakdown-row"><span>Max clip length</span><strong>{config?.limits?.maxSceneSeconds ?? '—'}s</strong></div>
          <div className="film-breakdown-row"><span>Max scenes / project</span><strong>{config?.limits?.maxScenes ?? '—'}</strong></div>
        </div>
        <p className="film-provider-note">Credits are reserved before each expensive job and refunded automatically when a provider fails. Failed jobs never silently consume your balance.</p>
        <InfoBanner tone="info" icon={Info}>
          <strong>Credit grants follow your subscription plan.</strong>
          <div className="film-provider-note">A one-time grant is applied on signup. Top-up purchases and Stripe credit packs need billing configuration; see <Link to="/app/billing">Plans &amp; Billing</Link> for the current plan.</div>
        </InfoBanner>
        <Button variant="secondary" className="btn-block" style={{ marginTop: 12 }} to="/app/billing">View plans & billing <ArrowRight size={14} /></Button>
      </Card>
    </div>
  );
}

function SeriesStudio() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: config } = useFilmConfig();
  const { data, loading, error, reload } = useLoad(() => get('/api/films/series'), [], { initial: { series: [] } });
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [seriesForm, setSeriesForm] = useState({ title: '', description: '', genre: 'african_stories', language: 'en', style: 'cinematic' });
  const [episodeForm, setEpisodeForm] = useState({ seasonNumber: 1, title: '', synopsis: '', idea: '', targetDurationSeconds: 180, status: 'draft' });
  const [bible, setBible] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState(null);
  const detail = useLoad(() => selectedId ? get(`/api/films/series/${selectedId}`) : Promise.resolve(null), [selectedId], { initial: null });
  const selected = detail.data;

  useEffect(() => { if (selected) setBible(JSON.stringify(selected.storyBible || {}, null, 2)); }, [selected?.id]);

  async function create(e) {
    e.preventDefault(); setPending(true); setErr(null);
    try { const res = await post('/api/films/series', seriesForm); await reload({ silent: true }); setSelectedId(res.series.id); setShowCreate(false); showToast('Series created.', 'success'); }
    catch (error2) { setErr(error2); }
    finally { setPending(false); }
  }
  async function addEpisode(e) {
    e.preventDefault(); setPending(true); setErr(null);
    try { await post(`/api/films/series/${selectedId}/episodes`, { ...episodeForm, seasonNumber: Number(episodeForm.seasonNumber), targetDurationSeconds: Number(episodeForm.targetDurationSeconds) }); await detail.reload({ silent: true }); await reload({ silent: true }); setEpisodeForm({ seasonNumber: episodeForm.seasonNumber, title: '', synopsis: '', idea: '', targetDurationSeconds: 180, status: 'draft' }); showToast('Episode created with its own film project.', 'success'); }
    catch (error2) { setErr(error2); }
    finally { setPending(false); }
  }
  async function saveBible() {
    try { await patch(`/api/films/series/${selectedId}`, { storyBible: JSON.parse(bible || '{}') }); await detail.reload({ silent: true }); showToast('Story bible saved.', 'success'); }
    catch (error2) { showToast(error2.message, 'error'); }
  }
  async function writeScript(episodeId) {
    setPending(true);
    try { await post(`/api/films/series/${selectedId}/episodes/${episodeId}/screenplay`, { allowTemplate: true }); await detail.reload({ silent: true }); showToast('Episode screenplay written with series continuity.', 'success'); }
    catch (error2) { showToast(error2.message, 'error'); }
    finally { setPending(false); }
  }
  async function setStatus(episodeId, status) {
    try { await patch(`/api/films/series/${selectedId}/episodes/${episodeId}`, { status }); await detail.reload({ silent: true }); }
    catch (error2) { showToast(error2.message, 'error'); }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="film-hint">Each episode owns a full film project: screenplay, cast, scenes, render and publishing.</div>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} /> New series</Button>
      </div>
      <ErrorBanner error={error || err} onRetry={() => reload()} />
      <div className="grid grid-studio">
        <Card title="Your series" subtitle={`${data?.series?.length || 0} series`} icon={Layers}>
          {loading ? <Spinner label="Loading…" /> : !data?.series?.length
            ? <EmptyState icon={Layers} title="No series yet" description="Create a series to plan seasons, episodes and a shared story bible." action={<Button onClick={() => setShowCreate(true)}><Plus size={15} /> New series</Button>} />
            : <div className="film-list">{data.series.map((s) => <button key={s.id} className="film-row" style={{ cursor: 'pointer', textAlign: 'left', color: 'inherit', width: '100%' }} onClick={() => setSelectedId(s.id)}>
              <div className="film-row-main"><strong>{s.title}</strong><small>{s.episodeCount} episodes · {s.completedEpisodes} completed · {s.seasons.length} season(s)</small></div>
              <StatusBadge status={s.status} /><ArrowRight size={15} />
            </button>)}</div>}
        </Card>
        <Card title={selected ? selected.title : 'Select a series'} subtitle={selected ? `${selected.episodeCount} episodes · ${selected.genre}` : 'Click a series on the left to manage it'} icon={Clapperboard}>
          {!selected ? <div className="film-empty-mini">Select a series to see its episodes, story bible and recurring cast.</div> : (
            <>
              <div className="film-section-title" style={{ marginTop: 0 }}><h2>Episodes</h2><span className="film-chip">{selected.episodeCount} total</span></div>
              {selected.episodes?.length ? <div className="film-list" style={{ marginTop: 12 }}>{selected.episodes.map((ep) => (
                <div className="film-row" key={ep.id}>
                  <div className="film-row-main"><strong>S{ep.seasonNumber}E{ep.episodeNumber} · {ep.title}</strong><small>{ep.synopsis || 'No synopsis'}</small><small>{ep.film?.sceneCount || 0} scenes · {ep.film?.progress || 0}% · {ep.film?.hasVideo ? 'video ready' : 'no render yet'}</small></div>
                  <div className="film-row-meta"><StatusBadge status={ep.status} /></div>
                  <div className="film-row-actions">
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => writeScript(ep.id)}><WandSparkles size={12} /> Script</Button>
                    {ep.filmId && <Button size="sm" variant="secondary" onClick={() => navigate(`/app/films/project/${ep.filmId}`)}>Open</Button>}
                    <select className="input" style={{ width: 'auto', padding: '6px 8px', fontSize: 11 }} value={ep.status} onChange={(e) => setStatus(ep.id, e.target.value)}>
                      {['draft', 'upcoming', 'completed', 'published'].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                    </select>
                  </div>
                </div>))}</div> : <div className="film-empty-mini">No episodes yet. Add one below.</div>}
              <form className="film-inline-form" style={{ marginTop: 16 }} onSubmit={addEpisode}>
                <div className="film-form-grid">
                  <Field label="Season"><input className="input" type="number" min="1" value={episodeForm.seasonNumber} onChange={(e) => setEpisodeForm({ ...episodeForm, seasonNumber: e.target.value })} /></Field>
                  <Field label="Status"><select className="input" value={episodeForm.status} onChange={(e) => setEpisodeForm({ ...episodeForm, status: e.target.value })}>{['draft', 'upcoming', 'completed'].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></Field>
                  <Field label="Episode title" className="span-2" required><input className="input" value={episodeForm.title} onChange={(e) => setEpisodeForm({ ...episodeForm, title: e.target.value })} placeholder="The Return" required /></Field>
                  <Field label="Synopsis" className="span-2"><textarea className="input" rows={2} value={episodeForm.synopsis} onChange={(e) => setEpisodeForm({ ...episodeForm, synopsis: e.target.value })} /></Field>
                  <Field label="Episode idea (for continuity)" className="span-2"><textarea className="input" rows={2} value={episodeForm.idea} onChange={(e) => setEpisodeForm({ ...episodeForm, idea: e.target.value })} /></Field>
                  <Field label="Duration (seconds)" className="span-2"><input className="input" type="number" min="5" max={config?.limits?.maxProjectSeconds || 3600} value={episodeForm.targetDurationSeconds} onChange={(e) => setEpisodeForm({ ...episodeForm, targetDurationSeconds: e.target.value })} /></Field>
                </div>
                <Button type="submit" size="sm" disabled={pending || episodeForm.title.trim().length < 2}><Plus size={14} /> Add episode</Button>
              </form>
              <div className="film-section-title"><h2>Story bible</h2><Button size="sm" variant="ghost" onClick={saveBible}>Save</Button></div>
              <textarea className="input" rows={6} value={bible} onChange={(e) => setBible(e.target.value)} aria-label="Story bible JSON" />
              <p className="film-provider-note">JSON shared with every new episode screenplay: premise, world, themes and continuity notes. Recurring characters are reused automatically.</p>
            </>)}
        </Card>
      </div>
      {showCreate && <Modal open onClose={() => setShowCreate(false)} title="New episodic series" description="A series holds seasons, episodes, a story bible and recurring characters." size="md"
        footer={<><Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={create} disabled={pending || seriesForm.title.trim().length < 2}>{pending ? <Spinner size={14} /> : 'Create series'}</Button></>}>
        <form className="film-inline-form" onSubmit={create}>
          <Field label="Series title" required><input className="input" value={seriesForm.title} onChange={(e) => setSeriesForm({ ...seriesForm, title: e.target.value })} placeholder="Lagos Nights" required /></Field>
          <Field label="Description"><textarea className="input" rows={2} value={seriesForm.description} onChange={(e) => setSeriesForm({ ...seriesForm, description: e.target.value })} /></Field>
          <div className="film-form-grid">
            <Field label="Genre"><select className="input" value={seriesForm.genre} onChange={(e) => setSeriesForm({ ...seriesForm, genre: e.target.value })}>{(config?.genres || ['drama']).map((g) => <option key={g} value={g}>{pretty(g)}</option>)}</select></Field>
            <Field label="Style"><select className="input" value={seriesForm.style} onChange={(e) => setSeriesForm({ ...seriesForm, style: e.target.value })}>{(config?.styles || ['cinematic']).map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></Field>
            <Field label="Language" className="span-2"><select className="input" value={seriesForm.language} onChange={(e) => setSeriesForm({ ...seriesForm, language: e.target.value })}>{(config?.languages || ['en']).map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></Field>
          </div>
        </form>
      </Modal>}
    </>
  );
}

export default function FilmStudio({ view = 'hub' }) {
  const navigate = useNavigate();
  const titles = {
    short: ['Short Drama Studio', 'Vertical dramas for TikTok, YouTube Shorts, Instagram Reels and Facebook.'],
    long: ['Long Drama & Movie Studio', 'Scene-by-scene long-form production assembled into one film.'],
    projects: ['My Projects', 'Every saved short drama, long drama, movie and episode — resume anytime.'],
    media: ['My Media', 'Projects with generated scene clips, subtitles and exports.'],
    published: ['Published Movies', 'Films marked as published and ready for distribution.'],
    scripts: ['AI Script Writer', 'Idea → structured screenplay, dialogue and scene breakdown.'],
    characters: ['Character Studio', 'Recurring cast, appearance prompts, voices and visual references.'],
    scenes: ['Scene Generator', 'Real AI video generation, one scene at a time.'],
    audio: ['Voice & Audio Studio', 'Character voices, subtitles and music for your film.'],
    editor: ['Movie Editor', 'Arrange, review and regenerate only the scenes you want.'],
    credits: ['Credits & Subscriptions', 'Cost estimates, reservations, refunds and your balance.'],
    series: ['Series & Episodes', 'Seasons, episodes, story bibles, continuity and publishing controls.'],
  };
  const [title, subtitle] = titles[view] || ['AI Filmmaking Studio', undefined];
  let body;
  switch (view) {
    case 'hub': body = <Hub />; break;
    case 'short': body = <ProjectList type="short_drama" newType="short_drama" emptyTitle="No short dramas yet" />; break;
    case 'long': body = <ProjectList types={['long_drama', 'movie']} newType="long_drama" emptyTitle="No long dramas or movies yet" emptyBody="Long-form films are built from many short AI clips and assembled into one timeline." />; break;
    case 'series': body = <SeriesStudio />; break;
    case 'scripts': body = <ScriptWriter />; break;
    case 'characters': body = <CharacterStudio />; break;
    case 'scenes': body = <ToolPicker step="scenes" icon={WandSparkles} title="Scene Generator" description="Choose a project to generate real AI clips, review each one, and regenerate only what you dislike." />; break;
    case 'audio': body = <ToolPicker step="audio" icon={Mic2} title="Voice & Audio Studio" description="Choose a project to set character voices, subtitles and music." />; break;
    case 'editor': body = <ToolPicker step="editor" icon={Scissors} title="Movie Editor" description="Choose a project to arrange scenes, edit prompts and dialogue, and assemble the final film." />; break;
    case 'projects': body = <ProjectList emptyTitle="No projects yet" />; break;
    case 'media': body = <ProjectList predicate={(film) => film.hasVideo || film.readyScenes > 0 || film.hasThumbnail} emptyTitle="No media yet" emptyBody="Generate scene clips and render a film to build your media library." />; break;
    case 'published': body = <ProjectList status="published" emptyTitle="Nothing published yet" emptyBody="Render a film and press Publish in the Preview step." />; break;
    case 'credits': body = <CreditsView />; break;
    default: body = <Hub />;
  }
  return (
    <FilmShell view={view} title={title} subtitle={subtitle} actions={view === 'hub' ? (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => navigate('/app/films/agent')}><Sparkles size={15} /> AI Production Agent</Button>
        <Button variant="secondary" onClick={() => navigate('/app/films/scripts')}><PenLine size={15} /> AI Script Writer</Button>
      </div>
    ) : undefined}>
      {body}
    </FilmShell>
  );
}
