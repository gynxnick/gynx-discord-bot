import { z } from 'zod';
import { Prisma, type Db } from '@gynx/database';
import { neutraliseMentions, redactSecrets } from '@gynx/shared';

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');
export const idSchema = z.string().trim().min(1).max(64);

/** Clean user-supplied text before storing it (secrets redacted; original wording otherwise kept). */
export const cleanText = (s: string): string => redactSecrets(s, { maskIps: false });

/** Neutralise mass/role mentions whenever stored user text is echoed by the bot. */
export const displayText = (s: string): string => neutraliseMentions(s);

/** Jump link to a posted message, or null when it has not been posted yet. */
export function messageLink(guildId: string, channelId: string | null, messageId: string | null): string | null {
  if (!channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/**
 * Debounce bucket for message refresh jobs: every change inside the same bucket maps to
 * one job that runs at the end of the bucket, so the edit reflects the final state.
 */
export function refreshBucket(now: Date, bucketMs: number): { bucket: number; runAt: Date } {
  const bucket = Math.floor(now.getTime() / bucketMs);
  return { bucket, runAt: new Date((bucket + 1) * bucketMs) };
}

type LockTable = 'CommunityEvent' | 'Poll' | 'Suggestion' | 'Giveaway';

/**
 * Row lock inside an interactive transaction. `FOR UPDATE` serialises writers that
 * must see each other's effects (capacity checks, vote counters, draw sequences);
 * `FOR SHARE` lets readers proceed concurrently while blocking a status change.
 */
export async function lockRow(tx: Db, table: LockTable, id: string, mode: 'update' | 'share' = 'update'): Promise<boolean> {
  const lock = mode === 'update' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} ${lock}`;
  return rows.length > 0;
}

/** Generic member DM job (rendered from current DB state at execution time). */
export type DmKind = 'event.reminder' | 'event.cancelled' | 'event.promoted' | 'suggestion.status';
export const DM_JOB = 'engagement.dm';
export interface DmPayload {
  kind: DmKind;
  userId: string;
  refId: string;
  /** Kind-specific staleness guard (e.g. startsAt ISO, suggestion status). */
  guard?: string;
  minutes?: number;
}

export const JOBS = {
  eventPublish: 'engagement.event.publish',
  eventRefresh: 'engagement.event.refresh',
  eventReminder: 'engagement.event.reminder',
  eventCancelled: 'engagement.event.cancelled',
  pollPublish: 'engagement.poll.publish',
  pollRefresh: 'engagement.poll.refresh',
  pollEnd: 'engagement.poll.end',
  suggestionPublish: 'engagement.suggestion.publish',
  suggestionRefresh: 'engagement.suggestion.refresh',
  giveawayPublish: 'engagement.giveaway.publish',
  giveawayRefresh: 'engagement.giveaway.refresh',
  giveawayEnd: 'engagement.giveaway.end',
  giveawayAnnounce: 'engagement.giveaway.announce',
  dm: DM_JOB,
} as const;
