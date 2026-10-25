/**
 * Pure mapping between the stored SetupConfig (overrides only) and the
 * configuration form (effective values for every blueprint item), plus the
 * client-side validation that mirrors setupConfigSchema. Safe on server and client.
 */
import type { BlueprintChannelView, BlueprintView, SetupConfigView } from './types';

export const NAME_MAX = 100;
export const SLOWMODE_MAX = 21_600;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** True for a full `#RRGGBB` hex colour (the format Discord and the schema accept). */
export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

/**
 * Normalise what an admin typed into `#RRGGBB` (uppercase): accepts a missing
 * `#` and the 3-digit shorthand. Returns null when it is not a colour.
 */
export function normalizeHex(value: string): string | null {
  let v = value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(v))
    v = `#${v
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`;
  return isHexColor(v) ? v.toUpperCase() : null;
}

export interface ConfigForm {
  roles: Record<string, { name: string; color: string }>;
  /** Channel and category display names (effective). */
  names: Record<string, string>;
  /** Channel key → included. */
  included: Record<string, boolean>;
  /** Text channel key → slow mode seconds as typed. */
  slowmode: Record<string, string>;
  /** Restricted channel key → staff role keys allowed. */
  restricted: Record<string, string[]>;
  /** Component key → selected. All selected = "everything" (stored as []). */
  components: Record<string, boolean>;
  showStaffNames: boolean;
}

const allChannels = (bp: BlueprintView): BlueprintChannelView[] => bp.categories.flatMap((c) => c.channels);

/** Build the form with effective values (overrides applied over blueprint defaults). */
export function configToForm(config: SetupConfigView, bp: BlueprintView): ConfigForm {
  const roles: ConfigForm['roles'] = {};
  for (const r of bp.roles) {
    const o = config.roles[r.key as keyof typeof config.roles];
    roles[r.key] = { name: o?.name ?? r.name, color: (o?.color ?? r.color).toUpperCase() };
  }
  const names: Record<string, string> = {};
  const included: Record<string, boolean> = {};
  const slowmode: Record<string, string> = {};
  const restricted: Record<string, string[]> = {};
  const excluded = new Set(config.excludedChannels);
  for (const c of bp.categories) names[c.key] = config.names[c.key] ?? c.name;
  for (const ch of allChannels(bp)) {
    names[ch.key] = config.names[ch.key] ?? ch.name;
    included[ch.key] = !excluded.has(ch.key);
    if (ch.type === 'text') slowmode[ch.key] = String(config.slowmode[ch.key] ?? ch.slowmode);
    if (ch.restrictedTo) restricted[ch.key] = [...(config.restrictedAccess[ch.key] ?? ch.restrictedTo)];
  }
  const selected = new Set<string>(config.components);
  const components: Record<string, boolean> = {};
  for (const c of bp.components) components[c.key] = selected.size === 0 || selected.has(c.key);
  return { roles, names, included, slowmode, restricted, components, showStaffNames: config.showStaffNames };
}

export type ConfigPatch = Partial<{
  roles: Record<string, { name?: string; color?: string }>;
  names: Record<string, string>;
  components: string[];
  excludedChannels: string[];
  slowmode: Record<string, number>;
  restrictedAccess: Record<string, string[]>;
  showStaffNames: boolean;
}>;

/** Stable structural equality for plain JSON values (key order independent). */
export function sameJson(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Turn the form into a PATCH body: only overrides that differ from the
 * blueprint are stored, and only top-level keys that differ from `baseline`
 * are sent (each sent key replaces the stored value for that key).
 * Errors use the same dotted paths as the API's validation issues.
 */
export function formToPatch(
  baseline: SetupConfigView,
  form: ConfigForm,
  bp: BlueprintView,
): { patch: ConfigPatch; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const checkName = (path: string, value: string) => {
    const v = value.trim();
    if (!v) errors[path] = 'Enter a name.';
    else if (v.length > NAME_MAX) errors[path] = `Use at most ${NAME_MAX} characters.`;
    return v;
  };

  const roles: Record<string, { name?: string; color?: string }> = {};
  for (const r of bp.roles) {
    const f = form.roles[r.key];
    if (!f) continue;
    const name = checkName(`roles.${r.key}.name`, f.name);
    const color = normalizeHex(f.color);
    if (!color) errors[`roles.${r.key}.color`] = 'Use a hex colour like #22D3EE.';
    const o: { name?: string; color?: string } = {};
    if (name && name !== r.name) o.name = name;
    if (color && color !== r.color.toUpperCase()) o.color = color;
    if (Object.keys(o).length) roles[r.key] = o;
  }

  const names: Record<string, string> = {};
  const defaults = new Map<string, string>();
  for (const c of bp.categories) defaults.set(c.key, c.name);
  for (const ch of allChannels(bp)) defaults.set(ch.key, ch.name);
  for (const [key, def] of defaults) {
    const raw = form.names[key];
    if (raw === undefined) continue;
    const v = checkName(`names.${key}`, raw);
    if (v && v !== def) names[key] = v;
  }

  const excludedChannels: string[] = [];
  const slowmode: Record<string, number> = {};
  const restrictedAccess: Record<string, string[]> = {};
  for (const ch of allChannels(bp)) {
    if (form.included[ch.key] === false) excludedChannels.push(ch.key);
    const sm = form.slowmode[ch.key];
    if (ch.type === 'text' && sm !== undefined) {
      const n = Number(sm.trim());
      if (sm.trim() === '' || !Number.isInteger(n) || n < 0 || n > SLOWMODE_MAX)
        errors[`slowmode.${ch.key}`] = `Use whole seconds from 0 to ${SLOWMODE_MAX}.`;
      else if (n !== ch.slowmode) slowmode[ch.key] = n;
    }
    const access = form.restricted[ch.key];
    if (ch.restrictedTo && access) {
      if (access.length === 0) errors[`restrictedAccess.${ch.key}`] = 'Pick at least one staff role.';
      else if (!sameSet(access, ch.restrictedTo))
        restrictedAccess[ch.key] = bp.roles.map((r) => r.key).filter((k) => access.includes(k));
    }
  }

  const picked = bp.components.filter((c) => form.components[c.key]).map((c) => c.key);
  if (picked.length === 0) errors.components = 'Select at least one component.';
  const components = picked.length === bp.components.length ? [] : picked;

  const next = {
    roles,
    names,
    components,
    excludedChannels,
    slowmode,
    restrictedAccess,
    showStaffNames: form.showStaffNames,
  };
  const patch: ConfigPatch = {};
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (key === 'components' || key === 'excludedChannels') {
      if (!sameSet(next[key], baseline[key] as string[])) (patch as Record<string, unknown>)[key] = next[key];
    } else if (!sameJson(next[key], baseline[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  return { patch, errors };
}

/**
 * Staff roles selected for a restricted channel that the blueprint does not
 * include by default (e.g. Moderator on executive or security channels).
 */
export function extraRestrictedRoles(channel: BlueprintChannelView, selected: readonly string[]): string[] {
  if (!channel.restrictedTo) return [];
  return selected.filter((k) => !channel.restrictedTo!.includes(k));
}
