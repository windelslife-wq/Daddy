#!/usr/bin/env node
/**
 * Phase 2 — complete-film acceptance runner.
 *
 * Drives a running Facade Studio instance through the whole production path over
 * the public HTTP API (exactly what the browser does), then records the result:
 *
 *   login → create project → screenplay → continuity snapshot → (music/SFX upload)
 *   → scene generation (real provider) → preflight → assembly → ffprobe
 *   → publish → download/stream check → credits → JSON report
 *
 * It refuses to run when no real video provider is configured, so it can never
 * "pass" on a deployment that would fabricate footage.
 *
 *   FILM_VIDEO_PROVIDER=replicate REPLICATE_API_TOKEN=r8_… npm run verify:film
 *   node scripts/verify-film.mjs --seconds=60 --publish --music=./score.mp3 --sfx=./thunder.wav
 *
 * Credentials for the *app* account come from --email/--password or
 * DEMO_EMAIL/DEMO_PASSWORD (defaults match the seeded demo user). Provider keys
 * are never read or printed by this script; they stay on the server.
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeVideo } from '../server/media/utils.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const valueOf = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

const baseUrl = (valueOf('base-url') || process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 8787}`).replace(/\/$/, '');
const email = valueOf('email') || process.env.DEMO_EMAIL || 'creator@faceless.local';
const password = valueOf('password') || process.env.DEMO_PASSWORD || 'StudioDemo2026!';
const seconds = Number(valueOf('seconds') || 20);
const aspectRatio = valueOf('aspect') || '16:9';
const title = valueOf('title') || `Acceptance run ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
const idea = valueOf('idea') || 'A lighthouse keeper discovers a second lighthouse that only appears at night, and must decide whether to climb it.';
const musicPath = valueOf('music');
const sfxPath = valueOf('sfx');
const publish = !flag('no-publish');
const timeoutMin = Number(valueOf('timeout-min') || 120);
const reportPath = valueOf('report') || 'test-artifacts/film-acceptance.json';
const pollMs = Number(valueOf('poll-ms') || 5000);

const startedAt = new Date();
const report = {
  kind: 'film-acceptance',
  startedAt: startedAt.toISOString(),
  baseUrl, seconds, aspectRatio, title,
  ok: false, blockers: [], steps: {}, scenes: null, film: null, credits: null,
};

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(`[${stamp()}]`, ...parts);
const fail = (message, code = 1) => { report.blockers.push(message); console.error(`\n✖ ${message}`); writeReport(); process.exit(code); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = startedAt.getTime() + timeoutMin * 60 * 1000;

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
}

let cookie = '';
async function api(pathname, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  if (setCookie.length) cookie = setCookie.map((value) => value.split(';')[0]).join('; ');
  if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

async function apiOrFail(pathname, options, what) {
  const result = await api(pathname, options);
  if (result.status >= 400) {
    fail(`${what} failed (HTTP ${result.status}): ${JSON.stringify(result.data?.error || result.data).slice(0, 400)}`);
  }
  return result;
}

const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

async function upload(kind, filePath, extra = {}) {
  const form = new FormData();
  form.append('kind', kind);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mime }), path.basename(filePath));
  const response = await fetch(`${baseUrl}/api/films/${report.film.id}/upload`, { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
  const data = await response.json().catch(() => null);
  if (response.status >= 400) fail(`${kind} upload failed (HTTP ${response.status}): ${JSON.stringify(data?.error || data).slice(0, 300)}`);
  return data;
}

// ---------------------------------------------------------------------------
// Preconditions — fail closed, never pretend
// ---------------------------------------------------------------------------
console.log('\nFaceless Studio — complete-film acceptance (Phase 2)');
console.log(`target ${baseUrl} · ${seconds}s · ${aspectRatio} · publish=${publish}\n`);

let login;
try {
  login = await api('/api/auth/login', { method: 'POST', body: { email, password } });
} catch (error) {
  fail(`cannot reach ${baseUrl}: ${error.message}`);
}
if (login.status !== 200) {
  fail(`login failed for ${email} (HTTP ${login.status}). Start the server and check the credentials.`, 2);
}
log(`signed in as ${login.data?.user?.email || email}`);

const config = await apiOrFail('/api/films/config', {}, 'reading film configuration');
const videoProvider = config.data.videoProvider;
report.provider = { provider: videoProvider?.provider, configured: videoProvider?.configured, model: videoProvider?.model, catalog: videoProvider?.catalog };
if (!videoProvider?.configured) {
  fail(`No real video provider is configured on ${baseUrl}. Set FILM_VIDEO_PROVIDER plus REPLICATE_API_TOKEN / FAL_API_KEY / GOOGLE_VEO_API_KEY and restart. This runner refuses to proceed because the server will not fabricate clips.`, 2);
}
log(`provider: ${videoProvider.provider} · model ${videoProvider.model} · configured ✔`);

const plan = config.data.limits;
if (seconds > plan.maxProjectSeconds) fail(`--seconds=${seconds} exceeds this deployment's limit of ${plan.maxProjectSeconds}s.`, 2);
report.plan = { sceneCount: Math.ceil(seconds / plan.maxSceneSeconds), sceneSeconds: plan.maxSceneSeconds, limits: plan };

// ---------------------------------------------------------------------------
// 1. Project + screenplay
// ---------------------------------------------------------------------------
const created = await apiOrFail('/api/films', {
  method: 'POST',
  body: { type: 'short_drama', title, targetDurationSeconds: seconds, aspectRatio, targetPlatform: 'youtube', storyBible: {}, characters: [] },
}, 'creating the project');
report.film = { id: created.data.film.id, title: created.data.film.title };
log(`project ${report.film.id} created`);

const screenplay = await apiOrFail(`/api/films/${report.film.id}/screenplay`, {
  method: 'POST', body: { idea },
}, 'writing the screenplay');
const scenes = screenplay.data.film.scenes;
if (!scenes.length) fail('the screenplay returned no scenes.');
const plannedCount = Math.ceil(seconds / plan.maxSceneSeconds);
if (scenes.length !== plannedCount) {
  fail(`screenplay produced ${scenes.length} scenes but ${plannedCount} were planned for ${seconds}s — this is a truncation bug.`);
}
const plannedSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
log(`screenplay: ${scenes.length} scenes · ${plannedSeconds}s planned · provider ${screenplay.data.provider}`);

// Continuity snapshot: recurring cast, per-scene cast, dialogue, appearance prompts.
const castNames = [...new Set(scenes.flatMap((scene) => (scene.cast || []).map((member) => (typeof member === 'string' ? member : member?.name)).filter(Boolean)))];
const dialogueLines = scenes.reduce((sum, scene) => sum + (scene.dialogue || []).length, 0);
const dialogueCharacters = scenes.reduce((sum, scene) => sum + (scene.dialogue || []).reduce((n, line) => n + String(line.line || '').length, 0), 0);
const withAppearance = scenes.filter((scene) => {
  const prompt = String(scene.visualPrompt || '');
  return castNames.some((name) => prompt.includes(name));
}).length;
report.steps.screenplay = {
  scenes: scenes.length, plannedCount, plannedSeconds,
  characters: castNames, castCoverage: `${scenes.filter((scene) => (scene.cast || []).length).length}/${scenes.length}`,
  appearanceCoverage: `${withAppearance}/${scenes.length}`,
  dialogueLines, dialogueCharacters,
};
if (dialogueLines === 0) log('⚠ no dialogue lines in this screenplay — voice verification will be empty');
if (withAppearance === 0) log('⚠ visual prompts do not name the cast — continuity coverage is unproven');

// ---------------------------------------------------------------------------
// 2. Optional music + sound effects
// ---------------------------------------------------------------------------
let sfxAsset = null;
if (musicPath) {
  if (!fs.existsSync(musicPath)) fail(`music file not found: ${musicPath}`, 2);
  await upload('music', musicPath);
  log(`music uploaded: ${path.basename(musicPath)}`);
  report.steps.music = { file: path.basename(musicPath), bytes: fs.statSync(musicPath).size };
}
if (sfxPath) {
  if (!fs.existsSync(sfxPath)) fail(`sfx file not found: ${sfxPath}`, 2);
  const uploaded = await upload('sfx', sfxPath, { name: path.basename(sfxPath) });
  sfxAsset = uploaded.asset;
  const target = scenes[0];
  await apiOrFail(`/api/films/${report.film.id}/scenes/${target.id}`, {
    method: 'PATCH', body: { sfx: [{ assetId: sfxAsset.id, atSeconds: 1, gain: 0.8 }] },
  }, 'attaching the sound effect');
  log(`sfx attached to scene ${target.ordinal} at 1s: ${sfxAsset.name} (${sfxAsset.durationSeconds?.toFixed(2)}s)`);
  report.steps.sfx = { file: path.basename(sfxPath), assetId: sfxAsset.id, scene: target.ordinal };
}

// ---------------------------------------------------------------------------
// 3. Scene generation with the real provider
// ---------------------------------------------------------------------------
const started = await apiOrFail(`/api/films/${report.film.id}/generation/start`, { method: 'POST', body: {} }, 'starting generation');
log(`generation queued: ${started.data.queued} started, ${started.data.planned} planned (concurrency ${plan.sceneConcurrency})`);

let lastLine = '';
let retried = false;
let progress;
for (;;) {
  if (Date.now() > deadline) {
    const detail = await api(`/api/films/${report.film.id}/progress`).catch(() => null);
    fail(`timed out after ${timeoutMin} min. ${JSON.stringify(detail?.data?.counts || {}).slice(0, 300)}`);
  }
  progress = await apiOrFail(`/api/films/${report.film.id}/progress`, {}, 'polling generation progress');
  const counts = progress.data.counts;
  const line = `${counts.ready}/${counts.total} ready · ${counts.processing} processing · ${counts.queued} queued · ${counts.failed} failed`;
  if (line !== lastLine) { log(line); lastLine = line; }
  if (counts.failed + (counts.cancelled || 0) > 0 && !retried) {
    retried = true;
    log(`${counts.failed + counts.cancelled} scene(s) failed — retrying once`);
    await api(`/api/films/${report.film.id}/scenes/retry-failed`, { method: 'POST', body: {} });
    continue;
  }
  if (counts.ready === counts.total) break;
  if (counts.failed + (counts.cancelled || 0) > 0 && !counts.processing && !counts.queued) {
    const detail = await api(`/api/films/${report.film.id}`);
    const failures = (detail.data?.scenes || []).filter((scene) => scene.status === 'failed').slice(0, 5)
      .map((scene) => `scene ${scene.ordinal}: ${scene.error}`).join('\n  ');
    report.scenes = { total: counts.total, ready: counts.ready, failed: counts.failed, errors: failures };
    fail(`generation stopped with ${counts.failed} failed scene(s):\n  ${failures}`);
  }
  await sleep(pollMs);
}

const detailAfter = await apiOrFail(`/api/films/${report.film.id}`, {}, 'loading the finished project');
const readyScenes = (detailAfter.data.scenes || []).filter((scene) => scene.status === 'ready');
const clipDurations = readyScenes.map((scene) => scene.durationSeconds);
report.scenes = {
  total: readyScenes.length,
  providers: [...new Set(readyScenes.map((scene) => scene.provider).filter(Boolean))],
  attempts: readyScenes.reduce((sum, scene) => sum + (scene.attempts || 0), 0),
  storyboardSeconds: clipDurations.reduce((sum, value) => sum + value, 0),
  clipSeconds: null,
  errors: [],
};
log(`all ${readyScenes.length} clips ready · providers ${report.scenes.providers.join(', ') || 'unknown'}`);

// ---------------------------------------------------------------------------
// 4. Preflight
// ---------------------------------------------------------------------------
const preflight = await apiOrFail(`/api/films/${report.film.id}/preflight`, {}, 'preflight');
if (!preflight.data.ready) fail(`preflight says the film is not ready: ${preflight.data.missing?.length || 0} scene(s) missing clips.`);
if (sfxAsset && preflight.data.sfxCount < 1) fail('the attached sound effect is not present in the preflight cue list.');
log(`preflight: ${preflight.data.durationSeconds}s · ${preflight.data.segments} segment(s) · ${Math.ceil(preflight.data.estimatedRenderBytes / 1e6)} MB temp · ${preflight.data.sfxCount} sfx cue(s) · ${preflight.data.dialogueCharacters} dialogue chars`);
report.steps.preflight = {
  durationSeconds: preflight.data.durationSeconds, segments: preflight.data.segments,
  estimatedRenderBytes: preflight.data.estimatedRenderBytes,
  sfxCount: preflight.data.sfxCount, dialogueCharacters: preflight.data.dialogueCharacters,
  burnInRecommended: preflight.data.burnInRecommended,
};

// ---------------------------------------------------------------------------
// 5. Assembly
// ---------------------------------------------------------------------------
const assemble = await apiOrFail(`/api/films/${report.film.id}/assemble`, { method: 'POST', body: { subtitles: true } }, 'queueing assembly');
log(`assembly queued: ${assemble.data.sceneCount} clips · ${assemble.data.durationSeconds}s · subtitles ${assemble.data.subtitles} · ${assemble.data.creditsReserved} credits`);
let lastStage = '';
for (;;) {
  if (Date.now() > deadline) fail(`assembly did not finish within ${timeoutMin} min.`);
  const film = await apiOrFail(`/api/films/${report.film.id}`, {}, 'polling assembly');
  const line = `${film.data.stage} ${film.data.progress || 0}%${film.data.detail ? ` — ${film.data.detail}` : ''}`;
  if (line !== lastStage) { log(line); lastStage = line; }
  if (film.data.stage === 'completed') break;
  if (film.data.stage === 'failed' || film.data.status === 'failed') fail(`assembly failed: ${film.data.error || 'unknown error'}`);
  await sleep(pollMs);
}

// ---------------------------------------------------------------------------
// 6. Final media probe
// ---------------------------------------------------------------------------
const download = await api(`/api/films/${report.film.id}/download`, { raw: true });
if (download.status !== 200) fail(`download failed (HTTP ${download.status}).`);
const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'film-acceptance-')), 'final.mp4');
fs.writeFileSync(tempFile, download.buffer);
const probe = await probeVideo(tempFile);
fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
if (!probe.hasVideo || probe.durationSeconds < 1) fail(`the downloaded film is not usable video (hasVideo=${probe.hasVideo}, ${probe.durationSeconds}s).`);
if (download.buffer.subarray(4, 8).toString() !== 'ftyp') fail('the downloaded file is not an MP4 (missing ftyp box).');
log(`final: ${probe.durationSeconds.toFixed(2)}s · ${probe.width}×${probe.height} · ${download.buffer.length} bytes · audio=${probe.hasAudio ? 'yes' : 'no'}`);

const captions = await api(`/api/films/${report.film.id}/media/captions`, { raw: true });
const srtOk = captions.status === 200 && /-->/.test(captions.buffer.toString('utf8'));

report.steps.assembly = {
  durationSeconds: Number(probe.durationSeconds.toFixed(2)),
  width: probe.width, height: probe.height,
  bytes: download.buffer.length, hasVideo: probe.hasVideo, hasAudio: probe.hasAudio,
  captions: srtOk, subtitlesRequested: assemble.data.subtitles,
  runtimeDrift: Number((probe.durationSeconds - preflight.data.durationSeconds).toFixed(2)),
};

// ---------------------------------------------------------------------------
// 7. Publish + playback
// ---------------------------------------------------------------------------
if (publish) {
  const published = await apiOrFail(`/api/films/${report.film.id}/publish`, { method: 'POST', body: {} }, 'publishing');
  const stream = await api(`/api/films/${report.film.id}/media/video`, { raw: true });
  const ranged = await fetch(`${baseUrl}/api/films/${report.film.id}/media/video`, { headers: { cookie, range: 'bytes=0-1023' } });
  report.steps.publish = {
    status: published.data.film.status,
    hasVideo: published.data.film.hasVideo,
    streamStatus: stream.status,
    streamFtyp: stream.buffer.subarray(4, 8).toString(),
    rangeStatus: ranged.status,
    publishedAt: published.data.film.metadata?.publishedAt || null,
  };
  if (published.data.film.status !== 'published') fail(`publish did not mark the film published (status ${published.data.film.status}).`);
  if (stream.status !== 200 || stream.buffer.subarray(4, 8).toString() !== 'ftyp') fail('the published video does not stream as an MP4.');
  if (ranged.status !== 206) log(`⚠ range request returned ${ranged.status} (expected 206); playback may not seek`);
  log(`published ✔ · stream ${stream.status} · range ${ranged.status}`);
} else {
  log('publish skipped (--no-publish)');
  report.steps.publish = { skipped: true };
}

// ---------------------------------------------------------------------------
// 8. Credits
// ---------------------------------------------------------------------------
const history = await apiOrFail('/api/films/credits/history?limit=200', {}, 'reading the credit ledger');
const credits = await apiOrFail('/api/films/credits', {}, 'reading the credit balance');
const entries = (history.data.history || []).filter((entry) => entry.referenceId === report.film.id || String(entry.metadata?.filmId || '') === report.film.id);
const charges = entries.filter((entry) => entry.amount < 0);
const refunds = entries.filter((entry) => entry.amount > 0);
const expectedCharges = readyScenes.length + 1; // one reservation per scene attempt + one assembly
report.credits = {
  balance: credits.data.balance,
  charges: charges.length, chargedCredits: charges.reduce((sum, entry) => sum - entry.amount, 0),
  refunds: refunds.length, refundedCredits: refunds.reduce((sum, entry) => sum + entry.amount, 0),
  expectedCharges,
  estimatedCost: detailAfter.data.creditsEstimated,
  spent: detailAfter.data.creditsSpent,
};
if (charges.length !== expectedCharges) {
  log(`⚠ ${charges.length} charge entries for ${readyScenes.length} scenes + 1 assembly (attempts may differ from scenes)`);
}
log(`credits: ${report.credits.chargedCredits} charged · ${report.credits.refundedCredits} refunded · balance ${report.credits.balance} · spent ${report.credits.spent} (estimated ${report.credits.estimatedCost})`);

report.ok = true;
report.film = { ...report.film, stage: 'completed', published: report.steps.publish.status === 'published' };
writeReport();
console.log(`\n✔ Phase 2 acceptance passed — report: ${reportPath}`);
console.log(`  film ${baseUrl}/app/films/project/${report.film.id} · download ${baseUrl}/api/films/${report.film.id}/download`);
