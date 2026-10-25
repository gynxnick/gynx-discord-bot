import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { Db, GuildSetup } from '@gynx/database';
import { ensureGuild } from '@gynx/database';
import {
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_ROLES,
  BLUEPRINT_VERSION,
  COMPONENT_KEYS,
  ROLE_BINDINGS,
  type BlueprintRole,
  type ChannelBinding,
  type ComponentKey,
  type GrantPreset,
  type OverwriteSpec,
  type OverwriteTarget,
  type PanelKey,
  type RoleBinding,
  type RoleKey,
} from './blueprint';
import { DEFAULT_SETUP_CONFIG, setupConfigSchema, type SetupConfig } from './types';

// ── GuildSetup row ───────────────────────────────────────────────────────────

/** The guild's GuildSetup row, created lazily (status NOT_STARTED). */
export async function loadGuildSetup(db: Db, guildId: string): Promise<GuildSetup> {
  const row = await db.guildSetup.findUnique({ where: { guildId } });
  if (row) return row;
  await ensureGuild(db, guildId);
  return db.guildSetup.upsert({
    where: { guildId },
    create: { guildId, blueprintVersion: BLUEPRINT_VERSION, configuration: {} },
    update: {},
  });
}

/** Stored configuration, re-validated (unknown/invalid stored data falls back to defaults). */
export function parseStoredConfig(raw: unknown): SetupConfig {
  const r = setupConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_SETUP_CONFIG;
}

// ── Effective blueprint (blueprint + SetupConfig) ────────────────────────────

export type ManagedTarget = OverwriteTarget;

/** Overwrite set keyed by target. */
export type OverwriteMap = Map<ManagedTarget, { allow: bigint; deny: bigint }>;

export interface EffectiveRole {
  key: RoleKey;
  name: string;
  color: number;
  colorHex: string;
  permissions: bigint;
  hoist: boolean;
  mentionable: boolean;
  staff: boolean;
  grant?: GrantPreset;
  manualPermissions: string[];
  bindings: RoleBinding[];
}

export interface EffectiveChannel {
  key: string;
  name: string;
  type: 'text' | 'voice';
  categoryKey: string;
  topic?: string;
  slowmode?: number;
  /** Full expected overwrite set (category's merged with the channel's own + restrictions). */
  overwrites: OverwriteMap;
  /** Targets set on the channel itself (differ from the category). */
  ownTargets: Set<ManagedTarget>;
  bindings: ChannelBinding[];
  panel?: PanelKey;
  private: boolean;
  restricted: boolean;
  /** Excluded by SetupConfig.excludedChannels or the category is not selected. */
  included: boolean;
  excluded: boolean;
}

export interface EffectiveCategory {
  key: string;
  name: string;
  private: boolean;
  overwrites: OverwriteMap;
  channels: EffectiveChannel[];
  included: boolean;
}

export interface EffectiveBlueprint {
  version: number;
  config: SetupConfig;
  selection: ReadonlySet<ComponentKey>;
  roles: EffectiveRole[];
  categories: EffectiveCategory[];
}

export const PANEL_COMPONENT: Record<PanelKey, ComponentKey> = {
  welcome: 'embeds',
  rules: 'embeds',
  verify: 'embeds',
  'support-status': 'panel:support-status',
  'duty-control': 'panel:duty-control',
};

const VIEW = P.ViewChannel;
const STAFF_TALK = P.ViewChannel | P.ReadMessageHistory | P.SendMessages | P.SendMessagesInThreads;

export const hexToInt = (hex: string) => Number.parseInt(hex.replace('#', ''), 16);

function toMap(specs: readonly OverwriteSpec[]): OverwriteMap {
  const m: OverwriteMap = new Map();
  for (const s of specs) {
    const cur = m.get(s.target) ?? { allow: 0n, deny: 0n };
    const allow = (cur.allow | (s.allow ?? 0n)) & ~(s.deny ?? 0n);
    const deny = (cur.deny | (s.deny ?? 0n)) & ~(s.allow ?? 0n);
    m.set(s.target, { allow, deny });
  }
  return m;
}

/**
 * Channel overwrite = the category's overwrite for that target with the
 * channel's own spec layered on top (allow/deny merged, channel wins). Discord
 * replaces a target's overwrite per channel, so the merge keeps e.g. the
 * category's VIEW allow when the channel only adds a SEND deny.
 */
function mergeOverwrites(base: OverwriteMap, own: readonly OverwriteSpec[]): OverwriteMap {
  const out: OverwriteMap = new Map([...base].map(([k, v]) => [k, { ...v }]));
  for (const s of own) {
    const cur = out.get(s.target) ?? { allow: 0n, deny: 0n };
    const a = s.allow ?? 0n;
    const d = s.deny ?? 0n;
    out.set(s.target, { allow: (cur.allow | a) & ~d, deny: (cur.deny | d) & ~a });
  }
  return out;
}

/** Effective components: explicit selection > SetupConfig.components > everything. */
export function resolveSelection(
  config: SetupConfig,
  selection?: readonly ComponentKey[],
): Set<ComponentKey> {
  if (selection && selection.length) return new Set(selection);
  if (config.components.length) return new Set(config.components);
  return new Set(COMPONENT_KEYS);
}

export function resolveBlueprint(
  config: SetupConfig,
  selection?: readonly ComponentKey[],
): EffectiveBlueprint {
  const sel = resolveSelection(config, selection);
  const staffKeys = BLUEPRINT_ROLES.filter((r) => r.staff).map((r) => r.key);

  const roles: EffectiveRole[] = BLUEPRINT_ROLES.map((r: BlueprintRole) => {
    const over = config.roles[r.key] ?? {};
    const colorHex = over.color ?? r.color;
    return {
      key: r.key,
      name: over.name ?? r.name,
      color: hexToInt(colorHex),
      colorHex: colorHex.toUpperCase(),
      permissions: r.permissions,
      hoist: r.hoist,
      mentionable: r.mentionable,
      staff: r.staff,
      grant: r.grant,
      manualPermissions: r.manualPermissions ?? [],
      bindings: ROLE_BINDINGS[r.key] ?? [],
    };
  });

  const categories: EffectiveCategory[] = BLUEPRINT_CATEGORIES.map((c) => {
    const catOverwrites = toMap(c.overwrites);
    const included = sel.has(`category:${c.key}` as ComponentKey);
    const channels: EffectiveChannel[] = c.channels.map((ch) => {
      const own: OverwriteSpec[] = [...(ch.overwrites ?? [])];
      const allowed = config.restrictedAccess[ch.key] ?? ch.restrictedTo;
      if (allowed) {
        for (const k of staffKeys) {
          if (!allowed.includes(k)) own.push({ target: k, deny: VIEW });
        }
        for (const k of allowed) {
          const base = catOverwrites.get(k);
          if (!base || (base.allow & VIEW) === 0n) own.push({ target: k, allow: STAFF_TALK });
        }
      }
      const excluded = config.excludedChannels.includes(ch.key);
      return {
        key: ch.key,
        name: config.names[ch.key] ?? ch.name,
        type: ch.type,
        categoryKey: c.key,
        topic: ch.topic,
        slowmode: config.slowmode[ch.key] ?? ch.slowmode,
        overwrites: mergeOverwrites(catOverwrites, own),
        ownTargets: new Set(own.map((o) => o.target)),
        bindings: ch.bindings ?? [],
        panel: ch.panel,
        private: c.private,
        restricted: Boolean(allowed),
        included: included && !excluded,
        excluded,
      };
    });
    return {
      key: c.key,
      name: config.names[c.key] ?? c.name,
      private: c.private,
      overwrites: catOverwrites,
      channels,
      included,
    };
  });

  return { version: BLUEPRINT_VERSION, config, selection: sel, roles, categories };
}

export function allChannels(bp: EffectiveBlueprint): EffectiveChannel[] {
  return bp.categories.flatMap((c) => c.channels);
}

/** Hash of the blueprint data a resource was provisioned from (SetupResource.configurationHash). */
export function resourceConfigData(bp: EffectiveBlueprint, key: string): unknown {
  const [type, k] = key.split(':') as [string, string];
  const ow = (m: OverwriteMap) => [...m].map(([t, v]) => [t, v.allow.toString(), v.deny.toString()]);
  if (type === 'role') {
    const r = bp.roles.find((x) => x.key === k);
    return r && { name: r.name, color: r.color, permissions: r.permissions.toString() };
  }
  if (type === 'category') {
    const c = bp.categories.find((x) => x.key === k);
    return c && { name: c.name, overwrites: ow(c.overwrites) };
  }
  if (type === 'channel') {
    const c = allChannels(bp).find((x) => x.key === k);
    return c && { name: c.name, topic: c.topic, slowmode: c.slowmode, overwrites: ow(c.overwrites) };
  }
  return { key, version: bp.version };
}
