import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Clapperboard, Clock, Coins, Info, Pause, Play,
  RefreshCw, Sparkles, Square, WandSparkles,
} from 'lucide-react';
import { get, post, formatDate } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Spinner, StatusBadge, useToast,
} from '../../components/ui.jsx';
import { FilmShell, formatDuration, pretty } from './FilmStudio.jsx';

const EXAMPLES = [
  'A 20-minute Nigerian family drama with five main characters, realistic Abuja locations, emotional dialogue and professional cinematography.',
  'A 30-second vertical advertisement for a Lagos skincare brand with a confident young woman, warm daylight and a clean product shot.',
  'A 3-minute cinematic music video: a singer walks through a rain-soaked city at night, neon reflections, slow dolly shots.',
];

function StageIcon({ status }) {
  if (status === 'done') return <CheckCircle2 size={15} />;
  if (status === 'running') return <RefreshCw size={15} className="spin" />;
  if (status === 'blocked') return <Info size={15} />;
  return <Play size={15} />;
}

function StartProduction() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const recent = useLoad(() => get('/api/films/production'), [], { initial: { productions: [] }, refreshMs: 15000 });

  async function start(event) {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      const result = await post('/api/films/production/start', {
        brief: brief.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      showToast('Production started. The free stages ran; generation is waiting for your approval.', 'success');
      navigate(`/app/films/agent?film=${result.film.id}`);
    } catch (err) { setError(err); }
    finally { setPending(false); }
  }

  return (
    <div className="grid grid-studio">
      <Card title="Describe the production" subtitle="One brief becomes a screenplay, cast, locations and directed scenes" icon={WandSparkles}>
        <ErrorBanner error={error} />
        <form onSubmit={start} style={{ display: 'grid', gap: 12 }}>
          <Field label="Production brief" required hint="Say what it is, how long, who is in it, where it is set and how it should look. The agent parses format, runtime, genre, language and cast size.">
            <textarea className="input" rows={6} required value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={EXAMPLES[0]} />
          </Field>
          <Field label="Working title (optional)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave blank to derive it from the brief" /></Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXAMPLES.map((example, index) => (
              <Button key={index} type="button" size="sm" variant="ghost" onClick={() => setBrief(example)}>Example {index + 1}</Button>
            ))}
          </div>
          <Button type="submit" disabled={pending || brief.trim().length < 10}>
            {pending ? <Spinner size={14} /> : <><Sparkles size={15} /> Start production</>}
          </Button>
        </form>
        <InfoBanner tone="info" icon={Info}>
          <strong>What runs automatically, and what does not.</strong>
          <div className="film-provider-note">The agent writes the screenplay, casts the characters, saves the locations and directs every shot without spending credits. Scene generation and the final assembly cost credits and need your explicit approval. No provider is ever called behind your back, and nothing is reported as finished until a real MP4 exists.</div>
        </InfoBanner>
      </Card>

      <Card title="Recent productions" subtitle="Resume a run at any stage" icon={Clapperboard}>
        {!recent.data?.productions?.length
          ? <EmptyState icon={WandSparkles} title="No productions yet" description="Write a brief on the left. You can edit every stage afterwards in the project workspace." />
          : (
            <div className="film-list">
              {recent.data.productions.map((run) => (
                <div className="film-row" key={run.id}>
                  <div className="film-row-main">
                    <strong>{run.title}</strong>
                    <small>{pretty(run.status)} · {run.currentStage} · updated {formatDate(run.updatedAt)}</small>
                  </div>
                  <Button size="sm" variant="secondary" to={`/app/films/agent?film=${run.filmId}`}>Open <ArrowRight size={13} /></Button>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  );
}

function RunView({ filmId }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const { data, loading, error: loadError, reload } = useLoad(
    () => get(`/api/films/${filmId}/production`),
    [filmId],
    { initial: null, refreshMs: 4000 },
  );

  async function act(action, toast) {
    setPending(action); setError(null);
    try {
      await post(`/api/films/${filmId}/production/advance`, { action });
      await reload({ silent: true });
      showToast(toast, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }

  async function revise() {
    if (instruction.trim().length < 3) return;
    setPending('revise'); setError(null);
    try {
      const result = await post(`/api/films/${filmId}/production/revise`, { stage: 'screenplay', instruction: instruction.trim() });
      setInstruction('');
      await reload({ silent: true });
      showToast(`Screenplay rewritten: ${result.scenes} scenes${result.aiGenerated ? ` (${result.provider})` : ' (labelled offline draft)'}. Cast, locations and direction rebuilt.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }

  async function schedule() {
    if (!scheduleAt) return;
    setPending('schedule'); setError(null);
    try {
      const result = await post(`/api/films/${filmId}/production/schedule`, { action: 'schedule', runAt: new Date(scheduleAt).toISOString() });
      setScheduleAt('');
      await reload({ silent: true });
      showToast(`Generation scheduled for ${new Date(result.runAt).toLocaleString()}. The worker runs it unattended.`, 'success');
    } catch (err) { setError(err); showToast(err.message, 'error'); }
    finally { setPending(null); }
  }

  async function cancel() {
    setPending('cancel'); setError(null);
    try {
      await post(`/api/films/${filmId}/production/cancel`, {});
      await reload({ silent: true });
      showToast('Production cancelled. Clips already generated are kept.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  if (loading && !data) return <Spinner label="Loading production…" />;
  if (loadError && !data) return <ErrorBanner error={loadError} onRetry={() => reload()} />;
  if (!data?.production) {
    return (
      <EmptyState
        icon={WandSparkles} title="This project has no production run"
        description="Start a production from a brief to have the agent write, cast, locate, direct and generate it."
        action={<Button to="/app/films/agent">Start a production</Button>}
      />
    );
  }

  const run = data.production;
  const film = data.film;
  const generateStage = run.stages.find((stage) => stage.id === 'generate');
  const assembleStage = run.stages.find((stage) => stage.id === 'assemble');
  const canGenerate = generateStage?.status === 'pending' && !film?.hasVideo;
  const canRetry = run.canRetry && generateStage?.status === 'blocked';
  const canAssemble = generateStage?.status === 'done' && assembleStage?.status === 'pending';
  const doneCount = run.stages.filter((stage) => stage.status === 'done').length;

  return (
    <div className="grid grid-studio">
      <Card
        title={film?.title || 'Production'}
        subtitle={`${pretty(run.plan.type || 'production')} · ${formatDuration(run.plan.durationSeconds || 0)} · ${run.plan.scenes || '—'} scenes · ${run.counts.ready}/${run.counts.total} clips ready`}
        icon={Clapperboard}
        action={<StatusBadge status={run.status} />}
      >
        <ErrorBanner error={error} />
        {run.error && (
          <InfoBanner tone="warning" icon={Info}>
            <strong>The run is blocked at this stage.</strong>
            <div className="film-provider-note">{run.error}</div>
          </InfoBanner>
        )}
        <div className="film-breakdown" style={{ marginBottom: 14 }}>
          <div className="film-breakdown-row"><span>Stage</span><strong>{doneCount} / {run.stages.length} complete</strong></div>
          <div className="film-breakdown-row"><span>Plan</span><strong>{pretty(run.plan.genre)} · {run.plan.language?.toUpperCase()} · {pretty(run.plan.style)}</strong></div>
          <div className="film-breakdown-row"><span>Credits</span><strong>{run.balance} available</strong></div>
          <div className="film-breakdown-row"><span>Retries used</span><strong>{run.retries}</strong></div>
        </div>

        <div className="film-list">
          {run.stages.map((stage, index) => (
            <div className="film-row" key={stage.id} style={{ alignItems: 'flex-start' }}>
              <div className="film-row-main">
                <strong><StageIcon status={stage.status} />{' '}{index + 1}. {stage.label}{stage.spendsCredits ? ' · costs credits' : ''}</strong>
                <small>{stage.detail || (stage.approval ? 'Waiting for your approval.' : 'Pending.')}</small>
              </div>
              <span className={`film-chip ${stage.status === 'done' ? 'good' : stage.status === 'blocked' ? 'danger' : stage.status === 'running' ? 'warning' : ''}`}>{stage.status}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {canGenerate && (
            <Button onClick={() => act('generate', 'Generation approved. Scenes are queued within your concurrency limit.')} disabled={pending}>
              {pending === 'generate' ? <Spinner size={14} /> : <><Sparkles size={14} /> Approve scene generation</>}
            </Button>
          )}
          {canRetry && (
            <Button onClick={() => act('retry', 'Failed scenes requeued.')} disabled={pending}>
              {pending === 'retry' ? <Spinner size={14} /> : <><RefreshCw size={14} /> Retry {run.failedScenes.length} failed scene(s)</>}
            </Button>
          )}
          {canAssemble && (
            <Button onClick={() => act('assemble', 'Assembly approved. Reserved credits will be refunded if it fails.')} disabled={pending}>
              {pending === 'assemble' ? <Spinner size={14} /> : <><Clapperboard size={14} /> Approve assembly</>}
            </Button>
          )}
          {run.status === 'completed' && <Button to={`/app/films/project/${run.filmId}?step=preview`}><Play size={14} /> Preview & export</Button>}
          {run.status !== 'completed' && run.status !== 'cancelled' && (
            <Button variant="danger" onClick={cancel} disabled={pending}><Square size={13} /> Cancel production</Button>
          )}
          <Button variant="ghost" onClick={() => reload({ silent: true })}><RefreshCw size={13} /> Refresh</Button>
          <Button variant="ghost" to={`/app/films/project/${run.filmId}?step=scenes`}><Pause size={13} /> Open director workspace</Button>
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Revise & schedule" subtitle="Rewrite the screenplay, or run generation later" icon={Sparkles}>
          <div className="stack" style={{ gap: 10 }}>
            <Field label="Revision note" hint="Rewrites the screenplay with your note, then rebuilds cast, locations and direction. Refused once clips exist.">
              <textarea className="input" rows={3} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make scene 3 more tense and shorten the opening." />
            </Field>
            <Button size="sm" variant="secondary" onClick={revise} disabled={pending === 'revise' || instruction.trim().length < 3}>
              {pending === 'revise' ? <Spinner size={13} /> : <><RefreshCw size={13} /> Revise screenplay</>}
            </Button>
            <Field label="Schedule generation" hint="Queues the paid generation stage for a future time; the worker runs it unattended.">
              <input className="input" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
            </Field>
            <Button size="sm" variant="ghost" onClick={schedule} disabled={pending === 'schedule' || !scheduleAt}>
              {pending === 'schedule' ? <Spinner size={13} /> : <><Clock size={13} /> Schedule generation</>}
            </Button>
            {run.scheduledFor && <p className="film-provider-note">Scheduled for {new Date(run.scheduledFor).toLocaleString()}.</p>}
          </div>
        </Card>

        <Card title="Continuity & quality" subtitle="Run automatically once every clip exists" icon={CheckCircle2}>
          {!run.qc
            ? <div className="film-empty-mini">QC runs when all scenes have real clips ({run.counts.ready}/{run.counts.total} ready).</div>
            : (
              <>
                <div className={`film-chip ${run.qc.status === 'pass' ? 'good' : run.qc.status === 'fail' ? 'danger' : 'warning'}`} style={{ marginBottom: 10 }}>{pretty(run.qc.status)} · {run.qc.score}%</div>
                <div className="film-breakdown">
                  {run.qc.checks.filter((check) => check.status !== 'pass').slice(0, 6).map((check) => (
                    <div className="film-breakdown-row" key={check.id}><span>{check.label}</span><strong>{check.detail}</strong></div>
                  ))}
                  {run.qc.checks.every((check) => check.status === 'pass') && <div className="film-breakdown-row"><span>All checks</span><strong>Passing</strong></div>}
                </div>
              </>
            )}
        </Card>

        <Card title="Agent rules" subtitle="What it will never do" icon={Info}>
          <div className="film-breakdown">
            <div className="film-breakdown-row"><span>Spends credits without approval</span><strong>Never</strong></div>
            <div className="film-breakdown-row"><span>Fabricates clips</span><strong>Never</strong></div>
            <div className="film-breakdown-row"><span>Claims completion before export</span><strong>Never</strong></div>
          </div>
          <p className="film-provider-note">A production is only marked complete when a real MP4 exists on disk. When a provider is missing or a scene fails, the run stops at that stage with the exact scene numbers and a retry action.</p>
          <Button size="sm" variant="secondary" className="btn-block" to={`/app/films/project/${run.filmId}?step=cast`}><Coins size={14} /> Review cast references</Button>
        </Card>

        <Card title="Brief" subtitle={`Created ${formatDate(run.createdAt)}`} icon={Sparkles}>
          <p className="film-provider-note" style={{ marginTop: 0 }}>{run.brief}</p>
          {run.failedScenes?.length > 0 && <InfoBanner tone="warning" icon={Info}><strong>Failed scenes:</strong> {run.failedScenes.join(', ')}</InfoBanner>}
          <Link className="btn btn-ghost btn-sm btn-block" to={`/app/films/project/${run.filmId}?step=setup`}>Project setup</Link>
        </Card>
      </div>
    </div>
  );
}

export default function ProductionAgent() {
  const [params] = useSearchParams();
  const filmId = params.get('film') || '';
  return (
    <FilmShell
      view="agent"
      title="AI Production Agent"
      subtitle="Describe a production once. The agent writes, casts, locates and directs it — then waits for your approval before spending credits."
    >
      {filmId ? <RunView filmId={filmId} /> : <StartProduction />}
    </FilmShell>
  );
}
