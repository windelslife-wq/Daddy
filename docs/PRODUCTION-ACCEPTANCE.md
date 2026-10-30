# Production acceptance — cinematic film generation

**Status: NOT production-verified for real AI footage. Final gate attempt on 2026-10-30 returned
BLOCKED — EXTERNAL PROVIDER ACCESS REQUIRED (see §0).**

This document is deliberately blunt: the pipeline has been verified end-to-end with real FFmpeg
media, real worker processes, real HTTP provider clients, real credits and a real published MP4 —
but **no real vendor (Veo / Replicate / fal.ai) has generated a frame for this build**, because the
verification environment has neither credentials nor network egress to the vendor APIs:

```
$ env | grep -E 'REPLICATE|FAL_|GOOGLE_VEO'      → (empty)
$ curl -s -o /dev/null -w '%{http_code}' https://api.replicate.com/            → 000 (TLS blocked)
$ curl -s -o /dev/null -w '%{http_code}' https://queue.fal.run/                → 000 (TLS blocked)
$ curl -s -o /dev/null -w '%{http_code}' https://generativelanguage.googleapis.com/ → 000 (TLS blocked)
```

Per the acceptance rule, nothing below may be described as "real AI video generation is
production-verified" until `npm run verify:provider` produces a probed clip from a live vendor.

---

## 0. Final gate attempt — 2026-10-30 (Africa/Lagos)

**Result: BLOCKED — EXTERNAL PROVIDER ACCESS REQUIRED.**

Phase 1 (Replicate credentials + real clip) and Phase 2 (complete real film) were **not executed**.
No vendor endpoint was contacted, no prediction was created, no clip was generated, and nothing in
this repository is marked production-verified.

Evidence collected at the time of the attempt:

| Check | Result |
|---|---|
| `env \| grep -E 'REPLICATE\|FAL_\|GOOGLE_VEO\|GEMINI'` | empty — no keys in the process environment |
| Deployment `.env` | `FILM_VIDEO_PROVIDER=none`, `REPLICATE_API_TOKEN=` (empty), `FAL_API_KEY` / `GOOGLE_VEO_API_KEY` absent |
| DNS | resolves (`api.replicate.com` → `2606:4700::6812:23c`) |
| TLS egress | **blocked**: `curl https://api.replicate.com/` → `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to api.replicate.com:443`; identical for `queue.fal.run` and `generativelanguage.googleapis.com` |
| `npm run verify:provider -- --provider=replicate` | exits `1` — `✖ replicate: no API key configured.` (fails closed, as designed) |

### Harness rehearsal (not provider verification)

The verification command was exercised end-to-end against a **local wire-protocol stub with an
obviously fake token** (`r8_rehearsalFakeTokenNotARealKey`): start → poll (`processing` → `succeeded`)
→ download → `ffprobe` (3.02 s, 320×180, 81,489 bytes, audio present) → artifact written → exit `0`.
The artifact was deleted immediately afterwards so it cannot be mistaken for a vendor result. This
proves the gate command and its reporting path work; **it is not real AI footage.**

### Regression state at the time of this note

`npm test` 174/174 · `npm run test:e2e` 15/15 flows · `npm run test:visual` 10/10 · `npm run build` clean.

### What unblocks Phases 1–3

1. Put a real key in the deployment's private `.env`:
   `FILM_VIDEO_PROVIDER=replicate` and `REPLICATE_API_TOKEN=r8_…`
   (or `FAL_API_KEY` / `GOOGLE_VEO_API_KEY` for the other adapters).
2. Allow outbound HTTPS to `api.replicate.com` (and/or `queue.fal.run`, `generativelanguage.googleapis.com`).
3. **Phase 1 — one real clip:** `npm run verify:provider -- --provider=replicate --check-auth`
   → keep `test-artifacts/provider-verification.json`.
4. **Phase 2 — the whole film, one command:**
   `npm run verify:film -- --seconds=60 --music=./score.mp3 --sfx=./thunder.wav`
   It signs in, creates a project, writes the screenplay, uploads music/SFX, generates every scene
   with the provider, checks the preflight (dialogue chars, SFX cues, segments, temp disk), assembles,
   `ffprobe`s the final MP4, publishes, checks stream + range playback, reconciles credits and writes
   `test-artifacts/film-acceptance.json`. It exits non-zero and refuses to run if no provider is
   configured. Use `--no-publish` to stop before publishing, `--seconds=20` for a cheap first run.

Once step 3 returns `ok: true` with a probed clip **from the vendor**, and step 4 publishes a film
built from those clips, replace this section with the dated real-provider result.

### Phase 2 runner rehearsal (2026-10-30, not a vendor run)

`verify:film` was rehearsed end-to-end against a stub-backed app instance (same wire protocol, fake
token): 2 scenes → 2 clips → 20.00 s MP4 (434,150 bytes, audio present) → published → stream `200`,
range `206`, `.srt` present → credits `206` debited, `0` refunded, exactly one assembly debit. That
rehearsal is what exposed the double-billing bug listed in §1; it proves the runner, not the vendor.

---

## 1. What was verified, and how

`tests/production-acceptance.test.js` (12 tests, ~7 s, part of `npm test`) runs the **real provider
adapters** (`server/film/videoProviders.js`) over HTTP against a protocol emulator that enforces the
documented wire contracts, plus a **real worker child process** that is SIGKILLed mid-run.

| Criterion | Result | Evidence |
|---|---|---|
| Provider request shape (Replicate) | ✔ | `POST /v1/models/kwaivgi/kling-v2.1-master/predictions`, `Authorization: Bearer …`, `prefer: wait=60`, `input.duration=10`, `input.aspect_ratio=16:9` |
| Provider request shape (fal.ai) | ✔ | `POST /fal-ai/<model>`, `Authorization: Key …`, `duration` as string, queue `status_url`/`response_url` honoured |
| Provider request shape (Veo) | ✔ | `models/veo-3.0-generate-001:predictLongRunning?key=…`, `parameters.durationSeconds` |
| Polling | ✔ | processing is never reported as finished; succeeded → video URL; failed/canceled → error |
| Cancellation | ✔ | Replicate `POST /v1/predictions/<id>/cancel`, fal `PUT …/cancel`; Veo honestly reports `supported: false` |
| Download + media probe | ✔ | clip downloaded with size cap, `ffprobe` sees a real H.264 stream |
| Auth error (401/403) | ✔ | non-retryable, message redacted |
| Rate limit (429) / 5xx | ✔ | flagged retryable → worker backoff |
| Dropped connection / timeout | ✔ | poll throws, scene job re-queues as `video_poll_transient` |
| Oversize / empty / corrupt clip | ✔ | rejected; scene failed and refunded, never attached |
| Credential exposure | ✔ | no key material in `/api/films/config`, film detail, or persisted provider handles |
| Worker killed mid-generation | ✔ | `SIGKILL` with 2 locked jobs → restarted worker resumed the **same** predictions in **509 ms**, zero new predictions, zero refunds |
| Failed download → retry | ✔ | scene failed, refunded exactly once; retry reserved a new attempt and succeeded |
| Cancel during generation | ✔ | provider cancel called, both scenes cancelled with no clip, refunded once; a second cancel refunded 0 |
| Incomplete film | ✔ | `409 scenes_incomplete` on assemble, `409 film_not_rendered` on publish |
| Assembly | ✔ | normalise → segments → concat → music/SFX → soft subtitles → probe → atomic publish |
| Final media | ✔ | 20.00 s MP4, 430,920 bytes, valid `ftyp`, range requests `206`, `.srt` 520 bytes |
| Publishing | ✔ | film status `published`, `/media/video` streams the same MP4 |
| Credits | ✔ | 2 clips × 100 = 200 debited, assembly charged once, every ledger key unique (idempotent) |

Exact numbers from the last run are written to `test-artifacts/acceptance-local.json`
(git-ignored). **These come from the emulator, not a vendor.**

### Bugs found and fixed during this stage

1. **`npm run worker` could never start.** `server/worker-standalone.js` called
   `initializeDatabase()` with no argument (`TypeError: Cannot read properties of undefined (reading
   'schema')`), so every production deployment that runs API and worker as separate processes was
   broken. Fixed: use `initDb()`.
2. **Every successful assembly charged the user twice.** `requestAssembly` reserved the assembly
   cost at queue time, then `processFilmAssemblyJob` debited it again as `assembly_charge` on
   completion — neither entry was ever released. A 20-second rehearsal film was billed 212 credits
   for 206 credits of work. The queue-time reservation is now the single charge; completion only
   records `credits_spent`. Regression test: exactly one `film_assembly_*` debit per film.
3. **A crashed worker stalled film generation for up to 20 minutes.** `recoverStaleJobs()` only
   recovered jobs older than `JOB_TIMEOUT_MS`; a `kill -9` left `film_generate_scene` jobs `running`
   and scenes `processing` until that timeout. Now a job whose lock owner is a dead local process
   (`hostname:pid`) is re-queued on the next tick — 509 ms in the test — and, when attempts are
   exhausted, the scene is failed **and refunded** instead of being orphaned.

## 2. Closing the gate with a real provider

Only the vendor's own inference is missing. One command per provider:

```bash
# .env
FILM_VIDEO_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_…            # server-side only
# optional: FILM_REPLICATE_VIDEO_MODEL, FILM_REPLICATE_INPUT_JSON

npm run verify:provider -- --provider=replicate --check-auth
npm run verify:provider -- --provider=fal --check-auth
npm run verify:provider -- --provider=veo --check-auth   # needs GOOGLE_VEO_API_KEY / GEMINI_API_KEY
```

The script starts one real prediction, polls it, downloads it, `ffprobe`s it, prints duration /
resolution / bytes, and writes `test-artifacts/provider-verification.json`. It exits non-zero on any
failure and never prints a key. Add `--cancel` to a second run to confirm the vendor accepts
cancellation.

Then run the full film once, in the app (`/app/films/long` → new project → write → generate →
assemble → publish) or headless, and record:

| Field | Where to read it |
|---|---|
| Provider + model | `test-artifacts/provider-verification.json`, `/api/films/config` |
| Clips generated | `GET /api/films/:id/progress` → `counts.ready` |
| Film duration | `GET /api/films/:id/preflight` → `durationSeconds`; `ffprobe` the MP4 |
| Assembly result | `stage: completed`, `hasVideo: true`, `ffprobe` duration/codecs |
| Playback | `GET /api/films/:id/media/video` in a browser, plus `/download` |
| Credits | `GET /api/films/credits/history` — one reserve per attempt, refunds only after failures |
| Failures | `GET /api/films/:id` → `error`, per-scene `error`, ledger `film_scene_refund:*` |

## 3. Outstanding limitations (real, not cosmetic)

- **Real-vendor inference is unverified** in this environment (no keys, no egress). Everything up to
  the vendor call is covered.
- **Veo has no cancel endpoint**; the UI/API report that honestly and refund locally. A late Veo
  result is discarded.
- **Veo is 16:9 / 9:16 only**; `1:1` falls back to the provider's nearest supported ratio.
- **Clip length is model-bound** (Kling 5/10 s by default). Scenes are planned at ≤
  `FILM_MAX_SCENE_SECONDS`; longer beats are composed from several scenes, not extrapolated.
- **Burn-in subtitles cap at `FILM_BURN_IN_MAX_SECONDS` (900 s)**; longer cuts get a soft track + `.srt`
  (fast, lossless, but player-dependent).
- **Music is uploaded, never generated**; SFX are uploaded audio cues mixed under a scene.
- **SQLite is single-writer.** Multi-process workers are only safe on PostgreSQL
  (`DATABASE_URL`); the crash recovery's dead-owner check uses `hostname:pid`, so a lock from another
  host is left to `JOB_TIMEOUT_MS`.
- **Cost is real**: defaults are 10 credits per video-second, so a 60-minute film is ~36,000 credits
  and 360 paid predictions. There is no free local fallback and none is pretended.
- **Render time** is CPU FFmpeg; a 60-minute 1280-px film takes tens of minutes and up to ~1.6 GB of
  temporary disk (preflight reports the estimate before you commit).

## 4. Regression status

| Suite | Result |
|---|---|
| `npm test` | 174 passed / 0 failed (12 new acceptance tests) |
| `npm run test:e2e` | ok — 15 flows |
| `npm run test:visual` | 10/10, no console errors |
| `npm run build` | clean |

No passing test was removed or weakened; all new coverage is additive.
