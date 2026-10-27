import fs from 'node:fs/promises';
import path from 'node:path';
import { db, now, json, parseJson } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { generateContentPlan, researchTopic } from '../ai.js';
import { sendNotification } from '../notifications.js';
import { queuePostPublications, recordProjectCompletionUsage } from '../services/projects.js';
import { generateSceneImages, activeImageProvider } from './images.js';
import { buildNarrationAudio, activeTtsProvider } from './audio.js';
import { renderVideo, cleanupFrames } from './render.js';
import { ensureProjectDir, projectDir } from './utils.js';

const STAGE_LABELS = {
  queued: 'Queued',
  research: 'Researching topic',
  script: 'Writing original script',
  images: 'Creating scene visuals',
  voiceover: 'Synthesizing narration',
  captions: 'Timing subtitles and music',
  rendering: 'Rendering final MP4',
  thumbnail: 'Preparing platform assets',
  completed: 'Completed',
  failed: 'Failed',
};

async function setProgress(projectId, stage, progress, callback, extra = {}) {
  const row = await db('projects').where({ id: projectId }).first();
  const summary = parseJson(row?.provider_summary, {});
  const stages = Array.isArray(summary.stages) ? summary.stages : [];
  const last = stages[stages.length - 1];
  if (!last || last.stage !== stage) stages.push({ stage, label: STAGE_LABELS[stage] || stage, progress, at: now() });
  else { last.progress = progress; last.at = now(); }
  const update = {
    stage,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    updated_at: now(),
    provider_summary: json({ ...summary, ...extra, stages, currentStage: stage }),
  };
  if (stage === 'completed') { update.status = 'completed'; update.completed_at = now(); update.error = null; }
  else if (stage !== 'queued') update.status = 'generating';
  await db('projects').where({ id: projectId }).update(update);
  if (callback) await callback(stage, progress, STAGE_LABELS[stage] || stage);
}

export async function generateProjectVideo(projectId, onProgress = null) {
  const project = await db('projects').where({ id: projectId }).first();
  if (!project) throw new Error(`Project ${projectId} not found.`);
  if (project.status === 'completed' && project.video_path) {
    try {
      await fs.access(project.video_path);
      await onProgress?.('completed', 100, STAGE_LABELS.completed);
      return project;
    } catch {}
  }
  const input = parseJson(project.config, {});
  const workDir = await ensureProjectDir(projectId);
  try {
    await setProgress(projectId, 'research', 6, onProgress);
    let research = { provider: 'none', sources: [] };
    let researchNote = 'Research was not requested for this project.';
    if (input.research) {
      if (config.ai.researchProvider === 'none') {
        researchNote = 'Research was requested, but SEARCH_PROVIDER is not configured. The script was written without external sources.';
      } else {
        research = await researchTopic(input.topic, input.niche);
        researchNote = `${research.sources.length} source(s) retrieved from ${research.provider}; source links are stored for editorial review.`;
      }
    }
    logger.info({ projectId, researchProvider: research.provider, sources: research.sources.length }, 'Starting content generation');

    await setProgress(projectId, 'script', 16, onProgress, { researchNote });
    const plan = await generateContentPlan(input, research);
    const captions = plan.captions || {};
    const hashtags = Object.fromEntries(Object.entries(captions).map(([platform, caption]) => [platform, caption.hashtags || []]));
    await db('projects').where({ id: projectId }).update({
      title: plan.title || project.title,
      script: plan.script,
      scenes: json(plan.scenes),
      sources: json(plan.sources || []),
      metadata: json({
        captions,
        sources: plan.sources || [],
        safetyNotes: plan.safetyNotes,
        hook: plan.hook,
      }),
      provider_summary: json({
        ...plan.providerSummary,
        researchNote,
        stages: parseJson((await db('projects').where({ id: projectId }).first())?.provider_summary, {}).stages || [],
      }),
      updated_at: now(),
    });
    const post = await db('posts').where({ project_id: projectId }).first();
    if (post) await db('posts').where({ id: post.id }).update({ captions: json(captions), hashtags: json(hashtags), updated_at: now() });
    await setProgress(projectId, 'images', 32, onProgress);
    const images = await generateSceneImages({ projectId, plan, input, onProgress: async (progress) => setProgress(projectId, 'images', progress, onProgress) });
    await setProgress(projectId, 'voiceover', 55, onProgress);
    const narration = await buildNarrationAudio({ projectId, plan, input, onProgress: async (progress) => setProgress(projectId, 'voiceover', progress, onProgress) });
    await setProgress(projectId, 'captions', 74, onProgress);
    await setProgress(projectId, 'rendering', 76, onProgress);
    const rendered = await renderVideo({
      projectId, plan, input, images, narration,
      onProgress: async (progress) => setProgress(projectId, 'rendering', progress, onProgress),
    });
    await setProgress(projectId, 'thumbnail', 95, onProgress);
    await cleanupFrames(projectId);

    const current = await db('projects').where({ id: projectId }).first();
    const summary = parseJson(current.provider_summary, {});
    const finalSummary = {
      ...summary,
      ...plan.providerSummary,
      researchProvider: research.provider,
      researchNote,
      imageProvider: images.provider || activeImageProvider(),
      ttsProvider: narration.provider || activeTtsProvider(),
      musicProvider: narration.musicProvider,
      renderer: 'ffmpeg/libx264',
      captions: input.captions ? 'burned-in + SRT' : 'SRT file only',
      frameCount: rendered.frameCount,
      completedAt: now(),
      stages: summary.stages || [],
    };
    await db('projects').where({ id: projectId }).update({
      status: 'completed', stage: 'completed', progress: 100,
      video_path: rendered.videoPath, thumbnail_path: rendered.thumbnailPath,
      caption_path: rendered.captionPath, audio_path: rendered.audioPath,
      duration_seconds: Math.round(rendered.duration),
      provider_summary: json(finalSummary),
      metadata: json({ ...parseJson(current.metadata, {}), renderedAt: now(), localAssets: true }),
      completed_at: now(), updated_at: now(), error: null,
    });
    await recordProjectCompletionUsage(project.user_id, rendered.duration, narration.ttsCharacters, plan.providerSummary.aiGenerated ? 1 : 0);
    await sendNotification(project.user_id, {
      type: 'success',
      title: 'Your video is ready',
      body: `${plan.title} was rendered with ${plan.scenes.length} scenes${input.captions ? ', captions' : ''}, and voice-over.`,
      actionUrl: `/app/projects/${projectId}`,
    });
    if (post && !['draft', 'needs_review'].includes(post.status)) {
      await queuePostPublications(post.id, { reason: 'project-completed', priority: 8 });
    }
    await onProgress?.('completed', 100, STAGE_LABELS.completed);
    logger.info({ projectId, duration: rendered.duration, imageProvider: images.provider, ttsProvider: narration.provider }, 'Project generation completed');
    return db('projects').where({ id: projectId }).first();
  } catch (error) {
    const message = String(error?.message || error);
    await db('projects').where({ id: projectId }).update({
      status: 'failed', stage: 'failed', error: message, updated_at: now(),
      provider_summary: json({ ...parseJson((await db('projects').where({ id: projectId }).first())?.provider_summary, {}), error: message }),
    });
    await sendNotification(project.user_id, {
      type: 'error',
      title: 'Video generation failed',
      body: message.slice(0, 500),
      actionUrl: `/app/projects/${projectId}`,
    });
    logger.error({ projectId, error: message }, 'Project generation failed');
    throw error;
  }
}

export async function projectAssetPath(projectId, filename) {
  const dir = projectDir(projectId);
  const target = path.resolve(dir, filename);
  if (!target.startsWith(`${dir}${path.sep}`) && target !== dir) throw new Error('Invalid asset path');
  return target;
}
