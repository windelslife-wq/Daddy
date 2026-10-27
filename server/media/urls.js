import path from 'node:path';
import { config } from '../config.js';
import { signValue, verifySignedValue } from '../security.js';
import { projectDir, resolveProjectFile } from './utils.js';

export function relativeProjectFile(projectId, absolutePath) {
  const relative = path.relative(projectDir(projectId), path.resolve(absolutePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File is outside the project storage directory');
  return relative;
}

export function signedMediaUrl(projectId, absoluteOrRelativePath, { ttlSeconds = 7 * 86400, baseUrl = config.publicBaseUrl } = {}) {
  const filename = path.isAbsolute(absoluteOrRelativePath)
    ? relativeProjectFile(projectId, absoluteOrRelativePath)
    : absoluteOrRelativePath;
  const token = signValue({ projectId, filename }, 'media', ttlSeconds);
  return `${baseUrl.replace(/\/$/, '')}/api/media/public/${encodeURIComponent(token)}/${encodeURIComponent(path.basename(filename))}`;
}

export function resolveSignedMedia(token, requestedFilename) {
  const value = verifySignedValue(token, 'media');
  if (!value?.projectId || !value?.filename) throw new Error('Invalid media token payload');
  const basename = path.basename(value.filename);
  if (requestedFilename && requestedFilename !== basename) throw new Error('Media filename does not match signed token');
  return { path: resolveProjectFile(value.projectId, value.filename), filename: value.filename };
}
