import React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, ExternalLink, FlaskConical, Sparkles } from 'lucide-react';
import { useLoad } from '../hooks.js';
import { get, formatDate, formatNumber } from '../api.js';
import { Button, Card, ErrorBanner, KeyValue, Spinner, StatusBadge } from '../components/ui.jsx';

export default function SandboxPost() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { data, loading, error, reload } = useLoad(() => get(`/api/sandbox/v1/posts/${encodeURIComponent(id)}/public?token=${encodeURIComponent(token)}`), [id, token], { refreshMs: 30000 });
  return (
    <div className="public-page">
      <Card className="public-card">
        <div className="row-between" style={{ marginBottom: 18 }}>
          <div className="row"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>Sandbox post</strong><small style={{ display: 'block' }}>Local HTTP publisher</small></div></div>
          <StatusBadge status="needs_review" label="Simulated" />
        </div>
        <ErrorBanner error={token ? error : new Error('Missing view token. Open the link from the publishing history instead.')} onRetry={token ? () => reload().catch(() => {}) : undefined} />
        {loading && !data ? <Spinner label="Loading sandbox post…" /> : data && (
          <div className="stack">
            <div>
              <h1>{data.title}</h1>
              <p>{formatDate(data.createdAt)} · ID {data.id}</p>
            </div>
            <video className="public-video" controls playsInline src={data.videoUrl} />
            <div className="caption-box"><h4>Published caption</h4><p>{data.caption}</p></div>
            <KeyValue items={[
              ['Views', formatNumber(data.metrics?.views)], ['Likes', formatNumber(data.metrics?.likes)],
              ['Comments', formatNumber(data.metrics?.comments)], ['Shares', formatNumber(data.metrics?.shares)],
            ]} />
            <div className="banner banner-warning" style={{ margin: 0 }}><FlaskConical size={18} /><div><strong>Test metrics only</strong><span>These values are deterministic simulations for verifying the publishing workflow. They are not real social engagement.</span></div></div>
            <div className="row row-wrap"><Button to="/app/publishing" variant="secondary"><ExternalLink size={15} /> Back to publishing</Button><Button to="/app/analytics" variant="ghost"><BarChart3 size={15} /> View analytics</Button></div>
          </div>
        )}
      </Card>
    </div>
  );
}
