/** Pure automod config form ↔ PATCH payload mapping (client-safe). */

export const AUTOMOD_NUMBERS = {
  duplicateThreshold: { min: 2, max: 20, label: 'Identical messages', unit: 'messages' },
  duplicateWindowSeconds: { min: 5, max: 600, label: 'Duplicate window', unit: 'seconds' },
  maxMentions: { min: 2, max: 50, label: 'Max mentions per message', unit: 'mentions' },
  burstThreshold: { min: 3, max: 50, label: 'Burst size', unit: 'messages' },
  burstWindowSeconds: { min: 3, max: 120, label: 'Burst window', unit: 'seconds' },
  newAccountDays: { min: 0, max: 90, label: 'New account age', unit: 'days (0 = off)' },
  strikeWindowHours: { min: 1, max: 720, label: 'Strike window', unit: 'hours' },
  warnAtStrikes: { min: 1, max: 20, label: 'Warn at', unit: 'strikes' },
  timeoutAtStrikes: { min: 1, max: 50, label: 'Timeout at', unit: 'strikes' },
  timeoutMinutes: { min: 1, max: 40_320, label: 'Timeout length', unit: 'minutes' },
  warningExpiryDays: { min: 1, max: 3650, label: 'Warnings expire after', unit: 'days' },
} as const;
export type AutomodNumberKey = keyof typeof AUTOMOD_NUMBERS;

export const AUTOMOD_BOOLEANS = ['enabled', 'blockInvites', 'phishingDetection'] as const;
export type AutomodBooleanKey = (typeof AUTOMOD_BOOLEANS)[number];

export const AUTOMOD_LISTS = {
  allowedInviteCodes: 50,
  blockedDomains: 500,
  allowedDomains: 500,
  blockedPhrases: 100,
  exemptRoleIds: 50,
  exemptChannelIds: 100,
} as const;
export type AutomodListKey = keyof typeof AUTOMOD_LISTS;

export type AutomodConfigView = Record<AutomodNumberKey, number> &
  Record<AutomodBooleanKey, boolean> &
  Record<AutomodListKey, string[]>;

export interface AutomodForm {
  numbers: Record<AutomodNumberKey, string>;
  flags: Record<AutomodBooleanKey, boolean>;
  lists: Record<AutomodListKey, string[]>;
}

export function automodToForm(c: AutomodConfigView): AutomodForm {
  return {
    numbers: Object.fromEntries(
      (Object.keys(AUTOMOD_NUMBERS) as AutomodNumberKey[]).map((k) => [k, String(c[k])]),
    ) as AutomodForm['numbers'],
    flags: Object.fromEntries(AUTOMOD_BOOLEANS.map((k) => [k, c[k]])) as AutomodForm['flags'],
    lists: Object.fromEntries(
      (Object.keys(AUTOMOD_LISTS) as AutomodListKey[]).map((k) => [k, [...c[k]]]),
    ) as AutomodForm['lists'],
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** "https://Example.com/path" → "example.com" (mirrors the service's normaliser), null if not a hostname. */
export function normalizeDomain(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^\*\./, '')
    .split(/[/?#]/)[0]!
    .replace(/\.+$/, '');
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:xn--[a-z0-9-]{2,59}|[a-z]{2,63})$/.test(
    s,
  )
    ? s
    : null;
}

/** "discord.gg/abc" or "https://discord.gg/abc" → "abc"; null when not an invite code. */
export function normalizeInvite(raw: string): string | null {
  const code = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\//i, '');
  return /^[A-Za-z0-9-]{2,32}$/.test(code) ? code : null;
}

export function automodPatch(
  initial: AutomodConfigView,
  form: AutomodForm,
): { patch: Partial<AutomodConfigView>; errors: Record<string, string> } {
  const patch: Partial<AutomodConfigView> = {};
  const errors: Record<string, string> = {};
  const values: Partial<Record<AutomodNumberKey, number>> = {};
  for (const k of Object.keys(AUTOMOD_NUMBERS) as AutomodNumberKey[]) {
    const raw = form.numbers[k].trim();
    const n = Number(raw);
    const lim = AUTOMOD_NUMBERS[k];
    if (raw === '' || !Number.isInteger(n)) errors[k] = 'Enter a whole number.';
    else if (n < lim.min || n > lim.max) errors[k] = `Must be between ${lim.min} and ${lim.max}.`;
    else {
      values[k] = n;
      if (n !== initial[k]) patch[k] = n;
    }
  }
  const warn = values.warnAtStrikes ?? initial.warnAtStrikes;
  const timeout = values.timeoutAtStrikes ?? initial.timeoutAtStrikes;
  if (!errors.timeoutAtStrikes && !errors.warnAtStrikes && timeout <= warn)
    errors.timeoutAtStrikes = 'Must be higher than the warning strike count.';

  for (const k of AUTOMOD_BOOLEANS) if (form.flags[k] !== initial[k]) patch[k] = form.flags[k];
  for (const k of Object.keys(AUTOMOD_LISTS) as AutomodListKey[]) {
    if (form.lists[k].length > AUTOMOD_LISTS[k]) errors[k] = `At most ${AUTOMOD_LISTS[k]} entries.`;
    else if (!sameList(form.lists[k], initial[k])) patch[k] = [...form.lists[k]];
  }
  const overlap = form.lists.blockedDomains.filter((d) => form.lists.allowedDomains.includes(d));
  if (overlap.length) errors.allowedDomains = `Also blocked: ${overlap.slice(0, 3).join(', ')}`;
  return { patch, errors };
}
