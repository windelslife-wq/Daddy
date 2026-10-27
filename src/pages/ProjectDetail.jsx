import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarClock, CheckCircle2, Clapperboard, Download, ExternalLink,
  FileText, Film, Globe2, Image as ImageIcon, ListVideo, Mic2, RefreshCw, Send, ShieldCheck,
} from 'lucide-react';
import { useLoad } from '../hooks.js';
import { get, post, patch, formatDate, safeHref } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, KeyValue, Modal, PageHeader, ProgressBar, Spinner, StatusBadge, Tabs, useToast } from '../components/ui.jsx';

function localDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { showToast } = useToast();
  const [tab, setTab] = useState('script');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(localDateTime(new Date(Date.now() + 3600000)));
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useLoad(() => Promise.all([
    get(`/api/projects/${id}`),
    get(`/api/projects/${id}/events`).catch(() => ({ stages: [], providerSummary: {} })),
  ]).then(([detail, events]) => ({ ...detail, events })), [id], { refreshMs: 3000 });

  const project = data?.project;
  const post = data?.post;
  const stages = data?.events?.stages || project?.providerSummary?.stages || [];
  const captions = post?.captions || {};
  const sources = project?.sources || [];
  const provider = project?.providerSummary || {};
  const isGenerating = project && ['queued', 'generating'].includes(project.status);
  const hasPublishingWork = post && ['queued', 'generating', 'scheduled', 'processing', 'publishing', 'awaiting_media'].includes(post.status);

  async function action(fn, message) {
    setBusy(true);
    try { await fn(); if (message) showToast(message, 'success'); await reload({ silent: true }); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(false); }
  }
  async function schedulePost() {
    await action(() => post(`/api/posts/${post.id}/schedule`, { scheduledAt: new Date(scheduledAt).toISOString() }), 'Post scheduled.');
    setScheduleOpen(false);
  }
  async function preparePost() {
    await action(() => post(`/api/projects/${id}/create-post`, { autoPublish: true, reviewRequired: true }), 'Post prepared for review.');
  }
  async function approvePost() { await action(() => post(`/api/posts/${post.id}/approve`, {}), 'Post approved and queued.'); }
  async function retryPublication(publicationId) { await action(() => post(`/api/publications/${publicationId}/retry`, {}), 'Publication retry queued.'); }
  async function skipPublication(publicationId) { await action(() => post(`/api/publications/${publicationId}/skip`, {}), 'Publication skipped.'); }
  async function refreshAccounts() { await action(() => post(`/api/posts/${post.id}/refresh-accounts`, {}), 'Connected accounts synced.'); }
  async function regenerate() { await action(() => post(`/api/projects/${id}/regenerate`, {}), 'Generation retry queued.'); }

  if (loading && !project) return <div className="full-loader"><Spinner size={20} label="Loading project…" /></div>;
  if (!project) return <ErrorBanner error={error || new Error('Project not found.')} />;

  return (
    <>
      <PageHeader
        eyebrow="Project detail"
        title={project.title}
        description={`${project.niche} · ${project.config?.style} · ${project.config?.language} · ${project.durationSeconds || project.config?.duration || 45}s`}
        actions={<><Button to="/app/projects" variant="ghost"><ArrowLeft size={15} /> Back</Button>{project.status === 'failed' && <Button variant="secondary" onClick={regenerate} disabled={busy}><RefreshCw size={15} /> Regenerate</Button>}</>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      {project.error && <div className="banner banner-error"><strong>Generation failed</strong><span>{project.error}</span></div>}
      {isGenerating && <InfoBanner icon={RefreshCw}><strong>Generation in progress.</strong><span> This page refreshes every 3 seconds. The worker handles rendering in the background.</span></InfoBanner>}

      <div className="grid grid-sidebar">
        <div className="stack">
          <Card title="Rendered video" subtitle="H.264/AAC MP4 with optional burned-in captions and SRT subtitle export." icon={Film}>
            <div className="video-frame">
              {project.hasVideo ? (
                <video controls playsInline poster={`/api/media/projects/${id}/thumbnail`} src={`/api/media/projects/${id}/video`}>
                  <track kind="captions" src={`/api/media/projects/${id}/captions`} srcLang={project.config?.language || 'en'} label="Generated captions" default />
                </video>
              ) : (
                <div style={{ textAlign: 'center', padding: 30 }}>
                  <Clapperboard size={28} color="var(--primary-2)" />
                  <h3 style={{ margin: '12px 0 5px' }}>{isGenerating ? 'Rendering your video…' : 'No video yet'}</h3>
                  <p className="tiny">{project.stage || project.status}</p>
                </div>
              )}
            </div>
            {isGenerating && <div style={{ marginTop: 16 }}><ProgressBar value={project.progress} label={project.stage || 'Working'} /></div>}
            {project.hasVideo && (
              <div className="row row-wrap" style={{ marginTop: 16 }}>
                <Button href={`/api/media/projects/${id}/video?download=1`} download size="sm" variant="primary"><Download size={15} /> Video</Button>
                <Button href={`/api/media/projects/${id}/thumbnail?download=1`} download size="sm" variant="secondary"><ImageIcon size={15} /> Thumbnail</Button>
                <Button href={`/api/media/projects/${id}/captions?download=1`} download size="sm" variant="secondary"><FileText size={15} /> SRT</Button>
                <Button href={`/api/media/projects/${id}/script?download=1`} download size="sm" variant="secondary"><FileText size={15} /> Script</Button>
                <Button href={`/api/media/projects/${id}/audio?download=1`} download size="sm" variant="secondary"><Mic2 size={15} /> Audio</Button>
              </div>
            )}
          </Card>

          <Card>
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { id: 'script', label: 'Script', icon: FileText },
                { id: 'scenes', label: 'Scenes', icon: ListVideo, count: project.scenes?.length || 0 },
                { id: 'captions', label: 'Captions', icon: Globe2, count: Object.keys(captions).length },
                { id: 'sources', label: 'Sources', icon: ShieldCheck, count: sources.length },
                { id: 'logs', label: 'Logs', icon: RefreshCw, count: stages.length },
                { id: 'publishing', label: 'Publishing', icon: Send, count: post?.publications?.length || 0 },
              ]}
            />
            <div style={{ marginTop: 18 }}>
              {tab === 'script' && (
                project.script ? <div className="caption-box"><h4>Final narration script</h4><p>{project.script}</p></div> : <EmptyState icon={FileText} title="Script not ready" description="The generated narration will appear here after the script stage." />
              )}
              {tab === 'scenes' && (
                project.scenes?.length ? <div className="scene-grid">{project.scenes.map((scene, index) => (
                  <div className="scene-card" key={index}>
                    <div className="scene-num">Scene {index + 1}</div>
                    <p style={{ margin: '7px 0', fontSize: 12 }}>{scene.narration || scene.text}</p>
                    <small>{scene.visualPrompt || scene.visual}</small>
                    {scene.caption && <div className="badge badge-info" style={{ marginTop: 9 }}>{scene.caption}</div>}
                  </div>
                ))}</div> : <EmptyState icon={ListVideo} title="Scenes not ready" description="Scene breakdown and art prompts will appear here." />
              )}
              {tab === 'captions' && (
                Object.keys(captions).length ? <div className="grid grid-2">{Object.entries(captions).map(([platform, content]) => (
                  <div className="caption-box" key={platform}>
                    <h4>{platform}</h4>
                    <p><strong>{content.title}</strong></p>
                    <p>{content.description || content.caption}</p>
                    <div className="row row-wrap">{(content.hashtags || []).slice(0, 8).map((tag) => <span className="badge badge-neutral" key={tag}>{tag}</span>)}</div>
                  </div>
                ))}</div> : <EmptyState icon={Globe2} title="No platform captions yet" description="Captions, titles, and hashtags are generated when the project finishes." />
              )}
              {tab === 'sources' && (
                sources.length ? <div className="list">{sources.map((source, index) => (
                  <div className="source-item" key={index}><ShieldCheck size={16} color="var(--cyan)" /><div><strong style={{ fontSize: 12 }}>{source.title || source.url}</strong><br /><a href={safeHref(source.url)} target="_blank" rel="noreferrer">{source.url}</a><small style={{ display: 'block' }}>{source.snippet}</small></div></div>
                ))}</div> : <EmptyState icon={ShieldCheck} title="No research sources" description="Research was off or no configured search provider returned results. Local scripts do not claim specific factual sourcing." />
              )}
              {tab === 'logs' && (
                <div className="stack">
                  <div className="key-value">
                    {[
                      ['AI provider', provider.ai?.provider || provider.research?.provider || 'local'],
                      ['Research', provider.research?.provider || 'none'],
                      ['Images', provider.images?.provider || 'procedural'],
                      ['Voice', provider.tts?.provider || 'mespeak'],
                      ['Music', provider.music?.provider || 'procedural'],
                      ['Renderer', provider.renderer?.provider || 'ffmpeg'],
                    ].map(([key, value]) => <div className="kv-item" key={key}><span>{key}</span><strong>{value}</strong></div>)}
                  </div>
                  {stages.length ? <div className="timeline">{stages.map((stage, index) => (
                    <div className={`timeline-item ${index < stages.length - 1 ? 'done' : 'current'}`} key={`${stage.stage}-${index}`}>
                      <div className="timeline-dot">{index < stages.length - 1 ? <CheckCircle2 size={13} /> : <RefreshCw size={12} />}</div>
                      <div><strong style={{ fontSize: 12 }}>{stage.label || stage.stage}</strong><small style={{ display: 'block' }}>{formatDate(stage.at)} · {stage.progress || 0}%</small></div>
                    </div>
                  ))}</div> : <EmptyState icon={RefreshCw} title="No stage logs yet" description="Generation stages will stream here as the worker progresses." />}
                </div>
              )}
              {tab === 'publishing' && (
                !post ? (
                  <EmptyState icon={Send} title="No post yet" description="Prepare a post to generate platform captions and connect publishing accounts." action={project.status === 'completed' ? <Button variant="primary" onClick={preparePost} disabled={busy}>Prepare post</Button> : null} />
                ) : (
                  <div className="stack">
                    <div className="row-between"><StatusBadge status={post.status} /><small>Scheduled: {formatDate(post.scheduledAt)}</small></div>
                    <div className="row row-wrap">
                      {post.status === 'needs_review' && <Button variant="primary" onClick={approvePost} disabled={busy}><CheckCircle2 size={15} /> Approve & queue</Button>}
                      <Button variant="secondary" onClick={() => setScheduleOpen(true)} disabled={busy}><CalendarClock size={15} /> Schedule</Button>
                      <Button variant="ghost" onClick={refreshAccounts} disabled={busy}><RefreshCw size={15} /> Sync accounts</Button>
                    </div>
                    {post.publications?.length ? post.publications.map((publication) => {
                      const href = safeHref(publication.remoteUrl);
                      return (
                        <div className="publication-row" key={publication.id}>
                          <div className="row-between">
                            <div><strong>{publication.account?.displayName || publication.account?.platform || 'Account'}</strong><small style={{ display: 'block' }}>{publication.account?.platform} · ref {publication.refCode}</small></div>
                            <StatusBadge status={publication.status} />
                          </div>
                          {publication.lastError && <div className="error-text">{publication.lastError}</div>}
                          <div className="row row-wrap" style={{ marginTop: 9 }}>
                            <small>Attempt {publication.attempts}/{publication.maxAttempts}</small>
                            {publication.nextAttemptAt && <small>Next retry: {formatDate(publication.nextAttemptAt)}</small>}
                            {publication.errorCode && <span className="badge badge-danger">{publication.errorCode}</span>}
                            <span className="spacer" />
                            {['failed', 'queued', 'awaiting_media', 'pending_review'].includes(publication.status) && <Button size="xs" variant="secondary" onClick={() => retryPublication(publication.id)} disabled={busy}>Retry</Button>}
                            {!['published', 'skipped'].includes(publication.status) && <Button size="xs" variant="ghost" onClick={() => skipPublication(publication.id)} disabled={busy}>Skip</Button>}
                            {href && <Button href={href} external={!href.startsWith('/')} size="xs" variant="ghost"><ExternalLink size={13} /> View</Button>}
                          </div>
                        </div>
                      );
                    }) : <EmptyState icon={Send} title="No connected accounts" description="Publications are created when matching connected accounts exist." />}
                  </div>
                )
              )}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Production summary" icon={Clapperboard}>
            <KeyValue columns={1} items={[
              ['Status', <StatusBadge key="status" status={project.status} />],
              ['Stage', project.stage || '—'],
              ['Duration', `${project.durationSeconds || project.config?.duration || 45}s`],
              ['Aspect ratio', project.config?.aspectRatio],
              ['Language', project.config?.language],
              ['Voice', project.config?.voice],
              ['Captions', project.config?.captions ? 'Enabled' : 'Disabled'],
              ['Music', project.config?.music ? 'Enabled' : 'Disabled'],
              ['Created', formatDate(project.createdAt)],
            ]} />
          </Card>
          <Card title="Generated assets" icon={Download}>
            <div className="stack" style={{ gap: 8 }}>
              {[['Video', project.videoPath], ['Thumbnail', project.thumbnailPath], ['SRT captions', project.captionPath], ['Audio mix', project.audioPath]].map(([label, path]) => (
                <div className="row-between" key={label}><span className="tiny">{label}</span>{path ? <StatusBadge status="completed" label="Ready" /> : <StatusBadge status="draft" label="Pending" />}</div>
              ))}
            </div>
          </Card>
          <Card title="Safety & rights" icon={ShieldCheck}>
            <p className="tiny" style={{ margin: 0 }}>Procedural scene art and music are generated locally. External AI-generated assets depend on your provider’s terms. Review factual claims before publishing, especially for news, history, and true crime.</p>
          </Card>
        </div>
      </div>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule post"
        description="The worker will publish after this time when the video is ready and accounts are connected."
        footer={<><Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button><Button variant="primary" onClick={schedulePost} disabled={busy}><CalendarClock size={15} /> Save schedule</Button></>}
      >
        <Field label="Publish at" required><input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
