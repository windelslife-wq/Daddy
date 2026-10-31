/**
 * Model marketplace / capability registry.
 *
 * Everything here is derived from live configuration, not from marketing copy:
 * a model is "ready" only when its credentials exist, and the prices shown are
 * the same numbers the credit engine charges. The registry deliberately has no
 * fake "activate" switch — enabling a provider is an operator action on the
 * server (env + key), and that is stated in the response.
 */
import { config } from '../config.js';
import { providerCatalog, durationOptionsFor, PROVIDER_IDS } from './videoProviders.js';
import { imageProviderStatus } from '../media/images.js';
import { activeTtsProvider } from '../media/audio.js';
import { sceneCreditCost } from './credits.js';

const PROVIDER_ENV = {
  replicate: 'REPLICATE_API_TOKEN',
  fal: 'FAL_API_KEY',
  veo: 'GOOGLE_VEO_API_KEY',
};

function textProviders() {
  return [
    {
      id: 'openai', label: 'OpenAI', kind: 'text',
      env: 'OPENAI_API_KEY', configured: Boolean(config.ai.openaiKey),
      model: config.ai.openaiModel || null, capabilities: ['screenplay', 'dialogue', 'story bible'],
    },
    {
      id: 'anthropic', label: 'Anthropic', kind: 'text',
      env: 'ANTHROPIC_API_KEY', configured: Boolean(config.ai.anthropicKey),
      model: config.ai.anthropicModel || null, capabilities: ['screenplay', 'dialogue', 'story bible'],
    },
    {
      id: 'gemini', label: 'Google Gemini', kind: 'text',
      env: 'GEMINI_API_KEY', configured: Boolean(config.ai.geminiKey),
      model: config.ai.geminiModel || null, capabilities: ['screenplay', 'dialogue', 'story bible'],
    },
    {
      id: 'local', label: 'Offline template writer', kind: 'text',
      env: null, configured: true, model: 'local-template',
      capabilities: ['structured draft, clearly labelled as non-AI'],
    },
  ];
}

function ttsModels() {
  const local = { id: 'mespeak', label: 'meSpeak (local)', kind: 'tts', env: null, configured: true, model: 'mespeak-local', capabilities: ['offline narration', 'per-scene takes'] };
  let active = null;
  let activeError = null;
  try { active = activeTtsProvider(); } catch (error) { activeError = error.message; }
  return {
    active,
    activeError,
    items: [
      local,
      { id: 'openai-tts', label: 'OpenAI TTS', kind: 'tts', env: 'OPENAI_API_KEY', configured: Boolean(config.ai.openaiKey), model: config.media.openaiTtsModel, capabilities: ['natural voices', 'multilingual'] },
      { id: 'elevenlabs', label: 'ElevenLabs', kind: 'tts', env: 'ELEVENLABS_API_KEY', configured: Boolean(config.media.elevenLabsKey), model: 'eleven_multilingual_v2', capabilities: ['voice cloning', 'multilingual'] },
    ],
  };
}

export function listModels() {
  const video = providerCatalog().map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: 'video',
    model: provider.model,
    env: PROVIDER_ENV[provider.id],
    configured: provider.configured,
    enabled: provider.configured,
    activeForServer: provider.id === config.film.videoProvider,
    durations: durationOptionsFor(provider.id),
    maxSeconds: provider.maxSeconds,
    aspectRatios: provider.aspectRatios,
    creditsPerSecond: Math.max(1, sceneCreditCost({ duration_seconds: 1, dialogue: [] })),
    creditsPerSixSecondScene: sceneCreditCost({ duration_seconds: 6, dialogue: [] }),
    supportsReferenceImage: provider.supportsReferenceImage,
    supportsCancel: provider.supportsCancel,
    supportsLipSync: provider.id === 'veo',
    notes: provider.id === 'veo'
      ? 'Veo cannot cancel a started prediction. Lip-sync is available with this provider.'
      : provider.id === 'fal'
        ? 'Fal returns a synchronous job handle; cancellation supported.'
        : 'Replicate predictions can be cancelled and resumed by id.',
  }));

  const image = imageProviderStatus();
  const tts = ttsModels();
  return {
    video: {
      active: config.film.videoProvider,
      realGeneration: Boolean(video.find((item) => item.id === config.film.videoProvider)?.configured),
      items: video,
    },
    image: {
      active: image.provider,
      ai: image.ai,
      configured: image.configured,
      items: [
        { id: 'procedural', label: 'Procedural renderer (local)', kind: 'image', env: null, configured: true, model: 'procedural-svg', capabilities: ['storyboards', 'posters', 'character concept art'], ai: false, notes: 'Real PNG files rendered locally. Not AI art and never used as a face reference.' },
        { id: 'openai', label: 'OpenAI images', kind: 'image', env: 'OPENAI_API_KEY', configured: Boolean(config.ai.openaiKey), model: config.media.openaiImageModel, capabilities: ['storyboards', 'posters', 'character portraits'], ai: true },
        { id: 'replicate', label: 'Replicate images', kind: 'image', env: 'REPLICATE_API_TOKEN', configured: Boolean(config.media.replicateToken), model: config.media.replicateModel, capabilities: ['storyboards', 'posters', 'character portraits'], ai: true },
      ],
    },
    tts,
    text: { active: config.ai.provider, items: textProviders() },
    assembly: {
      ffmpeg: config.media.ffmpegPath,
      local: true,
      capabilities: ['trim', 'fade_black', 'dip_white transitions', 'music mix', 'sfx', 'subtitles'],
    },
    policy: {
      enabling: 'Providers are enabled by the operator with environment variables and an API key; this page never accepts secrets.',
      billing: 'Prices come from the same credit engine that charges scenes. Stills and voice takes are free locally.',
      disclosure: 'A feature is only listed as available when its provider is configured. Nothing is mocked.',
      providers: PROVIDER_IDS,
    },
  };
}

/** Per-kind readiness summary for the studio header. */
export function capabilitySummary() {
  const models = listModels();
  const ready = (items) => items.filter((item) => item.configured).length;
  return {
    videoReady: ready(models.video.items),
    imageReady: ready(models.image.items),
    ttsReady: ready(models.tts.items),
    textReady: ready(models.text.items.filter((item) => item.id !== 'local')),
    canRenderFilm: models.video.realGeneration,
    canStoryboard: models.image.configured,
    canVoice: models.tts.items.some((item) => item.configured),
  };
}
