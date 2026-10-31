/**
 * The public developer API catalogue.
 *
 * This file is the single source of truth for the v1 API:
 *   - `server/routes/api-v1.js` mounts exactly these endpoints (a missing handler
 *     is a boot-time error, and an undocumented mount cannot happen),
 *   - `GET /api/developer/spec` serves this object to the documentation page,
 *   - `GET /api/developer/openapi.json` derives an OpenAPI 3.1 document from it,
 *   - `tests/api-v1.test.js` calls every documented endpoint with a real key.
 *
 * Paths are documented with `{param}` placeholders; Express uses `:param`.
 * Every endpoint is scoped to the owner of the API key. There is no admin bypass.
 */

export const API_VERSION = 'v1';
export const API_PREFIX = '/api/v1';
export const KEY_TOKEN_PREFIX = 'fcl_live_';
export const MAX_KEYS_PER_USER = 10;

export const SCOPES = [
  {
    id: 'read',
    label: 'Read',
    description: 'List and retrieve your projects, video posts, films, channels, plan and credit balance.',
  },
  {
    id: 'write',
    label: 'Write',
    description: 'Create video projects, video posts and film projects. Never publishes anything by itself.',
  },
  {
    id: 'publish',
    label: 'Publish',
    description: 'Approve and schedule your posts, and start scene generation for a film.',
  },
];

export const SCOPES_BY_ID = Object.fromEntries(SCOPES.map((scope) => [scope.id, scope]));

export const AUTHENTICATION = {
  scheme: 'Bearer token',
  header: 'Authorization: Bearer fcl_live_…',
  alternative: 'X-API-Key: fcl_live_…',
  keyFormat: 'fcl_live_ followed by 40 characters. The full key is shown once, at creation time.',
  storage: 'Only a SHA-256 hash of the key is stored. A lost key cannot be recovered — revoke it and create a new one.',
  obtain: 'Sign in, open Workspace → Developer API, and create a key with the scopes you need.',
  transport: 'HTTPS only in production. Keys are never accepted from the browser session cookie, and session cookies are never accepted by /api/v1.',
};

export const CONVENTIONS = [
  { title: 'Media type', body: 'Requests and responses use application/json (UTF-8), except file downloads which stream bytes with range support.' },
  { title: 'Field naming', body: 'Request and response fields are camelCase. Timestamps are ISO-8601 strings in UTC.' },
  { title: 'Request ids', body: 'Every response carries a request id in the error envelope and in the X-Request-Id response header; quote it in support requests.' },
  { title: 'Pagination', body: 'List endpoints accept limit (1–100, default 25) and offset (default 0) and return pagination { limit, offset, total }.' },
  { title: 'Idempotency', body: 'Duplicate protection is built into publishing. Project and post creation are not idempotent — retry only after checking the list endpoints.' },
  { title: 'Long-running work', body: 'Generation, rendering and publishing are queued. Endpoints return immediately with the resource in a queued/generating state; poll the resource until it reaches a terminal status.' },
];

export const RATE_LIMITS = {
  perKey: { limit: 120, window: '60 seconds', header: 'RateLimit: limit=120, remaining=…, reset=… (IETF draft-7 structured field)', note: 'Per API key, per minute. Configurable by the operator with API_KEY_RATE_LIMIT_PER_MINUTE.' },
  perIp: { limit: 600, window: '60 seconds', note: 'The shared application limit for unauthenticated and API traffic alike.' },
  exceeded: 'HTTP 429 with error.code = "rate_limited". Wait for the reset window advertised in the RateLimit header before retrying, then back off exponentially.',
};

export const ERROR_CODES = [
  { status: 400, code: 'bad_request', meaning: 'The request body or query failed validation. error.details lists the offending fields.' },
  { status: 401, code: 'unauthorized', meaning: 'Missing, malformed, revoked or unknown API key.' },
  { status: 403, code: 'forbidden', meaning: 'The key is valid but lacks the scope this endpoint requires.' },
  { status: 404, code: 'not_found', meaning: 'The resource does not exist, or it belongs to another account.' },
  { status: 402, code: 'quota_exceeded', meaning: 'The plan quota (videos, projects or rendering seconds) is exhausted.' },
  { status: 409, code: 'conflict', meaning: 'The resource cannot move to the requested state right now (for example a render already in progress).' },
  { status: 429, code: 'rate_limited', meaning: 'Too many requests for this key or IP address.' },
  { status: 402, code: 'insufficient_credits', meaning: 'The film credit balance cannot cover the requested generation.' },
  { status: 409, code: 'no_scenes', meaning: 'The film has no scenes yet. Write a screenplay before generating scene clips.' },
  { status: 409, code: 'provider_disabled', meaning: 'An administrator disabled the provider this project needs, and no other provider is enabled.' },
  { status: 503, code: 'video_provider_unavailable', meaning: 'No AI video provider is configured on this deployment. The message names the setting an operator must add; nothing is fabricated instead.' },
  { status: 500, code: 'internal_error', meaning: 'Unexpected server error. The response never includes stack traces or secrets.' },
];

export const WEBHOOKS = {
  title: 'Signed webhooks',
  summary: 'The server posts an HMAC-signed JSON event to NOTIFICATION_WEBHOOK_URL whenever a notification is created — including generation, publishing and failure events for your content.',
  headers: [
    { name: 'X-Film-Club-Lens-Event', description: 'Event name, for example notification.created.' },
    { name: 'X-Film-Club-Lens-Timestamp', description: 'Unix seconds used in the signature. Reject events older than 5 minutes.' },
    { name: 'X-Film-Club-Lens-Signature', description: 'sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>"). Compare in constant time.' },
  ],
  payload: {
    id: 'evt_01HZX',
    type: 'publication.published',
    createdAt: '2026-10-31T12:00:00.000Z',
    data: { postId: 'pst_…', publicationId: 'pub_…', platform: 'youtube', remoteUrl: 'https://…' },
  },
  note: 'Delivery retries three times with backoff and a 10 second timeout. Receivers must be idempotent: the same event id can arrive more than once.',
  setup: 'An operator sets NOTIFICATION_WEBHOOK_URL and NOTIFICATION_WEBHOOK_SECRET on the server. The secret is never exposed through the API.',
};

/**
 * @typedef {object} Endpoint
 * @property {string} id            stable handler key
 * @property {string} group         documentation group
 * @property {string} method        HTTP method
 * @property {string} path          Express-style path with :params (documented as {param})
 * @property {string} scope         required scope id
 * @property {string} summary       one-line description
 * @property {string} description   full description
 * @property {object[]} [params]    path/query parameters
 * @property {object} [exampleBody] request body example (also the documented schema)
 * @property {object} exampleResponse
 * @property {number} successStatus
 */

/** @type {Endpoint[]} */
export const ENDPOINTS = [
  {
    id: 'me',
    group: 'Account',
    method: 'GET',
    path: '/me',
    scope: 'read',
    summary: 'Get the account behind the API key',
    description: 'Returns the account, its plan, current usage, film credit balance and the scopes of the key making the call. Use it as a connection test after creating a key.',
    exampleResponse: {
      account: { id: 'usr_…', email: 'creator@example.com', name: 'Demo Creator', role: 'user', createdAt: '2026-10-01T09:00:00.000Z' },
      plan: { id: 'creator', name: 'Creator', maxVideosMonth: 75, maxProjects: 500 },
      usage: { period: '2026-10', videos: 4, posts: 7, renderSeconds: 180 },
      credits: 900,
      apiKey: { id: 'key_…', name: 'Build pipeline', scopes: ['read', 'write', 'publish'], lastUsedAt: '2026-10-31T11:59:00.000Z' },
    },
    successStatus: 200,
  },
  {
    id: 'projects.list',
    group: 'Projects',
    method: 'GET',
    path: '/projects',
    scope: 'read',
    summary: 'List video projects',
    description: 'Returns the newest projects first. Filter by production status to find work that is still generating or ready to review.',
    params: [
      { name: 'status', in: 'query', type: 'string', description: 'queued | generating | rendering | review | ready | published | failed | archived' },
      { name: 'limit', in: 'query', type: 'integer', description: '1–100, default 25' },
      { name: 'offset', in: 'query', type: 'integer', description: 'Default 0' },
    ],
    exampleResponse: {
      projects: [{ id: 'prj_…', title: 'Why sleep is a superpower', topic: 'The science of sleep', status: 'ready', stage: 'completed', progress: 100, hasVideo: true, durationSeconds: 45, createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:04:00.000Z' }],
      pagination: { limit: 25, offset: 0, total: 1 },
    },
    successStatus: 200,
  },
  {
    id: 'projects.create',
    group: 'Projects',
    method: 'POST',
    path: '/projects',
    scope: 'write',
    summary: 'Create a video project',
    description: 'Queues the full pipeline: research (optional), screenplay, scene art, narration, captions, music and MP4 rendering. Returns immediately with a queued project; poll GET /projects/{id} for progress. Rendering needs a configured media provider — the response never claims a fabricated video.',
    exampleBody: {
      topic: 'How a 20-minute walk changes your day',
      niche: 'Education',
      style: 'cinematic',
      language: 'en',
      voice: 'nova',
      aspectRatio: '9:16',
      duration: 45,
      tone: 'documentary',
      captions: true,
      music: true,
      platforms: ['sandbox'],
      autoPublish: false,
      createPost: false,
    },
    exampleResponse: {
      project: { id: 'prj_…', title: 'How a 20-minute walk changes your day', status: 'queued', stage: 'queued', progress: 0 },
      postId: null,
      jobId: 'job_…',
    },
    successStatus: 201,
  },
  {
    id: 'projects.get',
    group: 'Projects',
    method: 'GET',
    path: '/projects/:id',
    scope: 'read',
    summary: 'Retrieve one project with its posts',
    description: 'Full project record including the generated script and scene plan, plus the posts created from it. Requests for another account\'s project return 404.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Project id, for example prj_…' }],
    exampleResponse: {
      project: { id: 'prj_…', title: 'Why sleep is a superpower', status: 'ready', hasVideo: true, durationSeconds: 45, script: { hook: '…', scenes: [] } },
      posts: [{ id: 'pst_…', status: 'review', scheduledAt: null, publications: [] }],
    },
    successStatus: 200,
  },
  {
    id: 'projects.createPost',
    group: 'Projects',
    method: 'POST',
    path: '/projects/:id/posts',
    scope: 'write',
    summary: 'Create a publishable post from a project',
    description: 'Creates the post (caption, hashtags, per-platform publication rows) that the publishing workflow acts on. Choose the platforms you want to target; unsupported or disconnected platforms are rejected by the publisher, not silently dropped.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Project id' }],
    exampleBody: { platforms: ['sandbox'], scheduledAt: null },
    exampleResponse: { post: { id: 'pst_…', projectId: 'prj_…', status: 'draft', reviewRequired: true, hashtags: {}, publications: [{ id: 'pub_…', platform: 'sandbox', status: 'pending' }] } },
    successStatus: 201,
  },
  {
    id: 'posts.list',
    group: 'Posts & publishing',
    method: 'GET',
    path: '/posts',
    scope: 'read',
    summary: 'List posts',
    description: 'Returns posts with their per-platform publications. Use status=review to find content awaiting approval, then approve or schedule it.',
    params: [
      { name: 'status', in: 'query', type: 'string', description: 'draft | review | approved | scheduled | publishing | published | failed' },
      { name: 'limit', in: 'query', type: 'integer', description: '1–100, default 25' },
      { name: 'offset', in: 'query', type: 'integer', description: 'Default 0' },
    ],
    exampleResponse: {
      posts: [{ id: 'pst_…', projectId: 'prj_…', title: 'Why sleep is a superpower', status: 'review', reviewRequired: true, publications: [{ id: 'pub_…', platform: 'sandbox', status: 'pending', attempts: 0 }] }],
      pagination: { limit: 25, offset: 0, total: 1 },
    },
    successStatus: 200,
  },
  {
    id: 'posts.get',
    group: 'Posts & publishing',
    method: 'GET',
    path: '/posts/:id',
    scope: 'read',
    summary: 'Retrieve one post',
    description: 'Includes captions, hashtags and every publication attempt with its remote URL, error code and next retry time. Poll this endpoint to follow a publish.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Post id' }],
    exampleResponse: {
      post: { id: 'pst_…', status: 'published', publications: [{ id: 'pub_…', platform: 'sandbox', status: 'published', remoteUrl: 'https://…/sandbox/posts/sp_…', publishedAt: '2026-10-31T10:05:00.000Z' }] },
    },
    successStatus: 200,
  },
  {
    id: 'posts.approve',
    group: 'Posts & publishing',
    method: 'POST',
    path: '/posts/:id/approve',
    scope: 'publish',
    summary: 'Approve a post',
    description: 'Clears the review gate for a post. The underlying project must have finished rendering (400 with an explanation otherwise), because approving a video that does not exist yet would be a false claim. On success the post joins the publishing queue.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Post id' }],
    exampleResponse: { post: { id: 'pst_…', status: 'approved', reviewRequired: true, reviewedAt: '2026-10-31T12:00:00.000Z' } },
    successStatus: 200,
  },
  {
    id: 'posts.schedule',
    group: 'Posts & publishing',
    method: 'POST',
    path: '/posts/:id/schedule',
    scope: 'publish',
    summary: 'Schedule a post',
    description: 'Queues the post for a future ISO-8601 timestamp with an offset. Scheduling a review-gated post requires it to be approved first; the API returns 409 with an explanation instead of dropping the publication.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Post id' }],
    exampleBody: { scheduledAt: '2026-11-01T09:30:00.000Z' },
    exampleResponse: { post: { id: 'pst_…', status: 'scheduled', scheduledAt: '2026-11-01T09:30:00.000Z' } },
    successStatus: 200,
  },
  {
    id: 'films.list',
    group: 'Films',
    method: 'GET',
    path: '/films',
    scope: 'read',
    summary: 'List film projects',
    description: 'Short dramas, long dramas, series episodes and movies, newest first, with scene counts and render state.',
    params: [
      { name: 'type', in: 'query', type: 'string', description: 'short_drama | long_drama | series_episode | movie (see GET /api/films/config for the live list)' },
      { name: 'status', in: 'query', type: 'string', description: 'draft | generating | paused | assembling | ready | published | failed' },
      { name: 'limit', in: 'query', type: 'integer', description: '1–100, default 25' },
      { name: 'offset', in: 'query', type: 'integer', description: 'Default 0' },
    ],
    exampleResponse: {
      films: [{ id: 'flm_…', title: 'The Last Signal', type: 'short_drama', genre: 'sci-fi', status: 'draft', progress: 0, sceneCount: 6, createdAt: '2026-10-30T18:00:00.000Z' }],
      pagination: { limit: 25, offset: 0, total: 1 },
    },
    successStatus: 200,
  },
  {
    id: 'films.create',
    group: 'Films',
    method: 'POST',
    path: '/films',
    scope: 'write',
    summary: 'Create a film project',
    description: 'Creates the film with its target runtime, aspect ratio and scene provider. Scene planning happens on first generation, not here.',
    exampleBody: {
      title: 'The Last Signal',
      type: 'short_drama',
      genre: 'sci-fi',
      logline: 'A radio operator hears a voice from a station that closed in 1987.',
      language: 'en',
      style: 'cinematic',
      aspectRatio: '9:16',
      targetDurationSeconds: 120,
    },
    exampleResponse: { film: { id: 'flm_…', title: 'The Last Signal', type: 'short_drama', status: 'draft', targetDurationSeconds: 120 } },
    successStatus: 201,
  },
  {
    id: 'films.get',
    group: 'Films',
    method: 'GET',
    path: '/films/:id',
    scope: 'read',
    summary: 'Retrieve a film with scenes',
    description: 'The full film record: scenes with their prompts and clip state, characters, locations, credit estimate, assembly readiness and the active scene provider. Provider capability is reported honestly — a missing provider shows as not configured, never as a successful render.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Film id' }],
    exampleResponse: {
      film: { id: 'flm_…', title: 'The Last Signal', status: 'draft', sceneCount: 6, scenes: [{ id: 'scn_…', ordinal: 1, status: 'planned', clipUrl: null }], assemblyReady: false, videoProvider: { id: 'none', configured: false } },
    },
    successStatus: 200,
  },
  {
    id: 'films.generate',
    group: 'Films',
    method: 'POST',
    path: '/films/:id/generate',
    scope: 'publish',
    summary: 'Queue generation for every scene',
    description: 'Queues generation for every pending scene. Returns immediately with the queued and newly planned counts; scenes finish asynchronously and appear in GET /films/{id}. Returns 409 no_scenes when the film has no screenplay yet, 409 provider_disabled when an administrator disabled the provider, 402 insufficient_credits when the balance cannot cover it, and 503 video_provider_unavailable when no AI video provider is configured.',
    params: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Film id' }],
    exampleResponse: { queued: 6, planned: 0, total: 6, status: 'generating' },
    successStatus: 202,
  },
  {
    id: 'accounts.list',
    group: 'Channels',
    method: 'GET',
    path: '/accounts',
    scope: 'read',
    summary: 'List connected channels',
    description: 'The publishing destinations connected to the account, with platform, status and automation flag. Credentials and tokens are never returned.',
    exampleResponse: {
      accounts: [{ id: 'acc_…', platform: 'sandbox', platformName: 'Local sandbox', official: false, displayName: 'Demo sandbox', handle: '@demo', status: 'connected', active: true, automationEnabled: true }],
    },
    successStatus: 200,
  },
];

export const GROUPS = [...new Set(ENDPOINTS.map((endpoint) => endpoint.group))];

/** Path in the documentation style, e.g. /projects/{id}. */
export function documentedPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Full request path including the version prefix. */
export function fullPath(path) {
  return `${API_PREFIX}${documentedPath(path)}`;
}

/** The public spec served to the documentation page. */
export function apiSpec({ baseUrl, keyRateLimit, appName, version }) {
  return {
    name: `${appName} API`,
    version: API_VERSION,
    apiVersion: version,
    baseUrl,
    prefix: API_PREFIX,
    generatedAt: new Date().toISOString(),
    authentication: AUTHENTICATION,
    scopes: SCOPES,
    conventions: CONVENTIONS,
    rateLimits: { ...RATE_LIMITS, perKey: { ...RATE_LIMITS.perKey, limit: keyRateLimit, note: `Per API key, per minute (this deployment allows ${keyRateLimit}). Set by the operator with API_KEY_RATE_LIMIT_PER_MINUTE.` } },
    errors: ERROR_CODES,
    webhooks: WEBHOOKS,
    groups: GROUPS,
    endpoints: ENDPOINTS.map((endpoint) => ({
      ...endpoint,
      path: documentedPath(endpoint.path),
      fullPath: fullPath(endpoint.path),
    })),
    openapiUrl: '/api/developer/openapi.json',
  };
}

const TYPE_MAP = { string: 'string', integer: 'integer', boolean: 'boolean', object: 'object', array: 'array', number: 'number' };

function schemaForExample(value) {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? schemaForExample(value[0]) : {} };
  if (value && typeof value === 'object') {
    return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, schemaForExample(item)])) };
  }
  if (value === null) return { nullable: true };
  return { type: TYPE_MAP[typeof value] || 'string', example: value };
}

/**
 * OpenAPI 3.1 document generated from the same catalogue. Consumers can import it
 * into Postman, Insomnia, or generate a typed client.
 */
export function openApiDocument({ baseUrl, keyRateLimit, appName, version }) {
  const paths = {};
  for (const endpoint of ENDPOINTS) {
    const path = fullPath(endpoint.path);
    const parameters = (endpoint.params || []).map((param) => ({
      name: param.name,
      in: param.in,
      required: param.in === 'path' ? true : Boolean(param.required),
      description: param.description,
      schema: { type: TYPE_MAP[param.type] || 'string' },
    }));
    const operation = {
      operationId: endpoint.id.replace(/\./g, '_'),
      summary: endpoint.summary,
      description: endpoint.description,
      tags: [endpoint.group],
      security: [{ bearerAuth: [] }],
      'x-required-scope': endpoint.scope,
      parameters,
      responses: {
        [endpoint.successStatus]: {
          description: 'Success',
          content: { 'application/json': { schema: schemaForExample(endpoint.exampleResponse), example: endpoint.exampleResponse } },
        },
        '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '401': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '403': { description: 'Key lacks the required scope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '404': { description: 'Not found or not owned by this account', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '429': { description: 'Rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
    if (endpoint.exampleBody) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: schemaForExample(endpoint.exampleBody), example: endpoint.exampleBody } },
      };
    }
    paths[path] = { ...(paths[path] || {}), [endpoint.method.toLowerCase()]: operation };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${appName} API`,
      version: `${API_VERSION}`,
      description: `Developer API for ${appName}. Create projects, films and posts, then follow generation and publishing. Only a hash of each API key is stored.`,
      license: { name: 'Proprietary' },
    },
    servers: [{ url: baseUrl, description: 'This deployment' }],
    security: [{ bearerAuth: [] }],
    tags: GROUPS.map((group) => ({ name: group })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'fcl_live_…', description: 'Create keys in Workspace → Developer API.' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'unauthorized' },
                message: { type: 'string', example: 'Invalid API key.' },
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
    'x-rate-limit': { perKeyPerMinute: keyRateLimit },
    'x-api-version': version,
  };
}
