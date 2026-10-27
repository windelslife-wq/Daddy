import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, newId, now, logAudit, logger } from '../db.js';
import { parseBody } from '../validation.js';
import { asyncHandler } from '../errors.js';
import { sendNotification } from '../notifications.js';

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(180),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  topic: z.enum(['sales', 'support', 'integrations', 'partnership', 'security', 'other']),
  message: z.string().trim().min(10, 'Please add at least 10 characters.').max(5000),
  website: z.string().max(200).optional().default(''),
});

const TOPIC_LABELS = {
  sales: 'Plans and team setup',
  support: 'Product support',
  integrations: 'Integrations and provider approval',
  partnership: 'Partnership',
  security: 'Security or privacy',
  other: 'General enquiry',
};

// Public forms need a stricter per-IP limit than the general API limiter.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many messages. Please try again later.' } },
});

export function contactMessageView(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    topic: row.topic,
    topicLabel: TOPIC_LABELS[row.topic] || row.topic,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function contactRouter() {
  const router = express.Router();

  router.post('/', contactLimiter, asyncHandler(async (req, res) => {
    const data = parseBody(contactSchema, req.body);
    // Honeypot: silently accept obvious bot submissions without storing them.
    if (data.website) return res.status(202).json({ ok: true, reference: null, message: 'Message received.' });

    const id = newId('ctm_');
    const timestamp = now();
    await db('contact_messages').insert({
      id,
      name: data.name,
      email: data.email,
      topic: data.topic,
      message: data.message,
      status: 'new',
      ip: req.ip ? String(req.ip).slice(0, 120) : null,
      user_agent: req.get('user-agent') ? String(req.get('user-agent')).slice(0, 1000) : null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    await logAudit({
      userId: req.user?.id || null,
      action: 'contact.message.received',
      entityType: 'contact_message',
      entityId: id,
      details: { topic: data.topic },
      ip: req.ip || null,
    });

    try {
      const admins = await db('users').where({ role: 'admin', status: 'active' }).select('id');
      await Promise.all(admins.map((admin) => sendNotification(admin.id, {
        type: 'attention',
        title: `New contact message: ${TOPIC_LABELS[data.topic]}`,
        body: `${data.name} (${data.email}) sent a new website message. Open Admin → Messages to review it.`,
        actionUrl: '/app/admin',
        metadata: { contactId: id, topic: data.topic },
      })));
    } catch (error) {
      logger.warn({ error: error.message, contactId: id }, 'Could not notify administrators about contact message');
    }

    logger.info({ contactId: id, topic: data.topic }, 'Contact message received');
    return res.status(201).json({ ok: true, reference: id, message: 'Message received. Administrators have been notified.' });
  }));

  return router;
}
