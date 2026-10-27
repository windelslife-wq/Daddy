import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, now, newId, parseJson, logAudit } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, AppError, badRequest } from '../errors.js';
import { parseBody } from '../validation.js';
import { sendNotification } from '../notifications.js';

const checkoutSchema = z.object({ planId: z.string().min(1).max(48) });

function appendForm(form, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) value.forEach((item, index) => appendForm(form, `${key}[${index}]`, item));
  else if (typeof value === 'object') Object.entries(value).forEach(([child, item]) => appendForm(form, `${key}[${child}]`, item));
  else form.append(key, String(value));
}

async function stripeRequest(path, { method = 'GET', params = {} } = {}) {
  if (!config.stripe.secret) throw new AppError(503, 'stripe_not_configured', 'STRIPE_SECRET_KEY is not configured. Subscription checkout is unavailable.');
  const form = new URLSearchParams();
  if (method !== 'GET') appendForm(form, '', undefined);
  for (const [key, value] of Object.entries(params)) appendForm(form, key, value);
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${config.stripe.secret}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) throw new AppError(502, 'stripe_api_error', payload?.error?.message || `Stripe returned ${response.status}`);
  return payload;
}

async function assignPlan(userId, planId, source = 'billing') {
  const plan = await db('plans').where({ id: planId, active: true }).first();
  if (!plan) throw badRequest(`Plan "${planId}" is not available.`);
  await db('users').where({ id: userId }).update({ plan_id: plan.id });
  await logAudit({ userId, action: 'billing.plan_changed', entityType: 'user', entityId: userId, details: { planId: plan.id, source } });
  await sendNotification(userId, {
    type: 'billing', title: 'Subscription plan updated',
    body: `Your account is now on the ${plan.name} plan. Usage limits have been updated.`,
    actionUrl: '/app/settings',
  });
  return plan;
}

async function sessionToPlan(session) {
  const userId = session.client_reference_id || session.metadata?.userId;
  const planId = session.metadata?.planId;
  if (!userId || !planId) return null;
  if (session.payment_status !== 'paid' && session.status !== 'complete') return null;
  return assignPlan(userId, planId, 'checkout-session');
}

export function billingRouter() {
  const router = express.Router();

  router.get('/plans', asyncHandler(async (_req, res) => {
    const rows = await db('plans').where({ active: true }).orderBy('sort_order', 'asc');
    res.json({ plans: rows.map((row) => ({ ...row, features: parseJson(row.features, []), active: Boolean(row.active), stripeConfigured: Boolean(config.stripe.secret) })) });
  }));

  router.post('/checkout', requireAuth, asyncHandler(async (req, res) => {
    const data = parseBody(checkoutSchema, req.body);
    const plan = await db('plans').where({ id: data.planId, active: true }).first();
    if (!plan) throw badRequest('Plan not found.');
    if (Number(plan.price_cents) === 0) {
      await assignPlan(req.user.id, plan.id, 'free-plan');
      return res.json({ updated: true, url: `/app/settings?billing=success&plan=${encodeURIComponent(plan.id)}` });
    }
    if (!plan.stripe_price_id) throw new AppError(400, 'stripe_price_missing', `The ${plan.name} plan has no Stripe Price ID. An administrator must set one in the admin panel.`);
    if (!config.stripe.secret) throw new AppError(503, 'stripe_not_configured', 'STRIPE_SECRET_KEY is not configured. Add it to the server environment to enable checkout.');
    const session = await stripeRequest('/checkout/sessions', {
      method: 'POST',
      params: {
        mode: 'subscription',
        client_reference_id: req.user.id,
        customer_email: req.user.email,
        'line_items': [{ price: plan.stripe_price_id, quantity: 1 }],
        success_url: `${config.publicBaseUrl}/app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.publicBaseUrl}/app/settings?billing=cancelled`,
        allow_promotion_codes: 'true',
        'metadata': { userId: req.user.id, planId: plan.id },
        'subscription_data': { metadata: { userId: req.user.id, planId: plan.id } },
      },
    });
    if (!session.url) throw new AppError(502, 'stripe_checkout_error', 'Stripe did not return a checkout URL.');
    res.json({ url: session.url, sessionId: session.id });
  }));

  router.get('/checkout-session/:id', requireAuth, asyncHandler(async (req, res) => {
    const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(req.params.id)}`);
    if (session.client_reference_id !== req.user.id && session.metadata?.userId !== req.user.id) throw new AppError(403, 'forbidden', 'This checkout session belongs to another user.');
    const plan = await sessionToPlan(session);
    res.json({ status: session.status, paymentStatus: session.payment_status, plan: plan ? { id: plan.id, name: plan.name } : null });
  }));

  return router;
}

function verifyStripeSignature(raw, header) {
  if (!config.stripe.webhookSecret) throw new AppError(503, 'stripe_webhook_not_configured', 'STRIPE_WEBHOOK_SECRET is not configured.');
  if (!header) throw new AppError(400, 'stripe_signature_missing', 'Missing Stripe-Signature header.');
  const parts = Object.fromEntries(String(header).split(',').map((part) => {
    const index = part.indexOf('=');
    return index >= 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : [part.trim(), ''];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new AppError(400, 'stripe_signature_invalid', 'Invalid Stripe-Signature header.');
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new AppError(400, 'stripe_signature_timestamp', 'Stripe webhook timestamp is outside the allowed window.');
  const expected = crypto.createHmac('sha256', config.stripe.webhookSecret).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex');
  const supplied = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) throw new AppError(400, 'stripe_signature_invalid', 'Stripe webhook signature does not match.');
}

export async function stripeWebhookHandler(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  verifyStripeSignature(raw, req.get('stripe-signature'));
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw new AppError(400, 'stripe_webhook_invalid', 'Invalid webhook JSON.'); }
  const eventId = event.id || `evt_${crypto.randomUUID()}`;
  const existing = await db('webhook_events').where({ provider: 'stripe', event_id: eventId }).first();
  if (existing) return res.json({ received: true, duplicate: true });
  await db('webhook_events').insert({
    id: newId('whk_'), provider: 'stripe', event_id: eventId,
    payload: JSON.stringify(event).slice(0, 100000), processed_at: null, created_at: now(),
  }).onConflict('event_id').ignore();
  const object = event.data?.object || {};
  try {
    if (event.type === 'checkout.session.completed') await sessionToPlan(object);
    if (event.type === 'customer.subscription.updated') {
      const planId = object.metadata?.planId;
      const userId = object.metadata?.userId;
      if (planId && userId) await assignPlan(userId, planId, 'stripe-subscription-updated');
    }
    if (event.type === 'customer.subscription.deleted') {
      const userId = object.metadata?.userId;
      if (userId) await assignPlan(userId, 'free', 'stripe-subscription-deleted');
    }
    await db('webhook_events').where({ provider: 'stripe', event_id: eventId }).update({ processed_at: now() });
  } catch (error) {
    req.log?.error({ error: error.message, eventId, type: event.type }, 'Stripe webhook processing failed');
    return res.status(500).json({ error: { code: 'webhook_processing_failed', message: error.message } });
  }
  return res.json({ received: true, type: event.type });
}
