/**
 * Creative Canvas — a real node workflow, not a drawing board.
 *
 * Every node type calls an existing service: the screenplay generator, the image
 * provider, the TTS engine and the credit-aware scene renderer. A flow is
 * persisted, executed in dependency order, and its run log records exactly what
 * each node produced or why it failed. Video nodes never bypass credit
 * accounting: they go through `requestSceneGeneration`.
 */
import { z } from 'zod';
import { db, now, newId, json, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureProjectDir } from '../media/utils.js';
import { generatePromptImage, imageProviderStatus } from '../media/images.js';
import { activeTtsProvider, synthesizeScene } from '../media/audio.js';
import { generateScreenplay, FILM_TYPES } from './screenplay.js';
import { ownedFilm, saveScreenplay, requestSceneGeneration } from './scenes.js';

export const NODE_TYPES = [
  {
    id: 'text', label: 'Text prompt', produces: 'text', spendsCredits: false,
    description: 'A literal input. Upstream text is used when the field is empty.',
    config: { text: '' },
  },
  {
    id: 'screenplay', label: 'Screenplay', produces: 'screenplay', spendsCredits: false,
    description: 'Writes a scene-by-scene script. Attach a project to save it into that project.',
    config: { idea: '', type: 'short_drama', genre: 'family_drama', scenes: 0 },
  },
  {
    id: 'image', label: 'Storyboard image', produces: 'image', spendsCredits: false,
    description: 'Renders one image from the prompt using the configured image provider.',
    config: { prompt: '', aspectRatio: '16:9' },
  },
  {
    id: 'voice', label: 'Voice take', produces: 'audio', spendsCredits: false,
    description: 'Speaks the text with the configured TTS provider and stores a WAV.',
    config: { text: '', voice: 'nova' },
  },
  {
    id: 'scene', label: 'Scene clip', produces: 'video', spendsCredits: true,
    description: 'Renders one scene of the attached project through the real, credit-metered pipeline.',
    config: { sceneId: '' },
  },
];

const NODE_TYPE_IDS = NODE_TYPES.map((node) => node.id);

const nodeSchema = z.object({
  id: z.string().min(1).max(60),
  type: z.enum(NODE_TYPE_IDS),
  config: z.record(z.any()).optional().default({}),
  x: z.number().optional().default(0),
  y: z.number().optional().default(0),
});

const graphSchema = z.object({
  nodes: z.array(nodeSchema).max(24).default([]),
  edges: z.array(z.object({ from: z.string().min(1).max(60), to: z.string().min(1).max(60) })).max(48).default([]),
});

export const flowSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  filmId: z.string().max(48).optional().nullable(),
  graph: graphSchema.optional(),
});

export function flowView(row) {
  return {
    id: row.id,
    name: row.name,
    filmId: row.film_id || null,
    graph: parseJson(row.graph, { nodes: [], edges: [] }),
    status: row.status,
    lastRun: parseJson(row.last_run, null),
    lastRunAt: row.last_run_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ownedFlow(userId, flowId) {
  const flow = await db('film_flows').where({ id: flowId }).first();
  if (!flow) throw new AppError(404, 'flow_not_found', 'Canvas flow not found.');
  if (flow.user_id !== userId) throw new AppError(403, 'forbidden', 'You do not have access to this flow.');
  return flow;
}

export async function createFlow(userId, input = {}) {
  const data = flowSchema.parse(input);
  if (data.filmId) await ownedFilm(userId, data.filmId);
  const id = newId('flow_');
  if (data.graph) validateGraph(data.graph);
  const graph = data.graph || {
    nodes: [
      { id: 'brief', type: 'text', config: { text: '' }, x: 0, y: 0 },
      { id: 'script', type: 'screenplay', config: { idea: '', type: 'short_drama', genre: 'family_drama' }, x: 260, y: 0 },
      { id: 'frame', type: 'image', config: { prompt: '', aspectRatio: '16:9' }, x: 520, y: 0 },
    ],
    edges: [{ from: 'brief', to: 'script' }, { from: 'script', to: 'frame' }],
  };
  await db('film_flows').insert({
    id, user_id: userId, film_id: data.filmId || null,
    name: data.name || 'Untitled flow',
    graph: json(graph),
    status: 'draft', last_run: null, last_run_at: null,
    created_at: now(), updated_at: now(),
  });
  return flowView(await db('film_flows').where({ id }).first());
}

export async function listFlows(userId, { filmId } = {}) {
  const query = db('film_flows').where({ user_id: userId });
  if (filmId) query.where({ film_id: filmId });
  const rows = await query.orderBy('updated_at', 'desc').limit(50);
  return rows.map(flowView);
}

export async function updateFlow(userId, flowId, input = {}) {
  await ownedFlow(userId, flowId);
  const data = flowSchema.parse(input);
  if (data.filmId) await ownedFilm(userId, data.filmId);
  const patch = { updated_at: now() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.filmId !== undefined) patch.film_id = data.filmId || null;
  if (data.graph !== undefined) {
    validateGraph(data.graph);
    patch.graph = json(data.graph);
  }
  await db('film_flows').where({ id: flowId }).update(patch);
  return flowView(await db('film_flows').where({ id: flowId }).first());
}

export async function deleteFlow(userId, flowId) {
  await ownedFlow(userId, flowId);
  await db('film_flows').where({ id: flowId }).delete();
  return { deleted: true };
}

/** Reject self-loops, unknown references and cycles before anything runs. */
export function validateGraph(graph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length) throw new AppError(400, 'flow_duplicate_node', 'Two nodes share the same id.');
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new AppError(400, 'flow_unknown_edge', 'An edge points at a node that does not exist.');
    if (edge.from === edge.to) throw new AppError(400, 'flow_self_edge', 'A node cannot feed itself.');
  }
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    adjacency.get(edge.from).push(edge.to);
  }
  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adjacency.get(id)) {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) throw new AppError(400, 'flow_cycle', 'This flow contains a cycle. Node workflows must run in one direction.');
  return order;
}

function upstreamText(graph, nodeId, outputs) {
  const parents = graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
  const parts = parents.map((id) => outputs.get(id)).filter(Boolean);
  const text = parts.map((output) => output.text || output.summary || '').filter(Boolean).join('\n\n');
  return text.trim();
}

/**
 * Execute a flow. Stops at the first failure and records the real error, so a
 * missing provider is visible instead of being retried into a silent success.
 */
export async function runFlow(userId, flowId, { force = false } = {}) {
  const row = await ownedFlow(userId, flowId);
  const graph = parseJson(row.graph, { nodes: [], edges: [] });
  if (!graph.nodes?.length) throw new AppError(409, 'flow_empty', 'Add at least one node before running this flow.');
  const order = validateGraph(graph);
  const film = row.film_id ? await ownedFilm(userId, row.film_id) : null;
  const dir = path.join(await ensureProjectDir(`flow_${flowId}`));
  await fsp.mkdir(dir, { recursive: true });
  const images = imageProviderStatus();
  let tts = null;
  try { tts = { provider: activeTtsProvider(), configured: true }; } catch (error) { tts = { provider: null, configured: false, error: error.message }; }

  const outputs = new Map();
  const results = [];
  let failure = null;

  for (const nodeId of order) {
    const node = graph.nodes.find((item) => item.id === nodeId);
    const config = node.config || {};
    const startedAt = now();
    if (failure) {
      results.push({ nodeId, type: node.type, status: 'skipped', detail: 'Upstream node failed.', startedAt, finishedAt: now() });
      continue;
    }
    try {
      const input = upstreamText(graph, nodeId, outputs);
      let output;
      if (node.type === 'text') {
        const text = String(config.text || input || '').trim();
        if (!text) throw new AppError(400, 'flow_text_empty', 'This text node has no text and no upstream output.');
        output = { text, summary: text.slice(0, 400) };
      } else if (node.type === 'screenplay') {
        const idea = String(config.idea || input || '').trim();
        if (!idea) throw new AppError(400, 'flow_screenplay_idea', 'A screenplay node needs an idea or upstream text.');
        const type = FILM_TYPES.includes(config.type) ? config.type : (film?.type || 'short_drama');
        const screenplay = await generateScreenplay({
          idea,
          type,
          genre: config.genre || film?.genre || 'family_drama',
          language: film?.language || 'en',
          style: film?.style || 'cinematic',
          aspectRatio: film?.aspect_ratio || '16:9',
          platform: film?.target_platform || 'youtube',
          targetDurationSeconds: Number(film?.target_duration_seconds) || 60,
          storyBible: film ? parseJson(film.story_bible, {}) : {},
          allowTemplate: true,
        });
        if (film) await saveScreenplay(userId, row.film_id, screenplay, 'user');
        output = {
          text: screenplay.logline || idea,
          summary: `${screenplay.scenes.length} scenes · ${screenplay.aiGenerated ? `AI (${screenplay.provider})` : 'labelled offline draft'}`,
          scenes: screenplay.scenes.length,
          aiGenerated: Boolean(screenplay.aiGenerated),
          provider: screenplay.provider,
          savedToProject: Boolean(film),
        };
      } else if (node.type === 'image') {
        if (!images.configured) throw new AppError(503, 'image_provider_unavailable', `Storyboard node needs image credentials for IMAGE_PROVIDER=${images.provider}.`);
        const prompt = String(config.prompt || input || '').trim();
        if (!prompt) throw new AppError(400, 'flow_image_prompt', 'An image node needs a prompt or upstream text.');
        const outputPath = path.join(dir, `${nodeId}.png`);
        const result = await generatePromptImage({
          prompt, aspectRatio: config.aspectRatio || film?.aspect_ratio || '16:9',
          style: film?.style || 'cinematic', seedKey: `${flowId}:${nodeId}`, outputPath,
        });
        output = { text: prompt, summary: `${result.provider} · ${result.width}×${result.height}`, path: result.path, provider: result.provider, ai: result.ai };
      } else if (node.type === 'voice') {
        if (!tts.configured) throw new AppError(503, 'tts_unavailable', tts.error || 'No TTS provider is configured.');
        const text = String(config.text || input || '').trim();
        if (!text) throw new AppError(400, 'flow_voice_text', 'A voice node needs text or upstream output.');
        const outputPath = path.join(dir, `${nodeId}.wav`);
        await synthesizeScene({
          text, language: film?.language || 'en', voice: config.voice || 'nova',
          outputPath, workDir: dir, index: nodeId,
        });
        output = { text, summary: `${tts.provider} take`, path: outputPath, provider: tts.provider };
      } else if (node.type === 'scene') {
        if (!film) throw new AppError(409, 'flow_needs_project', 'Attach a project to this flow to render a scene clip.');
        const sceneId = String(config.sceneId || '').trim();
        if (!sceneId) throw new AppError(400, 'flow_scene_missing', 'Pick which scene this node renders.');
        const result = await requestSceneGeneration(userId, row.film_id, sceneId, 'user');
        output = { text: '', summary: `Scene queued with ${result.provider}`, scene: result.sceneId, provider: result.provider, credits: result.creditsCost };
      } else {
        throw new AppError(400, 'flow_node_unknown', `Unknown node type "${node.type}".`);
      }
      outputs.set(nodeId, output);
      results.push({ nodeId, type: node.type, status: 'done', output, summary: output.summary, startedAt, finishedAt: now(), ...(output.path ? { file: path.basename(output.path) } : {}) });
    } catch (error) {
      failure = { nodeId, type: node.type, error: error.message, code: error.code || 'flow_node_failed' };
      results.push({ nodeId, type: node.type, status: 'failed', error: error.message, code: failure.code, startedAt, finishedAt: now() });
    }
  }

  const status = failure ? 'failed' : 'succeeded';
  const lastRun = { status, startedAt: now(), finishedAt: now(), nodes: results, error: failure?.error || null, provider: { image: images, tts } };
  await db('film_flows').where({ id: flowId }).update({
    status, last_run: json(lastRun), last_run_at: now(), updated_at: now(),
  });
  return { flow: flowView(await db('film_flows').where({ id: flowId }).first()), lastRun, force };
}

/** List generated files so the canvas can link to real artifacts. */
export async function flowArtifact(userId, flowId, filename) {
  await ownedFlow(userId, flowId);
  const safe = path.basename(String(filename || ''));
  const filePath = path.join(await ensureProjectDir(`flow_${flowId}`), safe);
  if (!filePath.startsWith(path.join(await ensureProjectDir(`flow_${flowId}`))) || !fs.existsSync(filePath)) {
    throw new AppError(404, 'artifact_not_found', 'Artifact not found.');
  }
  return filePath;
}
