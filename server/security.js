import crypto from 'node:crypto';
import { config } from './config.js';

const key = config.encryptionKeyMaterial
  ? crypto.createHash('sha256').update(config.encryptionKeyMaterial, 'utf8').digest()
  : crypto.createHash('sha256').update('ephemeral-development-only').digest();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algorithm, saltPart, hashPart] = String(stored).split('$');
    if (algorithm !== 'scrypt' || !saltPart || !hashPart) return false;
    const expected = Buffer.from(hashPart, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(saltPart, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function encrypt(value) {
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decrypt(payload) {
  const [version, ivPart, tagPart, dataPart] = String(payload).split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  try { return JSON.parse(plain); } catch { return plain; }
}

export function signValue(value, purpose = 'media', ttlSeconds = 60 * 60 * 24 * 7) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ purpose, value, expires })).toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySignedValue(token, purpose = 'media') {
  const [body, signature] = String(token).split('.');
  if (!body || !signature) throw new Error('Invalid signature token');
  const expectedBuffer = crypto.createHmac('sha256', key).update(body).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expectedBuffer.length) throw new Error('Invalid signature');
  if (!crypto.timingSafeEqual(supplied, expectedBuffer)) throw new Error('Invalid signature');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (data.purpose !== purpose || data.expires < Math.floor(Date.now() / 1000)) throw new Error('Signature expired');
  return data.value;
}

export function safeParseCredentials(value) {
  if (!value) return {};
  if (typeof value === 'string' && value.startsWith('v1.')) return decrypt(value);
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const credentials = typeof parsed === 'string' ? decrypt(parsed) : parsed;
    if (!credentials || typeof credentials !== 'object') throw new Error('credentials payload is not an object');
    return credentials;
  } catch (error) {
    throw new Error(`Unable to decrypt stored credentials: ${error.message}`);
  }
}

export function shortRef(id) {
  return `FC-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8)}`;
}

const SENSITIVE = /(authorization|access_token|refresh_token|api[_-]?key|password|secret|token|signature|cookie)/i;
export function redact(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) result[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
    return result;
  }
  return value;
}
