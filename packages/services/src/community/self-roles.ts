import { requestRolePanelSync } from './role-panels';
import { z } from 'zod';
import { isUniqueViolation, type Db, type SelfAssignableRole } from '@gynx/database';
import { conflict, forbidden, notFound, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission, requireRate } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { assessRoleSafety, type RoleMeta } from './role-safety';
import { SELF_ROLE_GROUPS, snowflakeSchema } from './schemas';
import { CommunityText as T } from './texts';

/** Live role context supplied by the caller (gateway cache or DiscordPort.listRoles). */
export interface LiveRoleContext {
  role: RoleMeta;
  botHighestPosition: number;
}

const emojiSchema = z
  .string()
  .trim()
  .max(64)
  .refine(
    (e) => /^<a?:\w{2,32}:\d{17,20}>$/.test(e) || /^\p{Extended_Pictographic}/u.test(e),
    'Use a unicode emoji or a custom emoji like <:name:id>',
  );

export const selfRoleCreateSchema = z.object({
  roleId: snowflakeSchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(100).nullish(),
  emoji: emojiSchema.nullish(),
  group: z.enum(SELF_ROLE_GROUPS).default('games'),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export const selfRoleUpdateSchema = selfRoleCreateSchema.omit({ roleId: true }).partial().strict();

/**
 * Roles that are never self-assignable regardless of their Discord permissions:
 * any role referenced by a StaffPermission grant, the partner/escalation/staff-ping
 * roles and the verified role (self-assigning it would bypass verification).
 */
export async function protectedRoleIds(db: Db, guildId: string): Promise<Set<string>> {
  const [cfg, grants, welcome] = await Promise.all([
    getGuildConfig(db, guildId),
    db.staffPermission.findMany({ where: { guildId, subjectType: 'ROLE' }, select: { subjectId: true } }),
    db.welcomeConfig.findUnique({ where: { guildId }, select: { verifiedRoleId: true } }),
  ]);
  const ids = new Set(grants.map((g) => g.subjectId));
  for (const id of [cfg.partnerRoleId, cfg.escalationRoleId, cfg.staffPingRoleId, welcome?.verifiedRoleId])
    if (id) ids.add(id);
  return ids;
}

/** Full safety check for a role about to be offered or handed out. Throws VALIDATION/FORBIDDEN. */
export async function assertRoleAssignable(
  ctx: Ctx,
  roleId: string,
  live: LiveRoleContext,
  kind: 'validation' | 'forbidden' = 'validation',
): Promise<void> {
  if (live.role.id !== roleId) throw validation(T.roleMismatch());
  const result = assessRoleSafety({
    guildId: ctx.guildId,
    role: live.role,
    botHighestPosition: live.botHighestPosition,
    protectedRoleIds: await protectedRoleIds(ctx.db, ctx.guildId),
  });
  if (!result.ok) {
    await audit(ctx, {
      action: 'community.selfrole.unsafe',
      result: 'DENIED',
      targetType: 'Role',
      targetId: roleId,
      metadata: { reason: result.reason },
    });
    throw kind === 'forbidden' ? forbidden(result.message) : validation(result.message);
  }
}

export async function listSelfRoles(ctx: Ctx): Promise<SelfAssignableRole[]> {
  await requirePermission(ctx, 'community.manage');
  return ctx.db.selfAssignableRole.findMany({
    where: { guildId: ctx.guildId },
    orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
}

/** Member-facing: enabled roles only. */
export async function listEnabledSelfRoles(ctx: Ctx): Promise<SelfAssignableRole[]> {
  await requireModule(ctx, 'community');
  return ctx.db.selfAssignableRole.findMany({
    where: { guildId: ctx.guildId, enabled: true },
    orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
}

export async function createSelfRole(
  ctx: Ctx,
  raw: z.input<typeof selfRoleCreateSchema>,
  live: LiveRoleContext,
): Promise<SelfAssignableRole> {
  await requirePermission(ctx, 'community.manage', 'community.selfrole.create');
  const input = selfRoleCreateSchema.parse(raw);
  await assertRoleAssignable(ctx, input.roleId, live);
  try {
    const created = await ctx.db.$transaction(async (tx) => {
      const row = await tx.selfAssignableRole.create({
        data: {
          ...input,
          description: input.description ?? null,
          emoji: input.emoji ?? null,
          guildId: ctx.guildId,
        },
      });
      await audit(
        ctx,
        {
          action: 'community.selfrole.create',
          targetType: 'Role',
          targetId: input.roleId,
          metadata: { label: input.label, group: input.group },
        },
        tx,
      );
      return row;
    });
    await requestRolePanelSync(ctx.db, ctx.guildId, ctx.now());
    return created;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('That role is already in the self-assignable list.');
    throw e;
  }
}

/** Update an allowlist entry. Re-enabling an entry requires live role details (the role may have changed). */
export async function updateSelfRole(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof selfRoleUpdateSchema>,
  live?: LiveRoleContext,
): Promise<SelfAssignableRole> {
  await requirePermission(ctx, 'community.manage', 'community.selfrole.update');
  const input = selfRoleUpdateSchema.parse(raw);
  const row = await ctx.db.selfAssignableRole.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw notFound('Self-assignable role');
  if (input.enabled === true && !row.enabled) {
    if (!live) throw validation('Role details are required to re-enable a role.');
    await assertRoleAssignable(ctx, row.roleId, live);
  }
  const result = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.selfAssignableRole.update({ where: { id }, data: input });
    await audit(
      ctx,
      {
        action: 'community.selfrole.update',
        targetType: 'Role',
        targetId: row.roleId,
        metadata: { fields: Object.keys(input) },
      },
      tx,
    );
    return updated;
  });
  await requestRolePanelSync(ctx.db, ctx.guildId, ctx.now());
  return result;
}

export async function deleteSelfRole(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'community.manage', 'community.selfrole.delete');
  const row = await ctx.db.selfAssignableRole.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw notFound('Self-assignable role');
  await ctx.db.$transaction(async (tx) => {
    await tx.selfAssignableRole.delete({ where: { id } });
    await audit(
      ctx,
      {
        action: 'community.selfrole.delete',
        targetType: 'Role',
        targetId: row.roleId,
        metadata: { label: row.label },
      },
      tx,
    );
  });
  await requestRolePanelSync(ctx.db, ctx.guildId, ctx.now());
}

export interface RoleChange {
  roleId: string;
  label: string;
  action: 'add' | 'remove';
}

/**
 * Decide whether to add or remove a self-role for the acting member. The
 * allowlist (enabled) and role safety are re-checked at toggle time — the
 * role ID from the component's customId/value is never trusted. Current
 * membership comes from `ctx.actor.roleIds` (resolved from the live member).
 * The caller applies the returned change in Discord.
 */
export async function toggleSelfRole(ctx: Ctx, roleId: string, live: LiveRoleContext): Promise<RoleChange> {
  await requireModule(ctx, 'community');
  const id = snowflakeSchema.parse(roleId);
  await requireRate(ctx, 'community.selfrole.toggle', 20, 60);
  const entry = await ctx.db.selfAssignableRole.findUnique({
    where: { guildId_roleId: { guildId: ctx.guildId, roleId: id } },
  });
  if (!entry || !entry.enabled) throw forbidden(T.roleNotSelfAssignable());
  await assertRoleAssignable(ctx, id, live, 'forbidden');
  return { roleId: id, label: entry.label, action: ctx.actor.roleIds.includes(id) ? 'remove' : 'add' };
}
