import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db, notify, logger } from './db.js';

let transporter = null;
if (config.notifications.smtpUrl) {
  try {
    transporter = nodemailer.createTransport(config.notifications.smtpUrl);
  } catch (error) {
    logger.error({ error: error.message }, 'SMTP transport could not be created');
  }
}

function plainText(body) {
  return String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function sendNotification(userId, data) {
  const id = await notify(userId, data);
  if (!transporter) return id;
  try {
    const user = await db('users').where({ id: userId }).first();
    if (!user?.email) return id;
    await transporter.sendMail({
      from: config.notifications.from,
      to: user.email,
      subject: data.title,
      text: `${plainText(data.body)}\n\nOpen ${config.publicBaseUrl}${data.actionUrl || '/app'}`,
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#e8eefc;background:#0b1020;padding:24px"><h2 style="color:#fff">${data.title}</h2><p>${plainText(data.body)}</p><p><a style="color:#8b7cff" href="${config.publicBaseUrl}${data.actionUrl || '/app'}">Open ${config.appName}</a></p></div>`,
    });
  } catch (error) {
    logger.warn({ error: error.message, userId }, 'Email notification failed');
  }
  return id;
}
