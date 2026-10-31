import knexFactory from 'knex';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { hashPassword, encrypt } from './security.js';
import { logger } from './logger.js';
import { deliverNotificationWebhook } from './services/notificationWebhook.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = knexFactory(config.databaseUrl ? {
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 1, max: 10 },
} : {
  client: 'better-sqlite3',
  connection: { filename: config.dbPath },
  useNullAsDefault: true,
  pool: { min: 1, max: 1, afterCreate: (conn, done) => {
    try { conn.pragma('journal_mode = WAL'); conn.pragma('foreign_keys = ON'); conn.pragma('busy_timeout = 5000'); } catch {}
    done(null, conn);
  } },
});

export const isPostgres = Boolean(config.databaseUrl);

export const now = () => new Date().toISOString();
export const newId = (prefix = '') => `${prefix}${crypto.randomUUID()}`;
export const json = (value) => JSON.stringify(value ?? {});
export function parseJson(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
export const bool = (value) => value === true || value === 1 || value === '1' || value === 'true';
export const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const tableDefinitions = {
  users: (t) => {
    t.string('id', 48).primary();
    t.string('email', 320).notNullable().unique();
    t.string('name', 180).notNullable();
    t.text('password_hash').notNullable();
    t.string('role', 20).notNullable().defaultTo('user');
    t.string('plan_id', 48).notNullable().defaultTo('starter');
    t.string('status', 20).notNullable().defaultTo('active');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('last_login_at', 40);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.index(['status']);
  },
  sessions: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('token_hash', 64).notNullable().unique();
    t.string('expires_at', 40).notNullable();
    t.string('created_at', 40).notNullable();
    t.string('user_agent', 300);
    t.string('ip', 100);
  },
  plans: (t) => {
    t.string('id', 48).primary();
    t.string('name', 100).notNullable();
    t.integer('price_cents').notNullable().defaultTo(0);
    t.string('currency', 10).notNullable().defaultTo('USD');
    t.string('interval', 20).notNullable().defaultTo('month');
    t.integer('max_videos_month').notNullable().defaultTo(5);
    t.integer('max_render_seconds_month').notNullable().defaultTo(300);
    t.integer('max_posts_month').notNullable().defaultTo(20);
    t.integer('max_accounts').notNullable().defaultTo(2);
    t.integer('max_projects').notNullable().defaultTo(20);
    t.text('features').notNullable().defaultTo('[]');
    t.string('stripe_price_id', 120);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
  },
  oauth_states: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable();
    t.string('provider', 30).notNullable();
    t.string('state', 160).notNullable().unique();
    t.text('code_verifier');
    t.text('redirect_url');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('expires_at', 40).notNullable();
    t.string('consumed_at', 40);
    t.string('created_at', 40).notNullable();
  },
  accounts: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('platform', 30).notNullable();
    t.string('external_id', 160).notNullable();
    t.string('display_name', 180).notNullable();
    t.string('handle', 160);
    t.text('avatar_url');
    t.string('status', 30).notNullable().defaultTo('connected');
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('automation_enabled').notNullable().defaultTo(true);
    t.text('credentials').notNullable();
    t.text('scopes').notNullable().defaultTo('[]');
    t.string('token_expires_at', 40);
    t.text('permissions').notNullable().defaultTo('[]');
    t.text('metadata').notNullable().defaultTo('{}');
    t.text('last_error');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.string('last_verified_at', 40);
    t.unique(['user_id', 'platform', 'external_id']);
  },
  schedules: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('name', 120).notNullable();
    t.string('frequency', 20).notNullable();
    t.string('time_of_day', 8).notNullable().defaultTo('09:00');
    t.string('timezone', 80).notNullable().defaultTo('UTC');
    t.text('weekdays').notNullable().defaultTo('[1,2,3,4,5]');
    t.string('cron_expression', 120);
    t.integer('interval_minutes').notNullable().defaultTo(1440);
    t.string('next_run_at', 40);
    t.string('last_run_at', 40);
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('autopilot').notNullable().defaultTo(false);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  niches: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('name', 120).notNullable();
    t.string('slug', 140).notNullable();
    t.text('description');
    t.text('config').notNullable().defaultTo('{}');
    t.boolean('autopilot').notNullable().defaultTo(false);
    t.boolean('review_required').notNullable().defaultTo(true);
    t.integer('posting_limit_per_day').notNullable().defaultTo(2);
    t.string('schedule_id', 48);
    t.boolean('active').notNullable().defaultTo(true);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['user_id', 'slug']);
  },
  projects: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('niche_id', 48).index();
    t.string('title', 220).notNullable();
    t.string('topic', 500).notNullable();
    t.string('status', 30).notNullable().defaultTo('draft');
    t.string('stage', 40).notNullable().defaultTo('queued');
    t.integer('progress').notNullable().defaultTo(0);
    t.text('config').notNullable().defaultTo('{}');
    t.text('script');
    t.text('scenes').notNullable().defaultTo('[]');
    t.text('metadata').notNullable().defaultTo('{}');
    t.text('sources').notNullable().defaultTo('[]');
    t.text('video_path');
    t.text('thumbnail_path');
    t.text('caption_path');
    t.text('audio_path');
    t.integer('duration_seconds').notNullable().defaultTo(0);
    t.text('error');
    t.text('provider_summary').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.string('completed_at', 40);
    t.index(['user_id', 'created_at']);
  },
  posts: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('project_id', 48).notNullable().index();
    t.string('scheduled_at', 40).notNullable();
    t.string('status', 30).notNullable().defaultTo('draft');
    t.boolean('review_required').notNullable().defaultTo(true);
    t.string('reviewed_at', 40);
    t.text('captions').notNullable().defaultTo('{}');
    t.text('hashtags').notNullable().defaultTo('{}');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  publications: (t) => {
    t.string('id', 48).primary();
    t.string('post_id', 48).notNullable().index();
    t.string('account_id', 48).notNullable().index();
    t.string('user_id', 48).notNullable().index();
    t.string('status', 30).notNullable().defaultTo('pending');
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('max_attempts').notNullable().defaultTo(5);
    t.string('idempotency_key', 80).notNullable().unique();
    t.string('ref_code', 24).notNullable();
    t.text('remote_id');
    t.text('remote_url');
    t.text('remote_data').notNullable().defaultTo('{}');
    t.text('last_error');
    t.string('error_code', 80);
    t.string('next_attempt_at', 40);
    t.string('published_at', 40);
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['post_id', 'account_id']);
    t.index(['status', 'next_attempt_at']);
  },
  jobs: (t) => {
    t.string('id', 48).primary();
    t.string('type', 60).notNullable();
    t.text('payload').notNullable();
    t.string('status', 30).notNullable().defaultTo('queued');
    t.string('run_at', 40).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('max_attempts').notNullable().defaultTo(5);
    t.integer('priority').notNullable().defaultTo(0);
    t.string('dedupe_key', 180).unique();
    t.string('locked_at', 40);
    t.string('locked_by', 100);
    t.text('last_error');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.string('completed_at', 40);
    t.index(['status', 'run_at', 'priority']);
  },
  notifications: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('type', 40).notNullable();
    t.string('title', 220).notNullable();
    t.text('body').notNullable();
    t.text('action_url');
    t.string('read_at', 40);
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.index(['user_id', 'created_at']);
  },
  contact_messages: (t) => {
    t.string('id', 48).primary();
    t.string('name', 180).notNullable();
    t.string('email', 320).notNullable();
    t.string('topic', 80).notNullable();
    t.text('message').notNullable();
    t.string('status', 32).notNullable().defaultTo('new');
    t.string('ip', 120);
    t.text('user_agent');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['status', 'created_at']);
  },
  post_metrics: (t) => {
    t.string('id', 48).primary();
    t.string('publication_id', 48).notNullable().index();
    t.integer('views').notNullable().defaultTo(0);
    t.integer('likes').notNullable().defaultTo(0);
    t.integer('comments').notNullable().defaultTo(0);
    t.integer('shares').notNullable().defaultTo(0);
    t.integer('impressions').notNullable().defaultTo(0);
    t.integer('watch_seconds').notNullable().defaultTo(0);
    t.decimal('engagement_rate', 8, 4).notNullable().defaultTo(0);
    t.text('raw').notNullable().defaultTo('{}');
    t.string('fetched_at', 40).notNullable();
    t.index(['publication_id', 'fetched_at']);
  },
  recommendations: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('title', 220).notNullable();
    t.text('body').notNullable();
    t.string('category', 60).notNullable();
    t.decimal('confidence', 5, 2).notNullable().defaultTo(0);
    t.string('source', 40).notNullable();
    t.text('basis').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('dismissed_at', 40);
  },
  usage_counters: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable();
    t.string('period', 7).notNullable();
    t.integer('videos').notNullable().defaultTo(0);
    t.integer('render_seconds').notNullable().defaultTo(0);
    t.integer('tts_characters').notNullable().defaultTo(0);
    t.integer('posts').notNullable().defaultTo(0);
    t.integer('ai_requests').notNullable().defaultTo(0);
    t.string('updated_at', 40).notNullable();
    t.unique(['user_id', 'period']);
  },
  settings: (t) => {
    t.string('key', 120).primary();
    t.text('value').notNullable();
    t.string('updated_at', 40).notNullable();
    t.string('updated_by', 48);
  },
  audit_logs: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).index();
    t.string('action', 100).notNullable();
    t.string('entity_type', 80);
    t.string('entity_id', 80);
    t.text('details').notNullable().defaultTo('{}');
    t.string('ip', 100);
    t.string('created_at', 40).notNullable();
  },
  webhook_events: (t) => {
    t.string('id', 48).primary();
    t.string('provider', 40).notNullable();
    t.string('event_id', 200).notNullable().unique();
    t.text('payload').notNullable().defaultTo('{}');
    t.string('processed_at', 40);
    t.string('created_at', 40).notNullable();
  },
  sandbox_posts: (t) => {
    t.string('id', 48).primary();
    t.string('account_id', 48).notNullable();
    t.string('remote_id', 120).notNullable().unique();
    t.string('ref_code', 24).notNullable().unique();
    t.text('caption').notNullable();
    t.text('metadata').notNullable().defaultTo('{}');
    t.text('video_path');
    t.integer('views').notNullable().defaultTo(0);
    t.integer('likes').notNullable().defaultTo(0);
    t.integer('comments').notNullable().defaultTo(0);
    t.integer('shares').notNullable().defaultTo(0);
    t.string('created_at', 40).notNullable();
  },

  // ---- AI filmmaking -----------------------------------------------------
  film_series: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('title', 220).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.string('genre', 60).notNullable().defaultTo('drama');
    t.string('language', 12).notNullable().defaultTo('en');
    t.string('style', 60).notNullable().defaultTo('cinematic');
    t.text('story_bible').notNullable().defaultTo('{}');
    t.string('status', 30).notNullable().defaultTo('active');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  film_projects: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('series_id', 48).index();
    t.integer('season_number').notNullable().defaultTo(0);
    t.integer('episode_number').notNullable().defaultTo(0);
    t.string('type', 30).notNullable().defaultTo('short_drama');
    t.string('title', 220).notNullable();
    t.text('logline').notNullable().defaultTo('');
    t.string('genre', 60).notNullable().defaultTo('drama');
    t.string('language', 12).notNullable().defaultTo('en');
    t.string('style', 60).notNullable().defaultTo('cinematic');
    t.string('aspect_ratio', 10).notNullable().defaultTo('9:16');
    t.string('target_platform', 40).notNullable().defaultTo('tiktok');
    t.integer('target_duration_seconds').notNullable().defaultTo(60);
    t.text('story_bible').notNullable().defaultTo('{}');
    t.text('screenplay').notNullable().defaultTo('{}');
    t.text('reference_image_path');
    t.text('music_path');
    t.string('status', 30).notNullable().defaultTo('draft');
    t.string('stage', 40).notNullable().defaultTo('draft');
    t.integer('progress').notNullable().defaultTo(0);
    t.text('detail');
    t.integer('credits_estimated').notNullable().defaultTo(0);
    t.integer('credits_spent').notNullable().defaultTo(0);
    t.text('final_video_path');
    t.text('thumbnail_path');
    t.text('poster_path');
    t.string('brand_kit_id', 48);
    t.text('ad_variants').notNullable().defaultTo('[]');
    t.text('caption_path');
    t.integer('duration_seconds').notNullable().defaultTo(0);
    t.text('error');
    t.text('metadata').notNullable().defaultTo('{}');
    // Long-form production state (additive; existing rows read as idle/none).
    t.string('run_state', 30).notNullable().defaultTo('idle');
    t.string('scene_provider', 60);
    t.integer('assembly_cancel_requested').notNullable().defaultTo(0);
    t.string('run_started_at', 40);
    t.string('run_stopped_at', 40);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.string('completed_at', 40);
    t.index(['user_id', 'status']);
  },
  film_characters: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('film_id', 48).index();
    t.string('series_id', 48).index();
    t.string('name', 120).notNullable();
    t.string('role', 60).notNullable().defaultTo('supporting');
    t.text('description').notNullable().defaultTo('');
    t.text('appearance_prompt').notNullable().defaultTo('');
    t.string('voice_preset', 60).notNullable().defaultTo('nova');
    // Character depth: wardrobe, expression takes, relationships and reuse.
    t.text('wardrobe').notNullable().defaultTo('');
    t.text('expressions').notNullable().defaultTo('[]');
    t.text('relationships').notNullable().defaultTo('[]');
    t.string('age_range', 40).notNullable().defaultTo('');
    t.integer('is_library').notNullable().defaultTo(0);
    t.string('voice_provider', 60);
    t.text('reference_image_path');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['user_id', 'film_id']);
  },
  film_locations: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('film_id', 48).index();
    t.string('series_id', 48).index();
    t.string('name', 160).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.string('time_of_day', 60).notNullable().defaultTo('');
    t.string('weather', 60).notNullable().defaultTo('');
    t.string('palette', 120).notNullable().defaultTo('');
    t.string('style', 60).notNullable().defaultTo('');
    t.text('reference_image_path');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['user_id', 'film_id']);
    t.index(['user_id', 'series_id']);
  },
  film_scenes: (t) => {
    t.string('id', 48).primary();
    t.string('film_id', 48).notNullable().index();
    t.integer('ordinal').notNullable();
    t.string('slug', 120).notNullable().defaultTo('');
    t.string('heading', 220).notNullable().defaultTo('');
    t.string('location', 220).notNullable().defaultTo('');
    t.string('location_id', 48).index();
    t.string('time_of_day', 60).notNullable().defaultTo('');
    // Cinematography controls (validated vocabularies in film/cinematography.js).
    t.string('shot_size', 60).notNullable().defaultTo('');
    t.string('camera_angle', 60).notNullable().defaultTo('');
    t.string('lens', 40).notNullable().defaultTo('');
    t.string('lighting', 60).notNullable().defaultTo('');
    t.string('color_grade', 60).notNullable().defaultTo('');
    t.text('composition').notNullable().defaultTo('');
    t.text('description').notNullable().defaultTo('');
    t.text('dialogue').notNullable().defaultTo('[]');
    t.string('camera_movement', 120).notNullable().defaultTo('');
    t.text('visual_prompt').notNullable().defaultTo('');
    t.integer('duration_seconds').notNullable().defaultTo(6);
    t.string('status', 30).notNullable().defaultTo('draft');
    t.string('stage', 40).notNullable().defaultTo('draft');
    t.integer('progress').notNullable().defaultTo(0);
    t.text('detail');
    t.text('clip_path');
    t.text('poster_path');
    t.text('voice_path');
    t.string('provider', 60);
    t.string('provider_job_id', 200);
    t.text('provider_handle');
    t.integer('credits_cost').notNullable().defaultTo(0);
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('error');
    // Continuity + sound design for long-form production (additive).
    t.text('cast').notNullable().defaultTo('[]');
    t.text('sfx').notNullable().defaultTo('[]');
    t.integer('cancel_requested').notNullable().defaultTo(0);
    t.string('queued_at', 40);
    // Multi-track edit: text overlay, speed ramp, local VFX preset, lip-sync provenance.
    t.text('overlay_json');
    t.decimal('speed_factor', 5, 2).notNullable().defaultTo(1);
    t.string('vfx_preset', 40).notNullable().defaultTo('none');
    t.string('lipsync_provider', 60);
    t.string('lipsync_at', 40);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['film_id', 'ordinal']);
  },
  film_storyboard_frames: (t) => {
    t.string('id', 48).primary();
    t.string('film_id', 48).notNullable().index();
    t.string('scene_id', 48).index();
    t.string('kind', 20).notNullable().defaultTo('scene');
    t.string('character_id', 48).index();
    t.text('path');
    t.string('provider', 60);
    t.integer('width').notNullable().defaultTo(0);
    t.integer('height').notNullable().defaultTo(0);
    t.text('prompt');
    t.string('status', 20).notNullable().defaultTo('ready');
    t.text('error');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['film_id', 'scene_id', 'kind']);
  },
  film_flows: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('film_id', 48).index();
    t.string('name', 160).notNullable().defaultTo('Untitled flow');
    t.text('graph').notNullable().defaultTo('{}');
    t.string('status', 30).notNullable().defaultTo('draft');
    t.text('last_run');
    t.string('last_run_at', 40);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  film_props: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('film_id', 48).index();
    t.string('name', 160).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.string('category', 60).notNullable().defaultTo('prop');
    t.string('material', 80).notNullable().defaultTo('');
    t.string('color', 60).notNullable().defaultTo('');
    t.text('reference_image_path');
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  film_scene_props: (t) => {
    t.string('film_id', 48).notNullable().index();
    t.string('scene_id', 48).notNullable().index();
    t.string('prop_id', 48).notNullable().index();
    t.string('state', 120).notNullable().defaultTo('');
    t.string('created_at', 40).notNullable();
    t.unique(['scene_id', 'prop_id']);
  },
  brand_kits: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.string('name', 160).notNullable();
    t.string('product', 160).notNullable().defaultTo('');
    t.text('tagline').notNullable().defaultTo('');
    t.text('description').notNullable().defaultTo('');
    t.string('audience', 220).notNullable().defaultTo('');
    t.text('colors').notNullable().defaultTo('[]');
    t.text('logo_path');
    t.text('product_image_path');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  provider_settings: (t) => {
    t.string('id', 60).primary();
    t.integer('enabled').notNullable().defaultTo(1);
    t.string('updated_by', 48);
    t.string('updated_at', 40).notNullable();
  },
  film_productions: (t) => {
    t.string('id', 48).primary();
    t.string('film_id', 48).notNullable().unique();
    t.string('user_id', 48).notNullable().index();
    t.text('brief').notNullable().defaultTo('');
    t.string('status', 30).notNullable().defaultTo('draft');
    t.string('current_stage', 40).notNullable().defaultTo('analyze');
    t.text('plan').notNullable().defaultTo('{}');
    t.text('stages').notNullable().defaultTo('{}');
    t.text('options').notNullable().defaultTo('{}');
    t.integer('retries').notNullable().defaultTo(0);
    t.text('error');
    t.string('completed_at', 40);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  },
  film_episodes: (t) => {
    t.string('id', 48).primary();
    t.string('series_id', 48).notNullable().index();
    t.string('user_id', 48).notNullable().index();
    t.string('film_id', 48).index();
    t.integer('season_number').notNullable().defaultTo(1);
    t.integer('episode_number').notNullable();
    t.string('title', 220).notNullable();
    t.text('synopsis').notNullable().defaultTo('');
    t.string('status', 30).notNullable().defaultTo('draft');
    t.text('continuity_notes').notNullable().defaultTo('');
    t.string('thumbnail_path');
    t.text('credits').notNullable().defaultTo('[]');
    t.string('published_at', 40);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['series_id', 'season_number', 'episode_number']);
  },
  credit_accounts: (t) => {
    t.string('user_id', 48).primary();
    t.integer('balance').notNullable().defaultTo(0);
    t.string('updated_at', 40).notNullable();
  },
  credit_ledger: (t) => {
    t.string('id', 48).primary();
    t.string('user_id', 48).notNullable().index();
    t.integer('amount').notNullable();
    t.string('reason', 60).notNullable();
    t.string('reference_type', 60);
    t.string('reference_id', 120);
    t.string('idempotency_key', 200).notNullable().unique();
    t.text('metadata').notNullable().defaultTo('{}');
    t.string('created_at', 40).notNullable();
  },
};

export const defaultPlans = [
  { id: 'free', name: 'Free', price_cents: 0, max_videos_month: 3, max_render_seconds_month: 180, max_posts_month: 9, max_accounts: 1, max_projects: 10, features: ['3 videos / month', 'Local preview renderer', 'Sandbox publisher', 'Manual review'], sort_order: 1 },
  { id: 'starter', name: 'Starter', price_cents: 1900, max_videos_month: 20, max_render_seconds_month: 1200, max_posts_month: 80, max_accounts: 4, max_projects: 100, features: ['20 videos / month', 'All official integrations', 'Scheduling and retries', 'Analytics sync'], sort_order: 2 },
  { id: 'creator', name: 'Creator', price_cents: 4900, max_videos_month: 75, max_render_seconds_month: 5400, max_posts_month: 300, max_accounts: 12, max_projects: 500, features: ['75 videos / month', 'Autopilot schedules', 'Priority render queue', 'AI recommendations'], sort_order: 3 },
  { id: 'scale', name: 'Scale', price_cents: 14900, max_videos_month: 300, max_render_seconds_month: 24000, max_posts_month: 1200, max_accounts: 50, max_projects: 2500, features: ['300 videos / month', 'High concurrency', 'Advanced analytics', 'Bring your own AI keys'], sort_order: 4 },
];

export const defaultSettings = {
  allow_signups: true,
  maintenance_mode: false,
  default_review_required: true,
  autopilot_enabled: true,
  default_privacy: 'public',
  max_publish_retries: 5,
  metrics_sync_interval_hours: 6,
  caption_reference_codes: true,
  content_policy: 'Generate original scripts and respect platform policies. Review news and true-crime claims before publication.',
  supported_languages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'zh'],
  supported_platforms: ['sandbox', 'facebook', 'youtube', 'instagram', 'x'],
};

export async function initializeDatabase(database, options = {}) {
  const {
    seedDemo = config.seedDemo,
    adminEmail = config.adminEmail,
    adminPassword = config.adminPassword,
    log = logger,
  } = options;
  for (const [name, definition] of Object.entries(tableDefinitions)) {
    if (!await database.schema.hasTable(name)) {
      await database.schema.createTable(name, definition);
      log.info({ table: name }, 'Created database table');
    }
  }
  // The filmmaking tables are new; keep partial/early installs upgradeable.
  const filmColumns = {
    film_projects: {
      progress: (t) => t.integer('progress').notNullable().defaultTo(0),
      poster_path: (t) => t.text('poster_path'),
      brand_kit_id: (t) => t.string('brand_kit_id', 48),
      ad_variants: (t) => t.text('ad_variants').notNullable().defaultTo('[]'),
      detail: (t) => t.text('detail'),
      reference_image_path: (t) => t.text('reference_image_path'),
      music_path: (t) => t.text('music_path'),
      run_state: (t) => t.string('run_state', 30).notNullable().defaultTo('idle'),
      scene_provider: (t) => t.string('scene_provider', 60),
      assembly_cancel_requested: (t) => t.integer('assembly_cancel_requested').notNullable().defaultTo(0),
      run_started_at: (t) => t.string('run_started_at', 40),
      run_stopped_at: (t) => t.string('run_stopped_at', 40),
    },
    film_scenes: {
      progress: (t) => t.integer('progress').notNullable().defaultTo(0),
      detail: (t) => t.text('detail'),
      provider_handle: (t) => t.text('provider_handle'),
      cast: (t) => t.text('cast').notNullable().defaultTo('[]'),
      sfx: (t) => t.text('sfx').notNullable().defaultTo('[]'),
      cancel_requested: (t) => t.integer('cancel_requested').notNullable().defaultTo(0),
      queued_at: (t) => t.string('queued_at', 40),
      location_id: (t) => t.string('location_id', 48),
      shot_size: (t) => t.string('shot_size', 60).notNullable().defaultTo(''),
      camera_angle: (t) => t.string('camera_angle', 60).notNullable().defaultTo(''),
      lens: (t) => t.string('lens', 40).notNullable().defaultTo(''),
      lighting: (t) => t.string('lighting', 60).notNullable().defaultTo(''),
      color_grade: (t) => t.string('color_grade', 60).notNullable().defaultTo(''),
      composition: (t) => t.text('composition').notNullable().defaultTo(''),
      storyboard_path: (t) => t.text('storyboard_path'),
      storyboard_provider: (t) => t.string('storyboard_provider', 60),
      storyboard_at: (t) => t.string('storyboard_at', 40),
      voice_provider: (t) => t.string('voice_provider', 60),
      voice_duration: (t) => t.decimal('voice_duration', 8, 2).notNullable().defaultTo(0),
      voice_at: (t) => t.string('voice_at', 40),
      trim_start: (t) => t.decimal('trim_start', 6, 2).notNullable().defaultTo(0),
      trim_end: (t) => t.decimal('trim_end', 6, 2).notNullable().defaultTo(0),
      transition: (t) => t.string('transition', 30).notNullable().defaultTo('cut'),
      overlay_json: (t) => t.text('overlay_json'),
      speed_factor: (t) => t.decimal('speed_factor', 5, 2).notNullable().defaultTo(1),
      vfx_preset: (t) => t.string('vfx_preset', 40).notNullable().defaultTo('none'),
      lipsync_provider: (t) => t.string('lipsync_provider', 60),
      lipsync_at: (t) => t.string('lipsync_at', 40),
    },
    brand_kits: {
      product_image_path: (t) => t.text('product_image_path'),
    },
    film_characters: {
      wardrobe: (t) => t.text('wardrobe').notNullable().defaultTo(''),
      expressions: (t) => t.text('expressions').notNullable().defaultTo('[]'),
      relationships: (t) => t.text('relationships').notNullable().defaultTo('[]'),
      age_range: (t) => t.string('age_range', 40).notNullable().defaultTo(''),
      is_library: (t) => t.integer('is_library').notNullable().defaultTo(0),
    },
  };
  for (const [table, columns] of Object.entries(filmColumns)) {
    if (!await database.schema.hasTable(table)) continue;
    for (const [column, define] of Object.entries(columns)) {
      if (!await database.schema.hasColumn(table, column)) {
        await database.schema.alterTable(table, (t) => define(t));
        log.info({ table, column }, 'Added film column');
      }
    }
  }
  for (const plan of defaultPlans) {
    await database('plans').insert({ ...plan, features: json(plan.features), active: true, currency: 'USD', interval: 'month' })
      .onConflict('id').ignore();
  }
  for (const [key, value] of Object.entries(defaultSettings)) {
    await database('settings').insert({ key, value: json(value), updated_at: now(), updated_by: 'system' })
      .onConflict('key').ignore();
  }
  if (seedDemo) {
    const timestamp = now();
    const demo = await database('users').where({ email: config.demoEmail.toLowerCase() }).first();
    if (!demo) {
      const demoId = newId('usr_');
      await database('users').insert({
        id: demoId,
        email: config.demoEmail.toLowerCase(),
        name: 'Demo Creator',
        password_hash: hashPassword(config.demoPassword),
        role: 'user',
        plan_id: 'creator',
        status: 'active',
        metadata: json({ seeded: true }),
        created_at: timestamp,
      });
      await database('niches').insert({
        id: newId('nic_'), user_id: demoId, name: 'History Mysteries', slug: 'history-mysteries',
        description: 'Short documentaries about overlooked historical events.',
        config: json({ style: 'cinematic', language: 'en', voice: 'nova', aspectRatio: '9:16', duration: 45, platforms: ['sandbox'] }),
        autopilot: false, review_required: false, posting_limit_per_day: 3, active: true,
        created_at: timestamp, updated_at: timestamp,
      });
      await database('accounts').insert({
        id: newId('acc_'), user_id: demoId, platform: 'sandbox', external_id: 'sandbox-demo',
        display_name: 'Sandbox Test Channel', handle: '@sandbox-demo', status: 'connected',
        active: true, automation_enabled: true, credentials: encrypt({ accessToken: 'local-sandbox-token', mode: 'local' }),
        scopes: json(['sandbox.publish', 'sandbox.metrics']), permissions: json(['publish', 'metrics']),
        metadata: json({ seeded: true, note: 'Local HTTP test publisher, not a social network.' }),
        created_at: timestamp, updated_at: timestamp, last_verified_at: timestamp,
      });
      log.warn({ email: config.demoEmail }, 'Seeded demo user. Disable SEED_DEMO in production.');
    }
  }
  if (adminEmail && adminPassword) {
    const existing = await database('users').where({ email: adminEmail.toLowerCase() }).first();
    if (!existing) {
      await database('users').insert({
        id: newId('usr_'), email: adminEmail.toLowerCase(), name: 'Platform Administrator',
        password_hash: hashPassword(adminPassword), role: 'admin', plan_id: 'scale',
        status: 'active', metadata: json({ seeded: true }), created_at: now(),
      });
      log.warn({ email: adminEmail }, 'Seeded administrator. Rotate ADMIN_PASSWORD after first login.');
    }
  }
  await database('oauth_states').where('expires_at', '<', now()).del();
  await database('sessions').where('expires_at', '<', now()).del();
}

export async function initDb() {
  return initializeDatabase(db);
}

export async function getSetting(key, fallback = null) {
  const row = await db('settings').where({ key }).first();
  return row ? parseJson(row.value, fallback) : fallback;
}
export async function setSetting(key, value, userId = null) {
  await db('settings').insert({ key, value: json(value), updated_at: now(), updated_by: userId })
    .onConflict('key').merge({ value: json(value), updated_at: now(), updated_by: userId });
  return value;
}
export async function allSettings() {
  const rows = await db('settings').select('*');
  return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value)]));
}

export async function getPlan(planId) {
  const row = await db('plans').where({ id: planId }).first();
  if (row) return { ...row, features: parseJson(row.features, []), active: bool(row.active) };
  return { ...defaultPlans[1], features: parseJson(defaultPlans[1].features, []), active: true };
}

export function currentPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getUsage(userId, period = currentPeriod()) {
  const id = `${userId}:${period}`;
  await db('usage_counters').insert({ id, user_id: userId, period, updated_at: now() }).onConflict('id').ignore();
  const row = await db('usage_counters').where({ id }).first();
  return {
    period, videos: number(row.videos), render_seconds: number(row.render_seconds),
    tts_characters: number(row.tts_characters), posts: number(row.posts), ai_requests: number(row.ai_requests),
  };
}

export async function incrementUsage(userId, increments = {}, period = currentPeriod()) {
  const id = `${userId}:${period}`;
  await db('usage_counters').insert({ id, user_id: userId, period, updated_at: now() }).onConflict('id').ignore();
  const allowed = ['videos', 'render_seconds', 'tts_characters', 'posts', 'ai_requests'];
  const update = { updated_at: now() };
  for (const key of allowed) if (increments[key]) await db('usage_counters').where({ id }).increment(key, increments[key]);
  if (Object.keys(update).length > 0) await db('usage_counters').where({ id }).update(update);
  return getUsage(userId, period);
}

export async function checkQuota(userId, resource, amount = 1) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new Error('User not found');
  const plan = await getPlan(user.plan_id);
  const usage = await getUsage(userId);
  const map = {
    videos: ['videos', 'max_videos_month', 'video generations'],
    render_seconds: ['render_seconds', 'max_render_seconds_month', 'render seconds'],
    posts: ['posts', 'max_posts_month', 'publications'],
  };
  const entry = map[resource];
  if (!entry) return { allowed: true, plan, usage };
  const [usageKey, limitKey, label] = entry;
  const limit = number(plan[limitKey]);
  if (usage[usageKey] + amount > limit) {
    const error = new Error(`Your ${plan.name} plan allows ${limit} ${label} per month. Upgrade or wait for the next billing period.`);
    error.status = 402;
    error.code = 'quota_exceeded';
    error.plan = plan;
    error.usage = usage;
    throw error;
  }
  return { allowed: true, plan, usage, remaining: limit - usage[usageKey] - amount };
}

export async function addJob(type, payload = {}, options = {}) {
  const id = newId('job_');
  const timestamp = now();
  const row = {
    id, type, payload: json(payload), status: options.status || 'queued',
    run_at: options.runAt || timestamp, attempts: 0,
    max_attempts: options.maxAttempts || config.worker.maxAttempts,
    priority: options.priority || 0, dedupe_key: options.dedupeKey || null,
    created_at: timestamp, updated_at: timestamp,
  };
  if (options.dedupeKey) {
    await db('jobs').insert(row).onConflict('dedupe_key').ignore();
    const existing = await db('jobs').where({ dedupe_key: options.dedupeKey }).first();
    return existing?.id || id;
  }
  await db('jobs').insert(row);
  return id;
}

export async function notify(userId, { type, title, body, actionUrl = null, metadata = {} }) {
  const id = newId('ntf_');
  await db('notifications').insert({
    id, user_id: userId, type, title, body, action_url: actionUrl,
    metadata: json(metadata), created_at: now(),
  });
  if (config.notifications.webhookUrl) {
    const payload = { id, userId, type, title, body, actionUrl, metadata, createdAt: now() };
    deliverNotificationWebhook(payload).catch((error) => logger.warn({ error: error.message }, 'Notification webhook failed'));
  }
  return id;
}

export async function logAudit({ userId = null, action, entityType = null, entityId = null, details = {}, ip = null }) {
  await db('audit_logs').insert({
    id: newId('aud_'), user_id: userId, action, entity_type: entityType, entity_id: entityId,
    details: json(details), ip, created_at: now(),
  });
}

export { logger };

export async function closeDb() {
  await db.destroy();
}
