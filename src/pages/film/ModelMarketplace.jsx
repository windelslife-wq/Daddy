import React from 'react';
import {
  CheckCircle2, Clapperboard, Coins, Image as ImageIcon, Info, Mic2,
  Scissors, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import { get } from '../../api.js';
import { useLoad } from '../../hooks.js';
import { Card, ErrorBanner, Spinner } from '../../components/ui.jsx';
import { FilmShell, pretty } from './FilmStudio.jsx';

function Readiness({ ready, label }) {
  return (
    <span className={`film-chip ${ready ? 'good' : 'warn'}`}>
      {ready ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {label}
    </span>
  );
}

function ModelRow({ item, note }) {
  return (
    <div className="film-row" style={{ alignItems: 'flex-start' }}>
      <div className="film-row-main">
        <strong>{item.label}{item.model ? <span className="film-mono"> · {item.model}</span> : null}</strong>
        <small>
          {item.env ? <>Requires <code>{item.env}</code> · </> : 'No credentials needed · '}
          {item.capabilities?.join(' · ')}
        </small>
        {note && <small>{note}</small>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {item.ai === false && <span className="film-chip">local, not AI</span>}
        <Readiness ready={item.configured} label={item.configured ? 'ready' : 'needs credentials'} />
      </div>
    </div>
  );
}

export default function ModelMarketplace() {
  const { data, loading, error, reload } = useLoad(() => get('/api/films/models'), [], { initial: null });

  return (
    <FilmShell
      view="models"
      title="Models & Providers"
      subtitle="What this server can actually do right now — derived from live configuration, never from a wishlist."
    >
      {loading && !data ? <Spinner label="Checking providers…" /> : null}
      {error && !data ? <ErrorBanner error={error} onRetry={() => reload()} /> : null}
      {data && (
        <div className="grid grid-studio">
          <div style={{ display: 'grid', gap: 18 }}>
            <Card title="Video models" subtitle={data.video.realGeneration ? `${pretty(data.video.active)} is generating real clips` : 'No real video provider configured'} icon={Clapperboard}>
              {!data.video.realGeneration && (
                <div className="film-empty-mini">
                  Screenplay, storyboards, voice and assembly all work without a video provider. Scene clips will not be
                  fabricated: the server rejects generation until a provider key exists.
                </div>
              )}
              <div className="film-list">
                {data.video.items.map((item) => (
                  <ModelRow
                    key={item.id}
                    item={{ ...item, capabilities: [
                      `${item.maxSeconds}s max`, item.aspectRatios.join('/'),
                      item.supportsCancel ? 'cancellable' : 'no cancel',
                      item.supportsReferenceImage ? 'image-to-video' : '',
                      item.supportsLipSync ? 'lip-sync capable' : '',
                    ].filter(Boolean) }}
                    note={`${item.creditsPerSixSecondScene} credits per 6s scene${item.activeForServer ? ' · server default' : ''}. ${item.notes || ''}`}
                  />
                ))}
              </div>
            </Card>

            <Card title="Image models" subtitle="Storyboards, posters and character concepts" icon={ImageIcon}>
              <div className="film-list">
                {data.image.items.map((item) => (
                  <ModelRow key={item.id} item={item} note={item.notes || ''} />
                ))}
              </div>
            </Card>

            <Card title="Voice models" subtitle="Dialogue takes and the final mix" icon={Mic2}>
              <div className="film-list">
                {data.tts.items.map((item) => <ModelRow key={item.id} item={item} />)}
              </div>
            </Card>
          </div>

          <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
            <Card title="Capability summary" subtitle="Read live from the server" icon={Sparkles}>
              <div className="film-breakdown">
                <div className="film-breakdown-row"><span>Render real film</span><strong>{data.video.realGeneration ? 'Yes' : 'Needs a video key'}</strong></div>
                <div className="film-breakdown-row"><span>Storyboards</span><strong>{data.image.configured ? (data.image.ai ? 'AI images' : 'Local stills') : 'Not configured'}</strong></div>
                <div className="film-breakdown-row"><span>Voice takes</span><strong>{data.tts.active || 'Not configured'}</strong></div>
                <div className="film-breakdown-row"><span>Assembly</span><strong>FFmpeg, local</strong></div>
              </div>
              <div style={{ marginTop: 10 }}><Readiness ready={data.video.realGeneration} label={data.video.realGeneration ? 'Video ready' : 'Video needs credentials'} /></div>
            </Card>

            <Card title="Writing models" subtitle="Screenplays and dialogue" icon={Sparkles}>
              <div className="film-list">
                {data.text.items.map((item) => <ModelRow key={item.id} item={item} />)}
              </div>
            </Card>

            <Card title="Assembly capabilities" subtitle="Applied by the renderer" icon={Scissors}>
              <div className="film-inline-form">
                {data.assembly.capabilities.map((capability) => <span className="film-chip good" key={capability}><CheckCircle2 size={12} /> {capability}</span>)}
              </div>
              <p className="film-provider-note">Rendering is local FFmpeg, so trims, fades, the score, sound effects and subtitles work with no external service.</p>
            </Card>

            <Card title="How activation works" subtitle="No fake switches" icon={ShieldCheck}>
              <div className="film-breakdown">
                <div className="film-breakdown-row"><span>Secret entry</span><strong>Server env only</strong></div>
                <div className="film-breakdown-row"><span>Browser key storage</span><strong>Never</strong></div>
                <div className="film-breakdown-row"><span>Price source</span><strong>Credit engine</strong></div>
              </div>
              <p className="film-provider-note">{data.policy.enabling}</p>
              <p className="film-provider-note">{data.policy.billing}</p>
              <p className="film-provider-note">{data.policy.disclosure}</p>
              <div className="film-breakdown">
                <div className="film-breakdown-row"><span>Credits</span><strong><Coins size={12} /> priced per scene</strong></div>
              </div>
            </Card>

            <Card title="Deliberately absent" subtitle="Honest gaps" icon={Info}>
              <p className="film-provider-note" style={{ marginTop: 0 }}>
                Lip-sync, motion transfer, rotoscoping and video-to-video are not listed as features because no provider
                for them is configured and the studio does not ship non-functional buttons. They will appear here when a
                real integration exists.
              </p>
            </Card>
          </div>
        </div>
      )}
    </FilmShell>
  );
}
