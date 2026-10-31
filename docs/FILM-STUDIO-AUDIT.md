# WINDELS AI FILM STUDIO — repository audit & implementation report

**Date:** 2026-10-31
**Scope:** the existing Faceless Studio / WINDELS AI OS repository, its AI Filmmaking
subsystem, and the 12 modules requested in the upgrade brief.

This report follows the brief's rule: *a feature counts only when it works end to
end.* Each entry below is backed by code paths, database columns, API routes and
automated tests, or it is explicitly listed as missing.

---

## 1. How this audit was produced

1. Read the full film subsystem: `server/film/*` (screenplay, scenes, series,
   providers, assembly, credits), `server/routes/films.js`, the film React
   pages, the schema in `server/db.js` and the existing film test suites.
2. Ran the untouched test suite as a baseline (174 tests, all passing).
3. Implemented the Phase 1 gaps described in §4 and re-ran everything
   (182 tests, all passing).
4. Verified the desktop bundle builds (`vite build`, 2729 modules).

Nothing below is inferred from a button label or a table name alone.

---

## 2. What already worked (verified, not assumed)

| Capability | Evidence |
|---|---|
| Project creation, editing, deletion, ownership isolation | `film_projects`, `ownedFilm()` role checks, API tests |
| AI or offline screenplay with scene breakdown | `generateScreenplay()` — real LLM when configured, labelled local template otherwise |
| Long-form scene planning (never truncated) | `planProject()`, `FILM_MAX_SCENES` guard, 409 on over-limit |
| Recurring cast with appearance prompts and reference images | `film_characters`, `scenePrompt()` cast block |
| Series / seasons / episodes / story bible | `film_series`, `film_episodes`, `series.js` |
| Real video generation through 3 providers | `videoProviders.js` (Replicate, fal, Veo), no synthetic fallback |
| Provider capability catalogue (durations, aspect, cancel) | `providerCatalog()`, `GET /api/films/config` |
| Durable jobs, concurrency, pause/resume/cancel/retry, crash-safe resume | `jobs` table, `processFilmSceneJob()`, long-form tests |
| Credit reservation, idempotent refunds | `credits.js`, `film-longform.test.js` |
| FFmpeg assembly: concat, voice (TTS), music, SFX, subtitles, thumbnail | `assembly.js`, `assembleFilm()` |
| Export + publish state | `/download`, `/media/*`, `publishFilm()` |
| Provider readiness and admin configuration | `integrationReadiness.js`, activation modules 8–11 |

---

## 3. Existing-versus-missing matrix (12 modules)

Status legend: **DONE** = works end to end; **PARTIAL** = real backend exists but
coverage is incomplete; **MISSING** = no working implementation.

| # | Module | Before this phase | After Phase 1 | What is still missing |
|---|---|---|---|---|
| 1 | AI Director Studio | PARTIAL — prompt-only "camera movement" | **PARTIAL+** — shot size, angle, lens, lighting, grade, movement and composition are stored, validated and injected into the provider prompt; the AI screenplay now authors them | Multi-shot coverage inside one scene, automatic continuation between scenes, dedicated storyboard view |
| 2 | Actor & Character Studio | PARTIAL — name, role, description, appearance prompt, voice preset, reference image, series reuse, casting | Same | Expressions, outfits, age variants, poses, character relationships, user-level (cross-project) cast library |
| 3 | Cinematography Studio | PARTIAL — one free-text field | **DONE (controls)** — closed vocabularies (10 shot sizes, 8 angles, 17 movements, 8 lenses, 12 lighting setups, 9 grades) with depth-of-field phrases | Natural-language → structured shot parsing; per-shot overrides inside a scene |
| 4 | Image Generation Studio | MISSING for film (the faceless-video image engine exists) | Not started | Storyboard stills, posters, image-to-image, upscaling, background removal, variations |
| 5 | Video Generation Studio | PARTIAL — text/image-to-video through 3 providers, durations, aspect ratios, cancel | Same | First/last-frame conditioning, video-to-video, extension, capability-aware routing beyond duration/aspect |
| 6 | Voice & Lipsync Studio | PARTIAL — per-character voice preset; dialogue voiced at assembly by mespeak/OpenAI/ElevenLabs | Same | Per-scene voice assets, voice cloning, lip-sync, dubbing/translation, preview before render |
| 7 | Motion Transfer & VFX | MISSING | Not started | Motion/pose transfer, background and object replacement, interpolation |
| 8 | Marketing & Ad Studio | MISSING | **PARTIAL** — `advertisement` is a first-class project format with its own duration/aspect defaults | Product intake, product photography, ad variations, brand kits |
| 9 | Creative Canvas | MISSING | Not started | Node graph, templates, execution history |
| 10 | Movie Editing Studio | PARTIAL — reorder, edit prompts/dialogue, regenerate, subtitles, music, SFX, render | Same | Multi-track NLE, trimming/splitting, transitions, per-scene audio editing, text overlays |
| 11 | Production Agent | MISSING | Not started (primitives exist: screenplay → cast → scenes → generate-all) | Conversational orchestration with per-stage approval and retry budgets |
| 12 | Model Marketplace | PARTIAL — static provider catalogue, encrypted server-side keys, admin activation | Same | Dynamic registry, per-model pricing, health monitoring, automatic fallback |

**Continuity engine** (brief §5): PARTIAL → improved. Project/series characters,
story bible, wardrobe prompts, episode history and now **locations** persist;
props, props-state and a formal timeline entity are still missing.

---

## 4. Phase 1 — implemented and tested in this change

### 4.1 Cinematography controls (Modules 1 + 3)

- New `server/film/cinematography.js`: closed vocabularies plus prompt phrases
  and depth-of-field descriptions per lens.
- `film_scenes` gains `shot_size`, `camera_angle`, `lens`, `lighting`,
  `color_grade`, `composition` (additive migration; legacy rows default to `''`).
- `PATCH /api/films/:id/scenes/:sceneId` validates the values — an unknown shot
  is a `400`, not a silently ignored field.
- `scenePrompt()` now emits a cinematography sentence that reaches the real
  provider request, e.g.:
  `Cinematography: close-up, low angle looking up at the subject, 85mm lens,
  shallow depth of field with creamy background bokeh, dolly pushing in, rim
  lighting, teal and orange blockbuster grade, composition: subject on the left third.`
- The AI screenplay prompt asks for the same fields, and the offline template
  draft now includes real directorial choices so an offline storyboard is usable.
- UI: each scene card exposes shot size, angle, lens, movement, lighting, grade
  and a composition note.

### 4.2 Locations library (workflow step 4 + continuity engine)

- New `film_locations` table (film-, series- or user-scoped) with name,
  description, time of day, weather, palette, style and a reference-image slot.
- `server/film/locations.js`: CRUD with ownership checks and scope rules.
- Routes: `GET/POST /api/films/:id/locations`, `PATCH/DELETE
  /api/films/:id/locations/:locationId`.
- `film_scenes.location_id` links a scene to a saved location. Linking sets the
  scene's on-screen location name; deleting a location **detaches** its scenes
  instead of leaving a dangling reference.
- `scenePrompt()` prefers the saved set description, time of day, weather and
  palette over free text, which is what keeps later episodes in the same room.
- UI: a dedicated **Locations** step with the library, per-scene usage counts and
  a link selector on every scene.

### 4.3 Continuity / quality control engine (workflow step 9)

- New `server/film/continuity.js` and `GET /api/films/:id/qc`.
- Eight real checks computed from persisted state: scenes present, real clips on
  disk, failed generations, shot-direction coverage, cast reference images,
  cast membership of every speaking name, location linkage, runtime vs target,
  dialogue TTS availability and final render presence.
- Each check returns `pass | warn | fail | skip` with evidence and a score. A
  missing provider produces `clips: fail` — QC never passes by default.
- UI: a Quality Control card on the Assemble step.

### 4.4 Formats (workflow step 1, Module 8)

`advertisement`, `music_video` and `cinematic_scene` are now first-class project
types with their own defaults, in the API enum, the screenplay planner, the hub
cards and the new-project form. Existing formats are unchanged.

### 4.5 Compatibility

- All schema changes are additive (`initializeDatabase` migration is idempotent).
- No existing route, table or response shape was removed.
- No new environment variables or providers are required for anything above.

---

## 5. Test evidence

```
npm test                 182 tests, 182 pass, 0 fail   (baseline was 174)
vite build               2729 modules transformed, built in 5.05s
```

New `tests/film-director.test.js` (7 tests, real HTTP + real database):

1. config exposes the cinematography vocabulary and the new formats;
2. the offline screenplay draft ships directorial choices;
3. a scene can be directed and the choices reach the provider prompt;
4. unknown cinematography values are rejected (400);
5. locations are created, linked, reused in prompts, isolated per user, and
   deleted without leaving dangling scene links;
6. QC reports real gaps and never a false pass (no provider ⇒ `clips: fail`);
7. QC flags speaking names that have no character profile.

Extended `tests/film-migration.test.js`: a pre-upgrade database gains the seven
new scene columns and the `film_locations` table in place, without data loss,
and the migration stays idempotent.

---

## 6. Outstanding work (honest list)

| Phase | Work | Blocking dependency |
|---|---|---|
| 2 | Production Agent orchestration (`POST /api/films/:id/produce`) driving screenplay → cast → locations → generate-all → QC with per-stage approval | none — buildable next |
| 2 | Storyboard/still image studio for film (Module 4) | `OPENAI_API_KEY` or `REPLICATE_API_TOKEN` for real images |
| 3 | Multi-track editor + transitions (Module 10) | none in principle; FFmpeg work |
| 3 | Per-scene voice preview and lip-sync (Module 6) | ElevenLabs/OpenAI TTS keys; lip-sync provider |
| 4 | Motion transfer / VFX (Module 7) | third-party provider |
| 4 | Creative canvas (Module 9) | depends on 4–7 node types existing |
| 4 | Model marketplace (Module 12) | provider accounts and pricing decisions |
| — | Native mobile apps, credit packs | out of scope, documented in `docs/FILMMAKING.md` |

Real-vendor video generation remains unverified in this environment: no provider
keys and no outbound access to those APIs. The code path is exercised against a
wire-protocol stub in tests, and production fails honestly with a 503 when no
provider is configured — it never fabricates footage.
