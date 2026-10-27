import crypto from 'node:crypto';
import { config } from './config.js';
import { redact } from './security.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] || (config.isProduction ? 20 : 10);

function write(level, payload, message) {
  if (LEVELS[level] < minLevel) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg: message,
    ...redact(payload || {}),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (payload, msg) => write('debug', payload, msg),
  info: (payload, msg) => write('info', payload, msg),
  warn: (payload, msg) => write('warn', payload, msg),
  error: (payload, msg) => write('error', payload, msg),
  child(defaults = {}) {
    return {
      debug: (payload, msg) => write('debug', { ...defaults, ...(payload || {}) }, msg),
      info: (payload, msg) => write('info', { ...defaults, ...(payload || {}) }, msg),
      warn: (payload, msg) => write('warn', { ...defaults, ...(payload || {}) }, msg),
      error: (payload, msg) => write('error', { ...defaults, ...(payload || {}) }, msg),
    };
  },
};

export function requestLogger(req, res, next) {
  req.id = crypto.randomUUID();
  req.log = logger.child({ requestId: req.id, method: req.method, path: req.path });
  const started = Date.now();
  res.on('finish', () => {
    req.log.info({ status: res.statusCode, durationMs: Date.now() - started, ip: req.ip }, 'HTTP request');
  });
  next();
}
