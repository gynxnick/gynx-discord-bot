import type { AttributionConfidence } from '@gynx/database';

/**
 * Pure referral-attribution logic (no I/O), unit tested.
 */

export interface InviteSnapshot {
  code: string;
  uses: number;
}

export interface InviteDiffResult {
  confidence: AttributionConfidence;
  /** Set only when exactly one invite's use-count increased. */
  inviteCode: string | null;
  /** Every code whose use-count increased (for logs / ambiguity review). */
  changedCodes: string[];
}

/**
 * Compare invite use-counts cached before a join with a fresh fetch after it.
 *  - exactly one invite increased → CONFIRMED (credited only if that invite is tracked)
 *  - several increased simultaneously → AMBIGUOUS (nobody credited)
 *  - none increased → UNKNOWN (vanity URL, expired/one-shot invite, Discord discovery, missing data)
 * Invites that vanished from the fresh list are never guessed at: a deleted
 * invite is indistinguishable from one that hit its max uses.
 */
export function diffInviteUses(before: ReadonlyMap<string, number>, after: readonly InviteSnapshot[]): InviteDiffResult {
  const changedCodes = after.filter((i) => i.uses > (before.get(i.code) ?? 0)).map((i) => i.code);
  if (changedCodes.length === 1) return { confidence: 'CONFIRMED', inviteCode: changedCodes[0]!, changedCodes };
  if (changedCodes.length > 1) return { confidence: 'AMBIGUOUS', inviteCode: null, changedCodes };
  return { confidence: 'UNKNOWN', inviteCode: null, changedCodes };
}

export const MIN_ACCOUNT_AGE_DAYS = 7;
export const BURST_WINDOW_MS = 10 * 60_000;
export const BURST_THRESHOLD = 5;

export type AbuseFlag = 'NEW_ACCOUNT' | 'REJOIN' | 'SELF_REFERRAL' | 'BURST';

export const ABUSE_FLAG_LABELS: Record<AbuseFlag, string> = {
  NEW_ACCOUNT: `Account younger than ${MIN_ACCOUNT_AGE_DAYS} days`,
  REJOIN: 'Member was already attributed before (rejoin)',
  SELF_REFERRAL: 'Referrer invited themselves',
  BURST: `More than ${BURST_THRESHOLD} joins via this invite within 10 minutes`,
};

export interface AbuseCheckInput {
  referrerId: string | null;
  joinedUserId: string;
  /** Discord account creation time (derivable from the snowflake). */
  accountCreatedAt: Date;
  joinedAt: Date;
  /** Any earlier attribution exists for this joined user in this guild. */
  previouslyAttributed: boolean;
  /** Joins via the same invite in the preceding 10 minutes, NOT counting this one. */
  recentJoinsViaInvite: number;
  burstThreshold?: number;
}

export function detectReferralAbuse(i: AbuseCheckInput): AbuseFlag[] {
  const flags: AbuseFlag[] = [];
  if (i.joinedAt.getTime() - i.accountCreatedAt.getTime() < MIN_ACCOUNT_AGE_DAYS * 86_400_000) flags.push('NEW_ACCOUNT');
  if (i.previouslyAttributed) flags.push('REJOIN');
  if (i.referrerId && i.referrerId === i.joinedUserId) flags.push('SELF_REFERRAL');
  if (i.recentJoinsViaInvite + 1 > (i.burstThreshold ?? BURST_THRESHOLD)) flags.push('BURST');
  return flags;
}

const DISCORD_EPOCH = 1420070400000n;

/** Account creation time encoded in a Discord snowflake. */
export function snowflakeTimestamp(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}
