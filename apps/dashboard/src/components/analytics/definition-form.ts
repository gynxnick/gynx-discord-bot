/** Report-definition form ↔ API payload mapping (pure; mirrors analytics.reportDefinitionSchema). */

export const WEEKDAY_OPTIONS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export type WeekdayValue = (typeof WEEKDAY_OPTIONS)[number];

export interface DefinitionForm {
  name: string;
  enabled: boolean;
  day: string;
  time: string;
  timezone: string;
  periodDays: string;
  channelId: string;
}

export interface DefinitionPayload {
  name: string;
  enabled: boolean;
  day: WeekdayValue;
  time: string;
  timezone: string;
  periodDays: number;
  channelId: string | null;
}

export function emptyDefinitionForm(timezone: string): DefinitionForm {
  return { name: '', enabled: true, day: 'MONDAY', time: '09:00', timezone, periodDays: '7', channelId: '' };
}

export function definitionToForm(d: {
  name: string;
  enabled: boolean;
  day: string;
  time: string;
  timezone: string;
  periodDays: number;
  channelId: string | null;
}): DefinitionForm {
  return {
    name: d.name,
    enabled: d.enabled,
    day: d.day,
    time: d.time,
    timezone: d.timezone,
    periodDays: String(d.periodDays),
    channelId: d.channelId ?? '',
  };
}

export function formToPayload(
  f: DefinitionForm,
): { ok: true; payload: DefinitionPayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = f.name.trim();
  if (!name) errors.name = 'Give the schedule a name.';
  else if (name.length > 80) errors.name = 'Use at most 80 characters.';
  if (!(WEEKDAY_OPTIONS as readonly string[]).includes(f.day)) errors.day = 'Choose a weekday.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) errors.time = 'Time must be HH:MM (24h).';
  const tz = f.timezone.trim();
  if (!tz) errors.timezone = 'Enter an IANA time zone such as Europe/London.';
  const days = Number(f.periodDays);
  if (!/^\d+$/.test(f.periodDays.trim()) || !Number.isInteger(days) || days < 1 || days > 31)
    errors.periodDays = 'Period must be 1–31 days.';
  const channel = f.channelId.trim();
  if (channel && !/^\d{17,20}$/.test(channel))
    errors.channelId = 'Must be a Discord channel ID (17–20 digits).';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      name,
      enabled: f.enabled,
      day: f.day as WeekdayValue,
      time: f.time,
      timezone: tz,
      periodDays: days,
      channelId: channel || null,
    },
  };
}

export const weekdayLabel = (d: string) => d.charAt(0) + d.slice(1).toLowerCase();
