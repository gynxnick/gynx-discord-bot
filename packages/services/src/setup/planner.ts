import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { SetupResource } from '@gynx/database';
import { ungrantableKeys, type PermissionKey } from '@gynx/permissions';
import {
  REQUIRED_BOT_PERMISSIONS,
  categoryKey,
  channelKey,
  messageKey,
  permissionNames,
  roleKey,
  type ChannelBinding,
  type ComponentKey,
  type RoleBinding,
} from './blueprint';
import {
  PANEL_COMPONENT,
  type EffectiveBlueprint,
  type EffectiveCategory,
  type EffectiveChannel,
  type EffectiveRole,
  type ManagedTarget,
  type OverwriteMap,
} from './config';
import type {
  ChangeRisk,
  Finding,
  GuildSnapshot,
  Plan,
  PlannedChange,
  SnapshotChannel,
  SnapshotOverwrite,
  SnapshotRole,
} from './types';

/**
 * The setup planner: a pure function from (live server, effective blueprint,
 * manifest, current bot configuration) to an ordered list of changes plus
 * findings. It never guesses: a pre-existing resource is adopted only when
 * exactly one candidate matches; anything ambiguous is reported and skipped.
 *
 * Changes are emitted in execution stage order:
 * roles → positions → categories → channels → overwrites → bindings → grants → messages → template.
 */

export type OperationKind = 'START' | 'REPAIR' | 'UPDATE';

export type BindingKey = ChannelBinding | RoleBinding;

export interface PlanState {
  /** Current values of the GuildConfig / WelcomeConfig fields bindings write. */
  bindings: Partial<Record<BindingKey, string | null>>;
  verificationEnabled: boolean;
  /** Existing ROLE ALLOW StaffPermission grants. */
  grants: ReadonlyArray<{ subjectId: string; permission: string }>;
  /** Message keys (message:<panel>) whose manifest message still exists on Discord. */
  liveMessages: ReadonlySet<string>;
  templateExists: boolean;
}

export interface PlanOptions {
  type: OperationKind;
  operatorPermissions: ReadonlySet<PermissionKey>;
  state: PlanState;
}

export const TEMPLATE_KEY = 'template:announcement';
export const TEMPLATE_NAME = 'Official announcement';

export const bindingKey = (b: BindingKey) => `binding:${b}`;
export const grantKey = (roleK: string) => `grant:${roleK}`;
export const overwriteKey = (resourceKey: string, target: string) => `overwrite:${resourceKey}:${target}`;

/** Overwrite targets in plans: '@everyone', 'self' (the bot) or 'role:<key>'. */
export const targetRef = (t: ManagedTarget): string => (t === '@everyone' || t === 'self' ? t : roleKey(t));

export const STAGES = [
  'roles',
  'positions',
  'categories',
  'channels',
  'overwrites',
  'bindings',
  'grants',
  'messages',
  'template',
] as const;
export type Stage = (typeof STAGES)[number];

export function stageOf(c: Pick<PlannedChange, 'kind' | 'key'>): Stage {
  switch (c.kind) {
    case 'role.create':
    case 'role.adopt':
    case 'role.update':
      return 'roles';
    case 'role.position':
      return 'positions';
    case 'channel.create':
    case 'channel.adopt':
    case 'channel.update':
      return c.key.startsWith('category:') ? 'categories' : 'channels';
    case 'overwrite.set':
      return 'overwrites';
    case 'binding.set':
      return 'bindings';
    case 'grant.set':
      return 'grants';
    case 'message.deploy':
      return 'messages';
    case 'template.create':
      return 'template';
  }
}

const TEXT_TYPES = new Set([0, 5]);
const compatible = (want: 'category' | 'text' | 'voice', type: number) =>
  want === 'category' ? type === 4 : want === 'voice' ? type === 2 : TEXT_TYPES.has(type);

const fmtBits = (b: bigint) => (b === 0n ? 'none' : permissionNames(b).join(', '));

interface ResolvedId {
  /** Discord id, or null while pending creation in this plan. */
  id: string | null;
  pending: boolean;
  ownership: 'CREATED' | 'ADOPTED' | 'NEW';
  /** Adopted in this plan (adoption-time changes are disruptive). */
  adoptedNow: boolean;
}

export function plan(
  snapshot: GuildSnapshot,
  bp: EffectiveBlueprint,
  manifest: readonly SetupResource[],
  opts: PlanOptions,
): Plan {
  const { type, state } = opts;
  const sel = bp.selection;
  const has = (c: ComponentKey) => sel.has(c);
  const repairing = type === 'REPAIR' || type === 'UPDATE';

  const findings: Finding[] = [];
  const inPlace: string[] = [];
  const stage: Record<Stage, PlannedChange[]> = Object.fromEntries(STAGES.map((s) => [s, []])) as never;
  const push = (c: PlannedChange) => stage[stageOf(c)].push(c);

  const byKey = new Map(manifest.map((m) => [m.blueprintKey, m]));
  const claimed = new Set(manifest.map((m) => m.discordResourceId));
  const rolesById = new Map(snapshot.roles.map((r) => [r.id, r]));
  const chansById = new Map(snapshot.channels.map((c) => [c.id, c]));
  const resolved = new Map<string, ResolvedId>();
  /** Keys that must not be touched (hierarchy, ambiguous, deleted on START). */
  const unavailable = new Set<string>();
  /** Roles at/above the bot: never edited or reordered (still usable as overwrite targets). */
  const locked = new Set<string>();

  // ── Preflight ──────────────────────────────────────────────────────────────
  const missingBits = REQUIRED_BOT_PERMISSIONS & ~snapshot.botPermissions;
  const missingBotPermissions = permissionNames(missingBits);
  for (const name of missingBotPermissions) {
    const critical = name === 'ManageRoles' || name === 'ManageChannels';
    findings.push({
      level: critical ? 'blocking' : 'warning',
      code: 'missing-bot-permission',
      message: critical
        ? `The bot needs the ${name} permission to run the setup. Give the bot's role ${name} and preview again.`
        : `The bot lacks ${name}; permission overwrites that use it are left out.`,
    });
  }
  const canGrant = snapshot.botPermissions;
  const strip = (bits: bigint, what: string, key: string): bigint => {
    const lacking = bits & ~canGrant;
    if (lacking !== 0n) {
      findings.push({
        level: 'warning',
        code: 'cannot-grant',
        key,
        message: `${what}: the bot cannot grant ${fmtBits(lacking)} because it does not hold ${
          permissionNames(lacking).length > 1 ? 'them' : 'it'
        }; left out.`,
      });
    }
    return bits & canGrant;
  };

  // ── Roles ──────────────────────────────────────────────────────────────────
  const rolesSelected = has('roles');
  const below = (r: SnapshotRole) => r.position < snapshot.botHighestPosition;

  for (const role of bp.roles) {
    const key = roleKey(role.key);
    const m = byKey.get(key);
    if (m) {
      const cur = rolesById.get(m.discordResourceId);
      if (cur) {
        resolved.set(key, { id: cur.id, pending: false, ownership: m.ownership, adoptedNow: false });
        if (!rolesSelected) continue;
        if (!below(cur)) {
          hierarchyFinding(role, cur);
          continue;
        }
        planRoleDrift(role, cur, m.ownership);
        continue;
      }
      findings.push({
        level: repairing ? 'info' : 'warning',
        code: 'deleted',
        key,
        message: repairing
          ? `Role ${role.name} was deleted; it will be recreated.`
          : `Role ${role.name} was deleted after setup. Run a repair to recreate it.`,
      });
      if (!rolesSelected || !repairing) {
        unavailable.add(key);
        continue;
      }
      planRoleCreate(role);
      continue;
    }
    if (!rolesSelected) {
      unavailable.add(key);
      continue;
    }
    const candidates = snapshot.roles.filter(
      (r) => r.name === role.name && !r.managed && r.id !== snapshot.guildId && !claimed.has(r.id),
    );
    if (candidates.length > 1) {
      unavailable.add(key);
      findings.push({
        level: 'warning',
        code: 'ambiguous-match',
        key,
        message: `${candidates.length} roles are named "${role.name}"; none was adopted and none created. Rename or remove the duplicates and preview again.`,
      });
      continue;
    }
    if (candidates.length === 1) {
      const cur = candidates[0]!;
      claimed.add(cur.id);
      resolved.set(key, { id: cur.id, pending: false, ownership: 'ADOPTED', adoptedNow: true });
      push({
        kind: 'role.adopt',
        key,
        discordId: cur.id,
        risk: 'safe',
        description: `Adopt existing role ${cur.name} as ${role.key} (its permissions are not changed).`,
      });
      if (!below(cur)) hierarchyFinding(role, cur);
      continue;
    }
    planRoleCreate(role);
  }

  function hierarchyFinding(role: EffectiveRole, cur: SnapshotRole) {
    locked.add(roleKey(role.key));
    findings.push({
      level: 'blocking',
      code: 'hierarchy',
      key: roleKey(role.key),
      message: `Role ${cur.name} is at or above the bot's highest role, so the setup cannot manage it. Move the bot's role above ${cur.name} to let the setup manage it (or leave it as is).`,
    });
  }

  function planRoleCreate(role: EffectiveRole) {
    const key = roleKey(role.key);
    resolved.set(key, { id: null, pending: true, ownership: 'NEW', adoptedNow: false });
    const perms = strip(role.permissions, `Role ${role.name}`, key);
    push({
      kind: 'role.create',
      key,
      name: role.name,
      color: role.colorHex,
      permissions: perms.toString(),
      risk: 'safe',
      description: `Create role ${role.name} (${role.colorHex}; permissions: ${fmtBits(perms)}).`,
    });
  }

  function planRoleDrift(role: EffectiveRole, cur: SnapshotRole, ownership: 'CREATED' | 'ADOPTED') {
    const key = roleKey(role.key);
    const patch: { name?: string; color?: string; permissions?: string } = {};
    const notes: string[] = [];
    let risk: ChangeRisk = 'safe';
    if (cur.name !== role.name) {
      if (!repairing) {
        findings.push({
          level: 'warning',
          code: 'renamed',
          key,
          message: `Role ${role.name} was renamed to "${cur.name}". Run a repair to restore the name.`,
        });
      } else {
        patch.name = role.name;
        notes.push(`rename "${cur.name}" → "${role.name}"`);
      }
    }
    if (repairing && cur.color !== role.color && (ownership === 'CREATED' || type === 'UPDATE')) {
      patch.color = role.colorHex;
      notes.push(`colour → ${role.colorHex}`);
    }
    const wanted = role.permissions & canGrant;
    if (cur.permissions !== wanted) {
      const allowed = ownership === 'CREATED' ? repairing : type === 'UPDATE';
      if (allowed) {
        patch.permissions = strip(role.permissions, `Role ${role.name}`, key).toString();
        notes.push(`permissions ${fmtBits(cur.permissions)} → ${fmtBits(wanted)}`);
        if (ownership === 'ADOPTED') risk = 'disruptive';
      } else if (ownership === 'ADOPTED') {
        findings.push({
          level: 'info',
          code: 'permissions-differ',
          key,
          message: `Adopted role ${cur.name} has different permissions than the blueprint; they are left as they are (an update can change them).`,
        });
      }
    }
    if (Object.keys(patch).length) {
      push({
        kind: 'role.update',
        key,
        discordId: cur.id,
        patch,
        risk,
        description: `Update role ${cur.name}: ${notes.join('; ')}.`,
      });
    } else if (cur.name === role.name) {
      inPlace.push(key);
    }
  }

  if (rolesSelected) {
    for (const role of bp.roles) {
      for (const manual of role.manualPermissions) {
        findings.push({
          level: 'info',
          code: 'manual-step',
          key: roleKey(role.key),
          message: `${role.name}: ${manual}. Grant it manually in Server Settings → Roles if you want it; to let ${role.name} outrank the bot, drag it above the bot's role afterwards.`,
        });
      }
    }
    planPositions();
  }

  function planPositions() {
    const managed = bp.roles
      .map((r) => ({ role: r, res: resolved.get(roleKey(r.key)) }))
      .filter((x) => x.res && !unavailable.has(roleKey(x.role.key)) && !locked.has(roleKey(x.role.key)));
    if (managed.length < 2) return;
    // Simulate: existing roles keep their order; new roles land at the bottom in creation order.
    const existing = managed
      .filter((x) => x.res!.id)
      .sort((a, b) => rolesById.get(b.res!.id!)!.position - rolesById.get(a.res!.id!)!.position);
    const created = managed.filter((x) => !x.res!.id);
    const simulated = [...existing, ...created].map((x) => x.role.key);
    const wanted = managed.map((x) => x.role.key);
    if (simulated.join() === wanted.join()) return;
    managed.forEach((x, i) =>
      push({
        kind: 'role.position',
        key: roleKey(x.role.key),
        discordId: x.res!.id ?? '',
        position: snapshot.botHighestPosition - 1 - i,
        risk: x.res!.ownership === 'ADOPTED' ? 'disruptive' : 'safe',
        description: `Order ${x.role.name} as #${i + 1} of the setup roles, directly below the bot's role.`,
      }),
    );
  }

  // ── Categories & channels ──────────────────────────────────────────────────
  const permsSelected = has('permissions');

  for (const cat of bp.categories) {
    if (!cat.included) continue;
    const key = categoryKey(cat.key);
    const res = resolveChannelLike(key, cat.name, 'category', null, null);
    if (res?.id && permsSelected && (repairing || res.adoptedNow)) {
      diffOverwrites(key, cat.name, chansById.get(res.id)!, cat.overwrites, cat.private, res);
    }

    for (const ch of cat.channels) {
      if (!ch.included) continue;
      const ckey = channelKey(ch.key);
      const parent = resolved.get(key);
      const chRes = resolveChannelLike(ckey, ch.name, ch.type, ch, parent ?? null);
      if (chRes?.id && permsSelected && (repairing || chRes.adoptedNow)) {
        diffOverwrites(ckey, ch.name, chansById.get(chRes.id)!, ch.overwrites, ch.private, chRes);
      }
    }
  }

  function resolveChannelLike(
    key: string,
    name: string,
    want: 'category' | 'text' | 'voice',
    ch: EffectiveChannel | null,
    parent: ResolvedId | null,
  ): ResolvedId | null {
    const label = want === 'category' ? `Category ${name}` : `Channel ${name}`;
    const parentKey = ch ? categoryKey(ch.categoryKey) : null;
    const m = byKey.get(key);
    if (m) {
      const cur = chansById.get(m.discordResourceId);
      if (cur && compatible(want, cur.type)) {
        const r: ResolvedId = { id: cur.id, pending: false, ownership: m.ownership, adoptedNow: false };
        resolved.set(key, r);
        planChannelDrift(key, label, name, cur, ch, parent, m.ownership, false);
        return r;
      }
      findings.push({
        level: repairing ? 'info' : 'warning',
        code: 'deleted',
        key,
        message: repairing
          ? `${label} was deleted; it will be recreated.`
          : `${label} was deleted after setup. Run a repair to recreate it.`,
      });
      if (!repairing) {
        unavailable.add(key);
        return null;
      }
      return planChannelCreate(key, label, name, want, parentKey, parent);
    }

    const parentId = parent?.id ?? null;
    const candidates = snapshot.channels.filter(
      (c) =>
        c.name === name &&
        compatible(want, c.type) &&
        !claimed.has(c.id) &&
        (want === 'category' || !parentId || c.parentId === parentId),
    );
    if (candidates.length > 1) {
      unavailable.add(key);
      findings.push({
        level: 'warning',
        code: 'ambiguous-match',
        key,
        message: `${candidates.length} channels match ${label}; none was adopted and none created. Rename or remove the duplicates and preview again.`,
      });
      return null;
    }
    if (candidates.length === 1) {
      const cur = candidates[0]!;
      claimed.add(cur.id);
      const r: ResolvedId = { id: cur.id, pending: false, ownership: 'ADOPTED', adoptedNow: true };
      resolved.set(key, r);
      push({
        kind: 'channel.adopt',
        key,
        discordId: cur.id,
        risk: 'safe',
        description: `Adopt existing ${want === 'category' ? 'category' : 'channel'} ${cur.name} (its messages and settings stay).`,
      });
      planChannelDrift(key, label, name, cur, ch, parent, 'ADOPTED', true);
      return r;
    }
    return planChannelCreate(key, label, name, want, parentKey, parent);
  }

  function planChannelCreate(
    key: string,
    label: string,
    name: string,
    want: 'category' | 'text' | 'voice',
    parentKey: string | null,
    parent: ResolvedId | null,
  ): ResolvedId | null {
    if (parentKey && !parent) {
      unavailable.add(key);
      findings.push({
        level: 'warning',
        code: 'skipped',
        key,
        message: `${label} is not created because its category is not available.`,
      });
      return null;
    }
    const r: ResolvedId = { id: null, pending: true, ownership: 'NEW', adoptedNow: false };
    resolved.set(key, r);
    push({
      kind: 'channel.create',
      key,
      name,
      channelType: want,
      parentKey,
      risk: 'safe',
      description:
        want === 'category'
          ? `Create category ${name} with its permissions set before anyone can see it.`
          : `Create ${want} channel ${name}${parentKey ? ' in its category' : ''}.`,
    });
    return r;
  }

  function planChannelDrift(
    key: string,
    label: string,
    name: string,
    cur: SnapshotChannel,
    ch: EffectiveChannel | null,
    parent: ResolvedId | null,
    ownership: 'CREATED' | 'ADOPTED',
    adoptedNow: boolean,
  ) {
    const patch: { name?: string; parentKey?: string; topic?: string; slowmode?: number } = {};
    const notes: string[] = [];
    let risk: ChangeRisk = 'safe';
    if (cur.name !== name) {
      if (repairing) {
        patch.name = name;
        notes.push(`rename "${cur.name}" → "${name}"`);
      } else if (!adoptedNow) {
        findings.push({
          level: 'warning',
          code: 'renamed',
          key,
          message: `${label} was renamed to "${cur.name}". Run a repair to restore the name.`,
        });
      }
    }
    if (ch && parent && (repairing || adoptedNow)) {
      const wantParent = parent.id;
      if (wantParent === null || cur.parentId !== wantParent) {
        patch.parentKey = categoryKey(ch.categoryKey);
        notes.push('move into its category');
        if (ownership === 'ADOPTED') risk = 'disruptive';
      }
    }
    if (ch && repairing) {
      if (ch.type === 'text' && ch.topic !== undefined && (cur.topic ?? '') !== ch.topic) {
        patch.topic = ch.topic;
        notes.push('restore topic');
      }
      if (ch.type === 'text' && ch.slowmode !== undefined && cur.rateLimitPerUser !== ch.slowmode) {
        patch.slowmode = ch.slowmode;
        notes.push(`slow mode ${cur.rateLimitPerUser}s → ${ch.slowmode}s`);
      }
    }
    if (Object.keys(patch).length) {
      push({
        kind: 'channel.update',
        key,
        discordId: cur.id,
        patch,
        risk,
        description: `Update ${label.toLowerCase().startsWith('category') ? 'category' : 'channel'} ${cur.name}: ${notes.join('; ')}.`,
      });
    } else if (cur.name === name) {
      inPlace.push(key);
    }
  }

  function diffOverwrites(
    key: string,
    name: string,
    cur: SnapshotChannel,
    expected: OverwriteMap,
    isPrivate: boolean,
    res: ResolvedId,
  ) {
    for (const [target, want] of expected) {
      const tid = resolveTarget(target);
      if (tid === undefined) continue; // role not available: nothing to set
      let allow = strip(want.allow, `${name} (${target})`, key);
      const deny = strip(want.deny, `${name} (${target})`, key);
      if (target === '@everyone' && isPrivate && (allow & P.ViewChannel) !== 0n) {
        // Guard: a private area is never opened to @everyone.
        allow &= ~P.ViewChannel;
      }
      const existing: SnapshotOverwrite | undefined = tid
        ? cur.overwrites.find((o) => o.id === tid)
        : undefined;
      if (existing && existing.allow === allow && existing.deny === deny) continue;
      const ref = targetRef(target);
      const label = target === '@everyone' ? '@everyone' : target === 'self' ? 'the bot' : `role ${target}`;
      push({
        kind: 'overwrite.set',
        key: overwriteKey(key, ref),
        channelKey: key,
        target: ref,
        allow: allow.toString(),
        deny: deny.toString(),
        risk: res.ownership === 'ADOPTED' ? 'disruptive' : 'safe',
        description: `Set permissions for ${label} on ${cur.name}: ${
          existing ? `allow ${fmtBits(existing.allow)} / deny ${fmtBits(existing.deny)} → ` : ''
        }allow ${fmtBits(allow)} / deny ${fmtBits(deny)}.`,
      });
    }
  }

  /** '' = pending creation, undefined = not available. */
  function resolveTarget(t: ManagedTarget): string | undefined {
    if (t === '@everyone') return snapshot.guildId;
    if (t === 'self') return snapshot.botUserId;
    const k = roleKey(t);
    if (unavailable.has(k)) return undefined;
    const r = resolved.get(k);
    if (!r) return undefined;
    return r.id ?? '';
  }

  // ── Bindings ───────────────────────────────────────────────────────────────
  const available = (k: string) => resolved.has(k) && !unavailable.has(k);
  if (has('logging')) {
    const wire = (b: BindingKey, resourceKey: string, label: string) => {
      if (!available(resourceKey)) return;
      const r = resolved.get(resourceKey)!;
      const current = state.bindings[b] ?? null;
      const enablesVerification = b === 'welcome.verifiedRoleId' && !state.verificationEnabled;
      if (r.id && current === r.id && !enablesVerification) {
        inPlace.push(bindingKey(b));
        return;
      }
      const disruptive = (current !== null && current !== r.id) || enablesVerification;
      push({
        kind: 'binding.set',
        key: bindingKey(b),
        binding: b,
        resourceKey,
        risk: disruptive ? 'disruptive' : 'safe',
        description: `Route ${b} to ${label}: ${current ? `currently ${current}` : 'currently not set'} → ${
          r.id ?? 'the new resource'
        }${enablesVerification ? '; also turns on member verification (new members must verify to see the community)' : ''}.`,
      });
    };
    for (const cat of bp.categories) {
      for (const ch of cat.channels) {
        if (!ch.included) continue;
        for (const b of ch.bindings) wire(b, channelKey(ch.key), ch.name);
      }
    }
    if (rolesSelected) {
      for (const role of bp.roles) for (const b of role.bindings) wire(b, roleKey(role.key), role.name);
    }
  }

  // ── Staff grants ───────────────────────────────────────────────────────────
  if (has('staff-grants')) {
    for (const role of bp.roles) {
      if (!role.grant) continue;
      const k = roleKey(role.key);
      if (!available(k)) continue;
      const r = resolved.get(k)!;
      if (r.id && state.grants.some((g) => g.subjectId === r.id && g.permission === role.grant)) {
        inPlace.push(grantKey(role.key));
        continue;
      }
      const blocked = ungrantableKeys(opts.operatorPermissions, role.grant);
      if (blocked.length) {
        findings.push({
          level: 'info',
          code: 'manual-step',
          key: grantKey(role.key),
          message: `You cannot grant the ${role.grant} dashboard preset to ${role.name} because you do not hold all of its permissions. Ask someone who does (e.g. the owner) to grant it in Settings → Permissions.`,
        });
        continue;
      }
      push({
        kind: 'grant.set',
        key: grantKey(role.key),
        roleKey: k,
        preset: role.grant,
        risk: 'safe',
        description: `Give ${role.name} the ${role.grant} bot dashboard preset.`,
      });
    }
  }

  // ── Messages / panels ──────────────────────────────────────────────────────
  for (const cat of bp.categories) {
    for (const ch of cat.channels) {
      if (!ch.included || !ch.panel || !has(PANEL_COMPONENT[ch.panel])) continue;
      const ckey = channelKey(ch.key);
      if (!available(ckey)) continue;
      const mkey = messageKey(ch.panel);
      if (state.liveMessages.has(mkey)) {
        inPlace.push(mkey);
        continue;
      }
      push({
        kind: 'message.deploy',
        key: mkey,
        channelKey: ckey,
        panel: ch.panel,
        risk: 'safe',
        description:
          ch.panel === 'support-status'
            ? `Post the public support status panel in ${ch.name} (availability only, no ticket controls).`
            : ch.panel === 'duty-control'
              ? `Post the private staff duty-control panel in ${ch.name}.`
              : `Post the ${ch.panel} message in ${ch.name}.`,
      });
    }
  }

  if (has('embeds')) {
    if (state.templateExists) inPlace.push(TEMPLATE_KEY);
    else
      push({
        kind: 'template.create',
        key: TEMPLATE_KEY,
        name: TEMPLATE_NAME,
        risk: 'safe',
        description: `Create the "${TEMPLATE_NAME}" announcement template (saved only, nothing is posted).`,
      });
  }

  const changes = STAGES.flatMap((s) => stage[s]);
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const id = `${f.level}|${f.code}|${f.key ?? ''}|${f.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return {
    blueprintVersion: bp.version,
    changes,
    findings: unique,
    inPlace: [...new Set(inPlace)],
    missingBotPermissions,
    blocked: unique.some((f) => f.level === 'blocking' && !f.key),
  };
}

/** Category of a channel key, from the effective blueprint. */
export function categoryOfChannel(bp: EffectiveBlueprint, key: string): EffectiveCategory | undefined {
  const k = key.replace(/^channel:/, '');
  return bp.categories.find((c) => c.channels.some((ch) => ch.key === k));
}
