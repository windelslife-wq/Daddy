/**
 * Advertisement studio: brand kits and real ad variations.
 *
 * A brand kit is persisted per user and attached to an advertisement project.
 * Variations are generated through the same screenplay engine as the rest of
 * the studio (AI when configured, a labelled deterministic draft otherwise) and
 * are only written into the project when the director applies one.
 */
import fs from 'node:fs';
import { z } from 'zod';
import { db, now, newId, json, parseJson } from '../db.js';
import { AppError } from '../errors.js';
import { ownedFilm, saveScreenplay } from './scenes.js';
import { generateScreenplay } from './screenplay.js';

export const brandKitSchema = z.object({
  name: z.string().trim().min(1).max(160),
  product: z.string().max(160).optional().default(''),
  tagline: z.string().max(300).optional().default(''),
  description: z.string().max(1200).optional().default(''),
  audience: z.string().max(220).optional().default(''),
  colors: z.array(z.string().max(20)).max(6).optional().default([]),
});

const ANGLES = [
  { id: 'transformation', label: 'Before / after', hook: 'Show the change in the first two seconds', cta: 'Try it today' },
  { id: 'problem_solution', label: 'Problem → solution', hook: 'Name the frustration out loud', cta: 'Fix it in one step' },
  { id: 'social_proof', label: 'Social proof', hook: 'Real customers saying it works', cta: 'Join thousands of customers' },
  { id: 'demonstration', label: 'Demonstration', hook: 'The product doing the work in close-up', cta: 'See it for yourself' },
  { id: 'founder_story', label: 'Founder story', hook: 'Why this brand exists', cta: 'Made for people like you' },
];

export function brandKitView(row) {
  return {
    id: row.id,
    name: row.name,
    product: row.product,
    tagline: row.tagline,
    description: row.description,
    audience: row.audience,
    colors: parseJson(row.colors, []),
    hasLogo: Boolean(row.logo_path && fs.existsSync(row.logo_path)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBrandKits(userId) {
  const rows = await db('brand_kits').where({ user_id: userId }).orderBy('updated_at', 'desc');
  return rows.map(brandKitView);
}

export async function upsertBrandKit(userId, input = {}) {
  const data = brandKitSchema.parse(input);
  const existing = await db('brand_kits').where({ user_id: userId }).whereRaw('LOWER(name) = ?', [data.name.toLowerCase()]).first();
  if (existing) {
    await db('brand_kits').where({ id: existing.id }).update({
      product: data.product, tagline: data.tagline, description: data.description,
      audience: data.audience, colors: json(data.colors), updated_at: now(),
    });
    return brandKitView(await db('brand_kits').where({ id: existing.id }).first());
  }
  const id = newId('brand_');
  await db('brand_kits').insert({
    id, user_id: userId, name: data.name, product: data.product, tagline: data.tagline,
    description: data.description, audience: data.audience, colors: json(data.colors),
    logo_path: null, created_at: now(), updated_at: now(),
  });
  return brandKitView(await db('brand_kits').where({ id }).first());
}

export async function deleteBrandKit(userId, brandKitId) {
  const row = await db('brand_kits').where({ id: brandKitId, user_id: userId }).first();
  if (!row) throw new AppError(404, 'brand_kit_not_found', 'Brand kit not found.');
  await db('film_projects').where({ brand_kit_id: brandKitId }).update({ brand_kit_id: null, updated_at: now() });
  await db('brand_kits').where({ id: brandKitId }).delete();
  return { deleted: true };
}

/** Attach a brand kit so variant generation and prompts use it. */
export async function attachBrandKit(userId, filmId, brandKitId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  if (!brandKitId) {
    await db('film_projects').where({ id: filmId }).update({ brand_kit_id: null, updated_at: now() });
    return { brandKit: null, filmId };
  }
  const kit = await db('brand_kits').where({ id: brandKitId, user_id: userId }).first();
  if (!kit) throw new AppError(404, 'brand_kit_not_found', 'Brand kit not found.');
  const metadata = parseJson(film.metadata, {});
  metadata.brand = {
    name: kit.name, product: kit.product, tagline: kit.tagline,
    colors: parseJson(kit.colors, []), audience: kit.audience,
  };
  await db('film_projects').where({ id: filmId }).update({
    brand_kit_id: kit.id, metadata: json(metadata), updated_at: now(),
  });
  return { brandKit: brandKitView(kit), filmId };
}

export async function adVariants(userId, filmId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const variants = parseJson(film.ad_variants, []);
  const kit = film.brand_kit_id ? await db('brand_kits').where({ id: film.brand_kit_id }).first() : null;
  return {
    brandKit: kit ? brandKitView(kit) : null,
    variants: variants.map((variant) => ({
      id: variant.id, angle: variant.angle, label: variant.label, hook: variant.hook,
      cta: variant.cta, logline: variant.logline, scenes: variant.scenes,
      provider: variant.provider, aiGenerated: Boolean(variant.aiGenerated),
      createdAt: variant.createdAt,
    })),
    angles: ANGLES,
  };
}

/**
 * Generate `count` distinct creative angles for the attached brand. Each variant
 * carries a full screenplay so applying one is a single click.
 */
export async function generateAdVariations(userId, filmId, input = {}, role = 'user') {
  const data = z.object({ count: z.number().int().min(1).max(5).optional().default(3) }).parse(input || {});
  const film = await ownedFilm(userId, filmId, role);
  if (film.type !== 'advertisement') {
    throw new AppError(409, 'not_an_advertisement', 'Ad variations are only available on advertisement projects. Change the format in Setup first.');
  }
  const kit = film.brand_kit_id ? await db('brand_kits').where({ id: film.brand_kit_id }).first() : null;
  if (!kit) throw new AppError(409, 'brand_kit_missing', 'Attach a brand kit first so the variations advertise the right product.');
  const angles = ANGLES.slice(0, data.count);
  const variants = [];
  for (const angle of angles) {
    const brief = [
      `${kit.product || kit.name} advertisement.`,
      kit.tagline ? `Tagline: ${kit.tagline}.` : '',
      kit.description ? `Product: ${kit.description}.` : '',
      kit.audience ? `Audience: ${kit.audience}.` : '',
      `Creative angle: ${angle.label} — ${angle.hook}. Call to action: "${angle.cta}".`,
    ].filter(Boolean).join(' ');
    const screenplay = await generateScreenplay({
      idea: brief,
      type: 'advertisement',
      genre: 'advertisement',
      language: film.language,
      style: film.style,
      aspectRatio: film.aspect_ratio,
      platform: film.target_platform,
      targetDurationSeconds: Math.min(60, Number(film.target_duration_seconds) || 30),
      storyBible: parseJson(film.story_bible, {}),
      allowTemplate: true,
    });
    variants.push({
      id: newId('adv_'),
      angle: angle.id,
      label: angle.label,
      hook: angle.hook,
      cta: angle.cta,
      logline: kit.tagline || screenplay.logline || brief.slice(0, 200),
      scenes: screenplay.scenes.length,
      provider: screenplay.provider,
      aiGenerated: Boolean(screenplay.aiGenerated),
      screenplay,
      createdAt: now(),
    });
  }
  // Keep the latest generation; variants never stack up invisibly.
  await db('film_projects').where({ id: filmId }).update({ ad_variants: json(variants), updated_at: now() });
  return adVariants(userId, filmId, role);
}

/** Write one generated variant into the project (replacing its scenes). */
export async function applyAdVariant(userId, filmId, variantId, role = 'user') {
  const film = await ownedFilm(userId, filmId, role);
  const variants = parseJson(film.ad_variants, []);
  const variant = variants.find((item) => item.id === variantId);
  if (!variant?.screenplay) throw new AppError(404, 'ad_variant_not_found', 'That variation is no longer available. Generate variations again.');
  const saved = await saveScreenplay(userId, filmId, variant.screenplay, role);
  return {
    applied: variant.id,
    angle: variant.label,
    provider: variant.provider,
    aiGenerated: Boolean(variant.aiGenerated),
    scenes: Array.isArray(saved?.scenes) ? saved.scenes.length : variant.scenes,
  };
}
