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

/** Number of provider-sized clips needed to cover the requested duration. */
export function planSceneCount(targetDurationSeconds) {
  const duration = clampInt(targetDurationSeconds, 5, config.film.maxProjectSeconds, 60);
  const perScene = Math.max(3, config.film.maxSceneSeconds);
  return Math.min(config.film.maxScenes, Math.max(1, Math.ceil(duration / perScene)));
}

export function filmLimits() {
  return {
    maxSceneSeconds: config.film.maxSceneSeconds,
    maxScenes: config.film.maxScenes,
    maxProjectSeconds: config.film.maxProjectSeconds,
    maxReferenceImageMb: config.film.maxReferenceImageMb,
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

function buildPrompt(options, sceneCount) {
  const {
    idea, type, genre, language, style, targetDurationSeconds, aspectRatio, platform,
    characters = [], storyBible = {}, previousEpisodes = [], episodeLabel = '',
  } = options;
  const parts = [
    `Project type: ${type}. Genre: ${genre}. Language: ${language}. Visual style: ${style}.`,
    `Aspect ratio: ${aspectRatio}. Target platform: ${platform}. Target total duration: ${targetDurationSeconds} seconds.`,
    `Produce EXACTLY ${sceneCount} scenes, each 4-${config.film.maxSceneSeconds} seconds. This is a scene-by-scene production: the clips will be assembled into one film.`,
    `Story idea / ${episodeLabel || 'premise'}: ${idea}`,
  ];
  if (Object.keys(storyBible || {}).length) {
    parts.push(`STORY BIBLE (maintain strict continuity): ${JSON.stringify(storyBible).slice(0, 2500)}`);
  }
  if (characters.length) {
    parts.push(`RECURRING CAST (reuse these exact appearances and names): ${JSON.stringify(characters.map((c) => ({ name: c.name, role: c.role, appearance_prompt: c.appearance_prompt, voice_preset: c.voice_preset }))).slice(0, 2500)}`);
  }
  if (previousEpisodes.length) {
    parts.push(`PREVIOUS EPISODES (continue from here, do not contradict): ${JSON.stringify(previousEpisodes.map((e) => ({ title: e.title, synopsis: e.synopsis, continuity_notes: e.continuity_notes }))).slice(0, 2500)}`);
  }
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
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const beat = beats[i % beats.length];
    const a = cast[i % 2];
    const b = cast[(i + 1) % 2];
    return {
      heading: `SCENE ${i + 1} — ${beat.toUpperCase()}`,
      location: i % 3 === 0 ? 'A quiet city street at dusk' : i % 3 === 1 ? 'A small apartment living room' : 'A rooftop overlooking the city',
      time_of_day: i % 3 === 0 ? 'dusk' : 'night',
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

/**
 * Generate a screenplay. Never fabricates an AI result.
 * @returns {Promise<{title, logline, story_bible, characters, scenes, provider, aiGenerated, sceneCount, estimatedSeconds}>}
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
    targetDurationSeconds: clampInt(options.targetDurationSeconds, 5, config.film.maxProjectSeconds, 60),
    characters: Array.isArray(options.characters) ? options.characters : [],
    storyBible: options.storyBible && typeof options.storyBible === 'object' ? options.storyBible : {},
    previousEpisodes: Array.isArray(options.previousEpisodes) ? options.previousEpisodes : [],
    episodeLabel: options.episodeLabel || '',
    allowTemplate: options.allowTemplate !== false,
  };
  if (!normalized.idea) throw new AppError(400, 'idea_required', 'A story idea is required.');
  const sceneCount = planSceneCount(normalized.targetDurationSeconds);

  if (config.ai.provider === 'local') {
    if (!normalized.allowTemplate) {
      throw new AppError(503, 'ai_provider_required', 'AI screenplay generation requires AI_PROVIDER=openai, anthropic, or gemini with a valid API key. A local template draft is available but was not requested.');
    }
    return { ...templateScreenplay(normalized, sceneCount), sceneCount, estimatedSeconds: sceneCount * config.film.maxSceneSeconds };
  }

  let raw;
  try {
    raw = await callLLM(buildPrompt(normalized, sceneCount), { system: systemPrompt(), temperature: 0.85, maxTokens: 8000 });
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
  const scenes = parsed.scenes.slice(0, sceneCount).map((scene, index) => ({
    ...scene,
    duration_seconds: clampInt(scene.duration_seconds, 4, config.film.maxSceneSeconds, config.film.maxSceneSeconds),
    ordinal: index + 1,
  }));
  return {
    title: parsed.title,
    logline: parsed.logline,
    story_bible: parsed.story_bible,
    characters: parsed.characters,
    scenes,
    provider: `${config.ai.provider}:${config.ai.openaiModel || config.ai.anthropicModel || config.ai.geminiModel}`,
    aiGenerated: true,
    sceneCount: scenes.length,
    estimatedSeconds: scenes.reduce((n, s) => n + s.duration_seconds, 0),
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
