import type { BadgeTone } from '@/components/ui/Badge';

/** Pure partner-program helpers (safe on server and client). */

export const APPLICATION_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
export const APPLICATION_STATUS_TONES: Record<ApplicationStatus, BadgeTone> = {
  PENDING: 'accent',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'neutral',
};
export const isApplicationStatus = (v: unknown): v is ApplicationStatus =>
  typeof v === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(v);
export const isOpenStatus = (s: string): boolean => s === 'PENDING' || s === 'UNDER_REVIEW';

// ── Answers ──────────────────────────────────────────────────────────────────

export interface AnswerRow {
  id: string;
  label: string;
  /** Plain text exactly as submitted (render with whitespace preserved, never as HTML). */
  value: string | null;
  required: boolean;
}

/**
 * Pair stored answers with the category's question labels (question order).
 * Answers whose question no longer exists are kept under their raw id so
 * nothing the applicant wrote is hidden from reviewers.
 */
export function answerRows(
  questions: ReadonlyArray<{ id: string; label: string; required: boolean }>,
  raw: unknown,
): AnswerRow[] {
  const answers: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v : v === undefined || v === null || v === '' ? null : String(v);
  const known = new Set(questions.map((q) => q.id));
  return [
    ...questions.map((q) => ({ id: q.id, label: q.label, value: text(answers[q.id]), required: q.required })),
    ...Object.keys(answers)
      .filter((k) => !known.has(k))
      .map((k) => ({ id: k, label: `Other answer (${k})`, value: text(answers[k]), required: false })),
  ];
}

// ── Decision form ────────────────────────────────────────────────────────────

export interface DecisionDraft {
  decision: 'APPROVED' | 'REJECTED' | '';
  decisionNote: string;
  internalNotes: string;
  campaignName: string;
}

export function decisionProblems(d: DecisionDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (d.decision !== 'APPROVED' && d.decision !== 'REJECTED') out.decision = 'Choose approve or reject.';
  const note = d.decisionNote.trim();
  if (note.length < 3) out.decisionNote = 'Write at least 3 characters — the applicant sees this.';
  else if (note.length > 1000) out.decisionNote = 'Keep it under 1000 characters.';
  if (d.internalNotes.trim().length > 2000) out.internalNotes = 'Keep it under 2000 characters.';
  if (d.decision === 'APPROVED' && d.campaignName.trim().length > 80)
    out.campaignName = 'Keep it under 80 characters.';
  return out;
}

/** Body for POST …/decision. The campaign name only applies to approvals; blanks are omitted. */
export function decisionPayload(d: DecisionDraft) {
  const internal = d.internalNotes.trim();
  const name = d.campaignName.trim();
  return {
    decision: d.decision as 'APPROVED' | 'REJECTED',
    decisionNote: d.decisionNote.trim(),
    ...(internal ? { internalNotes: internal } : {}),
    ...(d.decision === 'APPROVED' && name ? { campaignName: name } : {}),
  };
}

// ── Campaign edit ────────────────────────────────────────────────────────────

export interface CampaignDraft {
  name: string;
  active: boolean;
  /** Guild-local "YYYY-MM-DDTHH:MM", or '' for no end date. */
  endsAt: string;
  canAnnounce: boolean;
}

/** Only the changed fields (so a reviewer without settings.manage never re-sends canAnnounce). */
export function campaignPatch(
  initial: CampaignDraft,
  draft: CampaignDraft,
): Partial<{ name: string; active: boolean; endsAt: string | null; canAnnounce: boolean }> {
  const out: Partial<{ name: string; active: boolean; endsAt: string | null; canAnnounce: boolean }> = {};
  if (draft.name.trim() !== initial.name.trim()) out.name = draft.name.trim();
  if (draft.active !== initial.active) out.active = draft.active;
  if (draft.endsAt !== initial.endsAt) out.endsAt = draft.endsAt ? draft.endsAt : null;
  if (draft.canAnnounce !== initial.canAnnounce) out.canAnnounce = draft.canAnnounce;
  return out;
}

export function campaignProblems(d: CampaignDraft): Record<string, string> {
  const out: Record<string, string> = {};
  const n = d.name.trim().length;
  if (n < 1) out.name = 'Give the campaign a name.';
  else if (n > 80) out.name = 'Keep it under 80 characters.';
  if (d.endsAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.endsAt)) out.endsAt = 'Enter a date and time.';
  return out;
}

/** Enabling announce rights needs settings.manage; turning them off never does. */
export const canAnnounceLocked = (hasSettingsManage: boolean, currentlyEnabled: boolean): boolean =>
  !hasSettingsManage && !currentlyEnabled;
