/**
 * Credit economy for AI filmmaking.
 *
 * Append-only ledger + cached balance. Every mutation is idempotent by a
 * caller-supplied key, so worker retries and duplicate clicks can never
 * double-charge. A failed reservation throws (and rolls back) rather than
 * allowing a negative balance.
 */
import { db, now, newId, json, number } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export function creditGrantForPlan(planId) {
  return number(config.film.grantByPlan[planId], 60);
}

/** Ensure the account exists and has received its one-time signup grant. */
export async function ensureCreditAccount(userId) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new AppError(404, 'user_not_found', 'User not found.');
  const existing = await db('credit_accounts').where({ user_id: userId }).first();
  if (existing) return { balance: number(existing.balance), granted: false };
  await db.transaction(async (trx) => {
    const claimed = await trx('credit_ledger').where({ idempotency_key: `signup:${userId}` }).first();
    if (claimed) return;
    const amount = creditGrantForPlan(user.plan_id);
    await trx('credit_ledger').insert({
      id: newId('crd_'), user_id: userId, amount, reason: 'signup_grant',
      reference_type: 'user', reference_id: userId,
      idempotency_key: `signup:${userId}`,
      metadata: json({ planId: user.plan_id }), created_at: now(),
    }).onConflict('idempotency_key').ignore();
    await trx('credit_accounts').insert({ user_id: userId, balance: amount, updated_at: now() })
      .onConflict('user_id').merge({ updated_at: now() });
  });
  const row = await db('credit_accounts').where({ user_id: userId }).first();
  return { balance: number(row?.balance), granted: true };
}

export async function getBalance(userId) {
  await ensureCreditAccount(userId);
  const row = await db('credit_accounts').where({ user_id: userId }).first();
  return number(row?.balance);
}

/**
 * Apply a signed amount atomically. Returns the resulting balance and whether
 * the entry was newly created (false = idempotent replay).
 */
export async function applyCredit(userId, amount, reason, {
  referenceType = null, referenceId = null, idempotencyKey, metadata = {}, allowNegative = false,
} = {}) {
  if (!idempotencyKey) throw new Error('applyCredit requires an idempotencyKey');
  await ensureCreditAccount(userId);
  const existing = await db('credit_ledger').where({ idempotency_key: idempotencyKey }).first();
  if (existing) return { balance: await getBalance(userId), applied: false, amount: 0 };

  let balance = 0;
  let applied = false;
  try {
    await db.transaction(async (trx) => {
      const again = await trx('credit_ledger').where({ idempotency_key: idempotencyKey }).first();
      if (again) { balance = number((await trx('credit_accounts').where({ user_id: userId }).first())?.balance); return; }
      // Insert first so duplicate idempotency keys roll the entire transaction back.
      await trx('credit_ledger').insert({
        id: newId('crd_'), user_id: userId, amount: Number(amount), reason,
        reference_type: referenceType, reference_id: referenceId,
        idempotency_key: idempotencyKey, metadata: json(metadata), created_at: now(),
      });
      // A database-side conditional update serializes distinct concurrent changes
      // without a read/modify/write race, including competing reservations.
      let update = trx('credit_accounts').where({ user_id: userId });
      if (!allowNegative) update = update.whereRaw('balance + ? >= 0', [Number(amount)]);
      const changed = await update.update({ balance: trx.raw('balance + ?', [Number(amount)]), updated_at: now() });
      const account = await trx('credit_accounts').where({ user_id: userId }).first();
      if (!changed) {
        const error = new AppError(402, 'insufficient_credits', `This operation needs ${Math.abs(Number(amount))} credits but your balance is ${number(account?.balance)}. Add credits or reduce the project size.`);
        error.balance = number(account?.balance);
        error.required = Math.abs(Number(amount));
        throw error;
      }
      balance = number(account?.balance);
      applied = true;
    });
  } catch (error) {
    // Two workers may race on the same idempotency key. The loser must treat
    // the mutation as a no-op rather than double-charging or throwing 500.
    if (/UNIQUE constraint|duplicate key|unique violation/i.test(String(error?.message))) {
      const winner = await db('credit_ledger').where({ idempotency_key: idempotencyKey }).first();
      if (winner) return { balance: await getBalance(userId), applied: false, amount: 0 };
    }
    throw error;
  }
  return { balance, applied, amount: applied ? Number(amount) : 0 };
}

export const reserveCredits = (userId, amount, options) => applyCredit(userId, -Math.abs(amount), 'scene_reserve', options);
export const refundCredits = (userId, amount, options) => applyCredit(userId, Math.abs(amount), 'scene_refund', { ...options, allowNegative: true });
export const grantCredits = (userId, amount, options) => applyCredit(userId, Math.abs(amount), 'credit_grant', { ...options, allowNegative: true });

/**
 * Estimate credits for a film before any job starts. Pure function — no DB.
 */
export function estimateCredits({
  sceneCount = 0, sceneSeconds = 0, dialogueCharacters = 0, assembly = true,
} = {}) {
  const video = Math.ceil(sceneCount * sceneSeconds * config.film.creditPerVideoSecond);
  const tts = Math.ceil((dialogueCharacters / 1000) * config.film.creditPerTtsThousandChars);
  const assemble = assembly ? config.film.creditPerAssembly : 0;
  return {
    breakdown: {
      video: { credits: video, basis: `${sceneCount} scenes × ${sceneSeconds}s × ${config.film.creditPerVideoSecond} credits/s` },
      voice: { credits: tts, basis: `${dialogueCharacters} dialogue characters × ${config.film.creditPerTtsThousandChars} credits/1k` },
      assembly: { credits: assemble, basis: assembly ? 'one final render' : 'not requested' },
    },
    total: video + tts + assemble,
  };
}

/**
 * Exact pre-flight estimate for a concrete scene list, matching what the
 * reservation code actually charges: each scene is rounded up independently.
 */
export function estimateFilm(scenes = [], { assembly = true } = {}) {
  const list = Array.isArray(scenes) ? scenes : [];
  const perScene = list.map((scene) => {
    const seconds = Math.max(1, Number(scene.duration_seconds ?? scene.durationSeconds) || config.film.maxSceneSeconds);
    const dialogue = Array.isArray(scene.dialogue) ? scene.dialogue : [];
    const characters = dialogue.reduce((n, line) => n + String(line?.line || '').length, 0);
    return { seconds, characters, credits: Math.ceil(seconds * config.film.creditPerVideoSecond) };
  });
  const video = perScene.reduce((n, item) => n + item.credits, 0);
  const dialogueCharacters = perScene.reduce((n, item) => n + item.characters, 0);
  const voice = Math.ceil((dialogueCharacters / 1000) * config.film.creditPerTtsThousandChars);
  const assemblyCredits = assembly ? config.film.creditPerAssembly : 0;
  return {
    breakdown: {
      video: { credits: video, basis: `${list.length} AI clips × ${config.film.creditPerVideoSecond} credits/second (rounded per clip)` },
      voice: { credits: voice, basis: `${dialogueCharacters} dialogue characters × ${config.film.creditPerTtsThousandChars} credits/1k` },
      assembly: { credits: assemblyCredits, basis: assembly ? 'one final FFmpeg render' : 'not requested' },
    },
    perScene,
    total: video + voice + assemblyCredits,
    sceneCount: list.length,
    sceneSeconds: perScene.reduce((n, item) => n + item.seconds, 0),
    dialogueCharacters,
  };
}

export function estimateFromScreenplay(screenplay, options = {}) {
  return estimateFilm(Array.isArray(screenplay?.scenes) ? screenplay.scenes : [], options);
}

/** Cost of generating/regenerating one scene (video only). */
export function sceneCreditCost(scene) {
  const seconds = Math.max(1, Number(scene?.duration_seconds ?? scene?.durationSeconds) || config.film.maxSceneSeconds);
  return Math.ceil(seconds * config.film.creditPerVideoSecond);
}

/** Cost of one final render: voice + assembly. */
export function assemblyCreditCost(scenes = []) {
  const list = Array.isArray(scenes) ? scenes : [];
  const characters = list.reduce((n, scene) => n + (Array.isArray(scene.dialogue) ? scene.dialogue : []).reduce((m, line) => m + String(line?.line || '').length, 0), 0);
  return Math.ceil((characters / 1000) * config.film.creditPerTtsThousandChars) + config.film.creditPerAssembly;
}

export async function creditHistory(userId, limit = 50) {
  await ensureCreditAccount(userId);
  const rows = await db('credit_ledger').where({ user_id: userId }).orderBy('created_at', 'desc').limit(Math.min(200, Math.max(1, limit)));
  return rows.map((row) => ({
    id: row.id, amount: number(row.amount), reason: row.reason,
    referenceType: row.reference_type, referenceId: row.reference_id,
    metadata: JSON.parse(row.metadata || '{}'), createdAt: row.created_at,
  }));
}
