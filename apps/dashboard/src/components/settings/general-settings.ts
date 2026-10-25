/**
 * Pure form ↔ patch mapping for the general settings page (shared by the
 * client form and unit tests; no service imports so it is client-safe).
 */

/** Serializable subset of `analytics.GuildSettings` edited on /settings. */
export interface SettingsView {
  timezone: string;
  enabledModules: string[];
  channels: Record<string, string | null>;
  roles: Record<string, string | null>;
  supportUrl: string | null;
  status: {
    checkIntervalSeconds: number;
    failureThreshold: number;
    recoveryThreshold: number;
    alertCooldownMinutes: number;
  };
  retention: {
    diagnosticHours: number;
    reportDays: number;
    auditDays: number;
    healthCheckDays: number;
    activityDays: number;
  };
  activeMemberMinMessages: number;
  reportNotifyReporter: boolean;
  suggestionThreads: boolean;
  embedFooter: string;
}

/** Numeric ranges (mirrors analytics.settingsPatchSchema; the service is authoritative). */
export const NUMBER_LIMITS = {
  'status.checkIntervalSeconds': { min: 15, max: 3600, label: 'Check interval', unit: 'seconds' },
  'status.failureThreshold': { min: 1, max: 20, label: 'Failure threshold', unit: 'checks' },
  'status.recoveryThreshold': { min: 1, max: 20, label: 'Recovery threshold', unit: 'checks' },
  'status.alertCooldownMinutes': { min: 0, max: 1440, label: 'Alert cooldown', unit: 'minutes' },
  'retention.diagnosticHours': { min: 1, max: 168, label: 'Diagnostics', unit: 'hours' },
  'retention.reportDays': { min: 30, max: 3650, label: 'Closed abuse reports', unit: 'days' },
  'retention.auditDays': { min: 90, max: 3650, label: 'Audit log', unit: 'days' },
  'retention.healthCheckDays': { min: 7, max: 365, label: 'Health checks', unit: 'days' },
  'retention.activityDays': { min: 30, max: 730, label: 'Activity data', unit: 'days' },
  activeMemberMinMessages: { min: 1, max: 1000, label: 'Active member threshold', unit: 'messages' },
} as const;
export type NumberPath = keyof typeof NUMBER_LIMITS;

export interface SettingsForm {
  timezone: string;
  enabledModules: string[];
  channels: Record<string, string | null>;
  roles: Record<string, string | null>;
  supportUrl: string;
  numbers: Record<NumberPath, string>;
  reportNotifyReporter: boolean;
  suggestionThreads: boolean;
  embedFooter: string;
}

function readNumber(v: SettingsView, path: NumberPath): number {
  if (path === 'activeMemberMinMessages') return v.activeMemberMinMessages;
  const [group, key] = path.split('.') as ['status' | 'retention', string];
  return (v[group] as Record<string, number>)[key]!;
}

export function toForm(v: SettingsView): SettingsForm {
  const numbers = Object.fromEntries(
    (Object.keys(NUMBER_LIMITS) as NumberPath[]).map((p) => [p, String(readNumber(v, p))]),
  ) as Record<NumberPath, string>;
  return {
    timezone: v.timezone,
    enabledModules: [...v.enabledModules],
    channels: { ...v.channels },
    roles: { ...v.roles },
    supportUrl: v.supportUrl ?? '',
    numbers,
    reportNotifyReporter: v.reportNotifyReporter,
    suggestionThreads: v.suggestionThreads,
    embedFooter: v.embedFooter,
  };
}

export type SettingsPatchOut = Partial<{
  timezone: string;
  enabledModules: string[];
  channels: Record<string, string | null>;
  roles: Record<string, string | null>;
  supportUrl: string | null;
  status: Partial<SettingsView['status']>;
  retention: Partial<SettingsView['retention']>;
  activeMemberMinMessages: number;
  reportNotifyReporter: boolean;
  suggestionThreads: boolean;
  embedFooter: string;
}>;

const SNOWFLAKE = /^\d{17,20}$/;
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Build a patch containing only changed fields, plus client-side field errors
 * (keys match the API's issue paths, e.g. `status.failureThreshold`, `channels.log`).
 */
export function buildPatch(
  initial: SettingsView,
  form: SettingsForm,
  validTimeZones?: ReadonlySet<string>,
): { patch: SettingsPatchOut; errors: Record<string, string> } {
  const patch: SettingsPatchOut = {};
  const errors: Record<string, string> = {};

  const tz = form.timezone.trim();
  if (tz !== initial.timezone) {
    if (!tz || (validTimeZones && !validTimeZones.has(tz)))
      errors.timezone = 'Choose a time zone from the list (IANA name such as Europe/London).';
    else patch.timezone = tz;
  }
  if (!sameSet(form.enabledModules, initial.enabledModules)) patch.enabledModules = [...form.enabledModules];

  for (const group of ['channels', 'roles'] as const) {
    const out: Record<string, string | null> = {};
    for (const [k, raw] of Object.entries(form[group])) {
      const v = raw?.trim() || null;
      if (v === (initial[group][k] ?? null)) continue;
      if (v !== null && !SNOWFLAKE.test(v)) errors[`${group}.${k}`] = 'Must be a Discord ID (17–20 digits).';
      else out[k] = v;
    }
    if (Object.keys(out).length) patch[group] = out;
  }

  const url = form.supportUrl.trim() || null;
  if (url !== initial.supportUrl) {
    if (url && !/^https:\/\/[^\s]+$/i.test(url))
      errors.supportUrl = 'The support URL must start with https://';
    else patch.supportUrl = url;
  }

  for (const path of Object.keys(NUMBER_LIMITS) as NumberPath[]) {
    const raw = form.numbers[path].trim();
    const lim = NUMBER_LIMITS[path];
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n)) {
      errors[path] = 'Enter a whole number.';
      continue;
    }
    if (n < lim.min || n > lim.max) {
      errors[path] = `Must be between ${lim.min} and ${lim.max}.`;
      continue;
    }
    if (n === readNumber(initial, path)) continue;
    if (path === 'activeMemberMinMessages') patch.activeMemberMinMessages = n;
    else {
      const [group, key] = path.split('.') as ['status' | 'retention', string];
      patch[group] = { ...(patch[group] ?? {}), [key]: n };
    }
  }

  if (form.reportNotifyReporter !== initial.reportNotifyReporter)
    patch.reportNotifyReporter = form.reportNotifyReporter;
  if (form.suggestionThreads !== initial.suggestionThreads) patch.suggestionThreads = form.suggestionThreads;
  const footer = form.embedFooter.trim();
  if (footer !== initial.embedFooter) {
    if (footer.length < 1 || footer.length > 100) errors.embedFooter = 'The footer must be 1–100 characters.';
    else patch.embedFooter = footer;
  }
  return { patch, errors };
}
