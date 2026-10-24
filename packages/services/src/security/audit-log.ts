import { z } from 'zod';
import type { Prisma, SecurityAuditEvent } from '@gynx/database';
import { cursorArgs, paginationSchema, toPage, type Page } from '@gynx/shared';
import { requirePermission } from '../core/authz';
import { getGuildConfig } from '../core/config';
import type { Ctx } from '../core/context';

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(64).optional(),
  actorId: z
    .string()
    .regex(/^\d{17,20}$|^system$/)
    .optional(),
  targetId: z.string().max(64).optional(),
  result: z.enum(['SUCCESS', 'DENIED', 'FAILURE']).optional(),
  since: z.coerce.date().optional(),
});

/** Search the security audit log. `action` matches as a prefix (e.g. "moderation." ). */
export async function searchAuditLog(
  ctx: Ctx,
  raw: z.input<typeof auditQuerySchema>,
): Promise<Page<SecurityAuditEvent>> {
  await requirePermission(ctx, 'audit.view');
  const q = auditQuerySchema.parse(raw);
  const where: Prisma.SecurityAuditEventWhereInput = {
    guildId: ctx.guildId,
    action: q.action ? { startsWith: q.action } : undefined,
    actorId: q.actorId,
    targetId: q.targetId,
    result: q.result,
    createdAt: q.since ? { gte: q.since } : undefined,
  };
  const rows = await ctx.db.securityAuditEvent.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(q),
  });
  return toPage(rows, q.limit);
}

export async function purgeExpiredAuditEvents(db: Ctx['db'], guildId: string, now: Date): Promise<number> {
  const cfg = await getGuildConfig(db, guildId);
  const cutoff = new Date(now.getTime() - cfg.auditRetentionDays * 86_400_000);
  const res = await db.securityAuditEvent.deleteMany({ where: { guildId, createdAt: { lt: cutoff } } });
  return res.count;
}
