import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, Clock3, Globe2,
  Image as ImageIcon, Info, Mic2, Rocket, ShieldCheck, Sparkles, WandSparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { get, post } from '../api.js';
import { Button, Card, ErrorBanner, Field, InfoBanner, PageHeader, Spinner, StatusBadge, Toggle, useToast } from '../components/ui.jsx';

const steps = [
  { id: 0, label: 'Topic & niche' },
  { id: 1, label: 'Visual & voice' },
  { id: 2, label: 'Publishing' },
  { id: 3, label: 'Review' },
];

function localDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Studio() {
  const { options, providerStatus, plan, usage } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: accountsData, error: accountsError } = useLoad(() => get('/api/accounts'), [], { initial: { accounts: [] } });
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    niche: options.niches?.[0]?.name || 'Education & interesting facts',
    customNiche: '',
    topic: '',
    tone: 'documentary',
    style: 'cinematic',
    language: 'en',
    voice: 'nova',
    aspectRatio: '9:16',
    duration: 45,
    captions: true,
    music: true,
    research: false,
    platforms: ['sandbox'],
    scheduleMode: 'now',
    scheduledAt: localDateTime(new Date(Date.now() + 60 * 60 * 1000)),
    reviewRequired: true,
  });

  const accounts = accountsData?.accounts || [];
  const platformEntries = Object.entries(options.platforms || {});
  const connectedByPlatform = useMemo(() => accounts.reduce((map, account) => {
    if (account.active && account.status === 'connected') map[account.platform] = (map[account.platform] || 0) + 1;
    return map;
  }, {}), [accounts]);
  const researchReady = providerStatus?.research?.active !== 'none' && providerStatus?.research?.configured;
  const selectedNiche = form.niche === 'Custom niche' ? form.customNiche.trim() : form.niche;
  const estimatedScenes = Math.min(8, Math.max(4, Math.round(Number(form.duration) / 8)));

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function togglePlatform(platform) {
    setForm((current) => ({
      ...current,
      platforms: current.platforms.includes(platform)
        ? current.platforms.filter((item) => item !== platform)
        : [...current.platforms, platform],
    }));
  }
  function validate(currentStep) {
    if (currentStep === 0) {
      if (form.topic.trim().length < 3) return 'Enter a topic with at least 3 characters.';
      if (!selectedNiche || selectedNiche.length < 2) return 'Choose a niche or enter a custom niche.';
    }
    if (currentStep === 2) {
      if (!form.platforms.length) return 'Select at least one publishing platform.';
      if (form.scheduleMode === 'scheduled') {
        const date = new Date(form.scheduledAt);
        if (Number.isNaN(date.getTime())) return 'Choose a valid date and time.';
        if (date.getTime() < Date.now() - 60000) return 'Choose a future date and time.';
      }
      if (form.platforms.includes('instagram') && !providerStatus?.publicMediaReady) {
        return 'Instagram requires a public HTTPS PUBLIC_BASE_URL so Meta can fetch the video. Set it before selecting Instagram.';
      }
    }
    return null;
  }
  function next() {
    const issue = validate(step);
    if (issue) { setError(new Error(issue)); return; }
    setError(null);
    setStep((value) => Math.min(3, value + 1));
  }

  async function submit() {
    for (let i = 0; i < 3; i += 1) {
      const issue = validate(i);
      if (issue) { setStep(i); setError(new Error(issue)); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        niche: selectedNiche,
        topic: form.topic.trim(),
        title: `${form.topic.trim().slice(0, 90)} — AI short`,
        tone: form.tone,
        style: form.style,
        language: form.language,
        voice: form.voice,
        aspectRatio: form.aspectRatio,
        duration: Number(form.duration),
        captions: form.captions,
        music: form.music,
        research: form.research && researchReady,
        autoPublish: form.scheduleMode !== 'draft',
        reviewRequired: form.reviewRequired,
        platforms: form.platforms,
        scheduledAt: form.scheduleMode === 'scheduled' ? new Date(form.scheduledAt).toISOString() : form.scheduleMode === 'now' ? new Date().toISOString() : null,
      };
      const result = await post('/api/projects', payload);
      showToast('Video generation started. Progress is tracked live.', 'success');
      navigate(`/app/projects/${result.project.id}`);
    } catch (err) { setError(err); }
    finally { setSubmitting(false); }
  }

  return (
    <>
      <PageHeader
        eyebrow="AI Studio"
        title="Create a faceless video campaign"
        description="Choose a niche and topic, customize the production, and let the worker render and publish the finished MP4."
        actions={<Button to="/app/automation" variant="secondary"><CalendarClock size={16} /> Recurring autopilot</Button>}
      />
      <ErrorBanner error={error || accountsError} />
      {providerStatus?.ai?.active === 'local' && (
        <InfoBanner icon={Info} action={<Button to="/app/settings" size="sm" variant="ghost">Provider settings</Button>}>
          <strong>Local writer mode.</strong><span> Scripts use the built-in original outline engine. Configure OpenAI, Anthropic, or Gemini in the server environment for generative LLM scripts and localized metadata.</span>
        </InfoBanner>
      )}

      <div className="wizard-steps">
        {steps.map((item) => (
          <div key={item.id} className={`wizard-step ${step === item.id ? 'active' : ''} ${step > item.id ? 'done' : ''}`}>
            <span className="step-num">{step > item.id ? <Check size={13} /> : item.id + 1}</span><span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-studio">
        <Card>
          {step === 0 && (
            <div className="stack">
              <div><h2>Choose a niche</h2><p className="tiny">Niches shape the hook, visual prompts, and platform metadata. Custom niches are supported.</p></div>
              <div className="niche-grid">
                {(options.niches || []).map((niche) => (
                  <button key={niche.id} className={`niche-option ${form.niche === niche.name ? 'active' : ''}`} onClick={() => update('niche', niche.name)}>
                    <strong>{niche.name}</strong><small>{niche.description}</small>
                  </button>
                ))}
              </div>
              {form.niche === 'Custom niche' && <Field label="Custom niche name" required><input value={form.customNiche} onChange={(e) => update('customNiche', e.target.value)} placeholder="e.g. Space exploration" /></Field>}
              <Field label="Topic or prompt" required hint="Be specific. For factual niches, add names, places, dates, or a question to investigate.">
                <textarea value={form.topic} onChange={(e) => update('topic', e.target.value)} placeholder="The forgotten explorer who mapped a river before vanishing" maxLength={500} minLength={3} required />
              </Field>
              <div className="grid grid-2">
                <Field label="Story tone">
                  <select value={form.tone} onChange={(e) => update('tone', e.target.value)}>
                    {(options.tones || []).map((tone) => <option key={tone.id} value={tone.id}>{tone.name}</option>)}
                  </select>
                </Field>
                <Field label="Research mode" hint={researchReady ? 'Use the configured search provider for source links.' : 'SEARCH_PROVIDER and SEARCH_API_KEY are not configured.'}>
                  <Toggle checked={form.research && researchReady} onChange={(checked) => update('research', checked)} disabled={!researchReady} label={researchReady ? 'Research this topic' : 'Research unavailable'} description="Sources are saved for editorial review, never copied into scripts." />
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="stack">
              <div><h2>Visual and narration style</h2><p className="tiny">The renderer creates original scene art by default. Configure an image provider for model-generated visuals.</p></div>
              <div className="style-grid">
                {(options.styles || []).map((style, index) => (
                  <button key={style.id} className={`style-option ${form.style === style.id ? 'active' : ''}`} onClick={() => update('style', style.id)}>
                    <div className="style-swatch" style={{ background: `linear-gradient(135deg, ${['#ffcf3f,#ff4d6d', '#b5121b,#24111c', '#5ce1e6,#a78bfa', '#172554,#f59e0b', '#38bdf8,#f9a8d4', '#22d3ee,#f472b6'][index % 6]})` }} />
                    <strong>{style.name}</strong><small>{style.description}</small>
                  </button>
                ))}
              </div>
              <div className="grid grid-3">
                <Field label="Language"><select value={form.language} onChange={(e) => update('language', e.target.value)}>{(options.languages || []).map((lang) => <option key={lang.id} value={lang.id}>{lang.name}</option>)}</select></Field>
                <Field label="Voice"><select value={form.voice} onChange={(e) => update('voice', e.target.value)}>{(options.voices || []).map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.provider}</option>)}</select></Field>
                <Field label="Aspect ratio"><select value={form.aspectRatio} onChange={(e) => update('aspectRatio', e.target.value)}>{(options.aspects || []).map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name}</option>)}</select></Field>
              </div>
              <div className="grid grid-2">
                <Field label={`Video length: ${form.duration} seconds`} hint={`Approximately ${estimatedScenes} scenes. Platform variants are transcoded automatically.`}>
                  <input type="range" min="15" max="180" step="15" value={form.duration} onChange={(e) => update('duration', e.target.value)} />
                </Field>
                <div className="stack" style={{ gap: 4 }}>
                  <Toggle checked={form.captions} onChange={(v) => update('captions', v)} label="Burned-in captions" description="Also exports an SRT subtitle file." />
                  <Toggle checked={form.music} onChange={(v) => update('music', v)} label="Original music bed" description="Procedural royalty-free ambient audio." />
                </div>
              </div>
              <div className="banner banner-info" style={{ margin: 0 }}><ImageIcon size={18} /><div><strong>Active image provider: {providerStatus?.images?.active || 'procedural'}</strong><span>{providerStatus?.images?.active === 'procedural' ? 'Original SVG scene art is rendered locally with no external API key.' : 'External image generation is configured for this server.'}</span></div></div>
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              <div><h2>Publishing targets</h2><p className="tiny">Only connected, active accounts with automation enabled will receive publications.</p></div>
              <div className="platform-grid">
                {platformEntries.map(([key, platform]) => {
                  const configured = providerStatus?.integrations?.[key]?.configured;
                  const connected = connectedByPlatform[key] || 0;
                  return (
                    <label key={key} className={`platform-option ${form.platforms.includes(key) ? 'active' : ''}`}>
                      <input type="checkbox" checked={form.platforms.includes(key)} onChange={() => togglePlatform(key)} style={{ accentColor: 'var(--primary)' }} />
                      <span className="platform-icon">{key.slice(0, 2).toUpperCase()}</span>
                      <div><strong>{platform.name}</strong><small>{connected} connected · max {platform.maxDuration}s</small></div>
                      {configured ? <StatusBadge status="connected" label="API" /> : <StatusBadge status="needs_review" label="Keys" />}
                    </label>
                  );
                })}
              </div>
              {form.platforms.some((key) => !providerStatus?.integrations?.[key]?.configured) && (
                <div className="banner banner-warning" style={{ margin: 0 }}><Info size={18} /><div><strong>Some selected platforms need server configuration</strong><span>The video will still render. Publishing jobs will report a clear integration error until credentials are added.</span></div></div>
              )}
              <div className="grid grid-2">
                <Field label="When should it publish?">
                  <select value={form.scheduleMode} onChange={(e) => update('scheduleMode', e.target.value)}>
                    <option value="now">As soon as rendering completes</option>
                    <option value="scheduled">At a specific date and time</option>
                    <option value="draft">Save as draft, publish manually later</option>
                  </select>
                </Field>
                {form.scheduleMode === 'scheduled' && <Field label="Publish at" required><input type="datetime-local" value={form.scheduledAt} onChange={(e) => update('scheduledAt', e.target.value)} /></Field>}
              </div>
              <Toggle checked={form.reviewRequired} onChange={(v) => update('reviewRequired', v)} label="Require manual review" description="When off, full autopilot publishes after successful rendering and scheduling." />
              <div className="banner banner-info" style={{ margin: 0 }}><ShieldCheck size={18} /><div><strong>Duplicate protection</strong><span>Each publication gets a unique idempotency key and a short reference code in captions/descriptions, so retries do not create duplicate posts.</span></div></div>
            </div>
          )}

          {step === 3 && (
            <div className="stack">
              <div><h2>Review your production</h2><p className="tiny">Everything below is sent to the backend. No API keys or access tokens are present in the browser.</p></div>
              <div className="review-panel">
                <div className="key-value">
                  {[
                    ['Niche', selectedNiche], ['Topic', form.topic], ['Tone', form.tone], ['Style', form.style],
                    ['Language', form.language], ['Voice', form.voice], ['Aspect ratio', form.aspectRatio], ['Duration', `${form.duration}s`],
                    ['Scenes', `~${estimatedScenes}`], ['Captions', form.captions ? 'On' : 'Off'], ['Music', form.music ? 'On' : 'Off'], ['Research', form.research && researchReady ? 'Enabled' : 'Off'],
                    ['Platforms', form.platforms.join(', ')], ['Publishing', form.scheduleMode], ['Review', form.reviewRequired ? 'Required' : 'Full autopilot'], ['Schedule', form.scheduleMode === 'scheduled' ? form.scheduledAt : 'After rendering'],
                  ].map(([key, value]) => <div className="kv-item" key={key}><span>{key}</span><strong>{value || '—'}</strong></div>)}
                </div>
              </div>
              <div className="row row-wrap">
                <span className="badge badge-info"><Sparkles size={12} /> {providerStatus?.ai?.active || 'local'} script</span>
                <span className="badge badge-info"><ImageIcon size={12} /> {providerStatus?.images?.active || 'procedural'} visuals</span>
                <span className="badge badge-info"><Mic2 size={12} /> {providerStatus?.tts?.active || 'mespeak'} voice</span>
                <span className="badge badge-info"><Clock3 size={12} /> FFmpeg MP4</span>
              </div>
              {usage?.videos >= plan?.max_videos_month && <div className="banner banner-error" style={{ margin: 0 }}><Info size={18} /><div><strong>Monthly quota reached</strong><span>Upgrade your plan before creating another video.</span></div><Button to="/app/billing" size="sm" variant="secondary">Plans</Button></div>}
            </div>
          )}

          <div className="wizard-actions">
            <Button variant="ghost" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}><ArrowLeft size={16} /> Back</Button>
            {step < 3
              ? <Button variant="primary" onClick={next}>Continue <ArrowRight size={16} /></Button>
              : <Button variant="primary" onClick={submit} disabled={submitting || usage?.videos >= plan?.max_videos_month}>{submitting ? <Spinner size={16} label="Starting…" /> : <><Rocket size={16} /> Create & generate</>}</Button>}
          </div>
        </Card>

        <div className="stack summary-side">
          <Card title="Production preview" icon={WandSparkles}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="video-frame" style={{ aspectRatio: form.aspectRatio === '16:9' ? '16 / 9' : form.aspectRatio === '1:1' ? '1 / 1' : '9 / 16', maxHeight: 330 }}>
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <Sparkles size={28} color="var(--primary-2)" />
                  <h3 style={{ margin: '12px 0 5px' }}>{form.topic || 'Your story starts here'}</h3>
                  <small>{selectedNiche || 'Choose a niche'} · {form.style} · {form.duration}s</small>
                </div>
              </div>
              <div className="row row-wrap">
                <StatusBadge status={providerStatus?.ai?.configured ? 'connected' : 'needs_review'} label={providerStatus?.ai?.configured ? 'AI ready' : 'AI needs keys'} />
                <StatusBadge status={providerStatus?.tts?.configured ? 'connected' : 'needs_review'} label={providerStatus?.tts?.configured ? 'Voice ready' : 'Voice needs keys'} />
              </div>
              <div className="key-value" style={{ gridTemplateColumns: '1fr' }}>
                <div className="kv-item"><span>Monthly videos</span><strong>{usage?.videos || 0} / {plan?.max_videos_month || 0}</strong></div>
                <div className="kv-item"><span>Render seconds</span><strong>{usage?.render_seconds || 0} / {plan?.max_render_seconds_month || 0}</strong></div>
                <div className="kv-item"><span>Publications</span><strong>{usage?.posts || 0} / {plan?.max_posts_month || 0}</strong></div>
              </div>
              <Button to="/app/automation" variant="ghost" className="btn-block"><CalendarClock size={15} /> Daily / weekly / custom schedules</Button>
            </div>
          </Card>
          <Card title="Good to know" icon={CheckCircle2}>
            <ul className="plan-features" style={{ margin: 0 }}>
              <li><CheckCircle2 size={15} /> Real MP4 with H.264 video and AAC audio.</li>
              <li><CheckCircle2 size={15} /> Original procedural visuals and music by default.</li>
              <li><CheckCircle2 size={15} /> Long-running work is processed in a persistent job queue.</li>
              <li><CheckCircle2 size={15} /> Official publishing activates only with valid OAuth credentials.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
