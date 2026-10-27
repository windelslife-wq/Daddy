import crypto from 'node:crypto';
import { db, now, newId, json, parseJson, number, addJob } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { llmRecommendations } from '../ai.js';

function engagementRate(metric) {
  const views = number(metric.views);
  if (views <= 0) return 0;
  return ((number(metric.likes) + number(metric.comments) + number(metric.shares)) / views) * 100;
}

function latestMetricsMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.publication_id)) map.set(row.publication_id, row);
  }
  return map;
}

function isSimulated(metric) {
  const raw = parseJson(metric.raw, {});
  return Boolean(raw.simulated || raw.note?.toLowerCase?.().includes('sandbox'));
}

function emptyDays(days = 30) {
  const result = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - i);
    result.push({ date: date.toISOString().slice(0, 10), views: 0, likes: 0, comments: 0, shares: 0, engagement: 0 });
  }
  return result;
}

export async function getAnalyticsSummary(userId) {
  const publications = await db('publications').where({ user_id: userId }).orderBy('created_at', 'desc');
  const publicationIds = publications.map((row) => row.id);
  const metrics = publicationIds.length
    ? await db('post_metrics').whereIn('publication_id', publicationIds).orderBy('fetched_at', 'desc')
    : [];
  const latest = latestMetricsMap(metrics);
  const postIds = [...new Set(publications.map((row) => row.post_id))];
  const posts = postIds.length ? await db('posts').whereIn('id', postIds) : [];
  const projectIds = [...new Set(posts.map((row) => row.project_id))];
  const projects = projectIds.length ? await db('projects').whereIn('id', projectIds) : [];
  const accountIds = [...new Set(publications.map((row) => row.account_id))];
  const accounts = accountIds.length ? await db('accounts').whereIn('id', accountIds) : [];
  const postMap = Object.fromEntries(posts.map((row) => [row.id, row]));
  const projectMap = Object.fromEntries(projects.map((row) => [row.id, row]));
  const accountMap = Object.fromEntries(accounts.map((row) => [row.id, row]));

  const totals = { views: 0, likes: 0, comments: 0, shares: 0, impressions: 0, watchSeconds: 0 };
  const byPlatform = {};
  const dailyMap = new Map(emptyDays().map((day) => [day.date, day]));
  const top = [];
  let realMetricsCount = 0;
  let simulatedMetricsCount = 0;
  for (const publication of publications) {
    const metric = latest.get(publication.id);
    if (!metric) continue;
    const simulated = isSimulated(metric);
    if (simulated) simulatedMetricsCount += 1;
    else realMetricsCount += 1;
    const values = {
      views: number(metric.views), likes: number(metric.likes), comments: number(metric.comments),
      shares: number(metric.shares), impressions: number(metric.impressions), watchSeconds: number(metric.watch_seconds),
    };
    for (const key of Object.keys(totals)) totals[key] += values[key];
    const platform = accountMap[publication.account_id]?.platform || 'unknown';
    byPlatform[platform] ||= { platform, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 };
    byPlatform[platform].views += values.views;
    byPlatform[platform].likes += values.likes;
    byPlatform[platform].comments += values.comments;
    byPlatform[platform].shares += values.shares;
    byPlatform[platform].posts += 1;
    const day = String(metric.fetched_at).slice(0, 10);
    const bucket = dailyMap.get(day) || { date: day, views: 0, likes: 0, comments: 0, shares: 0, engagement: 0 };
    bucket.views += values.views;
    bucket.likes += values.likes;
    bucket.comments += values.comments;
    bucket.shares += values.shares;
    bucket.engagement += values.likes + values.comments + values.shares;
    dailyMap.set(day, bucket);
    const post = postMap[publication.post_id];
    const project = projectMap[post?.project_id];
    top.push({
      publicationId: publication.id,
      title: project?.title || 'Untitled',
      platform,
      status: publication.status,
      remoteUrl: publication.remote_url,
      publishedAt: publication.published_at,
      simulated,
      engagementRate: engagementRate(metric),
      ...values,
    });
  }
  top.sort((a, b) => b.views - a.views);
  const recommendations = await db('recommendations').where({ user_id: userId }).whereNull('dismissed_at').orderBy('created_at', 'desc').limit(8);
  const engagement = totals.likes + totals.comments + totals.shares;
  return {
    totals: { ...totals, engagement, engagementRate: totals.views > 0 ? (engagement / totals.views) * 100 : 0 },
    byPlatform: Object.values(byPlatform),
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topPosts: top.slice(0, 8),
    dataQuality: {
      realMetricsCount,
      simulatedMetricsCount,
      publishedWithoutMetrics: publications.filter((p) => p.status === 'published' && !latest.has(p.id)).length,
      note: simulatedMetricsCount ? 'Sandbox metrics are simulated and excluded from data-backed recommendations.' : 'Only metrics returned by official platform APIs are shown.',
    },
    recommendations: recommendations.map((row) => ({
      id: row.id, title: row.title, body: row.body, category: row.category,
      confidence: number(row.confidence), source: row.source, basis: parseJson(row.basis, {}), createdAt: row.created_at,
    })),
  };
}

function averageBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] ||= { key, count: 0, views: 0, engagementRate: 0 };
    groups[key].count += 1;
    groups[key].views += item.views;
    groups[key].engagementRate += item.engagementRate;
  }
  return Object.values(groups).map((group) => ({
    ...group,
    avgViews: Math.round(group.views / group.count),
    avgEngagementRate: Math.round((group.engagementRate / group.count) * 100) / 100,
  })).sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
}

function heuristicRecommendations(aggregate, dataPoints) {
  const recs = [];
  const confidence = Math.min(0.9, 0.35 + dataPoints * 0.04);
  for (const [name, groups, category, phrase] of [
    ['style', aggregate.byStyle, 'creative', 'visual style'],
    ['platform', aggregate.byPlatform, 'distribution', 'platform'],
    ['hour', aggregate.byHour, 'timing', 'posting hour'],
    ['duration', aggregate.byDuration, 'format', 'video length'],
  ]) {
    const best = groups[0];
    if (!best || best.count < 2) continue;
    recs.push({
      title: `Lean into ${best.key} ${phrase === 'visual style' ? '' : phrase}`.replace(/\s+/g, ' ').trim(),
      body: `Across ${best.count} measured posts, ${phrase} "${best.key}" averaged ${best.avgEngagementRate.toFixed(2)}% engagement and ${best.avgViews.toLocaleString()} views. Test it on the next two videos while keeping one variable constant.`,
      category,
      confidence,
      basis: { group: name, key: best.key, samples: best.count, avgEngagementRate: best.avgEngagementRate, avgViews: best.avgViews },
    });
  }
  if (!recs.length) recs.push({
    title: 'Collect a few more measured posts',
    body: 'At least three official metrics snapshots with matching project settings are needed for a reliable comparison. Continue syncing metrics after each publication.',
    category: 'data-quality',
    confidence: 0.3,
    basis: { dataPoints },
  });
  return recs.slice(0, 4);
}

export async function generateRecommendations(userId) {
  const publications = await db('publications').where({ user_id: userId, status: 'published' });
  const publicationIds = publications.map((row) => row.id);
  const metrics = publicationIds.length ? await db('post_metrics').whereIn('publication_id', publicationIds).orderBy('fetched_at', 'desc') : [];
  const latest = latestMetricsMap(metrics);
  const postIds = [...new Set(publications.map((p) => p.post_id))];
  const posts = postIds.length ? await db('posts').whereIn('id', postIds) : [];
  const projectIds = [...new Set(posts.map((p) => p.project_id))];
  const projects = projectIds.length ? await db('projects').whereIn('id', projectIds) : [];
  const accounts = await db('accounts').where({ user_id: userId });
  const postMap = Object.fromEntries(posts.map((p) => [p.id, p]));
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const items = [];
  for (const publication of publications) {
    const metric = latest.get(publication.id);
    if (!metric || isSimulated(metric) || number(metric.views) <= 0) continue;
    const post = postMap[publication.post_id];
    const project = projectMap[post?.project_id];
    const projectConfig = parseJson(project?.config, {});
    const account = accountMap[publication.account_id];
    items.push({
      style: projectConfig.style || 'unknown',
      language: projectConfig.language || 'unknown',
      aspectRatio: projectConfig.aspectRatio || 'unknown',
      duration: number(project?.duration_seconds),
      durationBucket: number(project?.duration_seconds) <= 30 ? '15-30s' : number(project?.duration_seconds) <= 60 ? '31-60s' : '61s+',
      platform: account?.platform || 'unknown',
      hour: post?.scheduled_at ? new Date(post.scheduled_at).getUTCHours() : 'unknown',
      views: number(metric.views),
      engagementRate: engagementRate(metric),
    });
  }
  const aggregate = {
    dataPoints: items.length,
    totals: {
      views: items.reduce((sum, item) => sum + item.views, 0),
      avgEngagementRate: items.length ? items.reduce((sum, item) => sum + item.engagementRate, 0) / items.length : 0,
    },
    byStyle: averageBy(items, (item) => item.style),
    byPlatform: averageBy(items, (item) => item.platform),
    byHour: averageBy(items, (item) => `${item.hour}:00 UTC`),
    byDuration: averageBy(items, (item) => item.durationBucket),
    byLanguage: averageBy(items, (item) => item.language),
  };
  let recs;
  let source = 'local-data';
  if (items.length < 3) {
    source = 'baseline';
    recs = [{
      title: 'Connect official channels for data-backed advice',
      body: `There are ${items.length} usable official metrics snapshots. Publish through connected official accounts and let metrics sync before relying on performance recommendations.`,
      category: 'data-quality',
      confidence: 0.2,
      basis: { dataPoints: items.length },
    }, {
      title: 'Keep the first three seconds explicit',
      body: 'Baseline short-form guidance: state the outcome or mystery in the opening line, then use captions and a visual change every two to three seconds.',
      category: 'creative',
      confidence: 0.2,
      basis: { source: 'industry-baseline', notDerivedFromUserMetrics: true },
    }, {
      title: 'Review factual niches before autopilot',
      body: 'For news, history, and true crime, keep review mode enabled until you have verified sources and platform-specific captions for at least one publishing cycle.',
      category: 'safety',
      confidence: 0.2,
      basis: { source: 'policy-baseline' },
    }];
  } else if (config.ai.provider !== 'local') {
    try {
      const llm = await llmRecommendations(aggregate);
      recs = llm.slice(0, 5).map((item) => ({
        title: String(item.title || 'Recommendation').slice(0, 220),
        body: String(item.body || '').slice(0, 1000),
        category: String(item.category || 'general').slice(0, 60),
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
        basis: { aiBasis: item.basis || null, aggregate },
      }));
      source = `ai:${config.ai.provider}`;
    } catch (error) {
      logger.warn({ error: error.message, userId }, 'AI recommendations failed; using local statistical recommendations');
      recs = heuristicRecommendations(aggregate, items.length);
    }
  } else {
    recs = heuristicRecommendations(aggregate, items.length);
  }
  const today = new Date().toISOString().slice(0, 10);
  await db('recommendations').where({ user_id: userId }).whereNull('dismissed_at').where('created_at', '>=', `${today}T00:00:00.000Z`).delete();
  for (const rec of recs.slice(0, 5)) {
    await db('recommendations').insert({
      id: newId('rec_'), user_id: userId, title: rec.title, body: rec.body,
      category: rec.category, confidence: rec.confidence, source,
      basis: json(rec.basis || {}), created_at: now(),
    });
  }
  return { generated: Math.min(recs.length, 5), source, dataPoints: items.length };
}

export async function requestMetricsSync(userId, userRole = 'user') {
  const query = db('publications').where({ status: 'published' });
  if (userRole !== 'admin') query.where({ user_id: userId });
  const publications = await query.limit(200);
  let queued = 0;
  for (const publication of publications) {
    const jobId = await addJob('sync_metrics', { publicationId: publication.id, userId: publication.user_id, reason: 'manual' }, {
      dedupeKey: `metrics:${publication.id}:manual:${Date.now()}:${crypto.randomUUID().slice(0, 6)}`,
      priority: 8,
    });
    if (jobId) queued += 1;
  }
  return { queued };
}
