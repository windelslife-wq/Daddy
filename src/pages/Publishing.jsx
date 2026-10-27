import React, { useState } from 'react';
import {
  CalendarClock, CheckCircle2, ExternalLink, RefreshCw, Send, Trash2, Zap,
} from 'lucide-react';
import { useLoad } from '../hooks.js';
import { del, get, post, formatDate, safeHref } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, StatusBadge, Tabs, useToast } from '../components/ui.jsx';

function localDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Publishing() {
  const { showToast } = useToast();
  const [filter, setFilter] = useState('all');
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduledAt, setScheduledAt] = useState(localDateTime(new Date(Date.now() + 3600000)));
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useLoad(() => get('/api/posts?limit=200'), [], { refreshMs: 12000, initial: { posts: [] } });
  const allPosts = data?.posts || [];
  const posts = filter === 'all' ? allPosts : allPosts.filter((post) => filter === 'attention' ? ['needs_review', 'failed', 'partial'].includes(post.status) : post.status === filter);
  const counts = { all: allPosts.length, needs_review: 0, scheduled: 0, published: 0, attention: 0 };
  for (const post of allPosts) {
    if (counts[post.status] !== undefined) counts[post.status] += 1;
    if (['needs_review', 'failed', 'partial'].includes(post.status)) counts.attention += 1;
  }

  async function action(fn, message) {
    setBusy(true);
    try { await fn(); if (message) showToast(message, 'success'); await reload({ silent: true }); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(false); }
  }
  async function saveSchedule() {
    if (!scheduleTarget) return;
    await action(() => post(`/api/posts/${scheduleTarget.id}/schedule`, { scheduledAt: new Date(scheduledAt).toISOString() }), 'Post rescheduled.');
    setScheduleTarget(null);
  }
  async function deletePost(postId) { await action(() => del(`/api/posts/${postId}`), 'Draft post deleted.'); }
  async function syncMetrics() { await action(() => post('/api/analytics/sync', {}), 'Metrics sync jobs queued.'); }

  return (
    <>
      <PageHeader
        eyebrow="Publishing"
        title="Posts & delivery"
        description="Approve reviews, schedule posts, retry failed deliveries, and track every platform publication."
        actions={<><Button variant="secondary" onClick={syncMetrics} disabled={busy}><Zap size={15} /> Sync metrics</Button><Button to="/app/studio" variant="primary"><Send size={15} /> New post</Button></>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <Tabs active={filter} onChange={setFilter} tabs={[
        { id: 'all', label: 'All', count: counts.all },
        { id: 'needs_review', label: 'Needs review', count: counts.needs_review },
        { id: 'scheduled', label: 'Scheduled', count: counts.scheduled },
        { id: 'published', label: 'Published', count: counts.published },
        { id: 'attention', label: 'Attention', count: counts.attention },
      ]} />
      <Card style={{ marginTop: 18 }}>
        {loading && !allPosts.length ? <Spinner label="Loading posts…" /> : posts.length === 0 ? (
          <EmptyState icon={Send} title="No posts in this view" description="Create a project with publishing enabled or choose another status." action={<Button to="/app/studio" variant="primary">Open AI Studio</Button>} />
        ) : posts.map((post) => (
          <div className="post-card" key={post.id}>
            <div className="post-head">
              <div style={{ minWidth: 0 }}>
                <div className="post-title">{post.title}</div>
                <small>{formatDate(post.scheduledAt)} · {post.reviewRequired ? 'Review required' : 'Autopilot'} · {post.publications?.length || 0} destinations</small>
              </div>
              <StatusBadge status={post.status} />
            </div>
            <div className="row row-wrap" style={{ marginTop: 12 }}>
              {post.status === 'needs_review' && <Button size="xs" variant="primary" onClick={() => action(() => post(`/api/posts/${post.id}/approve`, {}), 'Post approved.')} disabled={busy}><CheckCircle2 size={13} /> Approve</Button>}
              <Button size="xs" variant="secondary" onClick={() => { setScheduleTarget(post); setScheduledAt(localDateTime(post.scheduledAt || new Date(Date.now() + 3600000))); }} disabled={busy}><CalendarClock size={13} /> Schedule</Button>
              <Button size="xs" variant="ghost" onClick={() => action(() => post(`/api/posts/${post.id}/refresh-accounts`, {}), 'Destinations refreshed.')} disabled={busy}><RefreshCw size={13} /> Sync accounts</Button>
              {post.status === 'draft' && <Button size="xs" variant="danger" onClick={() => deletePost(post.id)} disabled={busy}><Trash2 size={13} /> Delete draft</Button>}
            </div>
            <div style={{ marginTop: 10 }}>
              {(post.publications || []).map((publication) => {
                const href = safeHref(publication.remoteUrl);
                return (
                  <div className="publication-line" key={publication.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 12 }}>{publication.account?.displayName || publication.account?.platform || 'Account'}</strong>
                      <small style={{ display: 'block' }}>{publication.account?.platform} · ref {publication.refCode} · attempt {publication.attempts}/{publication.maxAttempts}</small>
                      {publication.lastError && <div className="error-text">{publication.lastError}</div>}
                    </div>
                    <StatusBadge status={publication.status} />
                    {['failed', 'queued', 'awaiting_media'].includes(publication.status) && <Button size="xs" variant="secondary" onClick={() => action(() => post(`/api/publications/${publication.id}/retry`, {}), 'Retry queued.')} disabled={busy}>Retry</Button>}
                    {!['published', 'skipped'].includes(publication.status) && <Button size="xs" variant="ghost" onClick={() => action(() => post(`/api/publications/${publication.id}/skip`, {}), 'Publication skipped.')} disabled={busy}>Skip</Button>}
                    {href && <Button href={href} external={!href.startsWith('/')} size="xs" variant="ghost"><ExternalLink size={13} /> View</Button>}
                  </div>
                );
              })}
              {!post.publications?.length && <small className="tiny">No connected accounts matched this post yet. Connect an account, then use “Sync accounts”.</small>}
            </div>
          </div>
        ))}
      </Card>

      <Modal
        open={Boolean(scheduleTarget)}
        onClose={() => setScheduleTarget(null)}
        title="Schedule post"
        description={scheduleTarget?.title}
        footer={<><Button variant="ghost" onClick={() => setScheduleTarget(null)}>Cancel</Button><Button variant="primary" onClick={saveSchedule} disabled={busy}>Save schedule</Button></>}
      >
        <Field label="Publish at" required><input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
