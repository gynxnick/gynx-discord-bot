import type { BadgeTone } from '@/components/ui/Badge';

/** Pure referral display/review helpers (safe on server and client). */

export const CONFIDENCES = ['CONFIRMED', 'AMBIGUOUS', 'UNKNOWN'] as const;
export const ATTRIBUTION_STATUSES = ['VALID', 'FLAGGED', 'DISPUTED', 'INVALID'] as const;
export const REVIEW_STATUSES = ['VALID', 'INVALID', 'DISPUTED'] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  CONFIRMED: 'Confirmed',
  AMBIGUOUS: 'Ambiguous',
  UNKNOWN: 'Unknown',
};
export const CONFIDENCE_TONES: Record<Confidence, BadgeTone> = {
  CONFIRMED: 'accent',
  AMBIGUOUS: 'warning',
  UNKNOWN: 'neutral',
};
export const STATUS_LABELS: Record<AttributionStatus, string> = {
  VALID: 'Valid',
  FLAGGED: 'Flagged',
  DISPUTED: 'Disputed',
  INVALID: 'Invalid',
};
export const STATUS_TONES: Record<AttributionStatus, BadgeTone> = {
  VALID: 'success',
  FLAGGED: 'warning',
  DISPUTED: 'warning',
  INVALID: 'danger',
};

export const isConfidence = (v: unknown): v is Confidence =>
  typeof v === 'string' && (CONFIDENCES as readonly string[]).includes(v);
export const isAttributionStatus = (v: unknown): v is AttributionStatus =>
  typeof v === 'string' && (ATTRIBUTION_STATUSES as readonly string[]).includes(v);

export const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
] as const;
export type Period = (typeof PERIODS)[number]['value'];
export const parsePeriod = (v: string | undefined): Period => (v === '7' || v === 'all' ? v : '30');

/** Statuses a reviewer may set, so the dialog only offers VALID when the service would accept it. */
export function reviewOptions(row: {
  confidence: string;
  referrerId: string | null;
}): { status: ReviewStatus; disabled: boolean; reason?: string }[] {
  const validOk = row.confidence === 'CONFIRMED' && Boolean(row.referrerId);
  return [
    {
      status: 'VALID',
      disabled: !validOk,
      reason: validOk
        ? undefined
        : 'Only confirmed attributions with a referrer can be marked valid — nobody can be credited for this join.',
    },
    { status: 'INVALID', disabled: false },
    { status: 'DISPUTED', disabled: false },
  ];
}

/** Rows that need staff attention. */
export const needsReview = (status: string): boolean => status === 'FLAGGED' || status === 'DISPUTED';

/** Client-side check mirroring the service schema (note 3–500 chars). */
export function reviewProblems(status: string, note: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(REVIEW_STATUSES as readonly string[]).includes(status)) out.status = 'Choose a decision.';
  const n = note.trim();
  if (n.length < 3) out.note = 'Write at least 3 characters.';
  else if (n.length > 500) out.note = 'Keep the note under 500 characters.';
  return out;
}

export interface AttributionCounts {
  total: number;
  byConfidence: Record<Confidence, number>;
  byStatus: Record<AttributionStatus, number>;
  /** CONFIRMED + VALID: what leaderboards count. */
  counted: number;
  underReview: number;
}

/** Fold a `groupBy(['confidence','status'])` result into explicit totals. */
export function aggregateAttributionCounts(
  groups: ReadonlyArray<{ confidence: string; status: string; _count: { _all: number } }>,
): AttributionCounts {
  const byConfidence: Record<Confidence, number> = { CONFIRMED: 0, AMBIGUOUS: 0, UNKNOWN: 0 };
  const byStatus: Record<AttributionStatus, number> = { VALID: 0, FLAGGED: 0, DISPUTED: 0, INVALID: 0 };
  let total = 0;
  let counted = 0;
  for (const g of groups) {
    const n = g._count._all;
    total += n;
    if (isConfidence(g.confidence)) byConfidence[g.confidence] += n;
    if (isAttributionStatus(g.status)) byStatus[g.status] += n;
    if (g.confidence === 'CONFIRMED' && g.status === 'VALID') counted += n;
  }
  return { total, byConfidence, byStatus, counted, underReview: byStatus.FLAGGED + byStatus.DISPUTED };
}
