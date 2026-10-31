import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Image as ImageIcon, Info, Mic2, Play, Plus, RefreshCw,
  Sparkles, Trash2, WandSparkles, Workflow,
} from 'lucide-react';
import { get, post, patch, del } from '../../api.js';
import { useLoad } from '../../hooks.js';
import {
  Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Spinner, useToast,
} from '../../components/ui.jsx';
import { FilmShell, pretty } from './FilmStudio.jsx';

const TYPE_META = {
  text: { icon: Sparkles, label: 'Text', hint: 'Literal text, or pass through upstream output.' },
  screenplay: { icon: WandSparkles, label: 'Screenplay', hint: 'Writes scenes. Attach a project to save them into it.' },
  image: { icon: ImageIcon, label: 'Image', hint: 'Renders a still from the prompt or upstream text.' },
  voice: { icon: Mic2, label: 'Voice', hint: 'Speaks the text with the configured TTS provider.' },
  scene: { icon: Play, label: 'Scene clip', hint: 'Renders one project scene through the credit-metered pipeline.' },
};

function NodeFields({ node, films, onChange }) {
  const config = node.config || {};
  const set = (key, value) => onChange({ ...node, config: { ...config, [key]: value } });
  if (node.type === 'text') {
    return <Field label="Text"><textarea className="input" rows={3} value={config.text || ''} onChange={(event) => set('text', event.target.value)} placeholder="A rooftop at dawn, a sister holding a letter…" /></Field>;
  }
  if (node.type === 'screenplay') {
    return (
      <>
        <Field label="Idea" hint="Leave blank to use upstream text."><textarea className="input" rows={3} value={config.idea || ''} onChange={(event) => set('idea', event.target.value)} /></Field>
        <div className="film-inline-form">
          <Field label="Format">
            <select className="input" value={config.type || 'short_drama'} onChange={(event) => set('type', event.target.value)}>
              {['short_drama', 'long_drama', 'movie', 'episode', 'advertisement', 'music_video', 'cinematic_scene'].map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
            </select>
          </Field>
          <Field label="Genre">
            <input className="input" value={config.genre || 'family_drama'} onChange={(event) => set('genre', event.target.value)} />
          </Field>
        </div>
      </>
    );
  }
  if (node.type === 'image') {
    return (
      <>
        <Field label="Prompt" hint="Blank uses upstream text."><textarea className="input" rows={3} value={config.prompt || ''} onChange={(event) => set('prompt', event.target.value)} /></Field>
        <Field label="Aspect ratio">
          <select className="input" value={config.aspectRatio || '16:9'} onChange={(event) => set('aspectRatio', event.target.value)}>
            {['16:9', '9:16', '1:1'].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
          </select>
        </Field>
      </>
    );
  }
  if (node.type === 'voice') {
    return (
      <>
        <Field label="Text" hint="Blank uses upstream text."><textarea className="input" rows={3} value={config.text || ''} onChange={(event) => set('text', event.target.value)} /></Field>
        <Field label="Voice"><input className="input" value={config.voice || 'nova'} onChange={(event) => set('voice', event.target.value)} /></Field>
      </>
    );
  }
  return (
    <Field label="Scene" hint="Video nodes render an existing scene, so credits and provider checks are identical to the normal pipeline.">
      <select className="input" value={config.sceneId || ''} onChange={(event) => set('sceneId', event.target.value)}>
        <option value="">Choose a scene…</option>
        {(films.find((film) => film.id === node.filmId)?.scenes || []).map((scene) => (
          <option key={scene.id} value={scene.id}>Scene {scene.ordinal} — {scene.heading || 'Untitled'}</option>
        ))}
      </select>
    </Field>
  );
}

function FlowEditor({ flowId }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [run, setRun] = useState(null);
  const flowState = useLoad(() => get(`/api/films/flows/${flowId}`), [flowId], { initial: null });
  const filmsState = useLoad(() => get('/api/films'), [], { initial: { films: [] } });
  const [draft, setDraft] = useState(null);
  const flow = draft?.flow || flowState.data?.flow;

  React.useEffect(() => {
    if (flowState.data?.flow && !draft) setDraft({ flow: flowState.data.flow });
  }, [flowState.data, draft]);

  const films = (filmsState.data?.films || []).map((film) => ({ ...film }));
  const filmDetailState = useLoad(() => (flow?.filmId ? get(`/api/films/${flow.filmId}`) : Promise.resolve({ scenes: [] })), [flow?.filmId], { initial: { scenes: [] } });
  const scenes = filmDetailState.data?.scenes || [];

  function setNodes(nodes) {
    setDraft((current) => ({ flow: { ...current.flow, graph: { nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })) } } }));
  }

  function addNode(type) {
    const id = `${type}-${Math.random().toString(36).slice(2, 6)}`;
    setNodes([...(flow.graph?.nodes || []), { id, type, config: {}, x: 0, y: 0 }]);
  }

  async function save() {
    setPending('save'); setError(null);
    try {
      const graph = flow.graph;
      await patch(`/api/films/flows/${flowId}`, { name: flow.name, filmId: flow.filmId, graph });
      await flowState.reload({ silent: true });
      setDraft(null);
      showToast('Flow saved.', 'success');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  async function execute() {
    setPending('run'); setError(null);
    try {
      const graph = flow.graph;
      await patch(`/api/films/flows/${flowId}`, { name: flow.name, filmId: flow.filmId, graph });
      const result = await post(`/api/films/flows/${flowId}/run`, {});
      setRun(result.lastRun);
      setDraft(null);
      await flowState.reload({ silent: true });
      showToast(result.lastRun.status === 'succeeded' ? 'Flow finished. Every node produced real output.' : `Flow stopped: ${result.lastRun.error}`, result.lastRun.status === 'succeeded' ? 'success' : 'error');
    } catch (err) { setError(err); }
    finally { setPending(null); }
  }

  if (flowState.loading && !flow) return <Spinner label="Loading flow…" />;
  if (!flow) return <ErrorBanner error={error} />;
  const nodes = flow.graph?.nodes || [];
  const lastRun = run || flow.lastRun;
  const results = new Map((lastRun?.nodes || []).map((node) => [node.nodeId, node]));

  return (
    <div className="grid grid-studio">
      <Card title={flow.name} subtitle={`${nodes.length} nodes · ${flow.filmId ? 'project attached' : 'standalone'}`} icon={Workflow}>
        <ErrorBanner error={error} />
        <div className="film-inline-form" style={{ marginBottom: 12 }}>
          <Field label="Flow name"><input className="input" value={flow.name} onChange={(event) => setDraft({ flow: { ...flow, name: event.target.value } })} /></Field>
          <Field label="Project (optional)">
            <select className="input" value={flow.filmId || ''} onChange={(event) => setDraft({ flow: { ...flow, filmId: event.target.value || null } })}>
              <option value="">Standalone flow</option>
              {films.map((film) => <option key={film.id} value={film.id}>{film.title}</option>)}
            </select>
          </Field>
        </div>

        <div className="film-flow">
          {nodes.map((node, index) => {
            const meta = TYPE_META[node.type] || TYPE_META.text;
            const Icon = meta.icon;
            const result = results.get(node.id);
            return (
              <React.Fragment key={node.id}>
                {index > 0 && <ArrowRight className="film-flow-arrow" size={18} />}
                <div className={`film-flow-node ${result ? `is-${result.status}` : ''}`}>
                  <div className="film-flow-node-head">
                    <strong><Icon size={14} /> {meta.label}</strong>
                    <button type="button" className="film-flow-remove" aria-label={`Remove ${meta.label} node`} onClick={() => setNodes(nodes.filter((item) => item.id !== node.id))}><Trash2 size={13} /></button>
                  </div>
                  <NodeFields node={{ ...node, filmId: flow.filmId }} films={[{ id: flow.filmId, scenes }]} onChange={(next) => setNodes(nodes.map((item) => (item.id === node.id ? { ...next, id: node.id } : item)))} />
                  {result && (
                    <div className={`film-flow-result ${result.status}`}>
                      <strong>{result.status}</strong>
                      <small>{result.error || result.summary || 'done'}</small>
                      {result.output?.path && node.type === 'image' && (
                        <img src={`/api/films/flows/${flowId}/artifact/${result.output.path.split('/').pop()}`} alt={`${meta.label} output`} />
                      )}
                      {result.output?.path && node.type === 'voice' && (
                        <audio controls preload="none" src={`/api/films/flows/${flowId}/artifact/${result.output.path.split('/').pop()}`} />
                      )}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="film-inline-form" style={{ marginTop: 14 }}>
          {Object.entries(TYPE_META).map(([type, meta]) => (
            <Button key={type} size="sm" variant="ghost" onClick={() => addNode(type)}><Plus size={13} /> {meta.label}</Button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Button onClick={execute} disabled={Boolean(pending) || !nodes.length}>
            {pending === 'run' ? <Spinner size={14} /> : <><Play size={14} /> Run flow</>}
          </Button>
          <Button variant="secondary" onClick={save} disabled={Boolean(pending)}><CheckCircle2 size={14} /> Save</Button>
          <Button variant="ghost" onClick={() => flowState.reload({ silent: true })}><RefreshCw size={13} /> Reload</Button>
          <Button variant="danger" onClick={async () => { await del(`/api/films/flows/${flowId}`); window.location.assign('/app/films/canvas'); }}><Trash2 size={13} /> Delete</Button>
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Card title="Last run" subtitle={lastRun ? pretty(lastRun.status) : 'Never run'} icon={Info}>
          {!lastRun
            ? <div className="film-empty-mini">Run the flow to see real per-node output and errors.</div>
            : (
              <div className="film-breakdown">
                {lastRun.nodes.map((node) => (
                  <div className="film-breakdown-row" key={node.nodeId}>
                    <span>{node.nodeId}</span>
                    <strong>{node.status}{node.error ? ` · ${node.error}` : ''}</strong>
                  </div>
                ))}
              </div>
            )}
        </Card>
        <Card title="How this executes" subtitle="Real services, no simulation" icon={Workflow}>
          <p className="film-provider-note" style={{ marginTop: 0 }}>
            Nodes run in dependency order. Text feeds downstream prompts; the screenplay node calls the same generator
            as the script writer; image and voice nodes write real files; scene nodes go through the credit-metered
            render pipeline. A missing provider fails that node and skips everything downstream instead of faking output.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function CreativeCanvas() {
  const [params, setParams] = useSearchParams();
  const flowId = params.get('flow');
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const { data, loading, reload } = useLoad(() => get('/api/films/flows'), [], { initial: { flows: [] } });

  async function create() {
    setPending(true);
    try {
      const result = await post('/api/films/flows', { name: 'Untitled flow' });
      await reload({ silent: true });
      setParams({ flow: result.flow.id });
      showToast('Flow created with a starter pipeline.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setPending(false); }
  }

  return (
    <FilmShell view="canvas" title="Creative Canvas" subtitle="Chain real generators into one reproducible flow — prompts, scripts, stills, voices and credit-metered scene clips.">
      {flowId
        ? <FlowEditor flowId={flowId} />
        : (
          <div className="grid grid-studio">
            <Card title="Your flows" subtitle="Saved node pipelines" icon={Workflow} action={<Button size="sm" onClick={create} disabled={pending}><Plus size={14} /> New flow</Button>}>
              {loading && !data?.flows?.length ? <Spinner label="Loading flows…" /> : null}
              {!loading && !data?.flows?.length
                ? <EmptyState icon={Workflow} title="No flows yet" description="Create a flow to connect prompts, a screenplay, stills and voice takes without leaving the studio." action={<Button onClick={create} disabled={pending}><Plus size={14} /> Create your first flow</Button>} />
                : (
                  <div className="film-list">
                    {data.flows.map((flow) => (
                      <div className="film-row" key={flow.id}>
                        <div className="film-row-main">
                          <strong>{flow.name}</strong>
                          <small>{flow.graph?.nodes?.length || 0} nodes · {pretty(flow.status)}{flow.lastRun?.error ? ` · ${flow.lastRun.error}` : ''}</small>
                        </div>
                        <Button size="sm" variant="secondary" to={`/app/films/canvas?flow=${flow.id}`}>Open <ArrowRight size={13} /></Button>
                      </div>
                    ))}
                  </div>
                )}
            </Card>
            <Card title="What a flow can do" subtitle="Every node is wired to a service" icon={Info}>
              <div className="film-breakdown">
                <div className="film-breakdown-row"><span>Text → screenplay</span><strong>Real generator</strong></div>
                <div className="film-breakdown-row"><span>Screenplay → stills</span><strong>Image provider</strong></div>
                <div className="film-breakdown-row"><span>Dialogue → voice</span><strong>TTS engine</strong></div>
                <div className="film-breakdown-row"><span>Scene → clip</span><strong>Credits + provider</strong></div>
              </div>
              <InfoBanner tone="info" icon={Info}>
                <strong>Execution is honest.</strong>
                <div className="film-provider-note">If a provider is missing, that node fails with its real error and downstream nodes are skipped. Nothing is written to the project as if it had succeeded.</div>
              </InfoBanner>
            </Card>
          </div>
        )}
    </FilmShell>
  );
}
