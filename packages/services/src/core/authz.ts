import type { PermissionKey } from '@gynx/permissions';
import { forbidden, rateLimited } from '@gynx/shared';
import { audit } from './audit';
import type { Ctx } from './context';

export function can(ctx: Ctx, key: PermissionKey): boolean {
  return ctx.actor.permissions.has(key);
}

export function canAny(ctx: Ctx, keys: readonly PermissionKey[]): boolean {
  return keys.some((k) => ctx.actor.permissions.has(k));
}

/**
 * Enforce a permission. Denials are audited (they are security-relevant: a
 * pattern of denials indicates probing or misconfiguration).
 */
export async function requirePermission(ctx: Ctx, key: PermissionKey, action?: string): Promise<void> {
  if (ctx.actor.permissions.has(key)) return;
  await audit(ctx, {
    action: action ?? `permission.denied`,
    result: 'DENIED',
    metadata: { required: key },
  });
  throw forbidden();
}

export async function requireAny(ctx: Ctx, keys: readonly PermissionKey[], action?: string): Promise<void> {
  if (canAny(ctx, keys)) return;
  await audit(ctx, {
    action: action ?? 'permission.denied',
    result: 'DENIED',
    metadata: { requiredAny: keys },
  });
  throw forbidden();
}

/** Per-actor rate limit for an operation. Throws RATE_LIMITED. */
export async function requireRate(ctx: Ctx, op: string, limit: number, windowSeconds: number): Promise<void> {
  const r = await ctx.rateLimiter.consume(`${ctx.guildId}:${ctx.actor.userId}:${op}`, limit, windowSeconds);
  if (!r.allowed) throw rateLimited(r.retryAfterSeconds);
}
