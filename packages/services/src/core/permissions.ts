import { z } from 'zod';
import type { Db } from '@gynx/database';
import {
  isRolePreset,
  isValidGrantPermission,
  privilegedKeysIn,
  resolvePermissions,
  ungrantableKeys,
  type PermissionKey,
} from '@gynx/permissions';
import { AppError, forbidden, validation } from '@gynx/shared';
import { audit } from './audit';
import { requirePermission } from './authz';
import type { Actor, Ctx } from './context';

export interface PrincipalInput {
  userId: string;
  roleIds: readonly string[];
  isGuildOwner: boolean;
  source: Actor['source'];
  displayName?: string;
}

/** Build an Actor with permissions resolved from the guild's StaffPermission grants. */
export async function resolveActor(db: Db, guildId: string, p: PrincipalInput): Promise<Actor> {
  const grants = await db.staffPermission.findMany({
    where: { guildId },
    select: { subjectType: true, subjectId: true, permission: true, effect: true },
  });
  return {
    userId: p.userId,
    roleIds: p.roleIds,
    permissions: resolvePermissions({ userId: p.userId, roleIds: p.roleIds, isGuildOwner: p.isGuildOwner }, grants),
    isSystem: false,
    source: p.source,
    displayName: p.displayName,
  };
}

export async function listGrants(ctx: Ctx) {
  await requirePermission(ctx, 'settings.manage');
  return ctx.db.staffPermission.findMany({ where: { guildId: ctx.guildId }, orderBy: [{ subjectId: 'asc' }, { permission: 'asc' }] });
}

export const grantInputSchema = z.object({
  subjectType: z.enum(['ROLE', 'USER']),
  subjectId: z.string().regex(/^\d{17,20}$/),
  permission: z.string().min(1).max(64),
  effect: z.enum(['ALLOW', 'DENY']).default('ALLOW'),
});

/**
 * Grant or deny a permission. Anti-escalation rules:
 *  - actor needs `permissions.manage`
 *  - actor can only grant keys they hold themselves
 *  - privileged keys cannot be granted to the configured partner role
 */
export async function upsertGrant(ctx: Ctx, raw: unknown, partnerRoleId?: string | null) {
  const input = grantInputSchema.parse(raw);
  await requirePermission(ctx, 'permissions.manage', 'permissions.grant');
  if (!isValidGrantPermission(input.permission)) throw validation('Unknown permission or preset.');

  const blocked: PermissionKey[] = ungrantableKeys(ctx.actor.permissions, input.permission);
  if (blocked.length > 0) {
    await audit(ctx, { action: 'permissions.grant', result: 'DENIED', metadata: { ...input, blocked } });
    throw forbidden('You cannot grant permissions you do not hold yourself.');
  }
  if (
    input.effect === 'ALLOW' &&
    partnerRoleId &&
    input.subjectType === 'ROLE' &&
    input.subjectId === partnerRoleId &&
    privilegedKeysIn(input.permission).length > 0
  ) {
    throw new AppError('FORBIDDEN', 'Privileged permissions can never be granted to the partner role.');
  }

  return ctx.db.$transaction(async (tx) => {
    const row = await tx.staffPermission.upsert({
      where: {
        guildId_subjectType_subjectId_permission: {
          guildId: ctx.guildId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          permission: input.permission,
        },
      },
      create: { ...input, guildId: ctx.guildId, createdById: ctx.actor.userId },
      update: { effect: input.effect },
    });
    await audit(ctx, { action: 'permissions.grant', targetType: input.subjectType, targetId: input.subjectId, metadata: { permission: input.permission, effect: input.effect, preset: isRolePreset(input.permission) } }, tx);
    return row;
  });
}

export async function deleteGrant(ctx: Ctx, grantId: string) {
  await requirePermission(ctx, 'permissions.manage', 'permissions.revoke');
  const grant = await ctx.db.staffPermission.findFirst({ where: { id: grantId, guildId: ctx.guildId } });
  if (!grant) throw new AppError('NOT_FOUND', 'Grant not found.');
  if (ungrantableKeys(ctx.actor.permissions, grant.permission).length > 0) {
    throw forbidden('You cannot revoke permissions you do not hold yourself.');
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.staffPermission.delete({ where: { id: grant.id } });
    await audit(ctx, { action: 'permissions.revoke', targetType: grant.subjectType, targetId: grant.subjectId, metadata: { permission: grant.permission } }, tx);
  });
}
