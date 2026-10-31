# Provider configuration

Provider configuration is owned by the **Super Admin dashboard** (`/app/admin` → **Providers**).
Creators never see it: their Settings page has no provider tab, and unavailable
capabilities report themselves honestly where they are used (a 503, a labelled local
draft, a "no provider configured" note).

## Precedence

1. A value saved in the dashboard.
2. The server environment variable.
3. The built-in default (local/procedural/mespeak/none).

Clearing a dashboard value restores the environment value; nothing is ever "half
configured". Changes are applied to the running server immediately — the shared
config object is rewritten, so every service picks the new value on its next call
with no restart. In a multi-instance deployment each instance loads the saved
configuration at boot, so other instances pick the change up on their next restart
or rolling deploy.

## What can be configured

| Modality | Environment | Choices |
| --- | --- | --- |
| AI writing | `AI_PROVIDER` | `local`, `openai`, `anthropic`, `gemini` |
| Research & search | `SEARCH_PROVIDER` | `none`, `brave`, `tavily` |
| Image generation | `IMAGE_PROVIDER` | `procedural`, `openai`, `replicate` |
| Text to speech | `TTS_PROVIDER` | `mespeak`, `openai`, `elevenlabs` |
| Film video | `FILM_VIDEO_PROVIDER` | `none`, `replicate`, `fal`, `veo` |

Credentials (write-only once saved):

| Credential | Environment | Feeds |
| --- | --- | --- |
| OpenAI API key | `OPENAI_API_KEY` | AI writing, images, TTS |
| Anthropic API key | `ANTHROPIC_API_KEY` | AI writing |
| Google Gemini API key | `GEMINI_API_KEY` | AI writing |
| Google Veo API key | `GOOGLE_VEO_API_KEY` | Film video |
| Search API key | `SEARCH_API_KEY` | Brave or Tavily research |
| Replicate API token | `REPLICATE_API_TOKEN` | Image generation **and** film video |
| fal.ai API key | `FAL_API_KEY` | Film video |
| ElevenLabs API key | `ELEVENLABS_API_KEY` | Text to speech |

Model overrides (blank = environment default): `OPENAI_MODEL`, `ANTHROPIC_MODEL`,
`GEMINI_MODEL`, `OPENAI_IMAGE_MODEL`, `REPLICATE_IMAGE_MODEL`, `OPENAI_TTS_MODEL`,
`ELEVENLABS_VOICE_ID`, `FILM_REPLICATE_VIDEO_MODEL`, `FILM_FAL_VIDEO_MODEL`,
`FILM_VEO_MODEL`.

Publishing OAuth clients (`META_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`,
`X_CONSUMER_KEY/SECRET`) are deliberately **not** dashboard-configurable: they are
tied to app-review status and registered callback URLs, and changing them inside the
app would silently break connected accounts.

## Storage and confidentiality

- Secrets are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` before they are
  written to the `provider_config` table. The row contains ciphertext only.
- The API is write-only: responses report whether a credential exists, whether it
  came from the dashboard or the environment, its last four characters and who
  changed it. A saved key is never returned, not even masked.
- Environment keys are never copied into the database — the table only knows that
  the environment supplies one.
- Every write is audited (`admin.providers.update`) with the credential **names**
  that changed and never their values. Tests also prove the plaintext is absent from
  both the table and the audit log.
- Rotating `APP_ENCRYPTION_KEY` makes stored credentials unreadable; the dashboard
  flags this in the boot warnings, and the keys must be re-entered afterwards.

## Guardrails

- A provider can only be activated after its credential exists. Asking for Replicate
  film generation without a Replicate token returns
  `400 provider_credential_missing` and leaves the live configuration untouched.
- Removing a credential that the active provider depends on is rejected for the same
  reason. Clear the provider first, then the key.
- Invalid provider ids, unknown fields, over-long or whitespace-broken keys and
  unsafe model strings are rejected with a message naming the field.
- The **Test** button performs a real, read-only call to the provider's official API
  (`/models`, `/account`, `/user`, or a one-result search). fal.ai exposes no
  credential endpoint, so it honestly reports "not checkable" instead of a fake
  success. A failed test does not disable anything; it reports exactly what the
  provider answered.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/providers` | Modalities, credentials (masked), model overrides, live status |
| `PUT` | `/api/admin/providers` | Save `active`, `models` and/or `secrets` (`null` clears a secret) |
| `POST` | `/api/admin/providers/test` | `{ "target": "openaiKey" }` — live credential probe |

All three require an authenticated admin (`requireAdmin`). The effective status is
also published at `GET /api/meta/status` for the app shell, without any credential.

## Verification

`tests/provider-config.test.js` covers admin-only access, encryption at rest, the
absence of plaintext in API responses, environment fallback, refusing to activate an
unkeyed provider, refusing to delete a key in use, model overrides, input validation,
honest test results and reload-from-database on boot.
