#!/usr/bin/env node
/**
 * Live provider verification — the ONE step that cannot run in CI.
 *
 * This script talks to the real vendor API with the real key in your `.env`,
 * generates a single short clip per provider, polls it to completion, downloads
 * it and probes the file with FFmpeg. It is the gate that turns "the adapters
 * follow the documented contract" into "this deployment really produced AI
 * footage".
 *
 *   FILM_VIDEO_PROVIDER=replicate REPLICATE_API_TOKEN=r8_… node scripts/verify-provider.mjs
 *   node scripts/verify-provider.mjs --provider=fal --cancel        # also exercise cancel
 *   node scripts/verify-provider.mjs --all --check-auth
 *
 * It never prints, stores or echoes a credential. Results are written to
 * test-artifacts/provider-verification.json (git-ignored).
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import {
  configuredProviders, providerCatalog, startVideoGeneration, pollVideoGeneration,
  cancelVideoGeneration, downloadProviderVideo,
} from '../server/film/videoProviders.js';
import { probeVideo } from '../server/media/utils.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const valueOf = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] || null;

const requested = valueOf('provider');
const targets = valueOf('all') || flag('all') ? configuredProviders() : [requested || config.film.videoProvider].filter((id) => id && id !== 'none');
const checkAuth = flag('check-auth');
const alsoCancel = flag('cancel');

const AUTH_CHECK = {
  replicate: { url: 'https://api.replicate.com/v1/account', headers: () => ({ authorization: `Bearer ${config.film.replicateToken}` }) },
  fal: { url: 'https://queue.fal.run', headers: () => ({ authorization: `Key ${config.film.falKey}` }) },
  veo: { url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.film.veoKey)}`, headers: () => ({}) },
};

const catalog = providerCatalog();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-verify-'));
const report = { startedAt: new Date().toISOString(), providers: [], note: 'Real provider verification. No test double is used by this script.' };

if (!targets.length) {
  console.error('No provider selected. Set FILM_VIDEO_PROVIDER and its API key in .env, or pass --provider=replicate|fal|veo.');
  console.error(`Configured providers: ${configuredProviders().join(', ') || 'none'}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verify(provider) {
  const entry = catalog.find((item) => item.id === provider);
  if (!entry?.configured) {
    console.error(`✖ ${provider}: no API key configured.`);
    report.providers.push({ provider, ok: false, error: 'not_configured' });
    return false;
  }
  console.log(`\n▶ ${provider} · model ${entry.model} · declared clip lengths ${entry.durations.join(', ')}s`);

  if (checkAuth) {
    const check = AUTH_CHECK[provider];
    try {
      const response = await fetch(check.url, { headers: check.headers(), signal: AbortSignal.timeout(20000) });
      console.log(`  auth check: HTTP ${response.status} ${response.ok ? '✔ credentials accepted' : '✖'}`);
      if (!response.ok) {
        report.providers.push({ provider, ok: false, error: `auth_http_${response.status}` });
        return false;
      }
    } catch (error) {
      console.error(`  auth check failed: ${error.message}`);
      report.providers.push({ provider, ok: false, error: `auth_network: ${error.message}` });
      return false;
    }
  }

  const seconds = Math.min(entry.durations[0] || config.film.maxSceneSeconds, config.film.maxSceneSeconds);
  const startedAt = Date.now();
  let handle;
  try {
    handle = await startVideoGeneration({
      prompt: 'Cinematic wide shot of a lighthouse keeper walking a stormy cliff at dusk, drifting fog, film grain, no text.',
      seconds, aspectRatio: '16:9', provider,
    });
    console.log(`  prediction started: ${handle.providerJobId} (${handle.providerSeconds}s clip for a ${seconds}s beat)`);
  } catch (error) {
    console.error(`  ✖ start failed: ${error.message}`);
    report.providers.push({ provider, ok: false, error: `start: ${error.message}`, model: entry.model });
    return false;
  }

  if (alsoCancel && entry.supportsCancel) {
    try {
      const cancelled = await cancelVideoGeneration(handle);
      console.log(`  cancel: ${cancelled.cancelled ? '✔ provider accepted the cancel' : `✖ ${cancelled.reason}`}`);
      report.providers.push({ provider, model: entry.model, mode: 'cancel', ok: cancelled.cancelled, cancel: cancelled });
    } catch (error) {
      console.error(`  cancel failed: ${error.message}`);
    }
    return true;
  }

  const deadline = Date.now() + Math.max(config.film.pollTimeoutMs, 60000);
  let lastDetail = '';
  let result = null;
  while (Date.now() < deadline) {
    let poll;
    try {
      poll = await pollVideoGeneration(handle);
    } catch (error) {
      console.error(`  ✖ poll failed: ${error.message}`);
      if (error.retryable === false) {
        report.providers.push({ provider, ok: false, error: `poll: ${error.message}`, model: entry.model });
        return false;
      }
      await sleep(config.film.pollIntervalMs);
      continue;
    }
    if (poll.detail && poll.detail !== lastDetail) { lastDetail = poll.detail; console.log(`  ${poll.detail}`); }
    if (poll.done) { result = poll; break; }
    await sleep(config.film.pollIntervalMs);
  }

  if (!result) {
    console.error('  ✖ timed out waiting for the provider');
    report.providers.push({ provider, ok: false, error: 'timeout', model: entry.model });
    return false;
  }
  if (result.error) {
    console.error(`  ✖ provider reported failure: ${result.error}`);
    report.providers.push({ provider, ok: false, error: result.error, model: entry.model });
    return false;
  }

  const destination = path.join(tempDir, `${provider}-clip.mp4`);
  try {
    await downloadProviderVideo(result, destination);
  } catch (error) {
    console.error(`  ✖ download failed: ${error.message}`);
    report.providers.push({ provider, ok: false, error: `download: ${error.message}`, model: entry.model });
    return false;
  }
  const probe = await probeVideo(destination);
  const bytes = fs.statSync(destination).size;
  const ok = probe.hasVideo && probe.durationSeconds >= 0.5;
  if (!ok) {
    console.error(`  ✖ downloaded file is not usable video (hasVideo=${probe.hasVideo}, ${probe.durationSeconds}s)`);
  } else {
    console.log(`  ✔ real clip: ${probe.durationSeconds.toFixed(2)}s ${probe.width}×${probe.height}, ${bytes} bytes, audio=${probe.hasAudio ? 'yes' : 'no'}`);
    console.log(`  elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }
  report.providers.push({
    provider, ok, model: entry.model,
    providerSeconds: handle.providerSeconds, requestedSeconds: seconds,
    durationSeconds: Number(probe.durationSeconds.toFixed(2)),
    width: probe.width, height: probe.height, hasAudio: probe.hasAudio, bytes,
    elapsedMs: Date.now() - startedAt,
  });
  return ok;
}

let failures = 0;
for (const provider of targets) {
  // eslint-disable-next-line no-await-in-loop
  if (!await verify(provider)) failures += 1;
}

report.finishedAt = new Date().toISOString();
report.ok = failures === 0;
fs.mkdirSync('test-artifacts', { recursive: true });
fs.writeFileSync('test-artifacts/provider-verification.json', JSON.stringify(report, null, 2));

console.log(`\n${failures === 0 ? '✔ provider verification passed' : `✖ ${failures} provider(s) failed`} — report: test-artifacts/provider-verification.json`);
console.log('Next: create a film in the app, generate its scenes and assemble it, or run `npm run test:e2e`.');
process.exit(failures === 0 ? 0 : 1);
