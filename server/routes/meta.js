import express from 'express';
import { NICHES, STYLES, LANGUAGES, VOICES, ASPECTS, PLATFORMS } from '../constants.js';
import { providerStatus, config } from '../config.js';
import { getSetting } from '../db.js';

export function metaRouter() {
  const router = express.Router();
  router.get('/options', async (req, res) => {
    const supportedPlatforms = await getSetting('supported_platforms', Object.keys(PLATFORMS));
    const supportedLanguages = await getSetting('supported_languages', LANGUAGES.map((l) => l.id));
    res.json({
      appName: config.appName,
      niches: NICHES,
      styles: STYLES,
      languages: LANGUAGES.filter((language) => supportedLanguages.includes(language.id)),
      voices: VOICES,
      aspects: ASPECTS,
      platforms: Object.fromEntries(Object.entries(PLATFORMS).filter(([key]) => supportedPlatforms.includes(key))),
      tones: [
        { id: 'dramatic', name: 'Dramatic' },
        { id: 'conversational', name: 'Conversational' },
        { id: 'educational', name: 'Educational' },
        { id: 'inspiring', name: 'Inspiring' },
        { id: 'documentary', name: 'Documentary' },
      ],
      durationRange: { min: 15, max: 180 },
      providerStatus: providerStatus(),
    });
  });
  router.get('/status', (_req, res) => res.json(providerStatus()));
  router.get('/health', (_req, res) => res.json({ ok: true, service: config.appName, time: new Date().toISOString() }));
  return router;
}
