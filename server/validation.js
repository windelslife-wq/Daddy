import { z } from 'zod';
import { badRequest } from './errors.js';

export function parseBody(schema, body) {
  const result = schema.safeParse(body || {});
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw badRequest('Please correct the highlighted fields.', details);
  }
  return result.data;
}

export const idSchema = z.string().min(1).max(120);
export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters.').max(128);

export const authSchemas = {
  register: z.object({
    name: z.string().trim().min(2).max(180),
    email: emailSchema,
    password: passwordSchema,
  }),
  login: z.object({ email: emailSchema, password: z.string().min(1).max(128) }),
  changePassword: z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }),
  updateProfile: z.object({ name: z.string().trim().min(2).max(180), email: emailSchema.optional() }),
};

export const platformEnum = z.enum(['sandbox', 'facebook', 'instagram', 'youtube', 'x']);
export const aspectEnum = z.enum(['9:16', '1:1', '16:9']);
export const frequencyEnum = z.enum(['daily', 'weekly', 'custom']);

export const projectSchema = z.object({
  nicheId: z.string().max(80).optional().nullable(),
  niche: z.string().trim().min(2).max(120).default('Education'),
  topic: z.string().trim().min(3, 'Give the AI a topic with at least 3 characters.').max(500),
  title: z.string().trim().max(220).optional(),
  style: z.enum(['comic', 'creepy-comic', 'modern-cartoon', 'cinematic', 'animated', '3d']).default('cinematic'),
  language: z.enum(['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'zh']).default('en'),
  voice: z.string().trim().min(1).max(80).default('nova'),
  aspectRatio: aspectEnum.default('9:16'),
  duration: z.coerce.number().int().min(15).max(180).default(45),
  captions: z.boolean().default(true),
  music: z.boolean().default(true),
  research: z.boolean().default(false),
  autoPublish: z.boolean().default(false),
  reviewRequired: z.boolean().default(true),
  platforms: z.array(platformEnum).max(5).default(['sandbox']),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  tone: z.enum(['dramatic', 'conversational', 'educational', 'inspiring', 'documentary']).default('documentary'),
});

export const nicheSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().default(''),
  defaultTopic: z.string().trim().max(500).optional().default(''),
  style: z.string().max(80).optional(),
  language: z.string().max(10).optional(),
  voice: z.string().max(80).optional(),
  aspectRatio: aspectEnum.optional(),
  duration: z.coerce.number().int().min(15).max(180).optional(),
  platforms: z.array(platformEnum).max(5).optional(),
  autopilot: z.boolean().optional().default(false),
  reviewRequired: z.boolean().optional().default(true),
  postingLimitPerDay: z.coerce.number().int().min(1).max(20).optional().default(2),
  schedule: z.object({
    frequency: frequencyEnum,
    timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().max(80).default('UTC'),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    cronExpression: z.string().max(120).optional(),
    intervalMinutes: z.coerce.number().int().min(15).max(60 * 24 * 30).optional(),
  }).optional(),
});

export const scheduleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  frequency: frequencyEnum,
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  timezone: z.string().max(80).default('UTC'),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
  cronExpression: z.string().max(120).optional().nullable(),
  intervalMinutes: z.coerce.number().int().min(15).max(60 * 24 * 30).default(1440),
  active: z.boolean().default(true),
  autopilot: z.boolean().default(false),
});

export const planSchema = z.object({
  name: z.string().trim().min(2).max(100),
  priceCents: z.coerce.number().int().min(0).max(10000000),
  maxVideosMonth: z.coerce.number().int().min(0).max(1000000),
  maxRenderSecondsMonth: z.coerce.number().int().min(0).max(100000000),
  maxPostsMonth: z.coerce.number().int().min(0).max(10000000),
  maxAccounts: z.coerce.number().int().min(0).max(100000),
  maxProjects: z.coerce.number().int().min(0).max(1000000),
  features: z.array(z.string().max(200)).max(20).default([]),
  active: z.boolean().default(true),
  stripePriceId: z.string().max(120).optional().nullable(),
});
