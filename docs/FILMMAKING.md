# AI Filmmaking Platform — Setup, Providers & Limits

Faceless Studio now includes a professional, **scene-by-scene AI filmmaking** product supporting:

- **Short dramas** — vertical 9:16 stories for TikTok, YouTube Shorts, Instagram Reels and Facebook.
- **Long dramas** — multi-scene stories assembled into one continuous film.
- **Movies** — long-form projects from **1 to 60 minutes** out of hundreds of real AI clips (default cap: 720 clips × 10 s = 2 hours of headroom). Longer films are a configuration change, not a code change.
- **Episodic series** — seasons, episodes, story bibles, recurring cast, continuity notes, thumbnails, credits, subtitles and draft/upcoming/completed/published status.

Everything lives in the same ecosystem: one credit ledger, one job worker, one media store, one design system. Short drama is **not** the only supported format.

> **Honesty guarantee.** The server never creates a fake AI video clip, never shows simulated provider progress as real, and never labels deterministic template text as AI output. If a real video provider is not configured, scene generation returns `503 video_provider_unavailable` and tells the user exactly which server variable is missing. Local FFmpeg assembly of **real provider clips** is genuine rendering, not AI video generation.

---

## 1. Architecture

```
Idea / reference image
   ↓  POST /api/films/config → formats, limits, provider readiness, pricing, duration presets
Format + genre + language + duration (1–60 min) + style + platform + provider
   ↓  POST /api/films                        → film_projects (plan validated, never truncated)
Story/screenplay/dialogue
   ↓  POST /api/films/:id/screenplay         → chunked LLM acts (or labelled local template)
Characters + wardrobe + voice + reference images
   ↓  film_characters (per project and per series)
Production run
   ↓  POST /api/films/:id/generation/start   → scenes marked planned, concurrency slots start
   ↓  job film_generate_scene                → credits reserved → provider prediction → REAL clip
   ↓  POST .../pause | /resume | /cancel     → run controls, provider cancel, refunds
   ↓  job film_dispatch_scenes / worker sweep→ next planned scenes start as slots free up
Sound design
   ↓  TTS per character voice + uploaded music + uploaded SFX cues + SRT
Assembly
   ↓  job film_assemble                      → normalise → segments → concat → mix → subtitles
Preview → export → save → publish
   ↓  GET /api/films/:id/download
```

Tables: `film_projects`, `film_scenes`, `film_characters`, `film_series`, `film_episodes`, `credit_accounts`, `credit_ledger`. Production state is additive on existing rows: `film_projects.run_state|scene_provider|assembly_cancel_requested` and `film_scenes.cast|sfx|cancel_requested|queued_at` are migrated in place, so existing projects keep working. Job types: `film_generate_scene`, `film_assemble`, `film_dispatch_scenes`.

**Recovery model.** Each provider prediction is stored as an opaque, secret-free handle on the scene row. The worker polls it; if the process dies, stale-job recovery requeues it and polling resumes against the *same* provider job. A job heartbeat keeps long renders from being mistaken for stale work. Credits are reserved before the request and refunded exactly once (idempotency key per scene attempt) on definitive failure, cancellation or timeout. The worker also sweeps films with `planned` scenes every few seconds so a restart cannot stall a long run.

---

## 2. Real AI video providers

Configure one or more providers on the server. `FILM_VIDEO_PROVIDER` is the server default; a project may store its own provider choice (`scene_provider`), which the server validates against the configured list before any request. Keys never leave the server; no endpoint returns them, and no key is ever written to a provider handle or job payload.

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

### Clip lengths, cancellation and provider selection

- Models accept a fixed set of clip lengths. Adapters map the storyboard length onto the nearest supported value (`FILM_REPLICATE_DURATIONS`, `FILM_FAL_DURATIONS`, `FILM_VEO_DURATIONS`; defaults `5,10`, `5,10`, `4,6,8`) and the renderer trims or pads to the exact scene duration. A 7 s beat on a 5/10 s model becomes a 10 s prediction trimmed to 7 s — the film length still matches the plan.
- `POST /api/films/:id/generation/cancel` and per-scene cancel call the provider's cancel endpoint where one exists (Replicate predictions, fal queue). Veo exposes no cancel operation, so the app says so, discards any late result and still refunds locally.
- `GET /api/films/config` returns a capability catalogue (`durations`, `aspectRatios`, `supportsCancel`, `supportsReferenceImage`) for every provider without exposing credentials.

`REPLICATE_API_ROOT`, `FAL_API_ROOT`, `GOOGLE_VEO_API_ROOT` exist for approved enterprise gateways and isolated integration tests. Production rejects non-HTTPS external overrides.

### AI screenwriting & voices

- Screenplays: `AI_PROVIDER=openai|anthropic|gemini` plus the matching key. Long films are written in **chunked acts** (`FILM_SCREENPLAY_CHUNK_SCENES`, default 25) that share the story bible, the recurring cast and the tail of the previous chunk; a top-up pass requests any shortfall and the response reports the honest `sceneCount`, `requestedSceneCount` and `shortfall` instead of inventing scenes. With `AI_PROVIDER=local`, the system produces a **deterministic template draft explicitly labelled `aiGenerated: false` / `provider: local-template`**. It is a structuring aid, not AI writing. Requesting `allowTemplate: false` returns `503 ai_provider_required`.
- Voices: existing `TTS_PROVIDER=mespeak|openai|elevenlabs` pipeline. `mespeak` works offline; OpenAI/ElevenLabs need their keys. Voices are synthesised per dialogue line using each character's preset.
- Music: procedural ambient audio is available in the legacy pipeline. For films, upload a licensed track per project (`POST /api/films/:id/upload`, `kind=music`). The renderer mixes it under dialogue at low volume.
- Sound effects: upload real audio clips (`kind=sfx`, max 25 MB) into the project library, then attach cues per scene (`atSeconds`, `gain`) via the scene editor. Cues are decoded with FFmpeg and mixed at the exact timestamp; a missing asset is reported in preflight instead of being silently invented. `FILM_SFX_ENABLED=false` disables the feature.
- Lip-sync: **only** where the chosen model natively supports it (Google Veo with audio-capable variants). The UI does not claim lip-sync for Replicate/Fal text/image-to-video models.
- Character consistency: every scene prompt repeats the cast's identical appearance/wardrobe description, the film's story-bible world and continuity notes, and the location/time of day. Scenes store their `cast`; image-to-video providers receive the strongest available reference image (project reference, character sheet, then a cast member's reference). This is production-grade prompting, not a guaranteed identity lock — no provider offers that for arbitrary characters.

---

## 3. Generation limits

| Setting | Default | Meaning |
|---|---|---|
| `FILM_MAX_SCENE_SECONDS` | 10 | Maximum duration of one provider clip (configurable). |
| `FILM_MIN_SCENE_SECONDS` | 4 | Minimum clip length; scene durations are clamped into this range. |
| `FILM_MAX_SCENES` | 720 | Maximum scenes per project (configurable). |
| `FILM_MAX_PROJECT_SECONDS` | 3600 | Maximum requested duration (60 minutes). |
| `FILM_MIN_PROJECT_SECONDS` | 5 | Minimum project duration. |
| `FILM_SCENE_CONCURRENCY` | 4 | Scene jobs in flight per film (keep below `WORKER_CONCURRENCY`). |
| `FILM_SCREENPLAY_CHUNK_SCENES` | 25 | Scenes per screenplay "act" request. |
| `FILM_ASSEMBLY_SEGMENT_SCENES` | 24 | Clips per render segment before stream-copy concatenation. |
| `FILM_MAX_RENDER_WIDTH` | 1280 | Long-edge cap for the normalised canvas. |
| `FILM_BURN_IN_MAX_SECONDS` | 900 | Longer films get a soft subtitle track + `.srt` instead of a full re-encode. |
| `FILM_ASSEMBLY_TIMEOUT_MS` | 14400000 | Render watchdog (4 h). |
| `FILM_SFX_ENABLED` | true | Allow project sound-effect uploads and cues. |
| `FILM_MAX_REFERENCE_IMAGE_MB` | 10 | Upload cap for reference/character images. |
| `FILM_MAX_CLIP_MB` | 200 | Hard cap when downloading a provider video. |
| `FILM_POLL_INTERVAL_MS` | 5000 | Provider polling cadence. |
| `FILM_POLL_TIMEOUT_MS` | 900000 | Per-prediction timeout; clamped below `JOB_TIMEOUT_MS`. |
| `WORKER_ENABLED` | true | Required for all generation and assembly. |
| `WORKER_CONCURRENCY` | 6 | Total concurrent jobs per worker process. |

### How the plan is computed

`sceneCount = ceil(targetSeconds / maxSceneSeconds)` — **never clamped**. A 60-minute film at 10 s per clip is exactly 360 scenes, and the scene durations are spread evenly so the finished cut matches the requested runtime. Two limits are enforced *before* anything is queued, and both fail loudly instead of shortening your movie:

- `400 duration_exceeds_limit` when the requested runtime is longer than `FILM_MAX_PROJECT_SECONDS`. The payload repeats the requested and maximum seconds and tells you which environment variables to raise.
- `400 scene_plan_exceeds_limit` when the plan would need more scenes than `FILM_MAX_SCENES`. The payload carries `sceneCount`, `maxScenes` and the longest runtime the deployment can currently produce.

The planner reports both the raw request (`requestedSeconds`) and the value it planned for (`plannedForSeconds`), so a mismatch is always visible. Writing a screenplay without an explicit runtime always inherits the project's own `targetDurationSeconds` — a 20-minute project never falls back to a 60-second cut. `GET /api/films/config.limits.maxProducibleSeconds` is `min(FILM_MAX_SCENES × FILM_MAX_SCENE_SECONDS, FILM_MAX_PROJECT_SECONDS)`: the longest film the deployment can actually deliver.

| Requested | Scenes at 10 s | Result |
|---|---|---|
| 1 min | 6 | ✔ |
| 10 min | 60 | ✔ |
| 30 min | 180 | ✔ |
| 60 min | 360 | ✔ (default limit is 720) |
| 120 min | 720 | ✘ `duration_exceeds_limit` until `FILM_MAX_PROJECT_SECONDS` ≥ 7200 |
| 180 min | 1080 | ✘ explicit error until both limits are raised |

**A single AI request never produces a feature-length film.** A 60-minute movie becomes 360 provider predictions plus one segmented FFmpeg assembly. `GET /api/films/config` exposes the limits, presets and the longest producible runtime, and `POST /api/films/estimate` returns the exact scene plan and credit cost before any job starts.

### Worker crashes and resumability

Generation state lives in the database, never in memory: every scene stores its provider handle,
attempt number and reserved credits before the first poll. A `film_generate_scene` job whose lock
belongs to a process that no longer exists (same host, PID gone) is re-queued on the next worker tick
and resumes polling the **same** provider prediction — no second charge and no duplicate clip. Jobs
on other hosts fall back to `JOB_TIMEOUT_MS`. When retries are exhausted after a crash the scene is
marked failed and refunded rather than left `processing` forever. See
[`PRODUCTION-ACCEPTANCE.md`](./PRODUCTION-ACCEPTANCE.md) for the measured recovery time.

### Long-form production controls

- **Start / pause / resume / cancel** a whole run. Starting marks pending scenes `planned`, then fills `FILM_SCENE_CONCURRENCY` provider slots. Finishing a scene triggers the dispatcher; a worker sweep covers restarts.
- **Cancel** calls the provider cancel endpoint when available, refunds each reserved scene exactly once, keeps every finished clip, and stops the run. A late provider result is discarded.
- **Retry failed** requeues only failed/cancelled scenes.
- **Progress** is available per film (`GET /api/films/:id/progress`) with counts, active scene details and an ETA measured from observed completions (never a fabricated guess).
- **Render cancellation** is supported mid-FFmpeg via a DB flag polled during progress events; a cancelled render is refunded and leaves the previous verified cut untouched.
- **Storage guard.** Before rendering, the estimated temporary size is compared with free disk; an insufficient disk returns `507` rather than filling the volume.

### Assembly pipeline (long-form aware)

1. Probe and normalise each clip to one canvas/fps/exact scene duration.
2. Build audio **scene by scene** (cached TTS per line, SFX cues, music later) into a raw PCM file — a 60-minute soundtrack is never held in memory.
3. Render in segments of `FILM_ASSEMBLY_SEGMENT_SCENES`, muxing each segment's audio by timestamp, then concatenate segments with stream copy.
4. Mix optional background music at low volume (video stream copied).
5. Subtitles: burn-in for short films, a real `mov_text` soft track plus downloadable `.srt` for long ones.
6. Probe the staged MP4 (video stream + duration + size) and only then atomically publish it; otherwise the render fails with a clear error and reserved credits are refunded.

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
| POST | `/:id/scenes/generate-all` | Queue all draft/failed scenes (bounded by concurrency). |
| POST | `/:id/generation/start` | Start/resume a production run (`sceneIds` optional). |
| POST | `/:id/generation/pause` | Stop starting new scenes; in-flight scenes finish. |
| POST | `/:id/generation/resume` | Continue a paused run. |
| POST | `/:id/generation/cancel` | Cancel the run, cancel provider jobs where supported, refund, keep clips. |
| GET | `/:id/progress` | Live counts, active scenes, run state and ETA. |
| POST | `/:id/scenes/retry-failed` | Requeue failed/cancelled scenes. |
| POST | `/:id/scenes/:sceneId/cancel` | Cancel one scene and refund it. |
| POST | `/:id/scenes/:sceneId/generate` | Generate or regenerate **one** scene. |
| GET | `/:id/scenes/:sceneId/clip` | Stream the real provider MP4 (range requests). |
| GET | `/:id/scenes/:sceneId/poster` | Stream the poster frame. |
| GET | `/:id/preflight` | Assembly readiness + missing scenes + render cost. |
| POST | `/:id/assemble` | Queue final FFmpeg render (`subtitles`, `burnSubtitles`). |
| POST | `/:id/assembly/cancel` | Cancel a running render and refund it. |
| GET/DELETE | `/:id/sfx[/:assetId]` | List / delete project sound-effect assets. |
| GET | `/:id/media/:asset` | `video`, `thumbnail`, `captions`, `reference`, `music`. |
| GET | `/:id/download` | Download the playable MP4. |
| POST | `/:id/publish` | Mark published (and complete a linked episode). |
| POST | `/:id/upload` | multipart upload: `kind=reference\|music\|character\|sfx`. |
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

The project workspace is a six-step resumable wizard. Every step persists to the DB; closing the browser never loses progress. It polls safely while jobs run and shows real status, failed jobs, remaining credits and provider errors. Duration presets (1–60 min) display the exact clip plan and credit estimate before creation; the generation panel exposes start/pause/resume/cancel/retry with live per-scene progress and an ETA; the render panel shows segment count, temporary disk needs, sound-effect cues and the subtitle mode.

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
npm test                 # includes filmmaking, film-providers, film-longform and film-routes suites
npm run build
npm run setup -- --check # overall configuration status
```

`tests/film-longform.test.js` (10 tests) and `tests/film-migration.test.js` (2 tests) cover, in order: a 60-minute request planned as exactly 360 clips, both over-limit error codes with exact numbers, a screenplay inheriting the project runtime, the estimate payload and config advertisement (including `maxProducibleSeconds`), provider duration mapping, rejection of an empty/corrupt provider file, a bounded-concurrency run through start → pause → resume → cancel with exact refunds and provider cancellation, a segmented render with real SFX + music + a soft subtitle track, and an in-place upgrade of a pre-long-form database that keeps every existing project and scene.

The rest of the test suite replaces the provider boundary with a **local HTTP test double** that mimics Replicate/Fal/Veo and serves a real H.264 file produced by FFmpeg. It verifies: credit idempotency and refunds, honest 503 without a provider, screenplay/scene persistence, per-scene regeneration, bounded concurrency with pause/resume/cancel, cancel refunds, long-form scene planning (360 scenes for 60 minutes, explicit over-limit errors, no truncation), provider duration mapping, rejection of corrupt clips, sound-effect mixing, segmented FFmpeg assembly with subtitles and voices, a playable MP4 (`ftyp` box), series continuity, character isolation, and no API-key leakage. Production code contains no such fallback.
