/** Pure event-form helpers (client-safe, unit tested). Times are guild wall-clock "YYYY-MM-DDTHH:MM". */

export const MAX_REMINDERS = 3;
export const MAX_REMINDER_MINUTES = 10_080; // 7 days (service limit)

export const REMINDER_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
];

export interface EventDraft {
  title: string;
  description: string;
  location: string;
  /** datetime-local value in the event/guild time zone. */
  start: string;
  /** Optional datetime-local value; blank = no end time. */
  end: string;
  /** Blank = unlimited. */
  capacity: string;
  waitlistEnabled: boolean;
  reminders: number[];
  /** Create only; blank = configured event channel. */
  channelId: string;
}

export const emptyEventDraft = (): EventDraft => ({
  title: '',
  description: '',
  location: '',
  start: '',
  end: '',
  capacity: '',
  waitlistEnabled: true,
  reminders: [60],
  channelId: '',
});

/** "90" → "1h 30m", "1440" → "1 day", "15" → "15 min". */
export function formatMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  if (m > 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m} min`;
}

/** Add a reminder (minutes before start). Returns the sorted list, or an error message. */
export function addReminder(list: readonly number[], minutes: number): { list: number[]; error?: string } {
  if (!Number.isInteger(minutes) || minutes < 1)
    return { list: [...list], error: 'Use a whole number of minutes (at least 1).' };
  if (minutes > MAX_REMINDER_MINUTES)
    return { list: [...list], error: 'Reminders can be at most 7 days before the start.' };
  if (list.includes(minutes)) return { list: [...list], error: 'That reminder is already added.' };
  if (list.length >= MAX_REMINDERS) return { list: [...list], error: `At most ${MAX_REMINDERS} reminders.` };
  return { list: [...list, minutes].sort((a, b) => b - a) };
}

export function customReminderMinutes(amount: string, unit: 'minutes' | 'hours' | 'days'): number {
  const n = Number(amount);
  if (!amount.trim() || !Number.isFinite(n)) return NaN;
  return Math.round(n * { minutes: 1, hours: 60, days: 1440 }[unit]);
}

const WALL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;

/** Client-side checks mirroring the API (the server re-validates and converts time zones). */
export function validateEventDraft(d: EventDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const title = d.title.trim();
  if (title.length < 3) e.title = 'At least 3 characters.';
  else if (title.length > 100) e.title = 'At most 100 characters.';
  if (!d.description.trim()) e.description = 'Describe the event.';
  else if (d.description.trim().length > 2000) e.description = 'At most 2000 characters.';
  if (d.location.trim().length > 100) e.location = 'At most 100 characters.';
  if (!WALL.test(d.start.trim())) e.start = 'Pick a start date and time.';
  if (d.end.trim()) {
    if (!WALL.test(d.end.trim())) e.end = 'Pick a valid end date and time.';
    // Same-format wall-clock strings compare chronologically.
    else if (!e.start && d.end.trim().replace(' ', 'T') <= d.start.trim().replace(' ', 'T'))
      e.end = 'The end must be after the start.';
  }
  if (d.capacity.trim()) {
    const n = Number(d.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 10_000)
      e.capacity = 'A whole number from 1 to 10,000, or blank for unlimited.';
  }
  if (d.reminders.length > MAX_REMINDERS) e.reminderMinutesBefore = `At most ${MAX_REMINDERS} reminders.`;
  else if (new Set(d.reminders).size !== d.reminders.length)
    e.reminderMinutesBefore = 'Reminder times must be different.';
  return e;
}

export interface EventPayload {
  title: string;
  description: string;
  location: string | null;
  start: string;
  end: string | null;
  capacity: number | null;
  waitlistEnabled: boolean;
  reminderMinutesBefore: number[];
  channelId?: string;
}

/** Form → API body. `channelId` is only sent on create (and only when chosen). */
export function eventDraftToPayload(d: EventDraft, mode: 'create' | 'edit'): EventPayload {
  const body: EventPayload = {
    title: d.title.trim(),
    description: d.description.trim(),
    location: d.location.trim() || null,
    start: d.start.trim(),
    end: d.end.trim() || null,
    capacity: d.capacity.trim() ? Number(d.capacity) : null,
    waitlistEnabled: d.waitlistEnabled,
    reminderMinutesBefore: [...d.reminders],
  };
  if (mode === 'create' && d.channelId.trim()) body.channelId = d.channelId.trim();
  return body;
}

export interface AttendeeLike {
  userId: string;
  status: string;
}

/** Split attendees into GOING then WAITLIST, keeping the service's order within each. */
export function groupAttendees<T extends AttendeeLike>(rows: readonly T[]): { going: T[]; waitlist: T[] } {
  return {
    going: rows.filter((r) => r.status === 'GOING'),
    waitlist: rows.filter((r) => r.status === 'WAITLIST'),
  };
}

export type EventView = 'upcoming' | 'past' | 'all';
export const parseEventView = (v: string | undefined): EventView =>
  v === 'past' || v === 'all' ? v : 'upcoming';

export const EVENT_STATUS_TONE = { SCHEDULED: 'accent', CANCELLED: 'neutral', COMPLETED: 'success' } as const;
