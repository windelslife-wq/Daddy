/**
 * Screenplay / story generation for drama, movie and episodic projects.
 *
 * Two honest modes:
 *  - `ai`      — a configured external LLM (OpenAI/Anthropic/Gemini) writes the
 *                structured screenplay. If it fails, the error propagates; we
 *                never silently substitute a template and call it AI.
 *  - `template`— a deterministic local draft, explicitly labelled
 *                `aiGenerated: false`, so users can still structure a project
 *                offline. The UI must show that label.
 *
 * Long projects are always broken into many short scenes; no request pretends
 * to produce a feature-length film in one generation.
 */
import { z } from 'zod';
import { config } from '../config.js';
import { callLLM, extractJson } from '../ai.js';
import { AppError } from '../errors.js';

export const FILM_TYPES = ['short_drama', 'long_drama', 'movie', 'episode'];
export const FILM_GENRES = [
  'romance', 'family_drama', 'comedy', 'horror', 'thriller', 'action',
  'african_stories', 'historical_drama', 'mystery', 'scifi', 'documentary', 'other',
];
export const FILM_STYLES = ['cinematic', 'comic', 'modern_cartoon', 'animated', '3d', 'noir', 'anime', 'realistic'];
export const FILM_ASPECTS = ['9:16', '16:9', '1:1'];
export const FILM_PLATFORMS = ['tiktok', 'youtube_shorts', 'instagram_reels', 'facebook', 'youtube', 'x', 'custom'];

const dialogueSchema = z.object({
  character: z.string().min(1).max(120),
  line: z.string().min(1).max(1000),
  emotion: z.string().max(80).optional().default(''),
});
const sceneSchema = z.object({
  heading: z.string().max(220).optional().default(''),
  location: z.string().max(220).optional().default(''),
  time_of_day: z.string().max(60).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  dialogue: z.array(dialogueSchema).max(20).optional().default([]),
  camera_movement: z.string().max(120).optional().default(''),
  visual_prompt: z.string().max(2000).optional().default(''),
  duration_seconds: z.number().int().min(1).max(60).optional(),
});
const screenplaySchema = z.object({
  title: z.string().min(2).max(220),
  logline: z.string().max(1000).optional().default(''),
  story_bible: z.object({
    premise: z.string().max(2000).optional().default(''),
    world: z.string().max(2000).optional().default(''),
    themes: z.array(z.string().max(100)).max(12).optional().default([]),
    continuity_notes: z.string().max(3000).optional().default(''),
  }).optional().default({}),
  characters: z.array(z.object({
    name: z.string().min(1).max(120),
    role: z.string().max(60).optional().default('supporting'),
    description: z.string().max(1000).optional().default(''),
    appearance_prompt: z.string().max(1500).optional().default(''),
    voice_preset: z.string().max(60).optional().default('nova'),
  })).max(20).optional().default([]),
  scenes: z.array(sceneSchema).min(1).max(config.film.maxScenes),
});

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

/**
 * Full scene plan for a requested duration.
 *
 * The plan is NEVER truncated: if a 60-minute film needs 360 ten-second clips,
 * the plan says 360. If that is more than the deployment allows, callers get an
 * explicit error with the numbers instead of a silently shortened film.
 */
export function planProject(targetDurationSeconds, { sceneSeconds = config.film.maxSceneSeconds } = {}) {
  const perScene = Math.max(1, Math.min(config.film.maxSceneSeconds, Number(sceneSeconds) || config.film.maxSceneSeconds));
  const requested = Number(targetDurationSeconds);
  const duration = clampInt(requested, config.film.minProjectSeconds, config.film.maxProjectSeconds, 60);
  const sceneCount = Math.max(1, Math.ceil(duration / perScene));
  const plannedSeconds = sceneCount * perScene;
  const maxSecondsByScenes = config.film.maxScenes * perScene;
  return {
    sceneCount,
    sceneSeconds: perScene,
    plannedSeconds,
    requestedSeconds: Number.isFinite(requested) ? requested : duration,
    plannedForSeconds: duration,
    maxScenes: config.film.maxScenes,
    maxSceneSeconds: config.film.maxSceneSeconds,
    maxProjectSeconds: config.film.maxProjectSeconds,
    maxSecondsByScenes,
    exceedsSceneLimit: sceneCount > config.film.maxScenes,
    exceedsDurationLimit: Number.isFinite(requested) && requested > config.film.maxProjectSeconds,
  };
}

/**
 * Highest duration a client may request. Requests above the deployment limit
 * are rejected with exact numbers rather than being silently clamped; the hard
 * ceiling keeps absurd values out of the planner entirely.
 */
export const MAX_REQUESTABLE_SECONDS = 7 * 24 * 3600;

/** Number of provider-sized clips needed to cover the requested duration. */
export function planSceneCount(targetDurationSeconds) {
  return planProject(targetDurationSeconds).sceneCount;
}

/**
 * Fail loudly when a duration cannot be produced within the deployment limits.
 * The message explains exactly what to change (duration or server config).
 */
export function assertScenePlanFits(targetDurationSeconds, { sceneSeconds } = {}) {
  const plan = planProject(targetDurationSeconds, { sceneSeconds });
  if (plan.exceedsDurationLimit) {
    throw new AppError(400, 'duration_exceeds_limit',
      `This deployment produces films up to ${Math.round(plan.maxProjectSeconds / 60)} minutes (${plan.maxProjectSeconds}s) long, ` +
      `but ${Math.round(plan.requestedSeconds / 60)} minutes (${Math.round(plan.requestedSeconds)}s) was requested. ` +
      'Nothing was queued or truncated. Shorten the request, or raise FILM_MAX_PROJECT_SECONDS (and FILM_MAX_SCENES if the extra length needs more clips).',
      { requestedSeconds: plan.requestedSeconds, maxProjectSeconds: plan.maxProjectSeconds, maxScenes: plan.maxScenes, sceneSeconds: plan.sceneSeconds });
  }
  if (plan.exceedsSceneLimit) {
    const affordableSeconds = plan.maxScenes * plan.sceneSeconds;
    throw new AppError(400, 'scene_plan_exceeds_limit',
      `A ${Math.round(plan.requestedSeconds / 60)}-minute film needs ${plan.sceneCount} scenes at ${plan.sceneSeconds}s per clip, but this server allows ${plan.maxScenes} scenes. ` +
      `Shorten the film to about ${Math.floor(affordableSeconds / 60)} minutes, or raise FILM_MAX_SCENES and FILM_MAX_PROJECT_SECONDS together.`,
      { ...plan, affordableSeconds });
  }
  return plan;
}

/**
 * Spread a target duration across the planned scenes so the finished film
 * matches the requested length instead of drifting to "sceneCount × max clip".
 */
export function distributeDurations(scenes, targetDurationSeconds) {
  const count = scenes.length;
  if (!count) return scenes;
  const target = Math.max(config.film.minProjectSeconds, Math.min(config.film.maxProjectSeconds, Number(targetDurationSeconds) || 0));
  if (!target) return scenes;
  const min = config.film.minSceneSeconds;
  const max = config.film.maxSceneSeconds;
  let per = Math.floor(target / count);
  per = Math.max(min, Math.min(max, per));
  let assigned = per * count;
  const result = scenes.map((scene) => ({ ...scene, duration_seconds: per }));
  // Spread the remaining seconds (rounding + clamping) over the tail scenes.
  let index = count - 1;
  while (assigned < target && index >= 0) {
    if (result[index].duration_seconds < max) { result[index].duration_seconds += 1; assigned += 1; index -= 1; }
    else index -= 1;
    if (index < 0 && assigned < target) {
      const reducible = result.findIndex((scene) => scene.duration_seconds < max);
      if (reducible === -1) break;
      index = reducible;
    }
  }
  return result;
}

export function filmLimits() {
  return {
    maxSceneSeconds: config.film.maxSceneSeconds,
    minSceneSeconds: config.film.minSceneSeconds,
    maxScenes: config.film.maxScenes,
    maxProjectSeconds: config.film.maxProjectSeconds,
    minProjectSeconds: config.film.minProjectSeconds,
    sceneConcurrency: config.film.sceneConcurrency,
    screenplayChunkScenes: config.film.screenplayChunkScenes,
    assemblySegmentScenes: config.film.assemblySegmentScenes,
    burnInMaxSeconds: config.film.burnInMaxSeconds,
    maxRenderWidth: config.film.maxRenderWidth,
    sfxEnabled: config.film.sfxEnabled,
    maxReferenceImageMb: config.film.maxReferenceImageMb,
    // Longest film this deployment can assemble today, in seconds. Both the
    // per-request ceiling and the scene budget can be the binding constraint.
    maxProducibleSeconds: Math.min(config.film.maxScenes * config.film.maxSceneSeconds, config.film.maxProjectSeconds),
    note: 'AI video models generate short clips. Long dramas/movies are produced scene-by-scene and assembled into one timeline; a single request never produces a feature-length film.',
  };
}

function systemPrompt() {
  return [
    'You are an award-winning screenwriter and story editor for short-form drama, episodic series, and feature films.',
    'Write ORIGINAL fiction. Do not reproduce copyrighted characters, scripts, or real people.',
    'Return ONLY valid JSON matching the requested schema — no markdown fences, no commentary.',
    'Every scene must be filmable as a short AI video clip (typically 4-10 seconds). Write concrete visual prompts:',
    'subject, wardrobe, setting, lighting, lens, camera movement, mood. Keep character appearance descriptions IDENTICAL across all scenes so cast members stay consistent.',
    'Dialogue must be short enough to speak within the scene duration. Include African and global settings respectfully and specifically when the genre asks for it.',
  ].join(' ');
}

function buildPrompt(options, sceneCount, context = {}) {
  const {
    idea, type, genre, language, style, targetDurationSeconds, aspectRatio, platform,
    characters = [], storyBible = {}, previousEpisodes = [], episodeLabel = '',
  } = options;
  const {
    chunkIndex = 0, chunkTotal = 1, fromScene = 1, toScene = sceneCount,
    previousScenes = [], attempt = 1,
  } = context;
  const parts = [
    `Project type: ${type}. Genre: ${genre}. Language: ${language}. Visual style: ${style}.`,
    `Aspect ratio: ${aspectRatio}. Target platform: ${platform}. Target total duration: ${targetDurationSeconds} seconds.`,
  ];
  if (chunkTotal > 1) {
    parts.push(`This is part ${chunkIndex + 1} of ${chunkTotal} of ONE continuous film. Write scenes ${fromScene} to ${toScene} of ${sceneCount}. Continue the story forward — never repeat or re-introduce scenes that already exist.`);
  }
  parts.push(
    `Produce EXACTLY ${sceneCount} scenes for this part, each 4-${config.film.maxSceneSeconds} seconds. This is a scene-by-scene production: the clips will be assembled into one film.`,
    `Story idea / ${episodeLabel || 'premise'}: ${idea}`,
  );
  if (Object.keys(storyBible || {}).length) {
    parts.push(`STORY BIBLE (maintain strict continuity): ${JSON.stringify(storyBible).slice(0, 2500)}`);
  }
  if (characters.length) {
    parts.push(`RECURRING CAST (reuse these exact names, faces, wardrobe and voices in every scene): ${JSON.stringify(characters.map((c) => ({ name: c.name, role: c.role, appearance_prompt: c.appearance_prompt, voice_preset: c.voice_preset }))).slice(0, 2500)}`);
  }
  if (previousEpisodes.length) {
    parts.push(`PREVIOUS EPISODES (continue from here, do not contradict): ${JSON.stringify(previousEpisodes.map((e) => ({ title: e.title, synopsis: e.synopsis, continuity_notes: e.continuity_notes }))).slice(0, 2500)}`);
  }
  if (previousScenes.length) {
    parts.push(`SCENES ALREADY WRITTEN (continue directly from the last one, keep locations/wardrobe identical): ${JSON.stringify(previousScenes.slice(-8).map((sc) => ({ heading: sc.heading, location: sc.location, description: sc.description, last_line: sc.dialogue?.slice(-1)?.[0]?.line || '' }))).slice(0, 2500)}`);
  }
  if (attempt > 1) parts.push(`A previous attempt returned fewer scenes than requested. Return exactly ${sceneCount} scene objects this time.`);
  parts.push(`Return JSON: { title, logline, story_bible: {premise, world, themes[], continuity_notes}, characters: [{name, role, description, appearance_prompt, voice_preset}], scenes: [{heading, location, time_of_day, description, dialogue:[{character, line, emotion}], camera_movement, visual_prompt, duration_seconds}] }`);
  return parts.join('\n\n');
}

function templateScreenplay(options, sceneCount) {
  const { idea, genre, language, style, type } = options;
  const subject = String(idea || 'a difficult choice').slice(0, 120);
  const title = `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`.slice(0, 90);
  const cast = [
    { name: 'Amara', role: 'lead', description: 'Determined protagonist facing a turning point.', appearance_prompt: 'Adult woman, short natural black hair, warm brown eyes, amber linen jacket, consistent across all scenes', voice_preset: 'nova' },
    { name: 'Kofi', role: 'supporting', description: 'Trusted friend who challenges the protagonist.', appearance_prompt: 'Adult man, close-cropped hair, deep brown skin, navy shirt, consistent across all scenes', voice_preset: 'echo' },
  ];
  const beats = ['setup', 'inciting incident', 'confrontation', 'reversal', 'climax', 'resolution'];
  const camera = ['slow push in', 'handheld follow', 'wide establishing', 'over-the-shoulder', 'low-angle dolly', 'gentle pull back'];
  const locations = [
    { location: 'A quiet city street at dusk', time_of_day: 'dusk' },
    { location: 'A small apartment living room', time_of_day: 'night' },
    { location: 'A rooftop overlooking the city', time_of_day: 'night' },
    { location: 'A crowded market at midday', time_of_day: 'day' },
    { location: 'A rain-soaked bus stop', time_of_day: 'evening' },
  ];
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const beat = beats[i % beats.length];
    const a = cast[i % 2];
    const b = cast[(i + 1) % 2];
    const place = locations[Math.floor(i / 6) % locations.length];
    return {
      heading: `SCENE ${i + 1} — ${beat.toUpperCase()}`,
      location: place.location,
      time_of_day: place.time_of_day,
      description: `${beat}: ${subject}. ${a.name} must decide what to do next.`,
      dialogue: [
        { character: a.name, line: `We cannot keep pretending this is fine. ${subject}.`, emotion: 'urgent' },
        { character: b.name, line: 'Then tell me what you want to do about it.', emotion: 'steady' },
      ],
      camera_movement: camera[i % camera.length],
      visual_prompt: `${style} ${genre} drama film still. ${a.name}: ${a.appearance_prompt}. ${b.name}: ${b.appearance_prompt}. ${beat.replace(/_/g, ' ')}, cinematic lighting, ${camera[i % camera.length]}, shallow depth of field, no text, no watermark.`,
      duration_seconds: Math.max(4, config.film.maxSceneSeconds),
    };
  });
  return {
    title,
    logline: `A ${genre.replace(/_/g, ' ')} story about ${subject}.`,
    story_bible: {
      premise: subject,
      world: `Contemporary ${style} drama in ${language}.`,
      themes: ['trust', 'consequences', 'resilience'],
      continuity_notes: 'Template draft — replace with AI-generated material for a real production.',
    },
    characters: cast,
    scenes,
    provider: 'local-template',
    aiGenerated: false,
    type,
    note: 'This is a deterministic local template draft, NOT an AI-generated screenplay. Configure AI_PROVIDER (openai, anthropic, or gemini) for genuine AI story generation.',
  };
}

function mergeCharacters(target, incoming = []) {
  for (const character of incoming) {
    const name = String(character?.name || '').trim();
    if (!name) continue;
    const existing = target.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      target.push({
        name,
        role: character.role || 'supporting',
        description: character.description || '',
        appearance_prompt: character.appearance_prompt || '',
        voice_preset: character.voice_preset || 'nova',
      });
    } else {
      // Keep the first description (and therefore the face) stable; fill gaps only.
      if (!existing.description && character.description) existing.description = character.description;
      if (!existing.appearance_prompt && character.appearance_prompt) existing.appearance_prompt = character.appearance_prompt;
      if (!existing.role && character.role) existing.role = character.role;
    }
  }
  return target;
}

/**
 * Generate a screenplay. Never fabricates an AI result.
 *
 * Long-form projects exceed any sane single LLM response, so the story is
 * written in bounded chunks ("acts") that share the story bible, the recurring
 * cast and the tail of the previous chunk. If a model returns fewer scenes than
 * asked, a top-up pass requests the remainder; the response reports the honest
 * `sceneCount` and any `shortfall` instead of inventing scenes locally.
 *
 * @returns {Promise<{title, logline, story_bible, characters, scenes, provider, aiGenerated, sceneCount, requestedSceneCount, estimatedSeconds, plan, shortfall}>}
 */
export async function generateScreenplay(options = {}) {
  const normalized = {
    idea: String(options.idea || '').trim().slice(0, 4000),
    type: FILM_TYPES.includes(options.type) ? options.type : 'short_drama',
    genre: FILM_GENRES.includes(options.genre) ? options.genre : 'drama',
    language: String(options.language || 'en').slice(0, 12),
    style: FILM_STYLES.includes(options.style) ? options.style : 'cinematic',
    aspectRatio: FILM_ASPECTS.includes(options.aspectRatio) ? options.aspectRatio : '9:16',
    platform: FILM_PLATFORMS.includes(options.platform) ? options.platform : 'tiktok',
    targetDurationSeconds: clampInt(options.targetDurationSeconds, config.film.minProjectSeconds, config.film.maxProjectSeconds, 60),
    characters: Array.isArray(options.characters) ? options.characters : [],
    storyBible: options.storyBible && typeof options.storyBible === 'object' ? options.storyBible : {},
    previousEpisodes: Array.isArray(options.previousEpisodes) ? options.previousEpisodes : [],
    episodeLabel: options.episodeLabel || '',
    allowTemplate: options.allowTemplate !== false,
  };
  if (!normalized.idea) throw new AppError(400, 'idea_required', 'A story idea is required.');

  // A 60-minute film is planned as 360 ten-second clips — never truncated.
  const plan = assertScenePlanFits(normalized.targetDurationSeconds);
  const sceneCount = plan.sceneCount;

  if (config.ai.provider === 'local') {
    if (!normalized.allowTemplate) {
      throw new AppError(503, 'ai_provider_required', 'AI screenplay generation requires AI_PROVIDER=openai, anthropic, or gemini with a valid API key. A local template draft is available but was not requested.');
    }
    const draft = templateScreenplay(normalized, sceneCount);
    const scenes = distributeDurations(draft.scenes, normalized.targetDurationSeconds)
      .map((scene, index) => ({ ...scene, ordinal: index + 1 }));
    return {
      ...draft,
      scenes,
      sceneCount: scenes.length,
      requestedSceneCount: sceneCount,
      estimatedSeconds: scenes.reduce((n, scene) => n + scene.duration_seconds, 0),
      plan,
      shortfall: 0,
      chunks: 1,
    };
  }

  const chunkSize = Math.max(4, Math.min(40, config.film.screenplayChunkScenes || 25));
  const chunkTotal = Math.ceil(sceneCount / chunkSize);
  const cast = [...normalized.characters];
  let storyBible = { ...normalized.storyBible };
  let title = '';
  let logline = '';
  let providerLabel = `${config.ai.provider}:${config.ai.openaiModel || config.ai.anthropicModel || config.ai.geminiModel}`;
  const scenes = [];
  let attempts = 0;
  let lastError = null;

  while (scenes.length < sceneCount && attempts < 3) {
    attempts += 1;
    const remaining = sceneCount - scenes.length;
    const count = Math.min(chunkSize, remaining);
    const chunkIndex = Math.floor(scenes.length / chunkSize);
    const prompt = buildPrompt(
      { ...normalized, characters: cast, storyBible },
      count,
      {
        chunkIndex, chunkTotal, fromScene: scenes.length + 1, toScene: scenes.length + count,
        previousScenes: scenes.slice(-8), attempt: attempts,
      },
    );
    let raw;
    try {
      raw = await callLLM(prompt, { system: systemPrompt(), temperature: 0.85, maxTokens: 8000 });
    } catch (error) {
      const wrapped = new AppError(502, 'screenplay_provider_error', `Screenplay provider (${config.ai.provider}) failed: ${error.message}`);
      wrapped.retryable = error.retryable !== false;
      throw wrapped;
    }
    let parsed;
    try { parsed = screenplaySchema.parse(extractJson(raw)); }
    catch (error) {
      throw new AppError(502, 'screenplay_parse_error', `The AI provider returned an invalid screenplay: ${error.message.slice(0, 300)}`);
    }
    if (!title) { title = parsed.title; logline = parsed.logline; }
    storyBible = { ...storyBible, ...(parsed.story_bible || {}) };
    mergeCharacters(cast, parsed.characters);
    if (!parsed.scenes.length) { lastError = 'The AI provider returned no scenes.'; continue; }
    for (const scene of parsed.scenes.slice(0, count)) {
      scenes.push({ ...scene, ordinal: scenes.length + 1 });
    }
  }

  if (!scenes.length) {
    throw new AppError(502, 'screenplay_parse_error', lastError || 'The AI provider returned no usable scenes.');
  }

  const finalScenes = distributeDurations(scenes, normalized.targetDurationSeconds)
    .map((scene, index) => ({ ...scene, ordinal: index + 1 }));

  return {
    title: title || normalized.idea.slice(0, 80),
    logline,
    story_bible: storyBible,
    characters: cast,
    scenes: finalScenes,
    provider: providerLabel,
    aiGenerated: true,
    sceneCount: finalScenes.length,
    requestedSceneCount: sceneCount,
    estimatedSeconds: finalScenes.reduce((n, scene) => n + scene.duration_seconds, 0),
    plan,
    shortfall: Math.max(0, sceneCount - finalScenes.length),
    chunks: chunkTotal,
  };
}

/** Rebuild a screenplay object from an edited scene list (keeps continuity). */
export function normaliseEditedScreenplay(screenplay) {
  const parsed = screenplaySchema.safeParse(screenplay);
  if (!parsed.success) throw new AppError(400, 'invalid_screenplay', `Invalid screenplay: ${parsed.error.issues[0]?.message || 'validation failed'}`);
  const scenes = parsed.data.scenes.map((scene, index) => ({
    ...scene,
    duration_seconds: scene.duration_seconds || config.film.maxSceneSeconds,
    ordinal: index + 1,
  }));
  return {
    title: parsed.data.title,
    logline: parsed.data.logline,
    story_bible: parsed.data.story_bible,
    characters: parsed.data.characters,
    scenes,
    sceneCount: scenes.length,
    estimatedSeconds: scenes.reduce((n, s) => n + s.duration_seconds, 0),
  };
}
