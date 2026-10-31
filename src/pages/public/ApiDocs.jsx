import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, CheckCircle2, Download, KeyRound,
  Loader2, Lock, RefreshCw, Server, Terminal, Webhook,
} from 'lucide-react';
import { get } from '../../api.js';
import { useLoad } from '../../hooks.js';
import { CodeBlock } from '../../components/CodeBlock.jsx';
import { CTASection, PageHero } from '../../components/Marketing.jsx';
import { SITE } from '../../config/site.js';

function curlFor(endpoint, baseUrl) {
  const lines = [
    `curl -X ${endpoint.method} "${baseUrl}${endpoint.fullPath}"`,
    '  -H "Authorization: Bearer $FCL_API_KEY"',
  ];
  if (endpoint.exampleBody) {
    lines.push('  -H "content-type: application/json"');
    lines.push(`  -d '${JSON.stringify(endpoint.exampleBody)}'`);
  }
  return lines.join(' \\\n');
}

function anchorFor(endpoint) {
  return `endpoint-${endpoint.id.replace(/\./g, '-')}`;
}

function methodClass(method) {
  return `api-method api-method-${method.toLowerCase()}`;
}

function Skeleton() {
  return (
    <div className="container api-docs-loading">
      <Loader2 className="spin" size={22} />
      <span>Loading the live API catalogue…</span>
    </div>
  );
}

export default function ApiDocs() {
  const { data: spec, loading, error, reload } = useLoad(() => get('/api/developer/spec'), [], { initial: null });
  const [expandAll, setExpandAll] = useState(false);

  const baseUrl = spec?.baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://filmclublens.com');
  const grouped = useMemo(() => {
    if (!spec) return [];
    return spec.groups.map((group) => ({ group, endpoints: spec.endpoints.filter((endpoint) => endpoint.group === group) }));
  }, [spec]);

  const quickStart = `# 1. Set your key (created in Workspace → Developer API)
export FCL_API_KEY="fcl_live_…"

# 2. Check the connection
curl "${baseUrl}/api/v1/me" -H "Authorization: Bearer $FCL_API_KEY"

# 3. Create a project, then follow it
curl -X POST "${baseUrl}/api/v1/projects" \\
  -H "Authorization: Bearer $FCL_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"topic":"How a 20-minute walk changes your day","duration":45,"platforms":["sandbox"]}'`;

  const nodeSample = `const KEY = process.env.FCL_API_KEY;
const BASE = '${baseUrl}/api/v1';

const call = (path, options = {}) => fetch(BASE + path, {
  ...options,
  headers: { authorization: \`Bearer \${KEY}\`, 'content-type': 'application/json', ...options.headers },
}).then(async (res) => {
  const body = await res.json();
  if (!res.ok) throw new Error(\`\${res.status} \${body.error?.code}: \${body.error?.message}\`);
  return body;
});

const { project } = await call('/projects', {
  method: 'POST',
  body: JSON.stringify({ topic: 'Why walking beats caffeine', duration: 45 }),
});`;

  const pythonSample = `import os, requests

BASE = "${baseUrl}/api/v1"
HEADERS = {"Authorization": f"Bearer {os.environ['FCL_API_KEY']}"}

project = requests.post(
    f"{BASE}/projects",
    headers=HEADERS,
    json={"topic": "Why walking beats caffeine", "duration": 45},
    timeout=30,
).json()["project"]

status = requests.get(f"{BASE}/projects/{project['id']}", headers=HEADERS).json()["project"]`;

  const webhookVerify = `import crypto from 'node:crypto';

// Express receiver: keep the raw body to verify the signature.
app.post('/hooks/film-club-lens', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('x-film-club-lens-timestamp');
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(\`\${timestamp}.\${req.body.toString()}\`)
    .digest('hex');
  const received = req.get('x-film-club-lens-signature') || '';
  const ok = expected.length === received.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!ok || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.status(401).end();
  res.status(200).json({ received: true });  // then process idempotently by event id
});`;

  return (
    <>
      <PageHero
        eyebrow="Developers"
        title="Build with the Film Club Lens API"
        description="Create projects and film projects, follow generation, and drive publishing from your own code. One REST API, bearer-token authentication, scoped keys and signed webhooks — every endpoint on this page is live on this deployment."
        actions={(
          <>
            <Link to="/app/developers" className="btn btn-primary btn-lg"><KeyRound size={16} /> Create an API key</Link>
            <a className="btn btn-secondary btn-lg" href="/api/developer/openapi.json" download="film-club-lens-openapi.json"><Download size={16} /> Download OpenAPI</a>
          </>
        )}
      />

      {loading && !spec && <Skeleton />}

      {(error || (spec === null && !loading)) && (
        <div className="container api-docs-error">
          <div className="banner banner-error">
            <AlertTriangle size={18} />
            <div>
              <strong>The live API catalogue could not be loaded.</strong>
              <span>{error?.message || 'The specification endpoint did not respond.'} Nothing is guessed here — reload once the server is reachable.</span>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => reload().catch(() => {})}><RefreshCw size={15} /> Try again</button>
        </div>
      )}

      {spec && (
        <>
          <section className="api-facts">
            <div className="container api-facts-grid">
              <div className="api-fact"><span><Server size={14} /> Base URL</span><code>{baseUrl}{spec.prefix}</code></div>
              <div className="api-fact"><span><Lock size={14} /> Authentication</span><code>Bearer fcl_live_…</code></div>
              <div className="api-fact"><span><BookOpen size={14} /> Version</span><code>{spec.version} · {spec.endpoints.length} endpoints</code></div>
              <div className="api-fact"><span><RefreshCw size={14} /> Rate limit</span><code>{spec.rateLimits.perKey.limit} req / min / key</code></div>
            </div>
          </section>

          <div className="container api-docs-layout">
            <aside className="api-docs-side">
              <div className="api-docs-side-inner">
                <strong>On this page</strong>
                {['quick-start', 'authentication', 'endpoints', 'errors', 'limits', 'webhooks'].map((id) => (
                  <a key={id} href={`#${id}`}>{id === 'quick-start' ? 'Quick start' : id === 'authentication' ? 'Authentication' : id === 'endpoints' ? 'Endpoints' : id === 'errors' ? 'Errors' : id === 'limits' ? 'Rate limits & paging' : 'Webhooks'}</a>
                ))}
                {grouped.map(({ group, endpoints }) => (
                  <div key={group} className="api-docs-side-group">
                    <span>{group}</span>
                    {endpoints.map((endpoint) => (
                      <a key={endpoint.id} href={`#${anchorFor(endpoint)}`}>
                        <em className={methodClass(endpoint.method)}>{endpoint.method}</em> {endpoint.path}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </aside>

            <div className="api-docs-main">
              <section id="quick-start" className="api-section">
                <div className="api-section-head">
                  <h2>Quick start</h2>
                  <p>Three calls get you from a key to a queued video. Every example uses the same key you create in the workspace.</p>
                </div>
                <ol className="api-steps">
                  <li><span>01</span><div><strong>Create a key.</strong> Open <Link to="/app/developers">Workspace · Developer API</Link>, name the key and choose scopes. The full secret is shown once — store it in your secret manager.</div></li>
                  <li><span>02</span><div><strong>Verify the connection.</strong> <code>GET {spec.prefix}/me</code> returns your account, plan, usage and credit balance.</div></li>
                  <li><span>03</span><div><strong>Follow the work.</strong> Creation returns immediately; poll the project until <code>status</code> is <code>ready</code> or <code>failed</code>. Publishing is queued the same way.</div></li>
                </ol>
                <CodeBlock label="shell" code={quickStart} />
                <div className="api-code-pair">
                  <CodeBlock label="node (fetch)" code={nodeSample} />
                  <CodeBlock label="python (requests)" code={pythonSample} />
                </div>
              </section>

              <section id="authentication" className="api-section">
                <div className="api-section-head">
                  <h2>Authentication</h2>
                  <p>{spec.authentication.scheme}. {spec.authentication.keyFormat}</p>
                </div>
                <div className="api-table-wrap">
                  <table>
                    <tbody>
                      <tr><th>Header</th><td><code>{spec.authentication.header}</code> (or <code>{spec.authentication.alternative}</code>)</td></tr>
                      <tr><th>Storage</th><td>{spec.authentication.storage}</td></tr>
                      <tr><th>Obtain a key</th><td>{spec.authentication.obtain}</td></tr>
                      <tr><th>Transport</th><td>{spec.authentication.transport}</td></tr>
                    </tbody>
                  </table>
                </div>
                <h3 className="api-subhead">Scopes</h3>
                <div className="api-scope-grid">
                  {spec.scopes.map((scope) => (
                    <div className="api-scope" key={scope.id}>
                      <code>{scope.id}</code>
                      <div><strong>{scope.label}</strong><p>{scope.description}</p></div>
                    </div>
                  ))}
                </div>
                <div className="banner">
                  <Lock size={16} />
                  <div>
                    <strong>Keys are secrets.</strong>
                    <span>Never ship a key in browser code or a mobile binary. If one leaks, revoke it in the workspace — revocation takes effect on the next request.</span>
                  </div>
                </div>
              </section>

              <section id="endpoints" className="api-section">
                <div className="api-section-head api-section-head-row">
                  <div>
                    <h2>Endpoints</h2>
                    <p>All paths are relative to <code>{baseUrl}</code>. Responses are JSON; errors always use the envelope documented below.</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpandAll((value) => !value)}>
                    {expandAll ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>

                {grouped.map(({ group, endpoints }) => (
                  <div className="api-group" key={group} id={`group-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                    <h3 className="api-group-title">{group}</h3>
                    {endpoints.map((endpoint) => (
                      <details className="api-endpoint" key={endpoint.id} id={anchorFor(endpoint)} open={expandAll} data-endpoint={endpoint.id}>
                        <summary>
                          <em className={methodClass(endpoint.method)}>{endpoint.method}</em>
                          <code className="api-endpoint-path">{endpoint.fullPath}</code>
                          <span className="api-endpoint-summary">{endpoint.summary}</span>
                          <span className={`api-scope-chip api-scope-${endpoint.scope}`}>{endpoint.scope}</span>
                        </summary>
                        <div className="api-endpoint-body">
                          <p className="api-endpoint-desc">{endpoint.description}</p>
                          {endpoint.params?.length > 0 && (
                            <div className="api-table-wrap">
                              <table>
                                <thead><tr><th>Parameter</th><th>In</th><th>Type</th><th>Notes</th></tr></thead>
                                <tbody>
                                  {endpoint.params.map((param) => (
                                    <tr key={`${endpoint.id}-${param.name}`}>
                                      <td><code>{param.name}</code>{param.required ? ' *' : ''}</td>
                                      <td>{param.in}</td>
                                      <td>{param.type}</td>
                                      <td>{param.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div className="api-code-pair">
                            <CodeBlock label="curl" code={curlFor(endpoint, baseUrl)} />
                            <CodeBlock label={`response · ${endpoint.successStatus}`} code={JSON.stringify(endpoint.exampleResponse, null, 2)} />
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                ))}
              </section>

              <section id="errors" className="api-section">
                <div className="api-section-head">
                  <h2>Errors</h2>
                  <p>Errors use HTTP status codes plus a stable machine-readable <code>code</code>. The message is written for humans; <code>requestId</code> identifies the server log entry.</p>
                </div>
                <CodeBlock label="error envelope" code={`{\n  "error": {\n    "code": "unauthorized",\n    "message": "This API key has been revoked.",\n    "requestId": "6b0f2f7c-…"\n  }\n}`} />
                <div className="api-table-wrap">
                  <table>
                    <thead><tr><th>Status</th><th>Code</th><th>When</th></tr></thead>
                    <tbody>
                      {spec.errors.map((error) => (
                        <tr key={error.code}><td><code>{error.status}</code></td><td><code>{error.code}</code></td><td>{error.meaning}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section id="limits" className="api-section">
                <div className="api-section-head">
                  <h2>Rate limits & pagination</h2>
                  <p>{spec.rateLimits.perKey.note}</p>
                </div>
                <div className="api-two-col">
                  <div className="api-note-card">
                    <h3><RefreshCw size={15} /> Rate limits</h3>
                    <ul className="api-list">
                      <li><strong>{spec.rateLimits.perKey.limit} requests / minute</strong> per API key ({spec.rateLimits.perKey.header}).</li>
                      <li><strong>{spec.rateLimits.perIp.limit} requests / minute</strong> per IP address for the whole application.</li>
                      <li>{spec.rateLimits.exceeded}</li>
                    </ul>
                  </div>
                  <div className="api-note-card">
                    <h3><Terminal size={15} /> Conventions</h3>
                    <ul className="api-list">
                      {spec.conventions.map((item) => <li key={item.title}><strong>{item.title}.</strong> {item.body}</li>)}
                    </ul>
                  </div>
                </div>
              </section>

              <section id="webhooks" className="api-section">
                <div className="api-section-head">
                  <h2><Webhook size={18} /> {spec.webhooks.title}</h2>
                  <p>{spec.webhooks.summary}</p>
                </div>
                <div className="api-table-wrap">
                  <table>
                    <thead><tr><th>Header</th><th>Purpose</th></tr></thead>
                    <tbody>{spec.webhooks.headers.map((header) => <tr key={header.name}><td><code>{header.name}</code></td><td>{header.description}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="api-code-pair">
                  <CodeBlock label="example payload" code={JSON.stringify(spec.webhooks.payload, null, 2)} />
                  <CodeBlock label="verify (node)" code={webhookVerify} />
                </div>
                <p className="api-footnote"><AlertTriangle size={14} /> {spec.webhooks.note} {spec.webhooks.setup}</p>
              </section>

              <section className="api-section api-section-final">
                <div className="api-final-card">
                  <div>
                    <h2>Ready to integrate?</h2>
                    <p>Create a scoped key, copy the OpenAPI document into your client generator, and start with <code>{spec.prefix}/me</code>.</p>
                  </div>
                  <div className="api-final-actions">
                    <Link to="/app/developers" className="btn btn-primary"><KeyRound size={15} /> Create an API key</Link>
                    <a className="btn btn-secondary" href={spec.openapiUrl} download="film-club-lens-openapi.json"><Download size={15} /> openapi.json</a>
                  </div>
                </div>
                <p className="api-footnote"><CheckCircle2 size={14} /> Every endpoint listed here is exercised by the automated test suite on each build, so this page cannot advertise a route that does not exist. Provider-dependent work (AI video, live social publishing) still requires the operator to configure those providers — the API reports the missing configuration instead of faking results.</p>
              </section>
            </div>
          </div>

          <CTASection
            title={`Ship with ${SITE.name}`}
            description="Read the filmmaking guide for the production workflow behind these endpoints, or talk to us about higher limits and dedicated workers."
            primary={{ to: '/app/developers', label: 'Create an API key' }}
            secondary={{ to: '/filmmaking', label: 'Explore the filmmaking workflow' }}
          />
        </>
      )}
    </>
  );
}
