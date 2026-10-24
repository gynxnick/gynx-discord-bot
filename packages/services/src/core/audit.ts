import type { AuditResult, Db, Prisma } from '@gynx/database';
import { redactObject } from '@gynx/shared';
import type { Ctx } from './context';

export interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  result?: AuditResult;
  metadata?: Record<string, unknown>;
}

/**
 * Append a security audit event. Metadata is recursively redacted so tokens or
 * secrets can never be persisted. Pass `tx` to make the audit row part of the
 * same transaction as the change it describes.
 */
export async function audit(ctx: Ctx, input: AuditInput, tx?: Db): Promise<void> {
  const db = tx ?? ctx.db;
  try {
    await db.securityAuditEvent.create({
      data: {
        guildId: ctx.guildId,
        actorId: ctx.actor.userId,
        actorType: ctx.actor.isSystem ? 'SYSTEM' : 'USER',
        source: ctx.actor.source,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        result: input.result ?? 'SUCCESS',
        metadata: redactObject(input.metadata ?? {}) as Prisma.InputJsonValue,
        correlationId: ctx.correlationId ?? null,
      },
    });
  } catch (err) {
    // Audit failures inside a transaction must abort it; standalone failures are logged loudly.
    if (tx) throw err;
    ctx.log.error({ err, action: input.action }, 'failed to write audit event');
  }
}
