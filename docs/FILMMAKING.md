# AI Filmmaking Platform — Setup, Providers & Limits

Faceless Studio now includes a professional, **scene-by-scene AI filmmaking** product supporting:

- **Short dramas** — vertical 9:16 stories for TikTok, YouTube Shorts, Instagram Reels and Facebook.
- **Long dramas** — multi-scene stories assembled into one continuous film.
- **Movies** — long-form projects of up to 120 short clips (default cap).
- **Episodic series** — seasons, episodes, story bibles, recurring cast, continuity notes, thumbnails, credits, subtitles and draft/upcoming/completed/published status.

Everything lives in the same ecosystem: one credit ledger, one job worker, one media store, one design system. Short drama is **not** the only supported format.

> **Honesty guarantee.** The server never creates a fake AI video clip, never shows simulated provider progress as real, and never labels deterministic template text as AI output. If a real video provider is not configured, scene generation returns `503 video_provider_unavailable` and tells the user exactly which server variable is missing. Local FFmpeg assembly of **real provider clips** is genuine rendering, not AI video generation.

---

## 1. Architecture

```
Idea / reference image
   ↓  POST /api/films/config → formats, limits, provider readiness, pricing
Format + genre + language + duration + style + platform
   ↓  POST /api/films                        → film_projects
Story/screenplay/dialogue
   ↓  POST /api/films/:id/screenplay         → LLM (or labelled local template)
Characters + visual references
   ↓  film_characters (per project and per series)
Scene-by-scene generation
   ↓  POST .../scenes/:id/generate           → credits reserved → provider prediction
   ↓  job film_generate_scene                → polls provider, downloads REAL clip
Voices / subtitles / music
   ↓  job film_assemble                      → FFmpeg concat + TTS + SRT + music
Preview → export → save → publish
   ↓  GET /api/films/:id/download
```

New tables: `film_projects`, `film_scenes`, `film_characters`, `film_series`, `film_episodes`, `credit_accounts`, `credit_ledger`. New job types: `film_generate_scene`, `film_assemble`.

**Recovery model.** Each provider prediction is stored as an opaque, secret-free handle on the scene row. The worker polls it; if the process dies, stale-job recovery requeues it and polling resumes against the *same* provider job. Credits are reserved before the request and refunded exactly once (idempotency key per scene attempt) on definitive failure.

---

## 2. Real AI video providers

Configure **one** provider on the server. Keys never leave the server; no endpoint returns them.

| `FILM_VIDEO_PROVIDER` | Credential | API used | Typical clip | Notes |
|---|---|---|---|---|
| `replicate` | `REPLICATE_API_TOKEN` | `POST /v1/models/{model}/predictions`, poll `GET /v1/predictions/{id}` | 5–10 s | Default model `kwaivgi/kling-v2.1-master`. Change with `FILM_REPLICATE_VIDEO_MODEL`. |
| `fal` | `FAL_API_KEY` | `POST https://queue.fal.run/{model}`, poll `status_url`, fetch `response_url` | 5–10 s | Default model `fal-ai/kling-video/v2.1/master/image-to-video`. |
| `veo` | `GOOGLE_VEO_API_KEY` (or `GEMINI_API_KEY`) | `predictLongRunning` on `generativelanguage.googleapis.com`, poll operation | 4–8 s | Default `veo-3.0-generate-001`. Access may require allowlisting. Google may apply SynthID watermarking. |
| `none` | — | — | — | **Scene generation disabled.** Screenwriting, planning, credits, editing and assembly still work. |

### Model-specific input keys

Video models disagree on parameter names. Override without editing code:

```bash
FILM_REPLICATE_VIDEO_MODEL=your-org/your-model
FILM_REPLICATE_IMAGE_KEY=first_frame_image        # default: start_image
FILM_REPLICATE_INPUT_JSON='{"duration":5,"guidance_scale":5}'
FILM_FAL_VIDEO_MODEL=fal-ai/your-model
FILM_FAL_IMAGE_KEY=image_url
FILM_FAL_INPUT_JSON='{"duration":"5"}'
FILM_VEO_PARAMETERS_JSON='{"durationSeconds":4,"personGeneration":"allow_adult"}'
```

Partial JSON is merged over the generated input. Reference images are sent as data URIs (`REPLICATE_IMAGE_KEY` / `FAL_IMAGE_KEY`) or inline base64 (`Veo`). Text-to-video models ignore image inputs; the app still works.

`REPLICATE_API_ROOT`, `FAL_API_ROOT`, `GOOGLE_VEO_API_ROOT` exist for approved enterprise gateways and isolated integration tests. Production rejects non-HTTPS external overrides.

### AI screenwriting & voices

- Screenplays: `AI_PROVIDER=openai|anthropic|gemini` plus the matching key. With `AI_PROVIDER=local`, the system produces a **deterministic template draft explicitly labelled `aiGenerated: false` / `provider: local-template`**. It is a structuring aid, not AI writing. Requesting `allowTemplate: false` returns `503 ai_provider_required`.
- Voices: existing `TTS_PROVIDER=mespeak|openai|elevenlabs` pipeline. `mespeak` works offline; OpenAI/ElevenLabs need their keys. Voices are synthesised per dialogue line using each character's preset.
- Music: procedural ambient audio is available in the legacy pipeline. For films, upload a licensed track per project (`POST /api/films/:id/upload`, `kind=music`). The renderer mixes it under dialogue at low volume.
- Lip-sync: **only** where the chosen model natively supports it (Google Veo with audio-capable variants). The UI does not claim lip-sync for Replicate/Fal text/image-to-video models. Character consistency is handled by reusing the same appearance prompt in every scene prompt; it is best-effort, not a guaranteed identity lock.

---

## 3. Generation limits

| Setting | Default | Meaning |
|---|---|---|
| `FILM_MAX_SCENE_SECONDS` | 10 | Maximum duration of one provider clip. |
| `FILM_MAX_SCENES` | 120 | Maximum scenes per project. |
| `FILM_MAX_PROJECT_SECONDS` | 3600 | Maximum requested duration (1 hour). |
| `FILM_MAX_REFERENCE_IMAGE_MB` | 10 | Upload cap for reference/character images. |
| `FILM_MAX_CLIP_MB` | 200 | Hard cap when downloading a provider video. |
| `FILM_POLL_INTERVAL_MS` | 5000 | Provider polling cadence. |
| `FILM_POLL_TIMEOUT_MS` | 900000 | Per-prediction timeout; clamped below `JOB_TIMEOUT_MS`. |
| `WORKER_ENABLED` | true | Required for all generation and assembly. |

**A single AI request never produces a feature-length film.** A 20-minute movie becomes ~120 short clips plus one FFmpeg assembly pass. `GET /api/films/config` exposes these limits to the UI, and `POST /api/films/estimate` computes the exact credit cost before any job starts.

Providers additionally enforce their own limits (resolution, concurrent predictions, queue depth, content policies, rate limits, region availability). Those are outside this application; failures are surfaced verbatim (redacted) with refunds.

---

## 4. Credits & cost accounting

| Setting | Default |
|---|---|
| `FILM_CREDIT_PER_VIDEO_SECOND` | 10 |
| `FILM_CREDIT_PER_TTS_1K_CHARS` | 2 |
| `FILM_CREDIT_PER_ASSEMBLY` | 5 |

One-time signup grant by plan: `free 60`, `starter 300`, `creator 900`, `scale 3000` (override in `creditGrantForPlan`). The ledger is append-only with a unique `idempotency_key` per mutation, so retries cannot double-charge.

Flow:

1. `POST /api/films/estimate` → exact breakdown (video / voice / render) + balance + shortfall. No charge.
2. Scene generation reserves `ceil(seconds × rate)` credits. Regenerating one scene charges only that scene.
3. Provider start failure, definitive provider failure, or timeout → `scene_refund`, scene marked `failed`, notification created, job completed (no infinite retry).
4. Success → reservation becomes the charge; clip stored; `credits_spent` incremented.
5. Assembly reserves voice + render credits; failure refunds them too.
6. `GET /api/films/credits` shows the full ledger.

**Credit top-ups / credit packs are not implemented.** Plan changes are handled by the existing Stripe billing module; adding purchasable credit packs requires Stripe Price IDs and webhook handling for `credit_grant` ledger entries.

---

## 5. REST API

All routes require an authenticated session and are mounted at `/api/films`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | Formats, genres, styles, languages, voices, limits, pricing, balance, provider readiness. |
| POST | `/estimate` | Credit estimate from scenes, a screenplay, or a target duration. |
| POST | `/screenplay` | Standalone AI Script Writer (no project). |
| GET/POST | `/`, `/` | List / create film projects. |
| GET/PATCH/DELETE | `/:id` | Full detail / edit / delete a project. |
| POST/PUT | `/:id/screenplay` | Generate / save an edited screenplay (rebuilds scene rows). |
| GET/POST | `/:id/scenes` | List / add a scene. |
| PATCH/DELETE | `/:id/scenes/:sceneId` | Edit / delete a scene. |
| POST | `/:id/scenes/reorder` | Reorder storyboard. |
| POST | `/:id/scenes/generate-all` | Queue all draft/failed scenes. |
| POST | `/:id/scenes/:sceneId/generate` | Generate or regenerate **one** scene. |
| GET | `/:id/scenes/:sceneId/clip` | Stream the real provider MP4 (range requests). |
| GET | `/:id/scenes/:sceneId/poster` | Stream the poster frame. |
| GET | `/:id/preflight` | Assembly readiness + missing scenes + render cost. |
| POST | `/:id/assemble` | Queue final FFmpeg render. |
| GET | `/:id/media/:asset` | `video`, `thumbnail`, `captions`, `reference`, `music`. |
| GET | `/:id/download` | Download the playable MP4. |
| POST | `/:id/publish` | Mark published (and complete a linked episode). |
| POST | `/:id/upload` | multipart upload: `kind=reference\|music\|character`. |
| GET/POST | `/characters` | Character studio. |
| DELETE | `/characters/:id` | Delete a character. |
| GET | `/credits`, `/credits/history` | Balance, pricing, ledger. |
| GET/POST | `/series`, `/series/:id` | Series CRUD + detail with seasons/episodes/cast. |
| POST | `/series/bulk-episodes` | Create a season outline. |
| POST/PATCH/DELETE | `/series/:id/episodes[/:episodeId]` | Episode CRUD. |
| POST | `/series/:id/episodes/:episodeId/screenplay` | Write an episode script using the story bible, recurring cast and previous episodes. |

---

## 6. Frontend / mobile

Routes (all under the existing authenticated `/app` shell, same brand, themes and navigation):

`/app/films` hub · `/short` · `/long` · `/series` · `/scripts` · `/characters` · `/scenes` · `/audio` · `/editor` · `/projects` · `/media` · `/published` · `/credits` · `/project/:id?step=setup|write|cast|scenes|render|preview`.

The project workspace is a six-step resumable wizard. Every step persists to the DB; closing the browser never loses progress. It polls safely while jobs run and shows real status, failed jobs, remaining credits and provider errors.

### Web, Android, iOS

- The app is a responsive **installable PWA** (`/manifest.webmanifest`, `/sw.js`, 192/512/maskable icons, standalone display, iOS meta tags). On Android it can be installed from Chrome; on iOS it can be added to the Home Screen from Safari. It works on phones and tablets with the same account and data.
- The service worker caches only the app shell and static assets. **API responses, media and authenticated state are never cached**, so credits, jobs and videos always reflect the server.
- **Native App Store / Play Store binaries are not implemented.** Store-ready native wrappers (Capacitor/React Native), push notifications, in-app purchases, signing and store review are a separate phase. Do not claim native apps exist.

---

## 7. Commercial use & legal notes (read before publishing)

This application is plumbing; **you are responsible for the rights to what you generate and upload.** Verify the current terms of each provider before commercial use — they change.

- **Replicate** — you pay per prediction/second of compute; model licences are set by each model's owner (Kling, Wan, Minimax, etc.). Check the specific model page for commercial-use terms, attribution and content restrictions. Some models forbid certain uses or require a paid plan.
- **Fal.ai** — usage-based pricing per model; model-specific licences apply. Queue limits and concurrency depend on your plan.
- **Google Veo / Gemini API** — subject to Google's Generative AI Prohibited Use Policy, regional availability and possible allowlisting. Google may embed **SynthID** watermarks in generated video; do not remove or obscure provenance signals. Review Google's terms for commercial distribution and disclosure obligations.
- **OpenAI / Anthropic / Gemini (text)** and **OpenAI / ElevenLabs (voice)** — each has its own usage policy, rate limits and commercial terms.
- **Music, reference images, likenesses** — only upload assets you own or have licensed for commercial use. Do not upload real people's photos without consent. The app stores uploads privately per user but does not verify rights.
- **Platform rules** — TikTok, YouTube, Instagram, Facebook and X have their own synthetic-media disclosure rules. Label AI-generated content where required.
- **No copyright guarantee.** The screenplay prompt instructs models to write original fiction, but no system can guarantee non-infringement. Review output before publishing.

---

## 8. Features that still need configuration or a paid service

| Feature | Requirement |
|---|---|
| Real AI scene video | `FILM_VIDEO_PROVIDER` + paid provider credential. |
| Genuine AI screenwriting | `AI_PROVIDER=openai\|anthropic\|gemini` + key. Otherwise labelled template. |
| Premium character voices | `TTS_PROVIDER=openai\|elevenlabs` + key. |
| Lip-sync / native audio | A provider/model that explicitly supports it (e.g. Veo variants). |
| Background music | Your own licensed upload, or a separately licensed music API. |
| Publishing to social networks | Existing official OAuth apps, connected accounts, public HTTPS origin, provider app review. Publishing a film only marks it published locally; it does not silently post to networks. |
| Purchasable credit packs | Stripe Price IDs + webhook → `credit_grant` ledger integration. |
| Native Android/iOS store apps | Separate native-wrapper project and store review. |
| Multi-node storage | Shared object storage / PostgreSQL for `STORAGE_DIR` clips; current default is local disk + SQLite. |

---

## 9. Verifying locally

```bash
npm ci
npm test                 # includes tests/filmmaking.test.js and tests/film-providers.test.js
npm run build
npm run setup -- --check # overall configuration status
```

The test suite replaces the provider boundary with a **local HTTP test double** that mimics Replicate/Fal/Veo and serves a real H.264 file produced by FFmpeg. It verifies: credit idempotency and refunds, honest 503 without a provider, screenplay/scene persistence, per-scene regeneration, FFmpeg assembly with subtitles and voices, a playable MP4 (`ftyp` box), series continuity, character isolation, and no API-key leakage. Production code contains no such fallback.
