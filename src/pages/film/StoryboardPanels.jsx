import React, { useMemo, useState } from 'react';
import {
  CheckCircle2, Clapperboard, Film as FilmIcon, Image as ImageIcon, Info, Mic2,
  RefreshCw, Save, Scissors, Sparkles, Volume2,
} from 'lucide-react';
import { get, post, patch } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, InfoBanner, Spinner, useToast,
} from '../../components/ui.jsx';
import { formatDuration, pretty } from './FilmStudio.jsx';

/** Step 5 — storyboard stills, poster and character concept art. */
export function StoryboardStep({ film }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const { data, loading, reload } = useLoad(() => get(`/api/films/${film.id}/storyboard`), [film.id], { initial: null, refreshMs: 15000 });

  async function generate(body, label) {
    setPending(label); setError(null);
    try {
      const result = await post(`/api/films/${film.id}/storyboard`, body);
      await reload({ silent: true });
      showToast(result.queued
        ? `Queued ${result.remaining} still(s) for the worker. This page refreshes as frames appear.`
        : result.generated ? `${result.generated} still(s) rendered with ${result.provider.active}.` : 'Every scene already has a still.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  async function poster() {
    setPending('poster'); setError(null);
    try {
      await post(`/api/films/${film.id}/poster`, {});
      await reload({ silent: true });
      showToast('Poster rendered from your logline and visual style.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  if (loading && !data) return <Spinner label="Loading storyboard…" />;
  if (!data) return <ErrorBanner error={error} onRetry={() => reload()} />;
  const provider = data.provider;
  const withStill = data.scenes.filter((scene) => scene.frame?.hasImage).length;

  return (
    <div className="grid grid-studio">
      <Card
        title="Storyboard"
        subtitle={`${withStill}/${data.scenes.length} scenes have a still · ${provider.active}`}
        icon={ImageIcon}
        action={<span className={provider.ai ? 'film-chip good' : 'film-chip'}>{provider.ai ? 'AI images' : 'Procedural stills'}</span>}
      >
        <ErrorBanner error={error} />
        {!provider.ai && (
          <InfoBanner tone="info" icon={Info}>
            <strong>Stills are rendered locally.</strong>
            <div className="film-provider-note">
              IMAGE_PROVIDER=procedural draws real PNG storyboards from each scene's shot, location and palette.
              It is not AI art and is never used as a character face reference. Set <code>OPENAI_API_KEY</code> or
              <code> REPLICATE_API_TOKEN</code> with IMAGE_PROVIDER=openai|replicate for model-drawn frames.
            </div>
          </InfoBanner>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 16px' }}>
          <Button onClick={() => generate({}, 'missing')} disabled={Boolean(pending)}>
            {pending === 'missing' ? <Spinner size={14} /> : <><Sparkles size={14} /> Render missing stills</>}
          </Button>
          <Button variant="secondary" onClick={() => generate({ force: true, limit: 8 }, 'refresh')} disabled={Boolean(pending)}>
            {pending === 'refresh' ? <Spinner size={14} /> : <><RefreshCw size={14} /> Re-render 8 stills</>}
          </Button>
          <Button variant="ghost" onClick={() => generate({ queue: true }, 'queue')} disabled={Boolean(pending)}>
            {pending === 'queue' ? <Spinner size={14} /> : <><RefreshCw size={14} /> Render all in background</>}
          </Button>
          <Button variant="secondary" onClick={poster} disabled={Boolean(pending)}>
            {pending === 'poster' ? <Spinner size={14} /> : <><FilmIcon size={14} /> {data.poster ? 'Re-render poster' : 'Render poster'}</>}
          </Button>
        </div>

        {!data.scenes.length && <EmptyState icon={ImageIcon} title="No scenes yet" description="Write the screenplay first; stills follow the script." />}
        <div className="film-storyboard-grid">
          {data.scenes.map((scene) => (
            <figure className="film-storyboard-card" key={scene.id}>
              {scene.frame?.imageUrl
                ? <img src={scene.frame.imageUrl} alt={`Storyboard for scene ${scene.ordinal}`} loading="lazy" />
                : <div className="film-storyboard-empty">{scene.hasClip ? 'Clip ready, no still' : 'No still yet'}</div>}
              <figcaption>
                <strong>Scene {scene.ordinal}</strong>
                <small>{scene.heading || scene.location} · {formatDuration(scene.durationSeconds)}</small>
              </figcaption>
            </figure>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Poster" subtitle={data.poster ? 'Rendered from your logline' : 'Not generated yet'} icon={FilmIcon}>
          {data.poster
            ? <img className="film-poster" src={`/api/films/${film.id}/poster/image`} alt="Film poster" />
            : <div className="film-empty-mini">A poster uses the title, logline, genre and palette. Render it once the logline reads well.</div>}
        </Card>
        <Card title="Why stills first" subtitle="Cheaper than clips" icon={Info}>
          <p className="film-provider-note" style={{ marginTop: 0 }}>
            Stills and voice takes cost no credits on the local providers. Locking the look and the dialogue pacing
            before generating video means fewer paid re-renders. The cinematography controls in Direct &amp; generate
            are baked into every still prompt.
          </p>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Provider</span><strong>{provider.active}</strong></div>
            <div className="film-breakdown-row"><span>Real AI images</span><strong>{provider.ai ? 'Yes' : 'No (procedural)'}</strong></div>
            <div className="film-breakdown-row"><span>Scenes covered</span><strong>{withStill}/{data.scenes.length}</strong></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Step 7 — per-scene dialogue takes with the real TTS engine. */
export function VoiceStep({ film }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const { data, loading, reload } = useLoad(() => get(`/api/films/${film.id}/voice`), [film.id], { initial: null, refreshMs: 15000 });

  async function generate(body, label) {
    setPending(label); setError(null);
    try {
      const result = await post(`/api/films/${film.id}/voice`, body);
      await reload({ silent: true });
      showToast(result.queued
        ? `Queued ${result.remaining} take(s) for the worker. This page refreshes as they arrive.`
        : result.generated ? `${result.generated} take(s) recorded with ${result.provider}.` : 'Every spoken scene already has a take.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  if (loading && !data) return <Spinner label="Loading voice takes…" />;
  if (!data) return <ErrorBanner error={error} onRetry={() => reload()} />;

  return (
    <div className="grid grid-studio">
      <Card title="Voice studio" subtitle={`${data.totals.withTake}/${data.totals.withDialogue} spoken scenes recorded · ${data.tts.provider || 'no provider'}`} icon={Mic2}>
        <ErrorBanner error={error} />
        {!data.tts.configured && <InfoBanner tone="warning" icon={Info}><strong>No TTS provider is configured.</strong><div className="film-provider-note">{data.tts.error}</div></InfoBanner>}
        {data.tts.local && (
          <InfoBanner tone="info" icon={Volume2}>
            <strong>Local voice engine.</strong>
            <div className="film-provider-note">
              Takes are spoken by the offline meSpeak engine and stored as WAV files. They are real audio for pacing and
              line checks; the final mix voices the same lines at assembly. Set <code>TTS_PROVIDER=openai|elevenlabs</code>
              with a key for natural or cloned voices.
            </div>
          </InfoBanner>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 16px' }}>
          <Button onClick={() => generate({}, 'missing')} disabled={Boolean(pending) || !data.tts.configured}>
            {pending === 'missing' ? <Spinner size={14} /> : <><Mic2 size={14} /> Record missing takes</>}
          </Button>
          <Button variant="secondary" onClick={() => generate({ force: true, limit: 6 }, 'redo')} disabled={Boolean(pending) || !data.tts.configured}>
            {pending === 'redo' ? <Spinner size={14} /> : <><RefreshCw size={14} /> Re-record 6 takes</>}
          </Button>
          <Button variant="ghost" onClick={() => generate({ queue: true }, 'queue')} disabled={Boolean(pending) || !data.tts.configured}>
            {pending === 'queue' ? <Spinner size={14} /> : <><Mic2 size={14} /> Record all in background</>}
          </Button>
        </div>

        {!data.scenes.length && <EmptyState icon={Mic2} title="No scenes yet" description="Write the screenplay to create dialogue." />}
        <div className="film-list">
          {data.scenes.map((scene) => (
            <div className="film-row" key={scene.id} style={{ alignItems: 'flex-start' }}>
              <div className="film-row-main">
                <strong>Scene {scene.ordinal} · {scene.heading || 'Untitled'}</strong>
                <small>
                  {scene.dialogueLines ? `${scene.dialogueLines} line(s)` : 'No dialogue'}
                  {scene.cast.length ? ` · ${scene.cast.join(', ')}` : ''}
                  {scene.take ? ` · ${scene.take.provider} · ${formatDuration(scene.take.durationSeconds)}` : ''}
                </small>
                {scene.script && <pre className="film-script-preview">{scene.script}</pre>}
              </div>
              {scene.take
                ? <audio controls preload="none" src={scene.take.url} aria-label={`Voice take for scene ${scene.ordinal}`} />
                : <span className={`film-chip ${scene.dialogueLines ? 'warn' : ''}`}>{scene.dialogueLines ? 'no take' : 'silent'}</span>}
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Casting voices" subtitle="Per character, reused across scenes" icon={Volume2}>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Language</span><strong>{data.language}</strong></div>
            <div className="film-breakdown-row"><span>Default voice</span><strong>{pretty(data.voice)}</strong></div>
            <div className="film-breakdown-row"><span>Scenes with dialogue</span><strong>{data.totals.withDialogue}</strong></div>
            <div className="film-breakdown-row"><span>Recorded takes</span><strong>{data.totals.withTake}</strong></div>
          </div>
          <p className="film-provider-note">Assign a voice per character in Cast; the scene takes and the final assembly both use it, so a character never changes voice mid-film.</p>
            <Button size="sm" variant="secondary" className="btn-block" to={`/app/films/project/${film.id}?step=cast`}>Open cast</Button>
        </Card>
        <Card title="Lip-sync" subtitle="Requires a provider" icon={Info}>
          <p className="film-provider-note" style={{ marginTop: 0 }}>
            Lip-sync is not offered as a button here because no lip-sync provider is configured. The studio interface
            reports capability from the server, so this panel will enable itself only when one exists.
          </p>
        </Card>
      </div>
    </div>
  );
}

/** Step 8 — editorial decisions that change the render. */
export function TimelineStep({ film, reload }) {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState({});
  const [splitPoints, setSplitPoints] = useState({});
  const [tracks, setTracks] = useState({});
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const scenes = film.scenes || [];
  const vfx = useLoad(() => get('/api/films/vfx'), [], { initial: null });
  const lipSync = useLoad(() => get('/api/films/lipsync'), [], { initial: null });
  const total = useMemo(() => scenes.reduce((sum, scene) => sum + Number(scene.durationSeconds || 0), 0), [scenes]);

  const valueFor = (scene, key) => drafts[scene.id]?.[key] ?? scene[key] ?? (key === 'transition' ? 'cut' : 0);
  const update = (scene, key, value) => setDrafts((current) => ({ ...current, [scene.id]: { ...current[scene.id], [key]: value } }));

  async function split(scene) {
    const at = Number(splitPoints[scene.id]);
    if (!Number.isFinite(at)) return;
    setPending(`split-${scene.id}`); setError(null);
    try {
      const result = await post(`/api/films/${film.id}/scenes/${scene.id}/split`, { atSeconds: at });
      setSplitPoints((current) => ({ ...current, [scene.id]: '' }));
      await reload({ silent: true });
      showToast(`Scene split into ${result.first.durationSeconds}s + ${result.second.durationSeconds}s.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }

  const trackFor = (scene) => tracks[scene.id] || {
    speedFactor: scene.speedFactor || 1,
    vfxPreset: scene.vfxPreset || 'none',
    overlayText: scene.overlay?.text || '',
    overlayStart: scene.overlay?.startSeconds ?? 0,
    overlayEnd: scene.overlay?.endSeconds ?? 0,
  };
  const setTrack = (scene, key, value) => setTracks((current) => ({ ...current, [scene.id]: { ...trackFor(scene), [key]: value } }));

  async function applyTrack(scene) {
    const track = trackFor(scene);
    setPending(`track-${scene.id}`); setError(null);
    try {
      await post(`/api/films/${film.id}/scenes/${scene.id}/track`, {
        speedFactor: Number(track.speedFactor) || 1,
        vfxPreset: track.vfxPreset,
        overlay: track.overlayText.trim()
          ? { text: track.overlayText, startSeconds: Number(track.overlayStart) || 0, endSeconds: Number(track.overlayEnd) || 0 }
          : null,
      });
      await reload({ silent: true });
      showToast(`Scene ${scene.ordinal}: speed, look and overlay saved for the next render.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }

  async function runProvider(scene, kind) {
    setPending(`${kind}-${scene.id}`); setError(null);
    try {
      const result = await post(`/api/films/${film.id}/scenes/${scene.id}/${kind}`, kind === 'motion' ? { motionPrompt: scene.visualPrompt || '' } : {});
      showToast(`${kind === 'motion' ? 'Motion transfer' : 'Lip-sync'} queued (job ${result.jobId}) with ${result.provider}.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }

  async function save(scene) {
    setPending(scene.id); setError(null);
    try {
      await patch(`/api/films/${film.id}/scenes/${scene.id}`, {
        transition: valueFor(scene, 'transition'),
        trim_start: Number(valueFor(scene, 'trimStart')) || 0,
        trim_end: Number(valueFor(scene, 'trimEnd')) || 0,
      });
      setDrafts((current) => { const next = { ...current }; delete next[scene.id]; return next; });
      await reload({ silent: true });
      showToast(`Scene ${scene.ordinal} edit applied to the next render.`, 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  return (
    <div className="grid grid-studio">
      <Card title="Timeline" subtitle={`${scenes.length} scenes · ${formatDuration(total)} master duration`} icon={Scissors}>
        <ErrorBanner error={error} />
        <InfoBanner tone="info" icon={Info}>
          <strong>Trims and transitions are applied by FFmpeg at render time.</strong>
          <div className="film-provider-note">
            Trimming skips seconds at the start or end of a clip; a transition fades the scene in and out from black
            (or white). They are applied when each clip is normalised, so the render stays fast.
          </div>
        </InfoBanner>
        {!scenes.length && <EmptyState icon={Scissors} title="Nothing to cut yet" description="Scenes appear here once the screenplay exists." />}
        <div className="film-list" style={{ marginTop: 12 }}>
          {scenes.map((scene) => (
            <div className="film-row film-timeline-row" key={scene.id} style={{ alignItems: 'flex-start' }}>
              <div className="film-row-main">
                <strong>{String(scene.ordinal).padStart(2, '0')} · {scene.heading || scene.location || 'Untitled scene'}</strong>
                <small>{formatDuration(scene.durationSeconds)} · {scene.hasClip ? 'clip ready' : 'no clip yet'} · {scene.hasVoiceTake ? 'voice take' : 'no take'}</small>
                <small>
                  {(film.sceneProps?.[scene.id] || []).length
                    ? `Props: ${(film.sceneProps[scene.id] || []).map((prop) => `${prop.name}${prop.state ? ` (${prop.state})` : ''}`).join(', ')}`
                    : 'No props linked'}
                </small>
              </div>
              <div className="film-timeline-controls">
                <label className="film-mini-field">
                  <span>Transition</span>
                  <select className="input" value={valueFor(scene, 'transition')} onChange={(event) => update(scene, 'transition', event.target.value)}>
                    <option value="cut">Hard cut</option>
                    <option value="fade_black">Fade from black</option>
                    <option value="dip_white">Dip to white</option>
                  </select>
                </label>
                <label className="film-mini-field">
                  <span>Trim start (s)</span>
                  <input className="input" type="number" min="0" max="30" step="0.1" value={valueFor(scene, 'trimStart')} onChange={(event) => update(scene, 'trimStart', event.target.value)} />
                </label>
                <label className="film-mini-field">
                  <span>Trim end (s)</span>
                  <input className="input" type="number" min="0" max="30" step="0.1" value={valueFor(scene, 'trimEnd')} onChange={(event) => update(scene, 'trimEnd', event.target.value)} />
                </label>
                <label className="film-mini-field">
                  <span>Split at (s)</span>
                  <input className="input" type="number" min="4" max={Math.max(4, scene.durationSeconds - 4)} step="0.5" value={splitPoints[scene.id] || ''} onChange={(event) => setSplitPoints({ ...splitPoints, [scene.id]: event.target.value })} />
                </label>
                <Button size="sm" variant="ghost" onClick={() => split(scene)} disabled={pending === `split-${scene.id}` || !splitPoints[scene.id]}>
                  {pending === `split-${scene.id}` ? <Spinner size={13} /> : <><Scissors size={13} /> Split</>}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => save(scene)} disabled={pending === scene.id || !drafts[scene.id]}>
                  {pending === scene.id ? <Spinner size={13} /> : <><Save size={13} /> Apply</>}
                </Button>
              </div>
              <details className="film-track-editor" style={{ flexBasis: '100%' }}>
                <summary>Track: speed {Number(scene.speedFactor || 1).toFixed(2)}× · {pretty(scene.vfxPreset && scene.vfxPreset !== 'none' ? scene.vfxPreset : 'no look')}{scene.overlay?.text ? ' · text overlay' : ''}</summary>
                <div className="film-timeline-controls" style={{ marginTop: 8 }}>
                  <label className="film-mini-field">
                    <span>Speed</span>
                    <input className="input" type="number" min="0.25" max="4" step="0.05" value={trackFor(scene).speedFactor} onChange={(event) => setTrack(scene, 'speedFactor', event.target.value)} />
                  </label>
                  <label className="film-mini-field">
                    <span>Look (VFX)</span>
                    <select className="input" value={trackFor(scene).vfxPreset} onChange={(event) => setTrack(scene, 'vfxPreset', event.target.value)}>
                      {(vfx.data?.presets || [{ id: 'none', label: 'None' }]).map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select>
                  </label>
                  <label className="film-mini-field" style={{ flex: 2 }}>
                    <span>Overlay text</span>
                    <input className="input" maxLength={120} value={trackFor(scene).overlayText} placeholder="e.g. Three days later" onChange={(event) => setTrack(scene, 'overlayText', event.target.value)} />
                  </label>
                  <label className="film-mini-field">
                    <span>Show from (s)</span>
                    <input className="input" type="number" min="0" step="0.1" value={trackFor(scene).overlayStart} onChange={(event) => setTrack(scene, 'overlayStart', event.target.value)} />
                  </label>
                  <label className="film-mini-field">
                    <span>Show until (s)</span>
                    <input className="input" type="number" min="0" step="0.1" value={trackFor(scene).overlayEnd} onChange={(event) => setTrack(scene, 'overlayEnd', event.target.value)} />
                  </label>
                  <Button size="sm" variant="secondary" onClick={() => applyTrack(scene)} disabled={pending === `track-${scene.id}`}>
                    {pending === `track-${scene.id}` ? <Spinner size={13} /> : <><Save size={13} /> Apply track</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => runProvider(scene, 'lipsync')} disabled={!lipSync.data?.configured || !scene.hasClip || pending === `lipsync-${scene.id}`} title={lipSync.data?.configured ? 'Re-sync the clip to the voice take' : lipSync.data?.note || 'Requires a lip-sync provider key'}>
                    {pending === `lipsync-${scene.id}` ? <Spinner size={13} /> : <><Mic2 size={13} /> Sync lips{lipSync.data?.configured ? '' : ' (needs key)'}</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => runProvider(scene, 'motion')} disabled={!vfx.data?.motion?.configured || !scene.hasPoster || pending === `motion-${scene.id}`} title={vfx.data?.motion?.configured ? 'Animate the storyboard still with a motion model' : vfx.data?.motion?.note || 'Requires a motion provider key'}>
                    {pending === `motion-${scene.id}` ? <Spinner size={13} /> : <>Animate still{vfx.data?.motion?.configured ? '' : ' (needs key)'}</>}
                  </Button>
                </div>
                <small className="film-provider-note">
                  Speed, look and the text overlay are burned in by FFmpeg during the next render. Lip-sync and motion transfer need a provider key;
                  without one the server refuses with 503 and nothing changes.
                </small>
              </details>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Edit summary" subtitle="What the render will use" icon={CheckCircle2}>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Scenes</span><strong>{scenes.length}</strong></div>
            <div className="film-breakdown-row"><span>Runtime</span><strong>{formatDuration(total)}</strong></div>
            <div className="film-breakdown-row"><span>Fades</span><strong>{scenes.filter((scene) => scene.transition && scene.transition !== 'cut').length}</strong></div>
            <div className="film-breakdown-row"><span>Trimmed scenes</span><strong>{scenes.filter((scene) => Number(scene.trimStart) || Number(scene.trimEnd)).length}</strong></div>
            <div className="film-breakdown-row"><span>Voice takes</span><strong>{scenes.filter((scene) => scene.hasVoiceTake).length}</strong></div>
            <div className="film-breakdown-row"><span>Speed-ramped</span><strong>{scenes.filter((scene) => Number(scene.speedFactor || 1) !== 1).length}</strong></div>
            <div className="film-breakdown-row"><span>Looks applied</span><strong>{scenes.filter((scene) => scene.vfxPreset && scene.vfxPreset !== 'none').length}</strong></div>
            <div className="film-breakdown-row"><span>Text overlays</span><strong>{scenes.filter((scene) => scene.overlay?.text).length}</strong></div>
          </div>
          <p className="film-provider-note">Sound effects, score and subtitles are configured in Assemble. Any edit here invalidates the current render, so re-render before exporting.</p>
          <Button size="sm" variant="secondary" className="btn-block" to={`/app/films/project/${film.id}?step=render`}><Clapperboard size={14} /> Go to assemble</Button>
        </Card>
        <Card title="Editing limits" subtitle="Honest scope" icon={Info}>
          <p className="film-provider-note" style={{ marginTop: 0 }}>
            Trims, fades, reordering, music, SFX and subtitles are real. Speed ramps (0.25×–4×), eight local VFX looks
            and timed text overlays are burned in by FFmpeg at render time. Picture-in-picture images, keyframed
            animation and separate music stems are not implemented and are not offered as controls.
          </p>
          <p className="film-provider-note">
            Lip-sync and motion transfer are queued against Replicate/fal only when a key and an explicit model id are
            configured; otherwise the API answers 503 and the buttons stay disabled.
          </p>
        </Card>
      </div>
    </div>
  );
}
