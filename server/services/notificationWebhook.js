import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function signNotificationPayload(raw, { secret = config.notifications.webhookSecret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) return null;
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
}

export function notificationWebhookHeaders(raw, options = {}) {
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
  const headers = {
    'content-type': 'application/json',
    'x-faceless-event': 'notification.created',
    'x-faceless-timestamp': String(timestamp),
    'user-agent': `${config.appName.replace(/[^a-z0-9-]/gi, '-')}-webhook/1.0`,
  };
  const signature = signNotificationPayload(raw, { ...options, timestamp });
  if (signature) headers['x-faceless-signature'] = signature;
  return headers;
}

export async function deliverNotificationWebhook(payload) {
  const url = config.notifications.webhookUrl;
  if (!url) return { delivered: false, reason: 'not_configured' };
  if (!config.notifications.webhookSecret) {
    logger.warn('NOTIFICATION_WEBHOOK_URL is set without NOTIFICATION_WEBHOOK_SECRET; sending an unsigned event.');
  }
  const raw = JSON.stringify(payload);
  let lastError = 'Webhook delivery failed.';
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: notificationWebhookHeaders(raw),
        body: raw,
        signal: AbortSignal.timeout(config.notifications.webhookTimeoutMs),
      });
      lastStatus = response.status;
      if (response.ok) return { delivered: true, status: response.status, attempts: attempt };
      lastError = `Webhook returned ${response.status}`;
      if (!RETRYABLE_STATUS.has(response.status)) break;
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** (attempt - 1))));
  }
  logger.warn({ error: lastError, status: lastStatus, notificationId: payload?.id }, 'Notification webhook delivery failed');
  return { delivered: false, error: lastError, status: lastStatus, attempts: 3 };
}
