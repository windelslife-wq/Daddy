import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CalendarClock, Clock3, Pencil, Play, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { del, get, patch, post, formatDate } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, Field, InfoBanner, Modal, PageHeader, Spinner, StatusBadge, Tabs, Toggle, useToast } from '../components/ui.jsx';

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultNicheForm(options) {
  return {
    name: '', description: '', defaultTopic: '',
    style: options.styles?.[0]?.id || 'cinematic',
    language: options.languages?.[0]?.id || 'en',
    voice: options.voices?.[0]?.id || 'nova',
    aspectRatio: options.aspects?.[0]?.id || '9:16',
    duration: 45,
    platforms: ['sandbox'],
    autopilot: false,
    reviewRequired: true,
    postingLimitPerDay: 2,
    frequency: 'daily',
    timeOfDay: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    weekdays: [1, 2, 3, 4, 5],
    cronExpression: '0 9 * * 1-5',
    intervalMinutes: 1440,
  };
}

function nicheToForm(niche) {
  const config = niche.config || {};
  const schedule = niche.schedule || {};
  return {
    name: niche.name, description: niche.description || '', defaultTopic: config.defaultTopic || '',
    style: config.style || 'cinematic', language: config.language || 'en', voice: config.voice || 'nova',
    aspectRatio: config.aspectRatio || '9:16', duration: config.duration || 45,
    platforms: config.platforms || ['sandbox'], autopilot: niche.autopilot, reviewRequired: niche.reviewRequired,
    postingLimitPerDay: niche.postingLimitPerDay || 2,
    frequency: schedule.frequency || 'daily', timeOfDay: schedule.timeOfDay || '09:00',
    timezone: schedule.timezone || 'UTC', weekdays: schedule.weekdays || [1, 2, 3, 4, 5],
    cronExpression: schedule.cronExpression || '0 9 * * 1-5', intervalMinutes: schedule.intervalMinutes || 1440,
  };
}

export default function Automation() {
  const { options } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('niches');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(defaultNicheForm(options));
  const [scheduleForm, setScheduleForm] = useState(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useLoad(() => Promise.all([get('/api/niches'), get('/api/schedules')]).then(([niches, schedules]) => ({ ...niches, ...schedules })), [], { refreshMs: 20000, initial: { niches: [], schedules: [] } });
  const niches = data?.niches || [];
  const schedules = data?.schedules || [];
  const platformIds = Object.keys(options.platforms || {});

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function togglePlatform(platform) {
    setForm((current) => ({ ...current, platforms: current.platforms.includes(platform) ? current.platforms.filter((p) => p !== platform) : [...current.platforms, platform] }));
  }
  function toggleWeekday(day) {
    setForm((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((d) => d !== day) : [...current.weekdays, day].sort() }));
  }
  function openCreate() { setForm(defaultNicheForm(options)); setModal({ type: 'niche', niche: null }); }
  function openEdit(niche) { setForm(nicheToForm(niche)); setModal({ type: 'niche', niche }); }
  function openGenerate(niche) { setTopic(''); setModal({ type: 'generate', niche }); }
  function openSchedule(schedule) { setScheduleForm({ ...schedule, weekdays: schedule.weekdays || [1, 2, 3, 4, 5], cronExpression: schedule.cronExpression || '', intervalMinutes: schedule.intervalMinutes || 1440 }); setModal({ type: 'schedule', schedule }); }

  async function action(fn, message) {
    setBusy(true);
    try { const result = await fn(); if (message) showToast(message, 'success'); await reload({ silent: true }); return result; }
    catch (err) { showToast(err.message, 'error'); return null; }
    finally { setBusy(false); }
  }
  function nichePayload() {
    return {
      name: form.name,
      description: form.description,
      defaultTopic: form.defaultTopic,
      style: form.style,
      language: form.language,
      voice: form.voice,
      aspectRatio: form.aspectRatio,
      duration: Number(form.duration),
      platforms: form.platforms,
      autopilot: form.autopilot,
      reviewRequired: form.reviewRequired,
      postingLimitPerDay: Number(form.postingLimitPerDay),
      schedule: form.autopilot ? {
        frequency: form.frequency,
        timeOfDay: form.timeOfDay,
        timezone: form.timezone,
        weekdays: form.weekdays,
        cronExpression: form.frequency === 'custom' ? form.cronExpression : undefined,
        intervalMinutes: Number(form.intervalMinutes),
      } : undefined,
    };
  }
  async function saveNiche() {
    if (form.name.trim().length < 2 || !form.platforms.length) { showToast('Enter a niche name and choose at least one platform.', 'error'); return; }
    if (form.autopilot && form.frequency === 'weekly' && !form.weekdays.length) { showToast('Choose at least one weekday.', 'error'); return; }
    const result = await action(() => modal.niche ? patch(`/api/niches/${modal.niche.id}`, nichePayload()) : post('/api/niches', nichePayload()), modal.niche ? 'Niche updated.' : 'Niche created.');
    if (result) setModal(null);
  }
  async function saveSchedule() {
    if (!scheduleForm) return;
    const payload = {
      name: scheduleForm.name, frequency: scheduleForm.frequency, timeOfDay: scheduleForm.timeOfDay,
      timezone: scheduleForm.timezone, weekdays: scheduleForm.weekdays,
      cronExpression: scheduleForm.frequency === 'custom' ? scheduleForm.cronExpression : null,
      intervalMinutes: Number(scheduleForm.intervalMinutes), active: scheduleForm.active, autopilot: scheduleForm.autopilot,
    };
    const result = await action(() => patch(`/api/schedules/${scheduleForm.id}`, payload), 'Schedule updated.');
    if (result) setModal(null);
  }
  async function generateNow() {
    if (!modal?.niche) return;
    const result = await action(() => post(`/api/niches/${modal.niche.id}/generate-now`, { topic: topic || undefined }), 'Video generation queued.');
    if (result?.project?.id) { setModal(null); navigate(`/app/projects/${result.project.id}`); }
  }
  async function toggleNicheAutopilot(niche, value) {
    await action(() => patch(`/api/niches/${niche.id}`, { autopilot: value }), value ? 'Autopilot enabled.' : 'Autopilot paused.');
  }
  async function deleteNiche(niche) {
    if (!window.confirm(`Pause and archive "${niche.name}"?`)) return;
    await action(() => del(`/api/niches/${niche.id}`), 'Niche archived.');
  }
  async function deleteSchedule(schedule) {
    if (!window.confirm(`Pause schedule "${schedule.name}"?`)) return;
    await action(() => del(`/api/schedules/${schedule.id}`), 'Schedule paused.');
  }

  return (
    <>
      <PageHeader
        eyebrow="Autopilot"
        title="Niches & recurring schedules"
        description="Create content series with daily, weekly, or custom cron schedules, daily posting limits, and review gates."
        actions={<><Button to="/app/studio" variant="ghost">Single video</Button><Button variant="primary" onClick={openCreate}><Plus size={16} /> New niche</Button></>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <InfoBanner icon={Bot}><strong>The background worker drives autopilot.</strong><span> It checks due schedules, generates a topic, renders a video, and queues publications while respecting your per-niche daily limit.</span></InfoBanner>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'niches', label: 'Niches', count: niches.length, icon: Zap }, { id: 'schedules', label: 'Schedules', count: schedules.length, icon: CalendarClock }]} />
      <div style={{ marginTop: 18 }}>
        {loading && !niches.length && !schedules.length ? <Card><Spinner label="Loading automation…" /></Card> : tab === 'niches' ? (
          niches.length === 0 ? <Card><EmptyState icon={Zap} title="No niches yet" description="Create a niche to schedule recurring AI videos." action={<Button variant="primary" onClick={openCreate}>Create niche</Button>} /></Card> : (
            <div className="grid grid-3">
              {niches.map((niche) => (
                <Card key={niche.id} title={niche.name} subtitle={niche.description || niche.config?.defaultTopic || 'Custom content series'}>
                  <div className="row-between" style={{ marginBottom: 12 }}><StatusBadge status={niche.active ? (niche.autopilot ? 'active' : 'draft') : 'disconnected'} label={niche.active ? (niche.autopilot ? 'Autopilot on' : 'Paused') : 'Archived'} /><small>{niche.postingLimitPerDay}/day limit</small></div>
                  <div className="key-value" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="kv-item"><span>Style / language</span><strong>{niche.config?.style} · {niche.config?.language}</strong></div>
                    <div className="kv-item"><span>Platforms</span><strong>{(niche.config?.platforms || []).join(', ')}</strong></div>
                    <div className="kv-item"><span>Schedule</span><strong>{niche.schedule ? `${niche.schedule.frequency} ${niche.schedule.timeOfDay} ${niche.schedule.timezone}` : 'Manual only'}</strong></div>
                    <div className="kv-item"><span>Next run</span><strong>{niche.schedule?.nextRunAt ? formatDate(niche.schedule.nextRunAt) : '—'}</strong></div>
                  </div>
                  <Toggle checked={niche.autopilot} onChange={(v) => toggleNicheAutopilot(niche, v)} label="Autopilot" description="Generate and queue posts on schedule." />
                  <div className="row row-wrap" style={{ marginTop: 12 }}>
                    <Button size="xs" variant="primary" onClick={() => openGenerate(niche)}><Play size={13} /> Generate now</Button>
                    <Button size="xs" variant="secondary" onClick={() => openEdit(niche)}><Pencil size={13} /> Edit</Button>
                    <Button size="xs" variant="danger" onClick={() => deleteNiche(niche)}><Trash2 size={13} /></Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : (
          schedules.length === 0 ? <Card><EmptyState icon={CalendarClock} title="No schedules yet" description="Create an autopilot niche with a schedule to get started." action={<Button variant="primary" onClick={openCreate}>Create niche</Button>} /></Card> : (
            <Card><div className="table-wrap"><table><thead><tr><th>Name</th><th>Frequency</th><th>Time</th><th>Next run</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td><strong>{schedule.name}</strong><small className="tiny" style={{ display: 'block' }}>{schedule.timezone}</small></td>
                  <td>{schedule.frequency}{schedule.cronExpression ? ` · ${schedule.cronExpression}` : ''}</td>
                  <td>{schedule.timeOfDay}</td>
                  <td><small>{formatDate(schedule.nextRunAt)}</small></td>
                  <td><StatusBadge status={schedule.active ? 'active' : 'draft'} label={schedule.active ? (schedule.autopilot ? 'Autopilot' : 'Active') : 'Paused'} /></td>
                  <td><div className="row" style={{ justifyContent: 'flex-end' }}><Button size="xs" variant="secondary" onClick={() => openSchedule(schedule)}><Pencil size={13} /> Edit</Button><Button size="xs" variant="danger" onClick={() => deleteSchedule(schedule)}><Trash2 size={13} /></Button></div></td>
                </tr>
              ))}
            </tbody></table></div></Card>
          )
        )}
      </div>

      <Modal
        open={modal?.type === 'niche'}
        onClose={() => setModal(null)}
        title={modal?.niche ? 'Edit niche' : 'Create autopilot niche'}
        description="Configure content defaults and the recurring publication schedule."
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" onClick={saveNiche} disabled={busy}>{busy ? <Spinner size={15} /> : 'Save niche'}</Button></>}
      >
        <div className="grid grid-2">
          <Field label="Niche name" required><input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Space mysteries" /></Field>
          <Field label="Default topic / theme"><input value={form.defaultTopic} onChange={(e) => update('defaultTopic', e.target.value)} placeholder="Unsolved events in space exploration" /></Field>
        </div>
        <Field label="Description"><textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="What should this series focus on?" /></Field>
        <div className="grid grid-3">
          <Field label="Visual style"><select value={form.style} onChange={(e) => update('style', e.target.value)}>{(options.styles || []).map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></Field>
          <Field label="Language"><select value={form.language} onChange={(e) => update('language', e.target.value)}>{(options.languages || []).map((lang) => <option key={lang.id} value={lang.id}>{lang.name}</option>)}</select></Field>
          <Field label="Voice"><select value={form.voice} onChange={(e) => update('voice', e.target.value)}>{(options.voices || []).map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></Field>
          <Field label="Aspect ratio"><select value={form.aspectRatio} onChange={(e) => update('aspectRatio', e.target.value)}>{(options.aspects || []).map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name}</option>)}</select></Field>
          <Field label="Duration"><select value={form.duration} onChange={(e) => update('duration', e.target.value)}>{[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d}s</option>)}</select></Field>
          <Field label="Max posts/day"><input type="number" min="1" max="20" value={form.postingLimitPerDay} onChange={(e) => update('postingLimitPerDay', e.target.value)} /></Field>
        </div>
        <Field label="Platforms" required><div className="row row-wrap">{platformIds.map((platform) => <label className="checkbox-row" key={platform}><input type="checkbox" checked={form.platforms.includes(platform)} onChange={() => togglePlatform(platform)} /> {options.platforms[platform].name}</label>)}</div></Field>
        <Toggle checked={form.reviewRequired} onChange={(v) => update('reviewRequired', v)} label="Review before publishing" description="Turn off for full autopilot." />
        <Toggle checked={form.autopilot} onChange={(v) => update('autopilot', v)} label="Enable recurring autopilot" description="The worker will create videos automatically when the schedule is due." />
        {form.autopilot && (
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="grid grid-3">
              <Field label="Frequency"><select value={form.frequency} onChange={(e) => update('frequency', e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="custom">Custom cron</option></select></Field>
              <Field label="Time of day"><input type="time" value={form.timeOfDay} onChange={(e) => update('timeOfDay', e.target.value)} /></Field>
              <Field label="Timezone"><input value={form.timezone} onChange={(e) => update('timezone', e.target.value)} placeholder="UTC" /></Field>
            </div>
            {form.frequency === 'weekly' && <Field label="Weekdays"><div className="row row-wrap">{weekdayLabels.map((label, day) => <label className="checkbox-row" key={label}><input type="checkbox" checked={form.weekdays.includes(day)} onChange={() => toggleWeekday(day)} /> {label}</label>)}</div></Field>}
            {form.frequency === 'custom' && <div className="grid grid-2"><Field label="Cron expression" hint="Minute hour day month weekday, e.g. 0 9 * * 1-5."><input value={form.cronExpression} onChange={(e) => update('cronExpression', e.target.value)} /></Field><Field label="Fallback interval (minutes)"><input type="number" min="15" max="43200" value={form.intervalMinutes} onChange={(e) => update('intervalMinutes', e.target.value)} /></Field></div>}
          </div>
        )}
      </Modal>

      <Modal
        open={modal?.type === 'schedule'}
        onClose={() => setModal(null)}
        title="Edit schedule"
        description={scheduleForm?.name}
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" onClick={saveSchedule} disabled={busy}>Save schedule</Button></>}
      >
        {scheduleForm && <div className="stack">
          <Field label="Name" required><input value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} /></Field>
          <div className="grid grid-3">
            <Field label="Frequency"><select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="custom">Custom cron</option></select></Field>
            <Field label="Time"><input type="time" value={scheduleForm.timeOfDay} onChange={(e) => setScheduleForm({ ...scheduleForm, timeOfDay: e.target.value })} /></Field>
            <Field label="Timezone"><input value={scheduleForm.timezone} onChange={(e) => setScheduleForm({ ...scheduleForm, timezone: e.target.value })} /></Field>
          </div>
          {scheduleForm.frequency === 'weekly' && <Field label="Weekdays"><div className="row row-wrap">{weekdayLabels.map((label, day) => <label className="checkbox-row" key={label}><input type="checkbox" checked={scheduleForm.weekdays.includes(day)} onChange={() => setScheduleForm({ ...scheduleForm, weekdays: scheduleForm.weekdays.includes(day) ? scheduleForm.weekdays.filter((d) => d !== day) : [...scheduleForm.weekdays, day].sort() })} /> {label}</label>)}</div></Field>}
          {scheduleForm.frequency === 'custom' && <Field label="Cron expression"><input value={scheduleForm.cronExpression || ''} onChange={(e) => setScheduleForm({ ...scheduleForm, cronExpression: e.target.value })} placeholder="0 9 * * 1-5" /></Field>}
          <Toggle checked={scheduleForm.active} onChange={(v) => setScheduleForm({ ...scheduleForm, active: v })} label="Active" />
          <Toggle checked={scheduleForm.autopilot} onChange={(v) => setScheduleForm({ ...scheduleForm, autopilot: v })} label="Autopilot" />
        </div>}
      </Modal>

      <Modal
        open={modal?.type === 'generate'}
        onClose={() => setModal(null)}
        title="Generate now"
        description={`Create an immediate video for ${modal?.niche?.name || 'this niche'}.`}
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" onClick={generateNow} disabled={busy}><RefreshCw size={15} /> Generate</Button></>}
      >
        <Field label="Topic (optional)" hint="Leave blank to let the configured AI or local template choose a topic."><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="A strange signal detected beyond Neptune" /></Field>
      </Modal>
    </>
  );
}
