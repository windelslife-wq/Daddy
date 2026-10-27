import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-unit-'));
process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.AI_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'none';
process.env.IMAGE_PROVIDER = 'procedural';
process.env.TTS_PROVIDER = 'mespeak';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8787';

const security = await import('../server/security.js');
const ai = await import('../server/ai.js');
const utils = await import('../server/media/utils.js');
const audio = await import('../server/media/audio.js');
const scheduler = await import('../server/services/scheduler.js');

test('password hashing verifies the original and rejects a wrong password', () => {
  const stored = security.hashPassword('correct horse battery staple');
  assert.equal(security.verifyPassword('correct horse battery staple', stored), true);
  assert.equal(security.verifyPassword('wrong password', stored), false);
  assert.notEqual(stored, 'correct horse battery staple');
});

test('AES-GCM credentials decrypt back to the original object', () => {
  const credentials = { accessToken: 'secret-token', refreshToken: 'refresh-token', nested: { enabled: true } };
  const encrypted = security.encrypt(credentials);
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes('secret-token'), false);
  assert.deepEqual(security.decrypt(encrypted), credentials);
  assert.deepEqual(security.safeParseCredentials(encrypted), credentials);
  assert.deepEqual(security.safeParseCredentials(JSON.stringify(credentials)), credentials);
});

test('HMAC signed values verify with the correct purpose and reject tampering or expiry', () => {
  const token = security.signValue({ projectId: 'prj_1', filename: 'video.mp4' }, 'media', 60);
  assert.deepEqual(security.verifySignedValue(token, 'media'), { projectId: 'prj_1', filename: 'video.mp4' });
  assert.throws(() => security.verifySignedValue(token, 'other-purpose'));
  const tampered = `${token.slice(0, -2)}aa`;
  assert.throws(() => security.verifySignedValue(tampered, 'media'));
  const expired = security.signValue({ projectId: 'prj_1' }, 'media', -10);
  assert.throws(() => security.verifySignedValue(expired, 'media'));
});

test('redaction removes sensitive values from nested objects', () => {
  const redacted = security.redact({ accessToken: 'secret', nested: { password: 'hidden', safe: 'visible' } });
  assert.notEqual(JSON.stringify(redacted).includes('secret'), true);
  assert.notEqual(JSON.stringify(redacted).includes('hidden'), true);
  assert.equal(redacted.nested.safe, 'visible');
});

test('local AI plan creates scenes, platform captions, and a provider summary without external APIs', async () => {
  const plan = await ai.generateContentPlan({
    topic: 'A mysterious abandoned observatory',
    niche: 'History & mysteries',
    style: 'cinematic',
    language: 'en',
    duration: 30,
    aspectRatio: '9:16',
    platforms: ['sandbox', 'youtube', 'instagram'],
    tone: 'documentary',
  });
  assert.ok(plan.title.length > 3);
  assert.ok(plan.script.length > 50);
  assert.ok(plan.scenes.length >= 3);
  assert.ok(plan.scenes.every((scene) => scene.narration && scene.visualPrompt));
  assert.ok(plan.captions.sandbox.title);
  assert.ok(plan.captions.sandbox.hashtags.length > 0);
  assert.ok(plan.captions.youtube.title);
  assert.equal(plan.providerSummary.scriptProvider, 'local');
  assert.equal(plan.providerSummary.aiGenerated, false);
});

test('local AI plan supports a non-English language', async () => {
  const plan = await ai.generateContentPlan({
    topic: 'Un faro olvidado',
    niche: 'Historia y misterios',
    language: 'es',
    duration: 15,
    style: 'comic',
    aspectRatio: '1:1',
    platforms: ['sandbox'],
  });
  assert.match(plan.script, /[áéíóúñ¿¡]|[a-z]/i);
  assert.equal(plan.providerSummary.language, 'es');
  assert.ok(plan.captions.sandbox.description.length > 20);
});

test('media helpers produce deterministic dimensions, escaped XML, and SRT timestamps', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(utils.dimensionsFor('9:16')).filter(([key]) => ['width', 'height'].includes(key))),
    { width: 1080, height: 1920 },
  );
  assert.equal(utils.dimensionsFor('1:1').width, 1080);
  assert.equal(utils.dimensionsFor('1:1').height, 1080);
  assert.equal(utils.dimensionsFor('16:9').width, 1920);
  assert.equal(utils.dimensionsFor('16:9').height, 1080);
  assert.equal(utils.escapeXml('Tom & Jerry <test>'), 'Tom &amp; Jerry &lt;test&gt;');
  assert.equal(utils.srtTime(61.25), '00:01:01,250');
  assert.ok(utils.splitCaptionChunks('This is a reasonably long caption that should be split into chunks', 4).length >= 2);
  assert.ok(utils.wrapText('A very long line of caption text for testing', 12).length >= 2);
});

test('WAV writer and reader round-trip 16-bit mono PCM samples', async () => {
  const file = path.join(tempDir, 'tone.wav');
  const samples = new Int16Array(2400);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(Math.sin(i / 10) * 12000);
  await audio.writeWav(samples, file, 24000);
  const parsed = audio.readWav(await fs.readFile(file));
  assert.equal(parsed.sampleRate, 24000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.samples.length, samples.length);
  assert.equal(parsed.samples[100], samples[100]);
});

test('scheduler computes daily, weekly, cron, and interval next runs', () => {
  const currentDate = new Date('2026-10-27T08:00:00.000Z');
  const daily = scheduler.computeNextRun({ frequency: 'daily', time_of_day: '09:00', timezone: 'UTC' }, currentDate);
  assert.equal(daily, '2026-10-27T09:00:00.000Z');
  const weekly = scheduler.computeNextRun({ frequency: 'weekly', time_of_day: '09:00', timezone: 'UTC', weekdays: [2] }, currentDate);
  assert.equal(weekly, '2026-10-27T09:00:00.000Z');
  const cron = scheduler.computeNextRun({ frequency: 'custom', cron_expression: '15 10 * * *', timezone: 'UTC' }, currentDate);
  assert.equal(cron, '2026-10-27T10:15:00.000Z');
  const interval = scheduler.computeNextRun({ frequency: 'custom', interval_minutes: 30 }, currentDate);
  assert.equal(interval, '2026-10-27T08:30:00.000Z');
});

test('extractJson reads JSON from fenced and conversational LLM responses', () => {
  assert.deepEqual(ai.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(ai.extractJson('Sure, here is it: {"title":"Hello"} thanks'), { title: 'Hello' });
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});
