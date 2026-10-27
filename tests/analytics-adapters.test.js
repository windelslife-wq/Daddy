import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceless-analytics-'));
process.env.NODE_ENV = 'test';
process.env.SKIP_FRONTEND = 'true';
process.env.SEED_DEMO = 'false';
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORAGE_DIR = path.join(tempDir, 'storage');
process.env.SQLITE_PATH = path.join(tempDir, 'app.sqlite3');
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.GOOGLE_API_BASE_URL = 'http://google.test';
process.env.GOOGLE_ANALYTICS_BASE_URL = 'http://yt-analytics.test';
process.env.GOOGLE_REPORTING_BASE_URL = 'http://yt-reporting.test';
process.env.X_API_BASE_URL = 'http://x.test/2';
process.env.X_CONSUMER_KEY = 'consumer-key';
process.env.X_CONSUMER_SECRET = 'consumer-secret';

const realFetch = globalThis.fetch;
let privateXMetricsAllowed = true;
const requests = [];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function text(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

function installFetchMock() {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    requests.push({ url: url.toString(), method: init.method || 'GET' });
    if (url.hostname === 'google.test') {
      return json({ items: [{ id: 'video-1', statistics: { viewCount: '1200', likeCount: '80', commentCount: '12' } }] });
    }
    if (url.hostname === 'yt-analytics.test') {
      if (url.searchParams.get('metrics')?.includes('shares')) {
        return json({
          columnHeaders: ['views', 'likes', 'comments', 'shares', 'estimatedMinutesWatched'].map((name) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' })),
          rows: [[1180, 79, 11, 9, 240.5]],
        });
      }
      return json({ error: { message: 'Engagement metrics are not supported for this report combination.' } }, 400);
    }
    if (url.hostname === 'yt-reporting.test') {
      if (url.pathname.endsWith('/reports')) {
        return json({ reports: [{ id: 'report-1', downloadUrl: 'http://yt-reporting.test/downloads/reach.csv' }] });
      }
      if (url.pathname === '/jobs' && init.method === 'POST') return json({ id: 'job-1' });
      if (url.pathname === '/jobs') return json({ jobs: [] });
      if (url.pathname === '/reportTypes') return json({ reportTypes: [{ id: 'channel_reach_basic_a1' }] });
    }
    if (url.pathname === '/downloads/reach.csv') {
      return text('date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n2026-10-25,UC1,video-1,3400,0.31\n2026-10-26,UC1,video-2,10,0.01\n', 200, { 'content-type': 'text/csv' });
    }
    if (url.hostname === 'x.test') {
      const wantsPrivate = url.searchParams.has('expansions');
      if (wantsPrivate && !privateXMetricsAllowed) return json({ title: 'Forbidden', detail: 'Private metrics require elevated access' }, 403);
      return json({
        data: {
          id: 'tweet-1',
          text: 'Test post',
          public_metrics: { impression_count: 9000, like_count: 210, reply_count: 33, retweet_count: 24, quote_count: 6, bookmark_count: 12 },
          attachments: { media_keys: ['3_video-1'] },
        },
        includes: {
          media: wantsPrivate ? [{
            media_key: '3_video-1', type: 'video', duration_ms: 40000,
            public_metrics: { view_count: 4200 },
            organic_metrics: { view_count: 4000, playback_0_count: 1000, playback_25_count: 600, playback_50_count: 400, playback_75_count: 250, playback_100_count: 100 },
            non_public_metrics: { playback_0_count: 1000, playback_25_count: 600, playback_50_count: 400, playback_75_count: 250, playback_100_count: 100 },
          }] : [],
        },
      });
    }
    return realFetch(input, init);
  };
}

const youtube = await import('../server/publishers/youtube.js');
const x = await import('../server/publishers/x.js');
const { closeDb } = await import('../server/db.js');

beforeEach(() => {
  requests.length = 0;
  privateXMetricsAllowed = true;
  installFetchMock();
});

function youtubeContext() {
  const timestamp = new Date(Date.now() - 3 * 86400000).toISOString();
  return {
    credentials: { accessToken: 'google-token' },
    account: { id: 'acc_yt', platform: 'youtube', metadata: JSON.stringify({ reachReportJobId: 'job-1' }) },
    publication: { id: 'pub_yt', published_at: timestamp, created_at: timestamp },
    post: { id: 'post_yt', scheduled_at: timestamp },
    project: { id: 'prj_yt', created_at: timestamp },
  };
}

function xContext() {
  return {
    credentials: { oauthToken: 'user-token', oauthTokenSecret: 'user-secret' },
    account: { id: 'acc_x', platform: 'x', external_id: 'user-1' },
    publication: { id: 'pub_x' },
  };
}

test('YouTube metrics combine Data API stats, Analytics watch time, shares, and bulk reach impressions', async () => {
  const result = await youtube.fetchYouTubeMetrics(youtubeContext(), 'video-1');
  assert.equal(result.views, 1200);
  assert.equal(result.likes, 80);
  assert.equal(result.comments, 12);
  assert.equal(result.shares, 9);
  assert.equal(result.watchSeconds, 14430);
  assert.equal(result.impressions, 3400);
  assert.equal(result.raw.analytics.scope, 'full');
  assert.equal(result.raw.reach.status, 'ok');
  assert.ok(requests.some((request) => request.url.includes('yt-analytics.test/reports')));
  assert.ok(requests.some((request) => request.url.includes('/downloads/reach.csv')));
});

test('X metrics distinguish post impressions from video views and estimate watch time from quartiles', async () => {
  const result = await x.fetchXMetrics(xContext(), 'tweet-1');
  assert.equal(result.impressions, 9000);
  assert.equal(result.views, 4200);
  assert.equal(result.likes, 210);
  assert.equal(result.comments, 33);
  assert.equal(result.shares, 30);
  assert.ok(result.watchSeconds > 0);
  assert.match(result.raw.notes.join(' '), /estimated from X video playback quartiles/);
  assert.ok(requests.some((request) => request.url.includes('expansions=attachments.media_keys')));
});

test('X metrics fall back to public post metrics when private media metrics are unavailable', async () => {
  privateXMetricsAllowed = false;
  const result = await x.fetchXMetrics(xContext(), 'tweet-1');
  assert.equal(result.impressions, 9000);
  assert.equal(result.views, 9000);
  assert.equal(result.watchSeconds, 0);
  assert.match(result.raw.notes.join(' '), /Private media metrics are not available/);
});

after(async () => {
  globalThis.fetch = realFetch;
  await closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});
