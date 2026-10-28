/** Direct adapter tests for all three real AI video providers. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faceless-providers-'));
const clipPath = path.join(tempDir, 'clip.mp4');
const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=2',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clipPath,
], { stdio: 'ignore' });
const clipBytes = fs.readFileSync(clipPath);

let state = { polls: 0, requests: [] };
let origin = '';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    state.requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, body });
    if (url.pathname.startsWith('/error')) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      return res.end('upstream model unavailable');
    }
    if (url.pathname.endsWith('/video.mp4')) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(clipBytes.length) });
      return res.end(clipBytes);
    }
    // Replicate
    if (url.pathname.includes('/v1/models/') && url.pathname.endsWith('/predictions') && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'pred_1', status: 'processing', urls: { get: `${origin}/v1/predictions/pred_1` } }));
    }
    if (url.pathname.startsWith('/v1/predictions/')) {
      state.polls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(state.polls < 2
        ? JSON.stringify({ id: 'pred_1', status: 'processing' })
        : JSON.stringify({ id: 'pred_1', status: 'succeeded', output: `${origin}/video.mp4` }));
    }
    // Fal.ai
    if (url.pathname.startsWith('/fal-model') && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ request_id: 'req_1', status_url: `${origin}/fal/status`, response_url: `${origin}/fal/result` }));
    }
    if (url.pathname === '/fal/status') {
      state.polls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(state.polls < 2 ? { status: 'IN_QUEUE', queue_position: 1 } : { status: 'COMPLETED' }));
    }
    if (url.pathname === '/fal/result') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ video: { url: `${origin}/video.mp4` } }));
    }
    // Google Veo
    if (url.pathname.includes(':predictLongRunning') && req.method === 'POST') {
      assert.ok(url.searchParams.get('key'), 'Veo needs the API key in the query');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ name: 'models/veo-test/operations/op_1', done: false }));
    }
    if (url.pathname.includes('/operations/')) {
      state.polls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(state.polls < 2
        ? JSON.stringify({ name: 'models/veo-test/operations/op_1', done: false })
        : JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${origin}/veo-video.mp4` } }] } } }));
    }
    if (url.pathname === '/veo-video.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(clipBytes.length) });
      return res.end(clipBytes);
    }
    res.writeHead(404); res.end('not found');
  });
});

process.env.NODE_ENV = 'test';
process.env.FILM_VIDEO_PROVIDER = 'none';
process.env.REPLICATE_API_ROOT = '';
process.env.FAL_API_ROOT = '';
process.env.GOOGLE_VEO_API_ROOT = '';

const { config } = await import('../server/config.js');
const { startVideoGeneration, pollVideoGeneration, downloadProviderVideo, providerStatus, requireVideoProvider } = await import('../server/film/videoProviders.js');

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  // The adapters read these roots at module load, so assert via env overrides
  // by re-importing with a cache-busting query after setting them.
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Re-import the adapter module so it picks up new API roots. */
async function freshAdapter({ provider, token, roots }) {
  config.film.videoProvider = provider;
  config.film.replicateToken = provider === 'replicate' ? token : '';
  config.film.falKey = provider === 'fal' ? token : '';
  config.film.veoKey = provider === 'veo' ? token : '';
  config.film.replicateModel = 'test/video-model';
  config.film.falModel = 'fal-model';
  config.film.veoModel = 'veo-test';
  process.env.REPLICATE_API_ROOT = roots.replicate || '';
  process.env.FAL_API_ROOT = roots.fal || '';
  process.env.GOOGLE_VEO_API_ROOT = roots.veo || '';
  return import(`../server/film/videoProviders.js?fresh=${Math.random()}`);
}

async function roundTrip(adapter, args = {}) {
  state = { polls: 0, requests: [] };
  const handle = await adapter.startVideoGeneration({ prompt: 'A dramatic rooftop scene', seconds: 5, aspectRatio: '9:16', ...args });
  assert.ok(handle.providerJobId, 'provider must return a real job id');
  assert.ok(!JSON.stringify(handle).includes('SECRET'), 'no API key in the persisted handle');
  let poll = await adapter.pollVideoGeneration(handle);
  let guard = 0;
  while (!poll.done && guard < 8) {
    poll = await adapter.pollVideoGeneration(handle);
    guard += 1;
  }
  assert.equal(poll.done, true);
  assert.ok(poll.videoUrl, 'provider must return a real video URL');
  const destination = path.join(tempDir, `${handle.provider}-out.mp4`);
  await adapter.downloadProviderVideo(poll, destination);
  assert.equal(fs.statSync(destination).size, clipBytes.length);
  return handle;
}

test('no provider configured fails loudly and never fabricates a video', async () => {
  config.film.videoProvider = 'none';
  config.film.replicateToken = '';
  config.film.falKey = '';
  config.film.veoKey = '';
  const mod = await freshAdapter({ provider: 'none', token: '', roots: {} });
  assert.equal(mod.providerStatus().configured, false);
  assert.equal(mod.providerStatus().realGeneration, false);
  assert.throws(() => mod.requireVideoProvider(), /not configured/i);
  await assert.rejects(() => mod.startVideoGeneration({ prompt: 'anything' }), /not configured/i);
  assert.equal(providerStatus().configured, false);
});

test('Replicate adapter starts, polls, and downloads a real prediction', async () => {
  const mod = await freshAdapter({ provider: 'replicate', token: 'SECRET-replicate', roots: { replicate: origin } });
  const handle = await roundTrip(mod);
  assert.equal(handle.provider, 'replicate');
  assert.ok(state.requests.some((r) => r.auth === 'Bearer SECRET-replicate'));
  assert.ok(state.requests.some((r) => r.body.includes('A dramatic rooftop scene')));
  assert.ok(handle.pollRef.startsWith('/v1/predictions/'));
});

test('Fal.ai adapter uses the queue API and returns a real clip', async () => {
  const mod = await freshAdapter({ provider: 'fal', token: 'SECRET-fal', roots: { fal: origin } });
  const handle = await roundTrip(mod);
  assert.equal(handle.provider, 'fal');
  assert.ok(state.requests.some((r) => r.auth === 'Key SECRET-fal'));
  assert.equal(handle.pollRef, `${origin}/fal/status`);
});

test('Google Veo adapter uses long-running operations without persisting keys', async () => {
  const mod = await freshAdapter({ provider: 'veo', token: 'SECRET-veo', roots: { veo: origin } });
  const handle = await roundTrip(mod);
  assert.equal(handle.provider, 'veo');
  assert.equal(handle.pollRef, 'models/veo-test/operations/op_1');
  assert.ok(!JSON.stringify(handle).includes('SECRET-veo'), 'Veo API key must not be stored in DB handle');
  assert.ok(state.requests.some((r) => r.path.includes(':predictLongRunning')));
});

test('provider errors are surfaced instead of being replaced by fake output', async () => {
  const mod = await freshAdapter({ provider: 'replicate', token: 'SECRET', roots: { replicate: `${origin}/error` } });
  await assert.rejects(() => mod.startVideoGeneration({ prompt: 'x' }), (error) => {
    assert.equal(error.code, 'video_provider_error');
    assert.ok(!error.message.includes('SECRET'));
    return true;
  });
});
