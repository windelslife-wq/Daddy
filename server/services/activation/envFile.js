/**
 * Safe .env file handling for the activation wizard.
 *
 * - Preserves comments, blank lines, and ordering of the user's existing file.
 * - Uncomments template lines like `# KEY=` instead of creating duplicates.
 * - Never prints values; callers use validators.describeValue() for display.
 * - Writes atomically with mode 0600 (secrets are owner-readable only).
 * - Verifies .gitignore covers the file before writing anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const ADDED_HEADER = '## Added by the Faceless Studio setup wizard';
const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const COMMENTED_KEY_LINE = /^\s*#\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * dotenv v17 only unescapes `\n` and `\r` inside double quotes; it leaves `\"`
 * and `\\` intact. The bare (unquoted) form, however, preserves every character
 * except `#`, CR and LF. So we prefer bare, and quote only when necessary.
 * `mergeEnv` verifies the round trip and refuses to write unrepresentable
 * values instead of silently corrupting a secret.
 */
export function formatValue(value) {
  const raw = String(value ?? '');
  if (raw === '') return '""';
  const bareSafe = !/[\s#\r\n]/.test(raw)
    && !/^['"`]/.test(raw)
    && !/['"`]$/.test(raw);
  if (bareSafe) return raw;
  const escaped = raw
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function readEnvFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

/** Parse a .env file into a plain object without touching process.env. */
export function parseEnv(content) {
  try { return dotenv.parse(Buffer.from(content || '')); } catch { return {}; }
}

/**
 * Merge updates into .env content. Values already present are replaced in
 * place; commented template keys are revived; missing keys are appended once.
 */
export function mergeEnv(content, updates) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const keys = new Set(Object.keys(updates));
  const seen = new Set();
  const output = [];
  for (const line of lines) {
    const active = KEY_LINE.exec(line);
    if (active && keys.has(active[1])) {
      if (seen.has(active[1])) {
        output.push(`# ${line.trim()}  (duplicate removed by setup wizard)`);
      } else {
        seen.add(active[1]);
        output.push(`${active[1]}=${formatValue(updates[active[1]])}`);
      }
      continue;
    }
    const commented = COMMENTED_KEY_LINE.exec(line);
    if (commented && keys.has(commented[1]) && !seen.has(commented[1])) {
      seen.add(commented[1]);
      output.push(`${commented[1]}=${formatValue(updates[commented[1]])}`);
      continue;
    }
    output.push(line);
  }

  const missing = Object.keys(updates).filter((key) => !seen.has(key));
  if (missing.length) {
    while (output.length && output[output.length - 1].trim() === '') output.pop();
    if (!output.includes(ADDED_HEADER)) {
      if (output.length) output.push('');
      output.push(ADDED_HEADER);
    }
    for (const key of missing) output.push(`${key}=${formatValue(updates[key])}`);
  }
  const merged = `${output.join('\n').replace(/\n+$/, '')}\n`;

  // Never silently corrupt a secret: verify dotenv reads back exactly what we
  // were asked to store.
  const parsed = parseEnv(merged);
  for (const [key, value] of Object.entries(updates)) {
    if (parsed[key] !== String(value)) {
      throw new Error(
        `The value for ${key} contains characters a .env file cannot preserve. ` +
        `Set ${key} directly in the process environment (or URL-encode special characters) instead.`,
      );
    }
  }
  return merged;
}

/** Atomic write with restrictive permissions. */
export function writeEnvFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* platform may not support chmod */ }
}

/**
 * Returns true when a .gitignore rule covers this env filename.
 * Recognises `.env`, `.env.*`, and `!.env.example` exceptions.
 */
export function gitignoreCovers(root, envFileName = '.env') {
  const ignorePath = path.join(root, '.gitignore');
  let content = '';
  try { content = fs.readFileSync(ignorePath, 'utf8'); } catch { return false; }
  const rules = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let covered = false;
  for (const rule of rules) {
    const negated = rule.startsWith('!');
    const pattern = negated ? rule.slice(1) : rule;
    const matches = pattern === envFileName
      || (pattern.endsWith('*') && envFileName.startsWith(pattern.slice(0, -1)))
      || pattern === '.*';
    if (matches) covered = !negated;
  }
  return covered;
}

/** Load .env into a fresh object (optionally overlaid with process.env). */
export function loadEnv(filePath, { includeProcessEnv = true } = {}) {
  const fromFile = parseEnv(readEnvFile(filePath));
  return includeProcessEnv ? { ...fromFile, ...process.env } : fromFile;
}
