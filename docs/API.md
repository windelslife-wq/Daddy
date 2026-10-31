# Developer API

Film Club Lens exposes a public REST API at **`/api/v1`** so your own systems can create
projects and films, follow generation, and drive publishing. Every endpoint below is
implemented, authenticated, scoped, rate-limited and covered by
`tests/api-v1.test.js`, which calls each documented endpoint with a real key on every
build — the catalogue cannot drift from the runtime.

- **Live reference page:** `/developers` (public, renders `GET /api/developer/spec`)
- **Machine-readable spec:** `GET /api/developer/spec`
- **OpenAPI 3.1 document:** `GET /api/developer/openapi.json`
- **Key management:** `GET|POST /api/developer/keys`, `DELETE /api/developer/keys/:id`
  (session-authenticated), surfaced in the workspace at **Workspace → Developer API**

## Quick start

```bash
# 1. Create a key in Workspace → Developer API and copy it once
export FCL_API_KEY="fcl_live_…"

# 2. Verify the connection
curl "$PUBLIC_BASE_URL/api/v1/me" -H "Authorization: Bearer $FCL_API_KEY"

# 3. Create a project
curl -X POST "$PUBLIC_BASE_URL/api/v1/projects" \
  -H "Authorization: Bearer $FCL_API_KEY" \
  -H "content-type: application/json" \
  -d '{"topic":"How a 20-minute walk changes your day","duration":45,"platforms":["sandbox"]}'
```

## Authentication

| Item | Value |
|---|---|
| Scheme | `Authorization: Bearer fcl_live_…` (or `X-API-Key: fcl_live_…`) |
| Key format | `fcl_live_` + 40 characters, shown **once** at creation |
| Storage | SHA-256 digest only, plus a display prefix — a database leak cannot call the API |
| Binding | One account per key; every query is filtered by that account, admins included |
| Revocation | Immediate. The next request returns `401 unauthorized` |
| Sessions | Session cookies are **not** accepted by `/api/v1` |
| Limits | 10 active keys per account (`API_KEY_RATE_LIMIT_PER_MINUTE` controls request rate) |

### Scopes

| Scope | Grants |
|---|---|
| `read` | List and read projects, posts, films, channels, plan, usage and credits |
| `write` | Create projects, video posts and film projects |
| `publish` | Approve and schedule posts, start film scene generation |

A key without the required scope receives `403 forbidden` with the scope named in the message.

## Endpoints

All paths are relative to `/api/v1`. Field names are camelCase; timestamps are ISO-8601 UTC.

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/me` | read | Account, plan, usage, credits, key scopes |
| GET | `/projects` | read | List video projects (`status`, `limit`, `offset`) |
| POST | `/projects` | write | Create a project and queue the pipeline |
| GET | `/projects/:id` | read | Project with script/scene plan and its posts |
| POST | `/projects/:id/posts` | write | Create a publishable post from a project |
| GET | `/posts` | read | List posts with publications (`status`, `limit`, `offset`) |
| GET | `/posts/:id` | read | One post with captions and every publication attempt |
| POST | `/posts/:id/approve` | publish | Clear the review gate and queue publishing |
| POST | `/posts/:id/schedule` | publish | Schedule a post for an ISO-8601 time |
| GET | `/films` | read | List film projects (`type`, `status`, `limit`, `offset`) |
| POST | `/films` | write | Create a film project |
| GET | `/films/:id` | read | Film with scenes, characters, locations, estimate, preflight |
| POST | `/films/:id/generate` | publish | Queue generation for every pending scene |
| GET | `/accounts` | read | Connected channels (never returns credentials) |

## Asynchronous work

Creation returns immediately. Generation, rendering and publishing are queued:

1. `POST /projects` → project `status: "queued"`.
2. Poll `GET /projects/:id` until `status` is `ready` (rendered), `failed`, or `completed`.
3. `POST /posts/:id/approve` requires the project to have finished rendering; approving
   an unrendered video would be a false claim, so the API answers `400` with an
   explanation instead.
4. Publication state lives in `post.publications[]` — `status`, `attempts`,
   `remoteUrl`, `errorCode`, `nextAttemptAt`.

## Errors

```json
{ "error": { "code": "unauthorized", "message": "This API key has been revoked.", "requestId": "6b0f2f7c-…" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Validation failed; `error.details` lists the fields |
| 401 | `unauthorized` | Missing, malformed, revoked or unknown key |
| 403 | `forbidden` | Key lacks the required scope |
| 404 | `not_found` | Missing resource, or one owned by another account |
| 402 | `quota_exceeded` / `insufficient_credits` | Plan quota or film credit balance exhausted |
| 409 | `conflict`, `no_scenes`, `provider_disabled`, `key_limit_reached` | State conflict; the message explains it |
| 429 | `rate_limited` | Per-key or per-IP limit reached; honour the `RateLimit` header |
| 503 | `video_provider_unavailable` | No AI video provider configured — nothing is fabricated |

## Rate limits and pagination

- `120` requests / minute / key (`API_KEY_RATE_LIMIT_PER_MINUTE`), advertised in the
  `RateLimit: limit=…, remaining=…, reset=…` header.
- `600` requests / minute / IP for the whole application.
- List endpoints accept `limit` (1–100, default 25) and `offset`, and return
  `pagination: { limit, offset, total }`.

## Webhooks

The server posts an HMAC-signed JSON event to `NOTIFICATION_WEBHOOK_URL` whenever a
notification is created (generation finished, publish succeeded/failed, and so on):

| Header | Purpose |
|---|---|
| `X-Film-Club-Lens-Event` | Event name, e.g. `notification.created` |
| `X-Film-Club-Lens-Timestamp` | Unix seconds used in the signature; reject older than 5 minutes |
| `X-Film-Club-Lens-Signature` | `sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")` |

Delivery retries three times with backoff and a 10 second timeout. Receivers must be
idempotent. The secret lives only on the server (`NOTIFICATION_WEBHOOK_SECRET`).

## Adding an endpoint

1. Add an entry to `server/api/catalog.js` (method, path, scope, docs, example body/response).
2. Add a handler with the same `id` in `server/routes/api-v1.js` — boot fails if it is missing.
3. Extend `tests/api-v1.test.js`; the coverage test already iterates the catalogue.

The documentation page and the OpenAPI document are generated from that catalogue, so an
undocumented or unimplemented endpoint cannot ship.

## Limits of what is verified here

- Live AI provider calls (Replicate / fal / Google Veo / ElevenLabs etc.) still require the
  operator to configure provider credentials. Without them the API answers `503` with the
  missing setting — it never returns a fabricated clip.
- Official social publishing still requires approved OAuth apps. The local sandbox
  publisher works with no external account and is suitable for integration tests.
