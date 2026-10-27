import crypto from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { db, now, parseJson, number, bool, addJob, getSetting } from '../db.js';
import { logger } from '../logger.js';
import { queuePostPublications } from './projects.js';

function normalizeTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC' }).format(new Date());
    return timezone || 'UTC';
  } catch { return 'UTC'; }
}

export function computeNextRun(schedule, fromDate = new Date()) {
  const [hourRaw = '9', minuteRaw = '0'] = String(schedule.time_of_day || schedule.timeOfDay || '09:00').split(':');
  const hour = Math.max(0, Math.min(23, Number(hourRaw) || 0));
  const minute = Math.max(0, Math.min(59, Number(minuteRaw) || 0));
  const timezone = normalizeTimezone(schedule.timezone || 'UTC');
  const frequency = schedule.frequency || 'daily';
  let expression;
  if (frequency === 'daily') expression = `${minute} ${hour} * * *`;
  else if (frequency === 'weekly') {
    const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : parseJson(schedule.weekdays, [1, 2, 3, 4, 5]);
    expression = `${minute} ${hour} * * ${weekdays.length ? weekdays.join(',') : '1'}`;
  } else if (schedule.cron_expression || schedule.cronExpression) {
    expression = String(schedule.cron_expression || schedule.cronExpression);
  } else {
    const intervalMinutes = Math.max(15, number(schedule.interval_minutes || schedule.intervalMinutes, 1440));
    const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
    return new Date(base.getTime() + intervalMinutes * 60000).toISOString();
  }
  try {
    const iterator = CronExpressionParser.parse(expression, { currentDate: fromDate, tz: timezone });
    return iterator.next().toDate().toISOString();
  } catch (error) {
    throw new Error(`Invalid schedule (${expression}): ${error.message}`);
  }
}

export async function createSchedule(userId, data) {
  const timestamp = now();
  const id = `sch_${crypto.randomUUID()}`;
  const row = {
    id,
    user_id: userId,
    name: data.name,
    frequency: data.frequency,
    time_of_day: data.timeOfDay,
    timezone: data.timezone,
    weekdays: JSON.stringify(data.weekdays || [1, 2, 3, 4, 5]),
    cron_expression: data.cronExpression || null,
    interval_minutes: data.intervalMinutes || 1440,
    active: data.active !== false,
    autopilot: Boolean(data.autopilot),
    created_at: timestamp,
    updated_at: timestamp,
  };
  row.next_run_at = computeNextRun(row, new Date());
  await db('schedules').insert(row);
  return row;
}

async function queueDuePosts() {
  const duePosts = await db('posts')
    .whereIn('status', ['scheduled', 'processing'])
    .where('scheduled_at', '<=', now())
    .orderBy('scheduled_at', 'asc')
    .limit(100);
  let queued = 0;
  for (const post of duePosts) {
    if (bool(post.review_required)) continue;
    const project = await db('projects').where({ id: post.project_id }).first();
    if (!project || project.status !== 'completed') continue;
    const jobs = await queuePostPublications(post.id, { reason: 'auto' });
    queued += jobs.length;
  }
  return queued;
}

async function queueAutopilotRuns() {
  const due = await db('schedules')
    .where({ active: true, autopilot: true })
    .whereNotNull('next_run_at')
    .where('next_run_at', '<=', now())
    .limit(50);
  let queued = 0;
  for (const schedule of due) {
    const runKey = schedule.next_run_at;
    let nextRunAt;
    try { nextRunAt = computeNextRun(schedule, new Date(runKey)); }
    catch (error) { logger.error({ scheduleId: schedule.id, error: error.message }, 'Invalid autopilot schedule'); nextRunAt = new Date(Date.now() + 86400000).toISOString(); }
    await db('schedules').where({ id: schedule.id }).update({ last_run_at: now(), next_run_at: nextRunAt, updated_at: now() });
    const niches = await db('niches').where({ schedule_id: schedule.id, active: true, autopilot: true });
    for (const niche of niches) {
      await addJob('autopilot_generate', { nicheId: niche.id, scheduleId: schedule.id, runKey }, {
        dedupeKey: `autopilot:${niche.id}:${runKey}`,
        priority: 2,
      });
      queued += 1;
    }
  }
  return queued;
}

async function queueMetricsSync() {
  const intervalHours = Math.max(1, number(await getSetting('metrics_sync_interval_hours', 6), 6));
  const cutoff = new Date(Date.now() - intervalHours * 3600000).toISOString();
  const publications = await db('publications').where({ status: 'published' }).whereNotNull('remote_id').limit(300);
  const ids = publications.map((row) => row.id);
  const metrics = ids.length ? await db('post_metrics').whereIn('publication_id', ids).orderBy('fetched_at', 'desc') : [];
  const latest = new Map();
  for (const metric of metrics) if (!latest.has(metric.publication_id)) latest.set(metric.publication_id, metric);
  const hourKey = new Date().toISOString().slice(0, 13);
  let queued = 0;
  for (const publication of publications) {
    const metric = latest.get(publication.id);
    if (metric && metric.fetched_at >= cutoff) continue;
    await addJob('sync_metrics', { publicationId: publication.id, userId: publication.user_id, reason: 'scheduled' }, {
      dedupeKey: `metrics:${publication.id}:scheduled:${hourKey}`,
      priority: 1,
    });
    queued += 1;
  }
  return queued;
}

async function queueDailyRecommendations() {
  const day = new Date().toISOString().slice(0, 10);
  const users = await db('users').where({ status: 'active' });
  let queued = 0;
  for (const user of users) {
    const published = await db('publications').where({ user_id: user.id, status: 'published' }).first();
    if (!published) continue;
    await addJob('generate_recommendations', { userId: user.id }, {
      dedupeKey: `recommendations:${user.id}:${day}`,
      priority: 0,
    });
    queued += 1;
  }
  return queued;
}

export async function tickScheduler() {
  if (await getSetting('maintenance_mode', false)) return { skipped: 'maintenance_mode' };
  const [posts, autopilot, metrics, recommendations] = await Promise.all([
    queueDuePosts(), queueAutopilotRuns(), queueMetricsSync(), queueDailyRecommendations(),
  ]);
  const result = { at: now(), posts, autopilot, metrics, recommendations };
  if (posts || autopilot || metrics || recommendations) logger.info(result, 'Scheduler tick queued work');
  return result;
}
