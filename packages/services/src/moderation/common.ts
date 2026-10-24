import { z } from 'zod';
import { nextSequence, type Db, type ModerationAction, type ModerationStatus, type ModerationType } from '@gynx/database';
import { formatRef, truncate, validation } from '@gynx/shared';
import { enqueueJob } from '../core/jobs';

export const snowflake = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');

/** Moderator id used for automatic actions. */
export const AUTOMOD_MODERATOR_ID = 'automod';
/** Moderator id used for actions performed by background jobs (e.g. temp-ban expiry). */
export const SYSTEM_MODERATOR_ID = 'system';

/** Manual warnings stop counting towards escalation after this many days (GuildConfig has no field for it yet). */
export const WARNING_EXPIRY_DAYS = 90;

export const TIMEOUT_MIN_MS = 60_000;
export const TIMEOUT_MAX_MS = 28 * 86_400_000;
export const TEMPBAN_MIN_MS = 60_000;
export const TEMPBAN_MAX_MS = 365 * 86_400_000;

/** Parse with Zod and convert failures into a user-safe VALIDATION error. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw validation(`${path}${issue?.message ?? 'Invalid input.'}`, { issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) });
  }
  return r.data;
}

export interface InsertActionData {
  guildId: string;
  type: ModerationType;
  targetId: string;
  moderatorId: string;
  reason: string;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
  status: ModerationStatus;
  failureReason?: string | null;
  dmSent?: boolean;
  moderatorNote?: string | null;
  automodEventId?: string | null;
}

/** Insert a ModerationAction with the next `M-0001` style reference and enqueue its modlog post. */
export async function insertAction(tx: Db, d: InsertActionData, now: Date): Promise<ModerationAction> {
  const number = await nextSequence(tx, d.guildId, 'moderation_action');
  const action = await tx.moderationAction.create({
    data: {
      guildId: d.guildId,
      number,
      ref: formatRef('M', number),
      type: d.type,
      targetId: d.targetId,
      moderatorId: d.moderatorId,
      reason: d.reason,
      durationSeconds: d.durationSeconds ?? null,
      expiresAt: d.expiresAt ?? null,
      status: d.status,
      failureReason: d.failureReason ? truncate(d.failureReason, 500) : null,
      dmSent: d.dmSent ?? false,
      moderatorNote: d.moderatorNote ?? null,
      automodEventId: d.automodEventId ?? null,
    },
  });
  await enqueueJob(tx, {
    type: 'moderation.modlog',
    dedupeKey: `moderation.modlog:${action.id}`,
    runAt: now,
    guildId: d.guildId,
    payload: { actionId: action.id },
  });
  return action;
}

export const expiryJobKey = (actionId: string) => `moderation.expire:${actionId}`;
