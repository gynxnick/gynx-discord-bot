import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { Db } from '@gynx/database';
import { notFound, validation } from '@gynx/shared';
import { audit } from './audit';
import { requirePermission } from './authz';
import type { Ctx } from './context';

/**
 * Editable bot text.
 *
 * Every member-facing string the bot sends is defined once with `defineTexts`:
 * a stable key, the default wording, and the placeholders it may use. Staff can
 * override any of them per server (Dashboard → Settings → Bot text); overrides
 * live in the TextOverride table.
 *
 * Lookups are synchronous: the bot router, gateway listeners and the worker run
 * each interaction/job inside `withGuildText(...)`, which loads that server's
 * overrides (cached ~30 s) into an AsyncLocalStorage scope. Outside a scope (unit
 * tests, the dashboard) the defaults are used.
 *
 * Definitions MUST live in packages/services so every process (including the
 * dashboard, which lists them) registers the full catalogue.
 */

export type TextKind = 'title' | 'label' | 'short' | 'text' | 'long';

/** Discord limits: embed title 256, button label 80, select/short 100, description 4096. */
export const TEXT_LIMITS: Record<TextKind, number> = {
  title: 256,
  label: 80,
  short: 100,
  text: 2000,
  long: 4000,
};

export interface TextDef {
  /** Default wording. May use `{placeholder}`s listed in `vars`. */
  default: string;
  /** Shown to staff in the editor: where this text appears. */
  help: string;
  vars?: readonly string[];
  kind?: TextKind;
}

export interface RegisteredText extends Required<Omit<TextDef, 'vars'>> {
  key: string;
  namespace: string;
  vars: readonly string[];
  max: number;
}

const REGISTRY = new Map<string, RegisteredText>();
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export const placeholdersIn = (s: string): string[] => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]!);

export type TextVars = Record<string, string | number>;
export type TextFn = (vars?: TextVars) => string;

/** Fill `{name}` placeholders; unknown placeholders are left untouched. */
export function interpolate(template: string, vars: TextVars = {}): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

// ── Scope ────────────────────────────────────────────────────────────────────

interface TextScope {
  guildId: string;
  overrides: ReadonlyMap<string, string>;
}
const scope = new AsyncLocalStorage<TextScope>();

/** Resolve a key in the current scope (override if set, else the default). */
export function resolveText(key: string, vars?: TextVars): string {
  const def = REGISTRY.get(key);
  const template = scope.getStore()?.overrides.get(key) ?? def?.default ?? key;
  return interpolate(template, vars);
}

/**
 * Define a namespace of texts. Returns typed accessors:
 *   const T = defineTexts('status', { boardTitle: { default: 'Service status', help: '…', kind: 'title' } });
 *   T.boardTitle()
 */
export function defineTexts<const D extends Record<string, TextDef>>(
  namespace: string,
  defs: D,
): { [K in keyof D]: TextFn } {
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw new Error(`Invalid text namespace "${namespace}"`);
  const out = {} as { [K in keyof D]: TextFn };
  for (const [name, def] of Object.entries(defs)) {
    const key = `${namespace}.${name}`;
    const vars = def.vars ?? [];
    const kind = def.kind ?? 'text';
    const unknown = placeholdersIn(def.default).filter((p) => !vars.includes(p));
    if (unknown.length)
      throw new Error(`Text "${key}" uses undeclared placeholder(s): ${unknown.join(', ')}`);
    if (def.default.length > TEXT_LIMITS[kind])
      throw new Error(`Default for "${key}" exceeds the ${kind} limit`);
    if (REGISTRY.has(key) && REGISTRY.get(key)!.default !== def.default) {
      throw new Error(`Text key "${key}" is defined twice with different defaults`);
    }
    REGISTRY.set(key, {
      key,
      namespace,
      default: def.default,
      help: def.help,
      vars,
      kind,
      max: TEXT_LIMITS[kind],
    });
    (out as Record<string, TextFn>)[name] = (v?: TextVars) => resolveText(key, v);
  }
  return out;
}

export function listTextDefinitions(): RegisteredText[] {
  return [...REGISTRY.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ── Loading & cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; overrides: Map<string, string> }>();

export function invalidateText(guildId?: string): void {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

export async function loadTextOverrides(
  db: Db,
  guildId: string,
  now = Date.now(),
): Promise<Map<string, string>> {
  const hit = cache.get(guildId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.overrides;
  let overrides = new Map<string, string>();
  try {
    const rows = await db.textOverride.findMany({ where: { guildId }, select: { key: true, value: true } });
    overrides = new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    // Never fail a command because custom text couldn't load: fall back to defaults (or stale cache).
    if (hit) return hit.overrides;
  }
  cache.set(guildId, { at: now, overrides });
  return overrides;
}

/** Run `fn` with this server's text overrides active. */
export async function withGuildText<T>(db: Db, guildId: string, fn: () => Promise<T>): Promise<T> {
  const overrides = await loadTextOverrides(db, guildId);
  return scope.run({ guildId, overrides }, fn);
}

/** Test helper / synchronous scope with explicit overrides. */
export function runWithTextOverrides<T>(overrides: Record<string, string>, fn: () => T): T {
  return scope.run({ guildId: 'test', overrides: new Map(Object.entries(overrides)) }, fn);
}

// ── Staff editing (dashboard) ────────────────────────────────────────────────

export interface TextEntryView {
  key: string;
  namespace: string;
  help: string;
  kind: TextKind;
  max: number;
  vars: readonly string[];
  default: string;
  override: string | null;
  updatedAt: string | null;
}

export async function listTexts(ctx: Ctx): Promise<TextEntryView[]> {
  await requirePermission(ctx, 'settings.manage');
  const rows = await ctx.db.textOverride.findMany({ where: { guildId: ctx.guildId } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return listTextDefinitions().map((d) => ({
    key: d.key,
    namespace: d.namespace,
    help: d.help,
    kind: d.kind,
    max: d.max,
    vars: d.vars,
    default: d.default,
    override: byKey.get(d.key)?.value ?? null,
    updatedAt: byKey.get(d.key)?.updatedAt.toISOString() ?? null,
  }));
}

export const setTextSchema = z.object({
  key: z.string().min(3).max(120),
  value: z.string().max(TEXT_LIMITS.long),
});

/** Validate an override against its definition. Returns the cleaned value. */
export function validateOverride(def: RegisteredText, raw: string): string {
  const value = raw.replace(/\r\n/g, '\n').trim();
  if (!value) throw validation('Text cannot be empty. Use "Reset to default" instead.', { field: 'value' });
  if (value.length > def.max) {
    throw validation(`Too long: ${value.length} characters (Discord allows ${def.max} here).`, {
      field: 'value',
    });
  }
  const unknown = [...new Set(placeholdersIn(value).filter((p) => !def.vars.includes(p)))];
  if (unknown.length) {
    const allowed = def.vars.length ? def.vars.map((v) => `{${v}}`).join(', ') : 'none';
    throw validation(
      `Unknown placeholder${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => `{${u}}`).join(', ')}. Allowed here: ${allowed}.`,
      { field: 'value' },
    );
  }
  if ((def.kind === 'label' || def.kind === 'title' || def.kind === 'short') && value.includes('\n')) {
    throw validation('This text must be a single line.', { field: 'value' });
  }
  return value;
}

export async function setText(ctx: Ctx, raw: z.input<typeof setTextSchema>): Promise<TextEntryView> {
  await requirePermission(ctx, 'settings.manage', 'text.update');
  const input = setTextSchema.parse(raw);
  const def = REGISTRY.get(input.key);
  if (!def) throw notFound('Text');
  const value = validateOverride(def, input.value);
  const row = await ctx.db.$transaction(async (tx) => {
    const saved =
      value === def.default
        ? (await tx.textOverride.deleteMany({ where: { guildId: ctx.guildId, key: def.key } }), null)
        : await tx.textOverride.upsert({
            where: { guildId_key: { guildId: ctx.guildId, key: def.key } },
            create: { guildId: ctx.guildId, key: def.key, value, updatedById: ctx.actor.userId },
            update: { value, updatedById: ctx.actor.userId },
          });
    await audit(
      ctx,
      { action: 'text.update', targetType: 'Text', targetId: def.key, metadata: { length: value.length } },
      tx,
    );
    return saved;
  });
  invalidateText(ctx.guildId);
  return {
    key: def.key,
    namespace: def.namespace,
    help: def.help,
    kind: def.kind,
    max: def.max,
    vars: def.vars,
    default: def.default,
    override: row?.value ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function resetText(ctx: Ctx, key: string): Promise<void> {
  await requirePermission(ctx, 'settings.manage', 'text.reset');
  if (!REGISTRY.has(key)) throw notFound('Text');
  await ctx.db.$transaction(async (tx) => {
    await tx.textOverride.deleteMany({ where: { guildId: ctx.guildId, key } });
    await audit(ctx, { action: 'text.reset', targetType: 'Text', targetId: key }, tx);
  });
  invalidateText(ctx.guildId);
}
