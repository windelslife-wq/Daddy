/**
 * AI Filmmaking REST API.
 * All provider credentials stay on the server. No endpoint returns a secret.
 */
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { db, now, json, parseJson, number } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, badRequest, notFound, forbidden, AppError } from '../errors.js';
import { contentType, projectDir, probeVideo } from '../media/utils.js';
import {
  FILM_TYPES, FILM_GENRES, FILM_STYLES, FILM_ASPECTS, FILM_PLATFORMS,
  generateScreenplay, filmLimits, planSceneCount, planProject,
  normaliseEditedScreenplay, assertScenePlanFits, MAX_REQUESTABLE_SECONDS,
} from '../film/screenplay.js';
import { providerStatus } from '../film/videoProviders.js';
import { estimateFilm, estimateFromScreenplay, getBalance, creditHistory } from '../film/credits.js';
import {
  createFilmSchema, patchFilmSchema, patchSceneSchema, characterSchema,
  createFilm, listFilms, updateFilm, deleteFilm, saveScreenplay, filmDetail,
  listScenes, updateScene, addScene, deleteScene, reorderScenes,
  listCharacters, upsertCharacter, deleteCharacter,
  requestSceneGeneration, requestAllScenes, requestAssembly, publishFilm,
  ownedFilm, queueFilmScenes, pauseFilmGeneration, resumeFilmGeneration,
  cancelFilmGeneration, cancelSceneGeneration, retryFailedScenes, filmProgress,
  cancelFilmAssembly, addSfxAsset, deleteSfxAsset, sfxAssetList, validateSceneProvider,
} from '../film/scenes.js';
import { assemblyPreflight } from '../film/assembly.js';
import { cinematographyCatalog } from '../film/cinematography.js';
import {
  locationSchema, patchLocationSchema,
  listLocations, createLocation, updateLocation, deleteLocation,
} from '../film/locations.js';
import { filmQualityReport } from '../film/continuity.js';
import {
  storyboardOverview, generateStoryboard, generatePoster, generateCharacterConcept, ownedFrame,
} from '../film/storyboard.js';
import { voiceOverview, generateVoiceTakes, sceneTakePath } from '../film/voice.js';
import {
  createFlow, listFlows, updateFlow, deleteFlow, runFlow, ownedFlow, flowArtifact, flowView, NODE_TYPES,
} from '../film/canvas.js';
import { listModels } from '../film/models.js';
import {
  startProduction, productionSnapshot, advanceProduction, cancelProduction,
  listProductions, PRODUCTION_STAGES,
} from '../film/production.js';
import {
  seriesSchema, episodeSchema, patchEpisodeSchema, EPISODE_STATUSES,
  createSeries, listSeries, seriesDetail, updateSeries, deleteSeries,
  createEpisode, updateEpisode, deleteEpisode, generateEpisodeScreenplay, bulkCreateEpisodes,
} from '../film/series.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

/** Converts Zod validation errors into friendly 400s instead of opaque 500s. */
function h(fn) {
  return asyncHandler(async (req, res, next) => {
    try { return await fn(req, res, next); }
    catch (error) {
      if (error?.name === 'ZodError') {
        throw badRequest('Please correct the highlighted fields.', error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
      }
      throw error;
    }
  });
}

const screenplayRequestSchema = z.object({
  idea: z.string().trim().min(3).max(4000),
  type: z.enum(FILM_TYPES).optional().default('short_drama'),
  genre: z.string().max(60).optional().default('drama'),
  language: z.string().max(12).optional().default('en'),
  style: z.string().max(60).optional().default('cinematic'),
  aspectRatio: z.enum(FILM_ASPECTS).optional().default('9:16'),
  platform: z.string().max(40).optional().default('tiktok'),
  // No default: an omitted duration must inherit the project's own runtime,
  // never force a 60-second cut onto a long-form film.
  targetDurationSeconds: z.number().int().min(5).max(MAX_REQUESTABLE_SECONDS).optional(),
  storyBible: z.record(z.any()).optional().default({}),
  characters: z.array(z.any()).max(20).optional().default([]),
  previousEpisodes: z.array(z.any()).max(30).optional().default([]),
  allowTemplate: z.boolean().optional().default(true),
});

const estimateSchema = z.object({
  scenes: z.array(z.object({
    duration_seconds: z.number().min(1).max(60),
    dialogue: z.array(z.object({ line: z.string().max(1000) })).max(20).optional().default([]),
  })).max(config.film.maxScenes).optional(),
  screenplay: z.any().optional(),
  targetDurationSeconds: z.number().int().min(5).max(MAX_REQUESTABLE_SECONDS).optional(),
  assembly: z.boolean().optional().default(true),
});

const uploadKindSchema = z.object({
  kind: z.enum(['reference', 'music', 'character', 'sfx']),
  characterId: z.string().max(48).optional(),
  name: z.string().max(120).optional(),
});

async function streamFile(req, res, filePath, filename, { download = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) throw notFound('Media file not found.');
  const stat = await fsp.stat(filePath);
  res.setHeader('Content-Type', contentType(filename));
  res.setHeader('Accept-Ranges', 'bytes');
  if (download) {
    const safe = path.basename(filename).replace(/["\r\n]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  }
  const range = req.get('range');
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', String(stat.size));
  return fs.createReadStream(filePath).pipe(res);
}

export function filmRouter() {
  const router = express.Router();
  router.use(requireAuth);

  // ---- Static configuration / discovery -----------------------------------
  router.get('/config', h(async (req, res) => {
    const [balance, provider] = await Promise.all([getBalance(req.user.id), Promise.resolve(providerStatus())]);
    const limits = filmLimits();
    res.json({
      types: FILM_TYPES, genres: FILM_GENRES, styles: FILM_STYLES,
      aspectRatios: FILM_ASPECTS, platforms: FILM_PLATFORMS,
      cinematography: cinematographyCatalog(),
      languages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'zh', 'ha', 'yo', 'ig', 'sw', 'ar', 'hi'],
      voices: ['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer', 'sage', 'eleven-default'],
      limits,
      // Long-form duration presets (seconds). Any value between min and max is
      // accepted; these are the shortcuts the studio offers.
      durationPresets: [60, 120, 300, 600, 900, 1200, 1800, 2400, 3000, 3600]
        .filter((seconds) => seconds <= limits.maxProjectSeconds),
      sceneDurationOptions: Array.from({ length: Math.max(0, limits.maxSceneSeconds - limits.minSceneSeconds + 1) }, (_, i) => limits.minSceneSeconds + i),
      production: {
        sceneConcurrency: limits.sceneConcurrency,
        assemblySegmentScenes: limits.assemblySegmentScenes,
        burnInMaxSeconds: limits.burnInMaxSeconds,
        sfxEnabled: limits.sfxEnabled,
        maxProducibleMinutes: Math.floor(limits.maxProducibleSeconds / 60),
      },
      credits: {
        balance,
        perVideoSecond: config.film.creditPerVideoSecond,
        perTtsThousandChars: config.film.creditPerTtsThousandChars,
        perAssembly: config.film.creditPerAssembly,
      },
      aiScreenplayProvider: config.ai.provider,
      aiScreenplayConfigured: config.ai.provider !== 'local',
      ttsProvider: config.media.ttsProvider,
      videoProvider: provider,
    });
  }));

  // ---- Production agent ----------------------------------------------------
  router.get('/production', h(async (req, res) => {
    res.json({ productions: await listProductions(req.user.id), stages: PRODUCTION_STAGES });
  }));

  // ---- Model marketplace (live readiness, no fake activation) --------------
  router.get('/models', h(async (req, res) => {
    res.json(listModels());
  }));

  // ---- Creative canvas -----------------------------------------------------
  router.get('/flows', h(async (req, res) => {
    res.json({ flows: await listFlows(req.user.id, { filmId: req.query.filmId }), nodeTypes: NODE_TYPES });
  }));

  router.post('/flows', h(async (req, res) => {
    res.status(201).json({ flow: await createFlow(req.user.id, req.body || {}) });
  }));

  router.get('/flows/:flowId', h(async (req, res) => {
    const flow = await ownedFlow(req.user.id, req.params.flowId);
    res.json({ flow: flowView(flow), nodeTypes: NODE_TYPES });
  }));

  router.patch('/flows/:flowId', h(async (req, res) => {
    res.json({ flow: await updateFlow(req.user.id, req.params.flowId, req.body || {}) });
  }));

  router.delete('/flows/:flowId', h(async (req, res) => {
    res.json(await deleteFlow(req.user.id, req.params.flowId));
  }));

  router.post('/flows/:flowId/run', h(async (req, res) => {
    res.json(await runFlow(req.user.id, req.params.flowId, { force: Boolean(req.body?.force) }));
  }));

  router.get('/flows/:flowId/artifact/:filename', h(async (req, res) => {
    const filePath = await flowArtifact(req.user.id, req.params.flowId, req.params.filename);
    await streamFile(req, res, filePath, path.basename(filePath));
  }));

  router.post('/production/start', h(async (req, res) => {
    const result = await startProduction(req.user.id, req.body || {}, req.user.role);
    res.status(201).json(result);
  }));

  router.post('/estimate', h(async (req, res) => {
    const data = estimateSchema.parse(req.body || {});
    let scenes = data.scenes;
    if (!scenes && data.screenplay) scenes = data.screenplay.scenes || [];
    if (!scenes && data.targetDurationSeconds) {
      const plan = assertScenePlanFits(data.targetDurationSeconds);
      scenes = Array.from({ length: plan.sceneCount }, () => ({ duration_seconds: plan.sceneSeconds, dialogue: [] }));
    }
    if (!scenes) throw badRequest('Provide scenes, a screenplay, or targetDurationSeconds.');
    const estimate = estimateFilm(scenes, { assembly: data.assembly });
    const balance = await getBalance(req.user.id);
    const plan = data.targetDurationSeconds ? planProject(data.targetDurationSeconds) : null;
    res.json({
      ...estimate, balance, plan,
      sufficient: balance >= estimate.total,
      shortfall: Math.max(0, estimate.total - balance),
    });
  }));

  // Standalone AI Script Writer (no project needed).
  router.post('/screenplay', h(async (req, res) => {
    const data = screenplayRequestSchema.parse(req.body || {});
    const screenplay = await generateScreenplay(data);
    res.json({ screenplay, estimate: estimateFromScreenplay(screenplay), provider: screenplay.provider, aiGenerated: screenplay.aiGenerated });
  }));

  // ---- Credits -------------------------------------------------------------
  router.get('/credits', h(async (req, res) => {
    const [balance, history] = await Promise.all([getBalance(req.user.id), creditHistory(req.user.id, 50)]);
    res.json({ balance, history, pricing: {
      perVideoSecond: config.film.creditPerVideoSecond,
      perTtsThousandChars: config.film.creditPerTtsThousandChars,
      perAssembly: config.film.creditPerAssembly,
    } });
  }));

  router.get('/credits/history', h(async (req, res) => {
    res.json({ history: await creditHistory(req.user.id, number(req.query.limit, 50)) });
  }));

  // ---- Character studio ----------------------------------------------------
  router.get('/characters', h(async (req, res) => {
    res.json({ characters: await listCharacters(req.user.id, { filmId: req.query.filmId, seriesId: req.query.seriesId }) });
  }));

  router.post('/characters', h(async (req, res) => {
    const data = characterSchema.parse(req.body || {});
    if (data.filmId) await ownedFilm(req.user.id, data.filmId, req.user.role);
    res.status(201).json({ character: await upsertCharacter(req.user.id, data) });
  }));

  router.delete('/characters/:characterId', h(async (req, res) => {
    res.json(await deleteCharacter(req.user.id, req.params.characterId));
  }));

  router.get('/characters/:characterId/image', h(async (req, res) => {
    const character = await db('film_characters').where({ id: req.params.characterId, user_id: req.user.id }).first();
    if (!character) throw notFound('Character not found.');
    if (req.user.role !== 'admin' && character.user_id !== req.user.id) throw forbidden();
    await streamFile(req, res, character.reference_image_path, 'reference.png');
  }));

  // ---- Series studio (defined before /:id to avoid shadowing) --------------
  router.get('/series', h(async (req, res) => res.json({ series: await listSeries(req.user.id) })));

  router.post('/series', h(async (req, res) => {
    const data = seriesSchema.parse(req.body || {});
    res.status(201).json({ series: await createSeries(req.user.id, data) });
  }));

  router.post('/series/bulk-episodes', h(async (req, res) => {
    const data = z.object({ seriesId: z.string().min(1), seasonNumber: z.number().int().min(1).max(100).default(1), titles: z.array(z.string().min(1).max(220)).min(1).max(50) }).parse(req.body || {});
    res.status(201).json({ episodes: await bulkCreateEpisodes(req.user.id, data.seriesId, data, req.user.role) });
  }));

  router.get('/series/:seriesId', h(async (req, res) => res.json(await seriesDetail(req.user.id, req.params.seriesId, req.user.role))));

  router.patch('/series/:seriesId', h(async (req, res) => {
    res.json(await updateSeries(req.user.id, req.params.seriesId, seriesSchema.partial().parse(req.body || {}), req.user.role));
  }));

  router.delete('/series/:seriesId', h(async (req, res) => {
    res.json(await deleteSeries(req.user.id, req.params.seriesId, req.user.role));
  }));

  router.post('/series/:seriesId/episodes', h(async (req, res) => {
    const data = episodeSchema.parse(req.body || {});
    res.status(201).json({ episode: await createEpisode(req.user.id, req.params.seriesId, data, req.user.role) });
  }));

  router.patch('/series/:seriesId/episodes/:episodeId', h(async (req, res) => {
    const data = patchEpisodeSchema.parse(req.body || {});
    res.json({ episode: await updateEpisode(req.user.id, req.params.seriesId, req.params.episodeId, data, req.user.role) });
  }));

  router.delete('/series/:seriesId/episodes/:episodeId', h(async (req, res) => {
    res.json(await deleteEpisode(req.user.id, req.params.seriesId, req.params.episodeId, req.user.role));
  }));

  router.post('/series/:seriesId/episodes/:episodeId/screenplay', h(async (req, res) => {
    const options = z.object({
      idea: z.string().max(4000).optional(),
      targetDurationSeconds: z.number().int().min(5).max(MAX_REQUESTABLE_SECONDS).optional(),
      allowTemplate: z.boolean().optional().default(true),
    }).parse(req.body || {});
    res.json(await generateEpisodeScreenplay(req.user.id, req.params.seriesId, req.params.episodeId, options, req.user.role));
  }));

  // ---- Projects ------------------------------------------------------------
  router.get('/', h(async (req, res) => {
    const films = await listFilms(req.user.id, {
      type: req.query.type, seriesId: req.query.seriesId, status: req.query.status,
      limit: number(req.query.limit, 50), offset: number(req.query.offset, 0),
    });
    res.json({ films });
  }));

  router.post('/', h(async (req, res) => {
    const data = createFilmSchema.parse(req.body || {});
    res.status(201).json({ film: await createFilm(req.user.id, data) });
  }));

  router.get('/:id', h(async (req, res) => res.json(await filmDetail(req.user.id, req.params.id, req.user.role))));

  router.patch('/:id', h(async (req, res) => {
    const data = patchFilmSchema.parse(req.body || {});
    res.json({ film: await updateFilm(req.user.id, req.params.id, data, req.user.role) });
  }));

  router.delete('/:id', h(async (req, res) => {
    res.json(await deleteFilm(req.user.id, req.params.id, req.user.role));
  }));

  // ---- Screenplay within a project ----------------------------------------
  router.post('/:id/screenplay', h(async (req, res) => {
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    const data = screenplayRequestSchema.parse(req.body || {});
    const screenplay = await generateScreenplay({
      ...data,
      type: film.type,
      genre: data.genre || film.genre,
      language: data.language || film.language,
      style: data.style || film.style,
      aspectRatio: film.aspect_ratio,
      platform: film.target_platform,
      targetDurationSeconds: data.targetDurationSeconds ?? film.target_duration_seconds,
      storyBible: Object.keys(data.storyBible || {}).length ? data.storyBible : parseJson(film.story_bible, {}),
      characters: data.characters?.length ? data.characters : await listCharacters(req.user.id, { filmId: film.id, seriesId: film.series_id || undefined }),
    });
    const detail = await saveScreenplay(req.user.id, film.id, screenplay, req.user.role);
    res.json({ screenplay, provider: screenplay.provider, aiGenerated: screenplay.aiGenerated, film: detail });
  }));

  router.put('/:id/screenplay', h(async (req, res) => {
    const data = z.object({ screenplay: z.any() }).parse(req.body || {});
    normaliseEditedScreenplay(data.screenplay);
    res.json(await saveScreenplay(req.user.id, req.params.id, data.screenplay, req.user.role));
  }));

  // ---- Locations library ---------------------------------------------------
  router.get('/:id/locations', h(async (req, res) => {
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    res.json({ locations: await listLocations(req.user.id, { filmId: film.id, seriesId: film.series_id || undefined }) });
  }));

  router.post('/:id/locations', h(async (req, res) => {
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    const data = locationSchema.parse({ ...(req.body || {}), filmId: film.id, seriesId: null });
    res.status(201).json({ location: await createLocation(req.user.id, data, req.user.role) });
  }));

  router.patch('/:id/locations/:locationId', h(async (req, res) => {
    await ownedFilm(req.user.id, req.params.id, req.user.role);
    const data = patchLocationSchema.parse(req.body || {});
    // Scope is fixed by the project the request came through.
    delete data.filmId; delete data.seriesId;
    res.json({ location: await updateLocation(req.user.id, req.params.locationId, data, req.user.role) });
  }));

  router.delete('/:id/locations/:locationId', h(async (req, res) => {
    await ownedFilm(req.user.id, req.params.id, req.user.role);
    res.json(await deleteLocation(req.user.id, req.params.locationId));
  }));

  // ---- Production agent (per project) --------------------------------------
  router.get('/:id/production', h(async (req, res) => {
    res.json(await productionSnapshot(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/production/advance', h(async (req, res) => {
    res.json(await advanceProduction(req.user.id, req.params.id, req.body || {}, req.user.role));
  }));

  router.post('/:id/production/cancel', h(async (req, res) => {
    res.json(await cancelProduction(req.user.id, req.params.id, req.user.role));
  }));

  // ---- Storyboard, poster and character concept art ------------------------
  router.get('/:id/storyboard', h(async (req, res) => {
    res.json(await storyboardOverview(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/storyboard', h(async (req, res) => {
    res.json(await generateStoryboard(req.user.id, req.params.id, req.body || {}, req.user.role));
  }));

  router.get('/:id/storyboard/:frameId/image', h(async (req, res) => {
    const frame = await ownedFrame(req.user.id, req.params.id, req.params.frameId, req.user.role);
    if (!frame.path) throw notFound('This frame has no image.');
    await streamFile(req, res, frame.path, path.basename(frame.path));
  }));

  router.post('/:id/poster', h(async (req, res) => {
    res.json(await generatePoster(req.user.id, req.params.id, req.user.role));
  }));

  router.get('/:id/poster/image', h(async (req, res) => {
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    if (!film.poster_path) throw notFound('No poster has been rendered yet.');
    await streamFile(req, res, film.poster_path, `poster-${req.params.id}.png`);
  }));

  router.post('/:id/characters/:characterId/concept', h(async (req, res) => {
    res.json(await generateCharacterConcept(req.user.id, req.params.id, req.params.characterId, req.user.role));
  }));

  // ---- Voice takes ---------------------------------------------------------
  router.get('/:id/voice', h(async (req, res) => {
    res.json(await voiceOverview(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/voice', h(async (req, res) => {
    res.json(await generateVoiceTakes(req.user.id, req.params.id, req.body || {}, req.user.role));
  }));

  router.get('/:id/scenes/:sceneId/voice', h(async (req, res) => {
    const take = await sceneTakePath(req.user.id, req.params.id, req.params.sceneId, req.user.role);
    await streamFile(req, res, take.path, take.filename);
  }));

  // ---- Quality control / continuity ---------------------------------------
  router.get('/:id/qc', h(async (req, res) => {
    res.json(await filmQualityReport(req.user.id, req.params.id, req.user.role));
  }));

  // ---- Scenes --------------------------------------------------------------
  router.get('/:id/scenes', h(async (req, res) => {
    res.json({ scenes: await listScenes(req.user.id, req.params.id, req.user.role) });
  }));

  router.post('/:id/scenes', h(async (req, res) => {
    res.status(201).json({ scene: await addScene(req.user.id, req.params.id, patchSceneSchema.parse(req.body || {}), req.user.role) });
  }));

  router.post('/:id/scenes/reorder', h(async (req, res) => {
    const data = z.object({ orderedIds: z.array(z.string().min(1)).min(1) }).parse(req.body || {});
    res.json({ scenes: await reorderScenes(req.user.id, req.params.id, data.orderedIds, req.user.role) });
  }));

  router.post('/:id/scenes/generate-all', h(async (req, res) => {
    const data = z.object({ sceneIds: z.array(z.string().min(1)).max(config.film.maxScenes).optional() }).parse(req.body || {});
    if (data.sceneIds?.length) {
      res.json(await queueFilmScenes(req.user.id, req.params.id, { sceneIds: data.sceneIds, role: req.user.role }));
      return;
    }
    res.json(await requestAllScenes(req.user.id, req.params.id, req.user.role));
  }));

  // ---- Generation run controls (long-form production) ----------------------
  router.post('/:id/generation/start', h(async (req, res) => {
    const data = z.object({ sceneIds: z.array(z.string().min(1)).max(config.film.maxScenes).optional() }).parse(req.body || {});
    res.status(202).json(await queueFilmScenes(req.user.id, req.params.id, { sceneIds: data.sceneIds || null, role: req.user.role }));
  }));

  router.post('/:id/generation/pause', h(async (req, res) => {
    res.json(await pauseFilmGeneration(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/generation/resume', h(async (req, res) => {
    res.json(await resumeFilmGeneration(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/generation/cancel', h(async (req, res) => {
    res.json(await cancelFilmGeneration(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/scenes/retry-failed', h(async (req, res) => {
    res.status(202).json(await retryFailedScenes(req.user.id, req.params.id, req.user.role));
  }));

  router.post('/:id/scenes/:sceneId/cancel', h(async (req, res) => {
    res.json(await cancelSceneGeneration(req.user.id, req.params.id, req.params.sceneId, req.user.role));
  }));

  router.get('/:id/progress', h(async (req, res) => {
    res.json(await filmProgress(req.user.id, req.params.id, req.user.role));
  }));

  // ---- Sound effects -------------------------------------------------------
  router.get('/:id/sfx', h(async (req, res) => {
    await ownedFilm(req.user.id, req.params.id, req.user.role);
    res.json({ assets: await sfxAssetList(req.params.id) });
  }));

  router.delete('/:id/sfx/:assetId', h(async (req, res) => {
    res.json(await deleteSfxAsset(req.user.id, req.params.id, req.params.assetId, req.user.role));
  }));

  router.get('/:id/preflight', h(async (req, res) => {
    await ownedFilm(req.user.id, req.params.id, req.user.role);
    const pre = await assemblyPreflight(req.params.id);
    const scenes = await db('film_scenes').where({ film_id: req.params.id });
    const cost = estimateFilm(scenes.map((s) => ({ duration_seconds: number(s.duration_seconds), dialogue: parseJson(s.dialogue, []) })), { assembly: false });
    res.json({
      sceneCount: pre.sceneCount, durationSeconds: pre.duration,
      missing: pre.missing, ready: pre.ready, ttsProvider: pre.ttsProvider,
      segments: pre.segments,
      estimatedRenderBytes: pre.estimatedRenderBytes,
      burnInRecommended: pre.burnInRecommended,
      burnInMaxSeconds: config.film.burnInMaxSeconds,
      sfxCount: pre.sfxCount,
      unresolvedSfx: pre.unresolvedSfx,
      dialogueCharacters: pre.dialogueCharacters,
      assemblyCredits: cost.total + config.film.creditPerAssembly,
      balance: await getBalance(req.user.id),
    });
  }));

  router.post('/:id/scenes/:sceneId/generate', h(async (req, res) => {
    res.status(202).json({ scene: await requestSceneGeneration(req.user.id, req.params.id, req.params.sceneId, req.user.role) });
  }));

  router.patch('/:id/scenes/:sceneId', h(async (req, res) => {
    res.json({ scene: await updateScene(req.user.id, req.params.id, req.params.sceneId, patchSceneSchema.parse(req.body || {}), req.user.role) });
  }));

  router.delete('/:id/scenes/:sceneId', h(async (req, res) => {
    res.json(await deleteScene(req.user.id, req.params.id, req.params.sceneId, req.user.role));
  }));

  router.get('/:id/scenes/:sceneId/clip', h(async (req, res) => {
    await ownedFilm(req.user.id, req.params.id, req.user.role);
    const scene = await db('film_scenes').where({ id: req.params.sceneId, film_id: req.params.id }).first();
    if (!scene) throw notFound('Scene not found.');
    await streamFile(req, res, scene.clip_path, `scene-${number(scene.ordinal)}.mp4`);
  }));

  router.get('/:id/scenes/:sceneId/poster', h(async (req, res) => {
    await ownedFilm(req.user.id, req.params.id, req.user.role);
    const scene = await db('film_scenes').where({ id: req.params.sceneId, film_id: req.params.id }).first();
    if (!scene) throw notFound('Scene not found.');
    await streamFile(req, res, scene.poster_path, `poster-${number(scene.ordinal)}.jpg`);
  }));

  // ---- Assembly / export ---------------------------------------------------
  router.post('/:id/assemble', h(async (req, res) => {
    const data = z.object({
      subtitles: z.boolean().optional(),
      burnSubtitles: z.boolean().optional(),
    }).parse(req.body || {});
    res.status(202).json(await requestAssembly(req.user.id, req.params.id, data, req.user.role));
  }));

  router.post('/:id/assembly/cancel', h(async (req, res) => {
    res.json(await cancelFilmAssembly(req.user.id, req.params.id, req.user.role));
  }));

  router.get('/:id/media/:asset', h(async (req, res) => {
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    const map = {
      video: [film.final_video_path, `${film.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`],
      thumbnail: [film.thumbnail_path, 'thumbnail.jpg'],
      captions: [film.caption_path, 'captions.srt'],
      reference: [film.reference_image_path, 'reference.png'],
      music: [film.music_path, 'music.mp3'],
    };
    const entry = map[req.params.asset];
    if (!entry) throw badRequest('Unknown media asset.');
    await streamFile(req, res, entry[0], entry[1], { download: req.query.download === '1' || ['captions', 'music'].includes(req.params.asset) });
  }));

  router.get('/:id/download', h(async (req, res) => {
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    const name = `${film.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'film'}.mp4`;
    await streamFile(req, res, film.final_video_path, name, { download: true });
  }));

  router.post('/:id/publish', h(async (req, res) => {
    res.json({ film: await publishFilm(req.user.id, req.params.id, req.user.role) });
  }));

  // ---- Secure uploads ------------------------------------------------------
  router.post('/:id/upload', upload.single('file'), h(async (req, res) => {
    const data = uploadKindSchema.parse(req.body || {});
    const film = await ownedFilm(req.user.id, req.params.id, req.user.role);
    if (!req.file) throw badRequest('Choose a file to upload.');
    const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype);
    const isAudio = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'audio/webm'].includes(req.file.mimetype);
    const audioKind = data.kind === 'music' || data.kind === 'sfx';
    if (!audioKind && !isImage) throw badRequest('Reference and character images must be PNG, JPEG, or WebP.');
    if (audioKind && !isAudio) throw badRequest('Audio must be MP3, WAV, M4A, OGG, or WebM.');
    if (!audioKind && req.file.size > config.film.maxReferenceImageMb * 1024 * 1024) {
      throw badRequest(`Images must be under ${config.film.maxReferenceImageMb} MB.`);
    }
    if (audioKind && req.file.size > 25 * 1024 * 1024) throw badRequest('Audio files must be under 25 MB.');
    if (data.kind === 'sfx' && !config.film.sfxEnabled) throw badRequest('Sound effects are disabled on this server.');
    const dir = path.join(projectDir(`film_${film.id}`), 'assets');
    await fsp.mkdir(dir, { recursive: true });
    const ext = audioKind ? (req.file.mimetype.includes('wav') ? 'wav' : req.file.mimetype.includes('ogg') ? 'ogg' : req.file.mimetype.includes('mp4') ? 'm4a' : req.file.mimetype.includes('webm') ? 'webm' : 'mp3') : (req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
    const filename = `${data.kind}-${Date.now()}.${ext}`;
    const destination = path.join(dir, filename);
    await fsp.writeFile(destination, req.file.buffer, { mode: 0o600 });
    if (data.kind === 'sfx') {
      const probe = await probeVideo(destination);
      if (!probe.durationSeconds) {
        await fsp.rm(destination, { force: true }).catch(() => {});
        throw badRequest('That audio file could not be decoded. Upload a valid MP3, WAV, M4A, OGG or WebM clip.');
      }
      const asset = await addSfxAsset(req.user.id, film.id, {
        name: data.name || path.basename(req.file.originalname || 'Sound effect'),
        path: destination, durationSeconds: probe.durationSeconds, bytes: req.file.size,
      }, req.user.role);
      res.status(201).json({ uploaded: true, kind: 'sfx', asset });
      return;
    }
    if (data.kind === 'reference') {
      await db('film_projects').where({ id: film.id }).update({ reference_image_path: destination, updated_at: now() });
    } else if (data.kind === 'music') {
      await db('film_projects').where({ id: film.id }).update({ music_path: destination, updated_at: now() });
      await db('film_projects').where({ id: film.id }).update({ status: film.status === 'completed' ? 'draft' : film.status });
    } else {
      if (!data.characterId) throw badRequest('characterId is required for character images.');
      const character = await db('film_characters').where({ id: data.characterId, user_id: req.user.id }).first();
      if (!character) throw notFound('Character not found.');
      await db('film_characters').where({ id: character.id }).update({ reference_image_path: destination, updated_at: now() });
    }
    res.status(201).json({ uploaded: true, kind: data.kind, filename, bytes: req.file.size });
  }));

  return router;
}
