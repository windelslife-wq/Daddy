import React, { useMemo, useState } from 'react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth,
  isToday, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Send } from 'lucide-react';
import { useLoad } from '../hooks.js';
import { get, formatDate } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge } from '../components/ui.jsx';

export default function Calendar() {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = useMemo(() => eachDayOfInterval({ start: calendarStart, end: calendarEnd }), [calendarStart.getTime(), calendarEnd.getTime()]);
  const from = calendarStart.toISOString();
  const to = calendarEnd.toISOString();
  const { data, loading, error, reload } = useLoad(() => get(`/api/posts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`), [from, to], { refreshMs: 30000, initial: { posts: [] } });
  const posts = data?.posts || [];
  const postsByDay = useMemo(() => {
    const map = {};
    for (const post of posts) {
      if (!post.scheduledAt) continue;
      const key = format(parseISO(post.scheduledAt), 'yyyy-MM-dd');
      (map[key] ||= []).push(post);
    }
    return map;
  }, [posts]);
  const selectedKey = format(selected, 'yyyy-MM-dd');
  const selectedPosts = postsByDay[selectedKey] || [];

  return (
    <>
      <PageHeader
        eyebrow="Content calendar"
        title="Publishing calendar"
        description="Review scheduled, published, and failed posts by date. Publication times follow your browser timezone."
        actions={<Button to="/app/studio" variant="primary"><Plus size={16} /> New video</Button>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <Card>
        <div className="calendar-toolbar">
          <div className="row"><Button variant="ghost" size="sm" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft size={16} /></Button><strong>{format(month, 'MMMM yyyy')}</strong><Button variant="ghost" size="sm" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></Button></div>
          <div className="row"><Button variant="secondary" size="sm" onClick={() => { const d = new Date(); setMonth(d); setSelected(d); }}>Today</Button><Button to="/app/publishing" variant="ghost" size="sm"><Send size={15} /> Publishing queue</Button></div>
        </div>
        {loading && !posts.length ? <Spinner label="Loading calendar…" /> : (
          <div className="calendar-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayPosts = postsByDay[key] || [];
              return (
                <div key={key} className={`calendar-day ${!isSameMonth(day, month) ? 'other' : ''} ${isToday(day) ? 'today' : ''} ${isSameDay(day, selected) ? 'selected' : ''}`} onClick={() => setSelected(day)}>
                  <div className="calendar-day-num">{format(day, 'd')}</div>
                  {dayPosts.slice(0, 3).map((post) => <div key={post.id} className={`calendar-event ${post.status === 'published' ? 'published' : post.status === 'failed' ? 'failed' : ''}`}>{format(parseISO(post.scheduledAt), 'HH:mm')} · {post.title}</div>)}
                  {dayPosts.length > 3 && <small className="tiny">+{dayPosts.length - 3} more</small>}
                </div>
              );
            })}
          </div>
        )}
        <div className="day-panel">
          <div className="row-between" style={{ marginBottom: 10 }}><strong>{format(selected, 'EEEE, MMMM d, yyyy')}</strong><small>{selectedPosts.length} post(s)</small></div>
          {selectedPosts.length === 0 ? <EmptyState icon={CalendarDays} title="Nothing scheduled" description="Create a video and choose a future publishing time to place it here." action={<Button to="/app/studio" variant="primary">Create video</Button>} /> : (
            <div className="list">
              {selectedPosts.map((post) => (
                <div className="list-item" key={post.id}>
                  <div className="thumb"><CalendarDays size={18} /></div>
                  <div className="list-main"><strong>{post.title}</strong><small>{formatDate(post.scheduledAt)} · {post.publications?.length || 0} destinations</small></div>
                  <div className="list-side"><StatusBadge status={post.status} /><Button to="/app/publishing" size="xs" variant="ghost">Open</Button></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
