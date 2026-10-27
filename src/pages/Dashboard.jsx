import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight, BarChart3, CalendarClock, CheckCircle2, Clapperboard, Eye,
  Plus, Send, Sparkles, Users, WandSparkles, Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { get, post, formatDate, formatNumber } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, ProgressBar, Spinner, StatusBadge, useToast } from '../components/ui.jsx';

export default function Dashboard() {
  const { user, plan, usage, options, providerStatus } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(async () => {
    const [projects, posts, analytics, accountStatus] = await Promise.all([
      get('/api/projects?limit=8'),
      get('/api/posts?limit=8'),
      get('/api/analytics'),
      get('/api/accounts/status'),
    ]);
    return { projects: projects.projects || [], posts: posts.posts || [], analytics, accountStatus };
  }, [], { refreshMs: 15000 });
  const [form, setForm] = useState({
    topic: '',
    niche: 'Education & interesting facts',
    style: 'cinematic',
    duration: 45,
    aspectRatio: '9:16',
    autoPublish: true,
    reviewRequired: true,
  });
  const [creating, setCreating] = useState(false);

  const projects = data?.projects || [];
  const posts = data?.posts || [];
  const analytics = data?.analytics;
  const integrations = data?.accountStatus?.integrations || {};
  const published = posts.filter((post) => post.status === 'published').length;
  const scheduled = posts.filter((post) => ['scheduled', 'processing', 'needs_review'].includes(post.status)).length;
  const activeGenerations = projects.filter((project) => ['queued', 'generating'].includes(project.status)).length;
  const chartData = useMemo(() => (analytics?.daily || []).map((day) => ({ ...day, label: day.date.slice(5) })), [analytics]);

  async function createQuick(event) {
    event.preventDefault();
    if (form.topic.trim().length < 3) { showToast('Enter a topic with at least 3 characters.', 'error'); return; }
    setCreating(true);
    try {
      const result = await post('/api/projects', {
        niche: form.niche,
        topic: form.topic.trim(),
        style: form.style,
        duration: Number(form.duration),
        aspectRatio: form.aspectRatio,
        language: 'en',
        voice: 'nova',
        captions: true,
        music: true,
        research: false,
        autoPublish: form.autoPublish,
        reviewRequired: form.reviewRequired,
        platforms: ['sandbox'],
        tone: 'documentary',
      });
      showToast('Generation job queued. You can watch progress live.', 'success');
      navigate(`/app/projects/${result.project.id}`);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCreating(false); }
  }

  const statCards = [
    { label: 'Videos generated', value: projects.length, foot: `${activeGenerations} in progress`, icon: Clapperboard, glow: 'rgba(139,124,255,.16)' },
    { label: 'Published posts', value: published, foot: `${scheduled} upcoming or in review`, icon: Send, glow: 'rgba(57,217,138,.13)' },
    { label: 'Measured views', value: formatNumber(analytics?.totals?.views || 0), foot: analytics?.dataQuality?.note || 'Awaiting metrics', icon: Eye, glow: 'rgba(66,217,208,.12)' },
    { label: 'Render quota', value: `${usage?.videos || 0}/${plan?.max_videos_month || 0}`, foot: `${plan?.name || 'Free'} monthly plan`, icon: Zap, glow: 'rgba(246,185,76,.12)' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title={`Good to see you, ${user?.name?.split(' ')[0] || 'Creator'}.`}
        description="Generate new faceless videos, monitor publishing, and keep every channel moving from one workspace."
        actions={<Button to="/app/studio" variant="primary"><WandSparkles size={16} /> Open AI Studio</Button>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />

      <div className="stat-grid">
        {statCards.map((stat) => (
          <div className="stat-card" key={stat.label} style={{ '--glow': stat.glow }}>
            <div className="stat-top"><span>{stat.label}</span><span className="stat-icon"><stat.icon size={17} /></span></div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-foot">{stat.foot}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-sidebar">
        <div className="stack">
          <Card className="quick-create" title="Quick create" subtitle="One idea becomes a script, narrated video, captions, and a scheduled post." icon={Sparkles}>
            <form onSubmit={createQuick}>
              <Field label="What should this video be about?" required>
                <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. The abandoned railway station that vanished overnight" minLength={3} maxLength={500} required />
              </Field>
              <div className="grid grid-3">
                <Field label="Niche">
                  <select value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })}>
                    {(options.niches || []).map((niche) => <option key={niche.id} value={niche.name}>{niche.name}</option>)}
                  </select>
                </Field>
                <Field label="Visual style">
                  <select value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}>
                    {(options.styles || []).map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                  </select>
                </Field>
                <Field label="Length / format">
                  <div className="row">
                    <select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} style={{ width: '45%' }}>
                      {[15, 30, 45, 60, 90].map((duration) => <option key={duration} value={duration}>{duration}s</option>)}
                    </select>
                    <select value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}>
                      {(options.aspects || []).map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.id}</option>)}
                    </select>
                  </div>
                </Field>
              </div>
              <div className="row row-wrap" style={{ marginTop: 12 }}>
                <label className="checkbox-row"><input type="checkbox" checked={form.autoPublish} onChange={(e) => setForm({ ...form, autoPublish: e.target.checked })} /> Prepare publishing</label>
                <label className="checkbox-row"><input type="checkbox" checked={form.reviewRequired} onChange={(e) => setForm({ ...form, reviewRequired: e.target.checked })} /> Review before posting</label>
                <span className="spacer" />
                <Button type="submit" disabled={creating}>{creating ? <Spinner size={16} label="Queuing…" /> : <><Plus size={16} /> Generate video</>}</Button>
              </div>
            </form>
          </Card>

          <Card
            title="Recent projects"
            subtitle="Live generation progress and rendered assets."
            icon={Clapperboard}
            action={<Button to="/app/projects" variant="ghost" size="sm">View all <ArrowRight size={14} /></Button>}
          >
            {loading && !projects.length ? <Spinner label="Loading projects…" /> : projects.length === 0 ? (
              <EmptyState icon={Clapperboard} title="No videos yet" description="Create your first AI faceless video and watch the pipeline here." action={<Button to="/app/studio" variant="primary">Open Studio</Button>} />
            ) : (
              <div className="list">
                {projects.slice(0, 6).map((project) => (
                  <div className="list-item" key={project.id}>
                    <div className="thumb">
                      {project.hasVideo ? <img src={`/api/media/projects/${project.id}/thumbnail`} alt="" /> : <Clapperboard size={20} />}
                    </div>
                    <div className="list-main">
                      <strong>{project.title}</strong>
                      <small>{project.niche} · {formatDate(project.createdAt)} · {project.durationSeconds || project.config?.duration || 45}s</small>
                      {['queued', 'generating'].includes(project.status) && <div style={{ marginTop: 7 }}><ProgressBar value={project.progress} compact /></div>}
                    </div>
                    <div className="list-side"><StatusBadge status={project.status} /><Button to={`/app/projects/${project.id}`} size="xs" variant="ghost">Open</Button></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Engagement trend" subtitle="Views from synced platform metrics over the last 30 days." icon={BarChart3} action={<Button to="/app/analytics" variant="ghost" size="sm">Analytics <ArrowRight size={14} /></Button>}>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b7cff" stopOpacity={.45} /><stop offset="100%" stopColor="#8b7cff" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={false} width={50} />
                  <Tooltip contentStyle={{ background: '#11182b', border: '1px solid #202c47', borderRadius: 10, color: '#eaf0ff' }} />
                  <Area type="monotone" dataKey="views" stroke="#9a8dff" strokeWidth={2} fill="url(#viewsGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Integration readiness" subtitle="Official APIs activate when server credentials are configured." icon={Users}>
            <div className="list">
              {Object.entries(integrations).map(([key, integration]) => (
                <div className="integration-row" key={key}>
                  <div className="integration-name">
                    <span className="platform-icon">{key.slice(0, 2).toUpperCase()}</span>
                    <div><strong style={{ fontSize: 12 }}>{integration.label}</strong><small style={{ display: 'block' }}>{integration.connectedCount || 0} connected</small></div>
                  </div>
                  {integration.configured
                    ? <Button href={integration.connectUrl} size="xs" variant="secondary">Connect</Button>
                    : <StatusBadge status="needs_review" label="Needs keys" />}
                </div>
              ))}
            </div>
            <div className="banner banner-warning" style={{ marginTop: 14, marginBottom: 0 }}>
              <Zap size={17} />
              <div><strong>Local mode is active</strong><span>AI: {providerStatus?.ai?.active || 'local'} · Images: {providerStatus?.images?.active || 'procedural'} · Voice: {providerStatus?.tts?.active || 'mespeak'}</span></div>
            </div>
          </Card>

          <Card title="Upcoming posts" subtitle="Scheduled, reviewing, and processing publications." icon={CalendarClock} action={<Button to="/app/publishing" variant="ghost" size="sm">Open</Button>}>
            {posts.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Generated videos can be scheduled here automatically." /> : (
              <div className="list">
                {posts.slice(0, 5).map((post) => (
                  <div className="list-item" key={post.id}>
                    <div className="thumb"><CalendarClock size={19} /></div>
                    <div className="list-main"><strong>{post.title}</strong><small>{formatDate(post.scheduledAt)}</small></div>
                    <div className="list-side"><StatusBadge status={post.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Workspace health" subtitle="Current provider and queue state." icon={CheckCircle2}>
            <div className="key-value" style={{ gridTemplateColumns: '1fr' }}>
              {[
                ['AI script provider', providerStatus?.ai?.active || 'local'],
                ['Research provider', providerStatus?.research?.active || 'none'],
                ['Image provider', providerStatus?.images?.active || 'procedural'],
                ['Voice provider', providerStatus?.tts?.active || 'mespeak'],
                ['Renderer', providerStatus?.videoRenderer || 'ffmpeg'],
                ['Public media URL', providerStatus?.publicMediaReady ? 'HTTPS ready' : 'Local only'],
              ].map(([key, value]) => <div className="kv-item" key={key}><span>{key}</span><strong>{value}</strong></div>)}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
