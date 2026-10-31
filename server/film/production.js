/**
 * AI Production Agent.
 *
 * One conversational brief becomes a real, resumable production. The agent is
 * an orchestrator, not a second implementation: every stage calls the existing
 * screenplay, location, direction, generation, assembly and QC services.
 *
 * Safety rules baked into this module:
 *  - Cheap, reversible stages (analyse, screenplay, cast, locations, direct)
 *    run automatically when a production starts.
 *  - Anything that spends credits or calls a paid provider (scene generation,
 *    assembly) waits for an explicit human approval.
 *  - A production is never reported as complete until a real MP4 exists.
 *  - Failures are surfaced with the exact scene numbers and a retry action;
 *    nothing is silently retried unless `autoRetry` was requested.
 */
import { z } from 'zod';
import { db, now, json, newId, number, parseJson, addJob } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import {
  FILM_TYPES, FILM_GENRES, FILM_STYLES,
  generateScreenplay, planSceneCount,
} from './screenplay.js';
import {
  ownedFilm, saveScreenplay, listScenes, updateScene,
  requestAllScenes, retryFailedScenes, cancelFilmGeneration,
  requestAssembly, filmDetail,
} from './scenes.js';
import { filmQualityReport } from './continuity.js';
import { getBalance } from './credits.js';

/** Ordered stages. `approval` means a human must confirm before it runs. */
export const PRODUCTION_STAGES = [
  { id: 'analyze', label: 'Understand the brief', approval: false, spendsCredits: false },
  { id: 'screenplay', label: 'Write the screenplay', approval: false, spendsCredits: false },
  { id: 'cast', label: 'Cast the characters', approval: false, spendsCredits: false },
  { id: 'locations', label: 'Build the locations', approval: false, spendsCredits: false },
  { id: 'direct', label: 'Direct every shot', approval: false, spendsCredits: false },
  { id: 'generate', label: 'Generate scene clips', approval: true, spendsCredits: true },
  { id: 'qc', label: 'Continuity & quality check', approval: false, spendsCredits: false },
  { id: 'assemble', label: 'Assemble the film', approval: true, spendsCredits: true },
  { id: 'export', label: 'Prepare export', approval: false, spendsCredits: false },
];

const STAGE_IDS = PRODUCTION_STAGES.map((stage) => stage.id);
const SAFE_STAGES = PRODUCTION_STAGES.filter((stage) => !stage.approval).map((stage) => stage.id);

const LANGUAGE_CODES = {
  english: 'en', french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt',
  italian: 'it', dutch: 'nl', polish: 'pl', turkish: 'tr', chinese: 'zh',
  hindi: 'hi', hausa: 'ha', yoruba: 'yo', igbo: 'ig', swahili: 'sw', arabic: 'ar',
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Parse a free-text production request into a concrete plan.
 * Deterministic and offline: it never invents AI output, and the screenplay
 * stage afterwards decides on its own whether a real LLM is configured.
 */
export function parseBrief(brief) {
  const text = String(brief || '').toLowerCase();
  const minutes = /(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:minute|min\b)/.exec(text);
  const hours = /(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:hour|hr\b)/.exec(text);
  const seconds = /(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:second|sec\b)/.exec(text);
  let durationSeconds = minutes ? Math.round(Number(minutes[1]) * 60)
    : hours ? Math.round(Number(hours[1]) * 3600)
      : seconds ? Math.round(Number(seconds[1]))
        : 60;
  durationSeconds = Math.max(config.film.minProjectSeconds, Math.min(durationSeconds, config.film.maxProjectSeconds));

  let type = 'short_drama';
  if (/music video/.test(text)) type = 'music_video';
  else if (/commercial|advert|\b ad\b|product film|brand film/.test(text)) type = 'advertisement';
  else if (/series|episode|season/.test(text)) type = 'episode';
  else if (/feature|movie/.test(text)) type = 'movie';
  else if (durationSeconds >= 1800) type = 'movie';
  else if (durationSeconds >= 300) type = 'long_drama';
  else if (/trailer|single scene|one scene|cinematic scene/.test(text)) type = 'cinematic_scene';
  if (!FILM_TYPES.includes(type)) type = 'short_drama';

  const genre = FILM_GENRES.find((item) => item !== 'other' && text.includes(item.replace(/_/g, ' ')))
    || (/drama/.test(text) ? 'family_drama' : 'other');
  const style = FILM_STYLES.find((item) => text.includes(item)) || 'cinematic';
  const language = Object.entries(LANGUAGE_CODES).find(([name]) => text.includes(name))?.[1] || 'en';

  const castMatch = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:main\s+|main|recurring\s+|lead\s+|key\s+)?(?:characters|cast|actors|people|leads)/.exec(text);
  const castRaw = castMatch?.[1];
  const castCount = castRaw
    ? (NUMBER_WORDS[castRaw] || Number.parseInt(castRaw, 10) || null)
    : null;

  const words = String(brief || '').trim().split(/\s+/).slice(0, 9).join(' ');
  const title = (words.charAt(0).toUpperCase() + words.slice(1)).replace(/[.:;!?]$/, '').slice(0, 90) || 'Untitled production';

  return {
    title,
    type,
    genre,
    style,
    language,
    durationSeconds,
    castCount: castCount ? Math.max(1, Math.min(20, castCount)) : null,
    scenes: planSceneCount(durationSeconds),
    notes: [],
    aiGenerated: false,
    parser: 'deterministic',
  };
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

function stageState(entry = {}) {
  return {
    status: entry.status || 'pending',
    startedAt: entry.startedAt || null,
    finishedAt: entry.finishedAt || null,
    detail: entry.detail || '',
    data: entry.data || null,
    error: entry.error || null,
  };
}

function readStages(row = {}) {
  const stored = parseJson(row.stages, {}) || {};
  return Object.fromEntries(STAGE_IDS.map((id) => [id, stageState(stored[id])]));
}

async function setStage(filmId, stages, stageId, patch) {
  const next = { ...stages, [stageId]: { ...stages[stageId], ...patch } };
  await db('film_productions').where({ film_id: filmId }).update({ stages: json(next), updated_at: now() });
  return next;
}

async function setRun(filmId, patch) {
  await db('film_productions').where({ film_id: filmId }).update({ ...patch, updated_at: now() });
}

// The deterministic direction palette used when a scene has no shot direction.
const DIRECTION_PALETTE = [
  { shot_size: 'wide', camera_angle: 'high_angle', lens: '24mm', lighting: 'golden_hour', color_grade: 'warm' },
  { shot_size: 'medium', camera_angle: 'eye_level', lens: '50mm', lighting: 'natural', color_grade: 'neutral' },
  { shot_size: 'medium_close', camera_angle: 'low_angle', lens: '85mm', lighting: 'low_key', color_grade: 'teal_orange' },
  { shot_size: 'over_the_shoulder', camera_angle: 'eye_level', lens: '50mm', lighting: 'practical', color_grade: 'cool' },
  { shot_size: 'close_up', camera_angle: 'low_angle', lens: '85mm', lighting: 'rim_light', color_grade: 'high_contrast' },
  { shot_size: 'extreme_wide', camera_angle: 'overhead', lens: '18mm', lighting: 'blue_hour', color_grade: 'desaturated' },
];

/** Derive a saved location per unique on-screen setting and link its scenes. */
async function buildLocations(userId, filmId) {
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  const names = [...new Set(scenes.map((scene) => String(scene.location || '').trim()).filter(Boolean))];
  let created = 0;
  let linked = 0;
  for (const name of names) {
    let location = await db('film_locations')
      .where({ user_id: userId, film_id: filmId })
      .whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
    if (!location) {
      const sample = scenes.find((scene) => scene.location === name);
      const id = newId('loc_');
      await db('film_locations').insert({
        id, user_id: userId, film_id: filmId, series_id: null,
        name: name.slice(0, 160),
        description: String(sample?.description || '').slice(0, 2000),
        time_of_day: sample?.time_of_day || '',
        weather: '', palette: '', style: '',
        metadata: json({ source: 'production-agent' }),
        created_at: now(), updated_at: now(),
      });
      location = await db('film_locations').where({ id }).first();
      created += 1;
    }
    const updated = await db('film_scenes')
      .where({ film_id: filmId, location: name })
      .whereNull('location_id')
      .update({ location_id: location.id, updated_at: now() });
    linked += Number(updated) || 0;
  }
  return { locations: names.length, created, linked };
}

/** Fill missing shot direction deterministically so no scene is undirected. */
async function directScenes(userId, filmId) {
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  let directed = 0;
  let already = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (scene.shot_size && scene.camera_angle) { already += 1; continue; }
    const choice = DIRECTION_PALETTE[index % DIRECTION_PALETTE.length];
    await db('film_scenes').where({ id: scene.id }).update({
      shot_size: scene.shot_size || choice.shot_size,
      camera_angle: scene.camera_angle || choice.camera_angle,
      lens: scene.lens || choice.lens,
      lighting: scene.lighting || choice.lighting,
      color_grade: scene.color_grade || choice.color_grade,
      camera_movement: scene.camera_movement || 'static',
      updated_at: now(),
    });
    directed += 1;
  }
  return { scenes: scenes.length, directed, alreadyDirected: already };
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export const startProductionSchema = z.object({
  brief: z.string().trim().min(10).max(4000),
  title: z.string().trim().min(2).max(220).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).optional(),
  platform: z.string().max(40).optional(),
  autoRetry: z.boolean().optional().default(false),
  maxRetries: z.number().int().min(0).max(3).optional().default(1),
});

/**
 * Create a project from a brief and run the free stages.
 * The expensive stages are left awaiting approval.
 */
export async function startProduction(userId, input = {}, role = 'user') {
  const data = startProductionSchema.parse(input);
  const plan = parseBrief(data.brief);
  const filmId = newId('flm_');
  const timestamp = now();
  await db('film_projects').insert({
    id: filmId,
    user_id: userId,
    type: plan.type,
    title: data.title || plan.title,
    logline: data.brief.slice(0, 1000),
    genre: plan.genre,
    language: plan.language,
    style: plan.style,
    aspect_ratio: data.aspectRatio || (['short_drama', 'advertisement'].includes(plan.type) ? '9:16' : '16:9'),
    target_platform: data.platform || (['short_drama', 'advertisement'].includes(plan.type) ? 'tiktok' : 'youtube'),
    target_duration_seconds: plan.durationSeconds,
    story_bible: json({ world: '', premise: data.brief.slice(0, 2000), themes: [], continuity_notes: '' }),
    screenplay: json({}),
    status: 'draft',
    stage: 'production',
    metadata: json({ voice: 'nova', productionAgent: true }),
    run_state: 'idle',
    created_at: timestamp,
    updated_at: timestamp,
  });

  const stages = Object.fromEntries(STAGE_IDS.map((id) => [id, stageState()]));
  await db('film_productions').insert({
    id: newId('prd_'),
    film_id: filmId,
    user_id: userId,
    brief: data.brief,
    status: 'running',
    current_stage: 'analyze',
    plan: json(plan),
    stages: json(stages),
    options: json({ aspectRatio: data.aspectRatio || null, platform: data.platform || null, autoRetry: data.autoRetry, maxRetries: data.maxRetries }),
    retries: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });

  await runSafeStages(userId, filmId, data.brief, plan, role);
  return productionSnapshot(userId, filmId, role);
}

async function runSafeStages(userId, filmId, brief, plan, role) {
  let stages = readStages(await db('film_productions').where({ film_id: filmId }).first());
  const film = await ownedFilm(userId, filmId, role);

  // analyze ------------------------------------------------------------------
  stages = await setStage(filmId, stages, 'analyze', {
    status: 'done', startedAt: now(), finishedAt: now(),
    detail: `${plan.type.replace(/_/g, ' ')} · ${plan.genre.replace(/_/g, ' ')} · ${Math.round(plan.durationSeconds / 60)} min · ${plan.scenes} scenes${plan.castCount ? ` · ${plan.castCount} leads requested` : ''}.`,
    data: plan,
  });
  await setRun(filmId, { current_stage: 'screenplay' });

  // screenplay ---------------------------------------------------------------
  stages = await setStage(filmId, stages, 'screenplay', { status: 'running', startedAt: now() });
  try {
    const screenplay = await generateScreenplay({
      idea: brief,
      type: film.type,
      genre: film.genre,
      language: film.language,
      style: film.style,
      aspectRatio: film.aspect_ratio,
      platform: film.target_platform,
      targetDurationSeconds: number(film.target_duration_seconds),
      storyBible: parseJson(film.story_bible, {}),
      characters: [],
      allowTemplate: true,
    });
    await saveScreenplay(userId, filmId, screenplay, role);
    stages = await setStage(filmId, stages, 'screenplay', {
      status: 'done', finishedAt: now(),
      detail: `${screenplay.scenes.length} scenes written · ${screenplay.aiGenerated ? `AI (${screenplay.provider})` : 'labelled offline draft (no AI provider configured)'}.`,
      data: { provider: screenplay.provider, aiGenerated: Boolean(screenplay.aiGenerated), scenes: screenplay.scenes.length },
    });
  } catch (error) {
    await setStage(filmId, stages, 'screenplay', { status: 'failed', error: error.message, finishedAt: now() });
    await setRun(filmId, { status: 'blocked', error: error.message });
    return;
  }
  await setRun(filmId, { current_stage: 'cast' });

  // cast ---------------------------------------------------------------------
  stages = await setStage(filmId, stages, 'cast', { status: 'running', startedAt: now() });
  const characters = await db('film_characters').where({ user_id: userId, film_id: filmId });
  const withReferences = characters.filter((character) => character.reference_image_path).length;
  stages = await setStage(filmId, stages, 'cast', {
    status: 'done', finishedAt: now(),
    detail: `${characters.length} character profile(s), ${withReferences} with a reference image.${characters.length && withReferences < characters.length ? ' Upload references in Cast to lock faces across scenes.' : ''}`,
    data: { characters: characters.length, withReferences },
  });
  await setRun(filmId, { current_stage: 'locations' });

  // locations ----------------------------------------------------------------
  stages = await setStage(filmId, stages, 'locations', { status: 'running', startedAt: now() });
  const locations = await buildLocations(userId, filmId);
  stages = await setStage(filmId, stages, 'locations', {
    status: 'done', finishedAt: now(),
    detail: `${locations.locations} unique setting(s): ${locations.created} saved as locations, ${locations.linked} scene(s) linked.`,
    data: locations,
  });
  await setRun(filmId, { current_stage: 'direct' });

  // direct -------------------------------------------------------------------
  stages = await setStage(filmId, stages, 'direct', { status: 'running', startedAt: now() });
  const direction = await directScenes(userId, filmId);
  stages = await setStage(filmId, stages, 'direct', {
    status: 'done', finishedAt: now(),
    detail: `${direction.directed} scene(s) directed, ${direction.alreadyDirected} already had direction.`,
    data: direction,
  });

  // Generation costs credits and calls a paid provider → human approval.
  await setRun(filmId, {
    status: 'awaiting_approval',
    current_stage: 'generate',
    error: null,
  });
}

/** Load the run and verify ownership through the film. */
export async function ownedProduction(userId, filmId, role = 'user') {
  await ownedFilm(userId, filmId, role);
  return db('film_productions').where({ film_id: filmId }).first();
}

function sceneCounts(scenes) {
  const counts = { total: scenes.length, ready: 0, failed: 0, queued: 0, processing: 0, planned: 0, draft: 0, cancelled: 0 };
  for (const scene of scenes) {
    if (scene.status === 'ready') counts.ready += 1;
    else if (scene.status === 'failed') counts.failed += 1;
    else if (counts[scene.status] !== undefined) counts[scene.status] += 1;
  }
  counts.pending = counts.total - counts.ready;
  counts.active = counts.queued + counts.processing;
  return counts;
}

/**
 * Live view of a production. Stage statuses that depend on jobs or the render
 * are derived from the database and disk, not from a stale stored flag.
 */
export async function productionSnapshot(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const row = await db('film_productions').where({ film_id: filmId }).first();
  if (!row) return { production: null, film: filmDetailView(film) };
  const stored = readStages(row);
  const scenes = await db('film_scenes').where({ film_id: filmId }).orderBy('ordinal', 'asc');
  const counts = sceneCounts(scenes);
  const balance = await getBalance(userId);

  const stages = PRODUCTION_STAGES.map((definition) => {
    const state = stageState(stored[definition.id]);
    if (!definition.approval && state.status === 'done') return { ...definition, ...state };
    if (definition.id === 'generate') {
      if (counts.active > 0) return { ...definition, ...state, status: 'running', detail: `${counts.ready}/${counts.total} scenes ready, ${counts.active} in progress.` };
      if (counts.total > 0 && counts.ready === counts.total) return { ...definition, ...state, status: 'done', detail: `All ${counts.total} scenes have real clips.` };
      if (counts.failed > 0) return { ...definition, ...state, status: 'blocked', detail: `${counts.failed} scene(s) failed generation: ${scenes.filter((s) => s.status === 'failed').map((s) => s.ordinal).slice(0, 10).join(', ')}.` };
      return { ...definition, ...state };
    }
    return { ...definition, ...state };
  });

  const byId = Object.fromEntries(stages.map((stage) => [stage.id, stage]));
  const qc = await filmQualityReport(userId, filmId, role);

  if (counts.total > 0 && counts.ready === counts.total) {
    byId.qc = { ...byId.qc, status: qc?.status === 'fail' ? 'blocked' : 'done', detail: `QC ${qc?.status || 'pending'} · ${qc?.score ?? 0}% · ${qc?.summary.warnings ?? 0} warning(s).` };
  } else if (qc) {
    byId.qc = { ...byId.qc, status: 'pending', detail: `QC runs automatically when all clips exist (${counts.ready}/${counts.total} ready).` };
  }
  if (film.final_video_path && film.status !== 'assembling') {
    byId.assemble = { ...byId.assemble, status: 'done', detail: 'Rendered MP4 exists.' };
    byId.export = { ...byId.export, status: 'done', detail: 'Ready to preview, download and publish.' };
  } else if (film.status === 'assembling') {
    byId.assemble = { ...byId.assemble, status: 'running', detail: film.detail || 'Rendering.' };
    byId.export = { ...byId.export, status: 'pending', detail: 'Waiting for the render.' };
  }
  if (byId.assemble.status === 'done' && byId.qc.status !== 'done') {
    byId.qc = { ...byId.qc, status: 'blocked', detail: 'Re-run QC after the render before exporting.' };
  }

  const ordered = PRODUCTION_STAGES.map((definition) => ({ ...definition, ...byId[definition.id] }));
  const nextStage = ordered.find((stage) => !['done', 'skipped'].includes(stage.status)) || null;
  const blocking = ordered.find((stage) => stage.status === 'blocked');
  const failedScenes = scenes.filter((scene) => scene.status === 'failed').map((scene) => scene.ordinal);

  const scheduledJob = await db('jobs').where({ dedupe_key: `film_production_run:${filmId}` }).first();
  const scheduledFor = scheduledJob && ['queued', 'running'].includes(scheduledJob.status) ? scheduledJob.run_at : null;

  let status = row.status;
  if (film.final_video_path && byId.export.status === 'done') status = 'completed';
  else if (row.error) status = 'blocked';
  else if (blocking) status = 'blocked';
  else if (row.status === 'scheduled' && scheduledFor) status = 'scheduled';
  else if (ordered.some((stage) => stage.status === 'running')) status = 'running';
  else if (nextStage?.approval) status = 'awaiting_approval';
  if (row.status === 'cancelled') status = 'cancelled';

  return {
    production: {
      id: row.id,
      filmId,
      brief: row.brief,
      status,
      currentStage: nextStage?.id || 'export',
      nextStage,
      stages: ordered,
      plan: parseJson(row.plan, {}),
      options: parseJson(row.options, {}),
      retries: number(row.retries),
      scheduledFor,
      error: row.error || null,
      failedScenes,
      counts,
      balance,
      qc: qc ? { status: qc.status, score: qc.score, summary: qc.summary, checks: qc.checks } : null,
      canRetry: failedScenes.length > 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: film.completed_at || null,
    },
    film: filmDetailView(film, counts),
  };
}

function filmDetailView(film, counts = null) {
  return {
    id: film.id,
    title: film.title,
    status: film.status,
    type: film.type,
    durationSeconds: number(film.duration_seconds),
    targetDurationSeconds: number(film.target_duration_seconds),
    hasVideo: Boolean(film.final_video_path),
    sceneCount: counts?.total ?? null,
    readyScenes: counts?.ready ?? null,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const advanceSchema = z.object({
  action: z.enum(['generate', 'assemble', 'retry', 'sync', 'schedule']),
  runAt: z.string().min(10).max(40).optional(),
});

export const reviseSchema = z.object({
  stage: z.enum(['screenplay']),
  instruction: z.string().trim().min(3).max(2000),
});

/**
 * Advance a production. `generate` and `assemble` are the two paid stages and
 * are rejected unless the caller explicitly names them.
 */
export async function advanceProduction(userId, filmId, input = {}, role = 'user') {
  const { action } = advanceSchema.parse(input);
  const row = await ownedProduction(userId, filmId, role);
  if (!row) throw new AppError(404, 'production_not_found', 'This project has no production run. Start one first.');
  if (row.status === 'cancelled') throw new AppError(409, 'production_cancelled', 'This production was cancelled. Start a new one.');
  const film = await ownedFilm(userId, filmId, role);

  if (action === 'generate') {
    if (film.final_video_path) throw new AppError(409, 'production_already_rendered', 'This production already has a rendered film.');
    try {
      const result = await requestAllScenes(userId, filmId, role);
      await setRun(filmId, { status: 'running', current_stage: 'generate', error: null });
      return { ...result, production: await productionSnapshot(userId, filmId, role) };
    } catch (error) {
      await setRun(filmId, { error: error.message });
      throw error;
    }
  }

  if (action === 'retry') {
    try {
      const result = await retryFailedScenes(userId, filmId, role);
      await setRun(filmId, { status: 'running', current_stage: 'generate', retries: number(row.retries) + 1, error: null });
      return { ...result, production: await productionSnapshot(userId, filmId, role) };
    } catch (error) {
      await setRun(filmId, { error: error.message });
      throw error;
    }
  }

  if (action === 'assemble') {
    const pending = await db('film_scenes').where({ film_id: filmId }).whereNot({ status: 'ready' }).count('* as count').first();
    if (number(pending?.count) > 0) {
      throw new AppError(409, 'scenes_incomplete', `${number(pending.count)} scene(s) still have no real clip. Generate them before assembling.`);
    }
    const result = await requestAssembly(userId, filmId, { subtitles: true, burnSubtitles: false }, role);
    await setRun(filmId, { status: 'running', current_stage: 'assemble', error: null });
    return { ...result, production: await productionSnapshot(userId, filmId, role) };
  }

  // sync: recompute state and persist completion honestly
  const snapshot = await productionSnapshot(userId, filmId, role);
  if (snapshot.production.status === 'completed') {
    await setRun(filmId, { status: 'completed', current_stage: 'export', completed_at: now(), error: null });
  } else if (snapshot.production.status !== row.status) {
    await setRun(filmId, { status: snapshot.production.status });
  }
  return { production: snapshot.production };
}

/**
 * Natural-language revision of the screenplay stage.
 *
 * Real revision, not a prompt preview: the screenplay is rewritten with the
 * director's note and the cast, locations and direction are recomputed from the
 * new scenes. It refuses once paid clips exist, because rewriting the scenes
 * would orphan them — the honest answer is 409, not silent destruction.
 */
export async function reviseProduction(userId, filmId, input = {}, role = 'user') {
  const data = reviseSchema.parse(input);
  const row = await ownedProduction(userId, filmId, role);
  if (!row) throw new AppError(404, 'production_not_found', 'This project has no production run.');
  if (row.status === 'cancelled') throw new AppError(409, 'production_cancelled', 'This production was cancelled. Start a new one.');
  const film = await ownedFilm(userId, filmId, role);
  const withClips = await db('film_scenes').where({ film_id: filmId }).whereNotNull('clip_path').count('* as count').first();
  if (number(withClips?.count) > 0) {
    throw new AppError(409, 'production_locked', `${number(withClips.count)} scene(s) already have real clips. Rewriting the screenplay would orphan paid work; edit the screenplay directly or start a new production.`);
  }
  let stages = readStages(row);
  stages = await setStage(filmId, stages, 'screenplay', { status: 'running', startedAt: now(), error: null });
  const screenplay = await generateScreenplay({
    idea: `${row.brief}\n\nDirector's revision: ${data.instruction}`,
    type: film.type,
    genre: film.genre,
    language: film.language,
    style: film.style,
    aspectRatio: film.aspect_ratio,
    platform: film.target_platform,
    targetDurationSeconds: number(film.target_duration_seconds),
    storyBible: parseJson(film.story_bible, {}),
    characters: [],
    allowTemplate: true,
  });
  await saveScreenplay(userId, filmId, screenplay, role);
  stages = await setStage(filmId, stages, 'screenplay', {
    status: 'done', finishedAt: now(),
    detail: `${screenplay.scenes.length} scenes rewritten · ${screenplay.aiGenerated ? `AI (${screenplay.provider})` : 'labelled offline draft'} · revision: “${data.instruction.slice(0, 160)}”`,
    data: { provider: screenplay.provider, aiGenerated: Boolean(screenplay.aiGenerated), scenes: screenplay.scenes.length, revision: data.instruction },
  });

  // Re-derive everything downstream of the screenplay.
  const characters = await db('film_characters').where({ user_id: userId, film_id: filmId });
  stages = await setStage(filmId, stages, 'cast', {
    status: 'done', finishedAt: now(),
    detail: `${characters.length} character profile(s) after the rewrite.`,
    data: { characters: characters.length },
  });
  await setRun(filmId, { current_stage: 'locations' });
  const locations = await buildLocations(userId, filmId);
  stages = await setStage(filmId, stages, 'locations', {
    status: 'done', finishedAt: now(),
    detail: `${locations.locations} unique setting(s) after the rewrite.`,
    data: locations,
  });
  const direction = await directScenes(userId, filmId);
  stages = await setStage(filmId, stages, 'direct', {
    status: 'done', finishedAt: now(),
    detail: `${direction.directed} scene(s) re-directed.`,
    data: direction,
  });
  await setRun(filmId, { status: 'awaiting_approval', current_stage: 'generate', error: null });
  return {
    revised: true,
    stage: 'screenplay',
    instruction: data.instruction,
    aiGenerated: Boolean(screenplay.aiGenerated),
    provider: screenplay.provider,
    scenes: screenplay.scenes.length,
    production: (await productionSnapshot(userId, filmId, role)).production,
  };
}

/** Queue the paid generation stage for a future time (unattended run). */
export async function scheduleProduction(userId, filmId, input = {}, role = 'user') {
  const data = advanceSchema.parse(input);
  if (data.action !== 'schedule') throw new AppError(400, 'invalid_action', 'Use action=schedule.');
  const when = new Date(data.runAt || '');
  if (Number.isNaN(when.getTime())) throw new AppError(400, 'invalid_run_at', 'runAt must be an ISO date-time.');
  const delay = when.getTime() - Date.now();
  if (delay < 60_000) throw new AppError(400, 'run_at_too_soon', 'Schedule generation at least a minute ahead.');
  if (delay > 90 * 24 * 60 * 60 * 1000) throw new AppError(400, 'run_at_too_far', 'Schedule generation within 90 days.');
  const row = await ownedProduction(userId, filmId, role);
  if (!row) throw new AppError(404, 'production_not_found', 'This project has no production run.');
  if (row.status === 'cancelled') throw new AppError(409, 'production_cancelled', 'This production was cancelled.');
  const film = await ownedFilm(userId, filmId, role);
  if (film.final_video_path) throw new AppError(409, 'production_already_rendered', 'This production already has a rendered film.');
  const dedupeKey = `film_production_run:${filmId}`;
  const jobId = await addJob('film_production_run', { filmId, userId, action: 'generate' }, {
    runAt: when.toISOString(), maxAttempts: 1, dedupeKey,
  });
  // Re-scheduling moves the existing job instead of stacking duplicates.
  await db('jobs').where({ dedupe_key: dedupeKey }).update({
    run_at: when.toISOString(), status: 'queued', attempts: 0, locked_at: null, locked_by: null,
    last_error: null, updated_at: now(),
  });
  await setRun(filmId, { status: 'scheduled', current_stage: 'generate', error: null });
  return {
    scheduled: true,
    jobId,
    runAt: when.toISOString(),
    production: (await productionSnapshot(userId, filmId, role)).production,
  };
}

/** Worker entry point for a scheduled production. */
export async function processScheduledProduction({ userId, filmId } = {}) {
  const result = await advanceProduction(userId, filmId, { action: 'generate' }, 'user');
  return { ...result, scheduled: true };
}

export async function cancelProduction(userId, filmId, role = 'user') {
  const row = await ownedProduction(userId, filmId, role);
  if (!row) throw new AppError(404, 'production_not_found', 'This project has no production run.');
  const film = await ownedFilm(userId, filmId, role);
  if (film.run_state === 'running') {
    await cancelFilmGeneration(userId, filmId, role).catch(() => {});
  }
  await setRun(filmId, { status: 'cancelled', error: null });
  return productionSnapshot(userId, filmId, role);
}

/** List active productions for the agent dashboard. */
export async function listProductions(userId, { limit = 20 } = {}) {
  const rows = await db('film_productions').where({ user_id: userId })
    .orderBy('updated_at', 'desc').limit(limit);
  const films = await db('film_projects').whereIn('id', rows.map((row) => row.film_id));
  const byId = Object.fromEntries(films.map((film) => [film.id, film]));
  return rows.map((row) => ({
    id: row.id,
    filmId: row.film_id,
    title: byId[row.film_id]?.title || 'Untitled',
    status: row.status,
    currentStage: row.current_stage,
    step: `${PRODUCTION_STAGES.findIndex((stage) => stage.id === row.current_stage) + 1}/${PRODUCTION_STAGES.length}`,
    brief: row.brief,
    updatedAt: row.updated_at,
  }));
}

export { SAFE_STAGES };
