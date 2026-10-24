/** Pure poll-form helpers (client-safe, unit tested). */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const POLL_MIN_MS = 60_000;
export const POLL_MAX_MS = 14 * 86_400_000;

export type DurationUnit = 'minutes' | 'hours' | 'days';

export interface PollDraft {
  question: string;
  options: string[];
  multipleChoice: boolean;
  /** Multi-choice only; blank = up to all options. */
  maxChoices: string;
  durationAmount: string;
  durationUnit: DurationUnit;
  anonymous: boolean;
  liveResults: boolean;
  channelId: string;
}

export const emptyPollDraft = (): PollDraft => ({
  question: '',
  options: ['', ''],
  multipleChoice: false,
  maxChoices: '',
  durationAmount: '1',
  durationUnit: 'days',
  anonymous: false,
  liveResults: true,
  channelId: '',
});

export const addOption = (opts: readonly string[]): string[] =>
  opts.length >= MAX_OPTIONS ? [...opts] : [...opts, ''];
export const removeOption = (opts: readonly string[], i: number): string[] =>
  opts.length <= MIN_OPTIONS ? [...opts] : opts.filter((_, j) => j !== i);

/** Move option `i` up (-1) or down (+1); out-of-range moves are no-ops. */
export function moveOption(opts: readonly string[], i: number, dir: -1 | 1): string[] {
  const j = i + dir;
  const out = [...opts];
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function pollDurationMs(amount: string, unit: DurationUnit): number {
  const n = Number(amount);
  if (!amount.trim() || !Number.isFinite(n)) return NaN;
  return Math.round(n * { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[unit]);
}

export function validatePollDraft(d: PollDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const q = d.question.trim();
  if (q.length < 5) e.question = 'At least 5 characters.';
  else if (q.length > 300) e.question = 'At most 300 characters.';
  const opts = d.options.map((o) => o.trim());
  if (opts.length < MIN_OPTIONS) e.options = `A poll needs at least ${MIN_OPTIONS} options.`;
  if (opts.length > MAX_OPTIONS) e.options = `A poll can have at most ${MAX_OPTIONS} options.`;
  opts.forEach((o, i) => {
    if (!o) e[`options.${i}`] = 'Enter an option or remove it.';
    else if (o.length > 80) e[`options.${i}`] = 'At most 80 characters.';
  });
  const lower = opts.filter(Boolean).map((o) => o.toLowerCase());
  if (!e.options && new Set(lower).size !== lower.length) e.options = 'Options must be different.';
  if (d.multipleChoice && d.maxChoices.trim()) {
    const n = Number(d.maxChoices);
    if (!Number.isInteger(n) || n < 1) e.maxChoices = 'A whole number of at least 1.';
    else if (n > opts.length) e.maxChoices = 'Cannot exceed the number of options.';
  }
  const ms = pollDurationMs(d.durationAmount, d.durationUnit);
  if (!Number.isFinite(ms) || ms <= 0) e.durationMs = 'Enter a duration.';
  else if (ms < POLL_MIN_MS) e.durationMs = 'Minimum duration is 1 minute.';
  else if (ms > POLL_MAX_MS) e.durationMs = 'Maximum duration is 14 days.';
  if (!/^\d{17,20}$/.test(d.channelId.trim())) e.channelId = 'Choose the channel to post in.';
  return e;
}

export interface PollPayload {
  question: string;
  options: string[];
  multipleChoice: boolean;
  maxChoices?: number;
  durationMs: number;
  anonymous: boolean;
  liveResults: boolean;
  channelId: string;
}

export function pollDraftToPayload(d: PollDraft): PollPayload {
  const body: PollPayload = {
    question: d.question.trim(),
    options: d.options.map((o) => o.trim()),
    multipleChoice: d.multipleChoice,
    durationMs: pollDurationMs(d.durationAmount, d.durationUnit),
    anonymous: d.anonymous,
    liveResults: d.liveResults,
    channelId: d.channelId.trim(),
  };
  if (d.multipleChoice && d.maxChoices.trim()) body.maxChoices = Number(d.maxChoices);
  return body;
}

/** Percent of ballots (multi-choice percentages can sum past 100). Rounded to 1 decimal. */
export function votePercent(votes: number, totalBallots: number): number {
  if (totalBallots <= 0) return 0;
  return Math.round((votes / totalBallots) * 1000) / 10;
}

/** `?voters=1` → true. */
export const wantsVoters = (v: string | undefined): boolean => v === '1' || v === 'true';
