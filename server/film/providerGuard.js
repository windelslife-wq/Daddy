/**
 * Operator controls for providers.
 *
 * An administrator can disable a provider without redeploying. The setting is
 * enforced where generation is *queued* (not just in the UI), so a disabled
 * provider cannot be used by an old project that still names it, and the studio
 * falls back to another configured provider only when one is explicitly enabled.
 */
import { db, now } from '../db.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { providerCatalog, resolveVideoProvider } from './videoProviders.js';

export async function disabledProviders() {
  const rows = await db('provider_settings').where({ enabled: 0 });
  return rows.map((row) => row.id);
}

export async function providerEnabled(id) {
  const row = await db('provider_settings').where({ id }).first();
  return !row || Number(row.enabled) !== 0;
}

export async function setProviderEnabled(id, enabled, adminId) {
  const known = providerCatalog().some((item) => item.id === id);
  if (!known) throw new AppError(404, 'provider_unknown', `Unknown provider "${id}".`);
  await db('provider_settings')
    .insert({ id, enabled: enabled ? 1 : 0, updated_by: adminId || null, updated_at: now() })
    .onConflict('id')
    .merge({ enabled: enabled ? 1 : 0, updated_by: adminId || null, updated_at: now() });
  return { id, enabled: Boolean(enabled) };
}

/**
 * Resolve the provider for a job, refusing disabled ones.
 * Falls back to the first enabled + configured provider when the project or the
 * server default points at a disabled provider.
 */
export async function resolveEnabledVideoProvider(requested) {
  const disabled = await disabledProviders();
  const chosen = String(requested || config.film.videoProvider || 'none').toLowerCase();
  if (chosen !== 'none' && disabled.includes(chosen)) {
    const fallback = providerCatalog().find((item) => item.configured && !disabled.includes(item.id));
    if (!fallback) {
      throw new AppError(409, 'provider_disabled', `The ${chosen} provider is disabled by an administrator and no other configured provider is enabled.`);
    }
    return resolveVideoProvider(fallback.id);
  }
  return resolveVideoProvider(requested);
}
