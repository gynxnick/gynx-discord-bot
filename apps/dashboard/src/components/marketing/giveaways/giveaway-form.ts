/** Pure giveaway-form helpers (client-safe, unit tested). */

export const MAX_WINNERS = 20;
export const MAX_REQUIRED_ROLES = 5;

export interface GiveawayDraft {
  prize: string;
  description: string;
  winnerCount: string;
  /** datetime-local value in the guild time zone. */
  endsAt: string;
  requiredRoleIds: string[];
  minAccountAgeDays: string;
  minMemberDays: string;
  channelId: string;
}

export const emptyGiveawayDraft = (): GiveawayDraft => ({
  prize: '',
  description: '',
  winnerCount: '1',
  endsAt: '',
  requiredRoleIds: [],
  minAccountAgeDays: '0',
  minMemberDays: '0',
  channelId: '',
});

const days = (v: string) => {
  if (!v.trim()) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : NaN;
};

export function validateGiveawayDraft(d: GiveawayDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.prize.trim()) e.prize = 'Describe the prize.';
  else if (d.prize.trim().length > 200) e.prize = 'At most 200 characters.';
  if (d.description.trim().length > 1000) e.description = 'At most 1000 characters.';
  const w = Number(d.winnerCount);
  if (!Number.isInteger(w) || w < 1 || w > MAX_WINNERS)
    e.winnerCount = `A whole number from 1 to ${MAX_WINNERS}.`;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(d.endsAt.trim())) e.endsAt = 'Pick an end date and time.';
  if (d.requiredRoleIds.length > MAX_REQUIRED_ROLES)
    e.requiredRoleIds = `At most ${MAX_REQUIRED_ROLES} roles.`;
  if (Number.isNaN(days(d.minAccountAgeDays))) e.minAccountAgeDays = 'Whole days from 0 to 3650.';
  if (Number.isNaN(days(d.minMemberDays))) e.minMemberDays = 'Whole days from 0 to 3650.';
  if (!/^\d{17,20}$/.test(d.channelId.trim())) e.channelId = 'Choose the channel to post in.';
  return e;
}

export interface GiveawayPayload {
  prize: string;
  description: string | null;
  winnerCount: number;
  endsAt: string;
  requiredRoleIds: string[];
  minAccountAgeDays: number;
  minMemberDays: number;
  channelId: string;
}

export function giveawayDraftToPayload(d: GiveawayDraft): GiveawayPayload {
  return {
    prize: d.prize.trim(),
    description: d.description.trim() || null,
    winnerCount: Number(d.winnerCount),
    endsAt: d.endsAt.trim(),
    requiredRoleIds: [...new Set(d.requiredRoleIds)],
    minAccountAgeDays: days(d.minAccountAgeDays),
    minMemberDays: days(d.minMemberDays),
    channelId: d.channelId.trim(),
  };
}

export interface VerificationLike {
  hashMatches: boolean;
  countMatches: boolean;
  winnersAreEntrants: boolean;
  winnersDistinct: boolean;
  knownAlgorithm: boolean;
  valid: boolean;
}

const CHECK_LABELS: Record<Exclude<keyof VerificationLike, 'valid'>, string> = {
  hashMatches: 'entrant hash mismatch',
  countMatches: 'entrant count mismatch',
  winnersAreEntrants: 'winner not in entrant pool',
  winnersDistinct: 'duplicate winners',
  knownAlgorithm: 'unknown algorithm',
};

/** Human-readable list of the verification checks that failed (empty when all passed). */
export function failedChecks(v: VerificationLike): string[] {
  return (Object.keys(CHECK_LABELS) as Array<keyof typeof CHECK_LABELS>)
    .filter((k) => !v[k])
    .map((k) => `${k}: ${CHECK_LABELS[k]}`);
}

/** "abcdef…7890" for long hashes (full value shown in a title attribute). */
export function truncateHash(h: string, head = 10, tail = 6): string {
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export interface RerollDraft {
  reason: string;
  count: string;
}

export function validateReroll(d: RerollDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const r = d.reason.trim();
  if (r.length < 3) e.reason = 'A reason is required (at least 3 characters).';
  else if (r.length > 500) e.reason = 'At most 500 characters.';
  if (d.count.trim()) {
    const n = Number(d.count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_WINNERS)
      e.count = `A whole number from 1 to ${MAX_WINNERS}.`;
  }
  return e;
}

export function rerollPayload(d: RerollDraft): { reason: string; count?: number } {
  return d.count.trim() ? { reason: d.reason.trim(), count: Number(d.count) } : { reason: d.reason.trim() };
}

export type GiveawayStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
export const GIVEAWAY_STATUSES: readonly GiveawayStatus[] = ['ACTIVE', 'SCHEDULED', 'ENDED', 'CANCELLED'];
export const GIVEAWAY_STATUS_TONE = {
  SCHEDULED: 'neutral',
  ACTIVE: 'accent',
  ENDED: 'success',
  CANCELLED: 'neutral',
} as const;
