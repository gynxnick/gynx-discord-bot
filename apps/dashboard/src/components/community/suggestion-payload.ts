/** Suggestion status form → API payload (pure; unit tested). Mirrors the engagement service's statuses. */

export const SUGGESTION_STATUSES = [
  'UNDER_REVIEW',
  'PLANNED',
  'IMPLEMENTED',
  'DECLINED',
  'DUPLICATE',
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  UNDER_REVIEW: 'Under review',
  PLANNED: 'Planned',
  IMPLEMENTED: 'Implemented',
  DECLINED: 'Declined',
  DUPLICATE: 'Duplicate',
};

export function statusPayload(status: SuggestionStatus, response: string, duplicateOf: string) {
  return {
    status,
    ...(response.trim() ? { response: response.trim() } : {}),
    ...(status === 'DUPLICATE' && duplicateOf.trim() ? { duplicateOf: duplicateOf.trim() } : {}),
  };
}
