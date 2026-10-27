import React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, BrainCircuit, CheckCircle2, Eye, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useLoad } from '../hooks.js';
import { get, post, formatDate, formatNumber, safeHref } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, InfoBanner, PageHeader, Spinner, StatusBadge, useToast } from '../components/ui.jsx';

export default function Analytics() {
  const { showToast } = useToast();
  const { data, loading, error, reload } = useLoad(() => get('/api/analytics'), [], { refreshMs: 30000 });
  const totals = data?.totals || {};
  const daily = (data?.daily || []).map((day) => ({ ...day, label: day.date.slice(5) }));
  const byPlatform = data?.byPlatform || [];
  const topPosts = data?.topPosts || [];
  const recommendations = data?.recommendations || [];
  const quality = data?.dataQuality || {};

  async function action(fn, message) {
    try { await fn(); if (message) showToast(message, 'success'); await reload({ silent: true }); }
    catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Performance"
        title="Analytics & recommendations"
        description="Metrics come from official platform APIs when available. Sandbox metrics are clearly labeled as simulated."
        actions={<><Button variant="secondary" onClick={() => action(() => post('/api/analytics/sync', {}), 'Metrics sync queued.')}><RefreshCw size={15} /> Sync metrics</Button><Button variant="primary" onClick={() => action(() => post('/api/analytics/recommendations/generate', {}), 'Recommendation analysis queued.')}><BrainCircuit size={15} /> Generate insights</Button></>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      {quality.simulatedMetricsCount > 0 && <InfoBanner icon={Sparkles}><strong>Simulated data is excluded from insights.</strong><span> {quality.simulatedMetricsCount} sandbox metric snapshot(s) are shown for testing only.</span></InfoBanner>}
      {loading && !data ? <div className="full-loader"><Spinner size={20} label="Loading analytics…" /></div> : (
        <>
          <div className="stat-grid">
            {[
              ['Views', formatNumber(totals.views), Eye], ['Engagement', formatNumber(totals.engagement), Sparkles],
              ['Engagement rate', `${(totals.engagementRate || 0).toFixed(2)}%`, BarChart3], ['Impressions', formatNumber(totals.impressions), CheckCircle2],
            ].map(([label, value, Icon]) => (
              <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-foot">From synced metrics snapshots</div></div>
            ))}
          </div>
          <div className="grid grid-sidebar">
            <div className="stack">
              <Card title="Views over time" subtitle="Daily views from the most recent synced metrics." icon={BarChart3}>
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <defs><linearGradient id="analyticsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#42d9d0" stopOpacity={.35} /><stop offset="100%" stopColor="#42d9d0" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} width={50} />
                      <Tooltip contentStyle={{ background: '#11182b', border: '1px solid #202c47', borderRadius: 10, color: '#eaf0ff' }} />
                      <Area type="monotone" dataKey="views" stroke="#42d9d0" strokeWidth={2} fill="url(#analyticsGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Top posts" subtitle="Ranked by latest available view count." icon={Eye}>
                {topPosts.length === 0 ? <EmptyState icon={Eye} title="No metrics yet" description="Publish a post and sync metrics to see performance here." /> : (
                  <div className="table-wrap"><table><thead><tr><th>Post</th><th>Platform</th><th>Views</th><th>Rate</th><th>Published</th><th /></tr></thead><tbody>
                    {topPosts.map((post) => {
                      const href = safeHref(post.remoteUrl);
                      return <tr key={post.publicationId}><td><strong>{post.title}</strong>{post.simulated && <small style={{ display: 'block' }}>simulated</small>}</td><td><StatusBadge status="active" label={post.platform} /></td><td>{formatNumber(post.views)}</td><td>{(post.engagementRate || 0).toFixed(2)}%</td><td><small>{formatDate(post.publishedAt)}</small></td><td>{href && <Button href={href} external={!href.startsWith('/')} size="xs" variant="ghost">View</Button>}</td></tr>;
                    })}
                  </tbody></table></div>
                )}
              </Card>
            </div>
            <div className="stack">
              <Card title="Platform breakdown" subtitle="Views by connected network." icon={BarChart3}>
                {byPlatform.length === 0 ? <EmptyState icon={BarChart3} title="No platform data" description="Metrics appear after official or sandbox syncs." /> : (
                  <div className="chart-container" style={{ height: 190 }}>
                    <ResponsiveContainer width="100%" height="100%"><BarChart data={byPlatform} layout="vertical" margin={{ left: 12, right: 12 }}><CartesianGrid horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} /><YAxis dataKey="platform" type="category" tickLine={false} axisLine={false} width={80} /><Tooltip contentStyle={{ background: '#11182b', border: '1px solid #202c47', borderRadius: 10 }} /><Bar dataKey="views" fill="#8b7cff" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer>
                  </div>
                )}
              </Card>
              <Card title="AI recommendations" subtitle="Based only on synced official metrics." icon={BrainCircuit}>
                {recommendations.length === 0 ? <EmptyState icon={BrainCircuit} title="No insights yet" description="Generate insights after a few measured posts." action={<Button variant="primary" onClick={() => action(() => post('/api/analytics/recommendations/generate', {}), 'Analysis queued.')}>Generate insights</Button>} /> : (
                  <div className="stack" style={{ gap: 10 }}>
                    {recommendations.map((rec) => (
                      <div className="recommendation" key={rec.id}>
                        <div className="recommendation-head"><strong>{rec.title}</strong><span className="confidence">{Math.round((rec.confidence || 0) * 100)}%</span></div>
                        <p>{rec.body}</p>
                        <div className="row-between"><small>{rec.category} · {rec.source}</small><Button size="xs" variant="ghost" title="Dismiss" onClick={() => action(() => post(`/api/analytics/recommendations/${rec.id}/dismiss`, {}), 'Recommendation dismissed.')}><Trash2 size={13} /></Button></div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title="Data quality" icon={CheckCircle2}>
                <div className="key-value" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="kv-item"><span>Official metric snapshots</span><strong>{quality.realMetricsCount || 0}</strong></div>
                  <div className="kv-item"><span>Simulated sandbox snapshots</span><strong>{quality.simulatedMetricsCount || 0}</strong></div>
                  <div className="kv-item"><span>Published without metrics</span><strong>{quality.publishedWithoutMetrics || 0}</strong></div>
                </div>
                <p className="tiny" style={{ marginTop: 12, marginBottom: 0 }}>{quality.note}</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
