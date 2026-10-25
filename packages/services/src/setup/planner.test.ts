import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { SetupResource } from '@gynx/database';
import { ALL_PERMISSIONS } from '@gynx/permissions';
import { BLUEPRINT_CATEGORIES, BLUEPRINT_ROLES, REQUIRED_BOT_PERMISSIONS } from './blueprint';
import { resolveBlueprint } from './config';
import { plan, type PlanOptions } from './planner';
import { planHash } from './store';
import { DEFAULT_SETUP_CONFIG, type GuildSnapshot, type SnapshotChannel, type SnapshotRole } from './types';

const G = '1000';
const BOT = '2000';
let n = 0;
const id = () => String(5000 + ++n);

function snap(over: Partial<GuildSnapshot> = {}): GuildSnapshot {
  return {
    guildId: G,
    ownerId: '3000',
    botUserId: BOT,
    botPermissions: REQUIRED_BOT_PERMISSIONS,
    botHighestPosition: 5,
    roles: [role('@everyone', 0, G), { ...role('GYNX Bot', 5), managed: true }],
    channels: [],
    ...over,
  };
}
function role(name: string, position: number, rid = id()): SnapshotRole {
  return {
    id: rid,
    name,
    color: 0,
    position,
    permissions: 0n,
    managed: false,
    hoist: false,
    mentionable: false,
  };
}
function chan(name: string, type: number, parentId: string | null = null, rid = id()): SnapshotChannel {
  return { id: rid, name, type, parentId, position: 0, topic: null, rateLimitPerUser: 0, overwrites: [] };
}
function res(key: string, discordId: string, ownership: 'CREATED' | 'ADOPTED' = 'CREATED'): SetupResource {
  const type = key.startsWith('role:') ? 'ROLE' : key.startsWith('category:') ? 'CATEGORY' : 'TEXT_CHANNEL';
  return {
    id: key,
    guildId: G,
    setupOperationId: 'op',
    resourceType: type,
    blueprintKey: key,
    discordResourceId: discordId,
    channelId: null,
    ownership,
    configurationHash: '',
    blueprintVersion: 1,
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
const opts = (over: Partial<PlanOptions> = {}): PlanOptions => ({
  type: 'START',
  operatorPermissions: new Set(ALL_PERMISSIONS),
  state: {
    bindings: {},
    verificationEnabled: false,
    grants: [],
    liveMessages: new Set(),
    templateExists: false,
  },
  ...over,
});
const bp = (selection?: Parameters<typeof resolveBlueprint>[1]) =>
  resolveBlueprint(DEFAULT_SETUP_CONFIG, selection);
const keysOf = (p: ReturnType<typeof plan>, kind: string) =>
  p.changes.filter((c) => c.kind === kind).map((c) => c.key);

describe('setup planner', () => {
  it('plans a full build for an empty server in stage order', () => {
    const p = plan(snap(), bp(), [], opts());
    const channelCount = BLUEPRINT_CATEGORIES.reduce((a, c) => a + c.channels.length, 0);
    expect(keysOf(p, 'role.create')).toHaveLength(BLUEPRINT_ROLES.length);
    expect(keysOf(p, 'channel.create')).toHaveLength(BLUEPRINT_CATEGORIES.length + channelCount);
    expect(keysOf(p, 'message.deploy').sort()).toEqual(
      [
        'message:duty-control',
        'message:rules',
        'message:support-status',
        'message:verify',
        'message:welcome',
      ].sort(),
    );
    // New roles land in blueprint order on their own, so no reorder is needed.
    const order = [
      'role.create',
      'channel.create',
      'binding.set',
      'grant.set',
      'message.deploy',
      'template.create',
    ];
    const seen = [...new Set(p.changes.map((c) => c.kind))];
    expect(seen).toEqual(order);
    // categories before channels
    const creates = p.changes.filter((c) => c.kind === 'channel.create');
    const lastCat = creates.map((c) => c.key.startsWith('category:')).lastIndexOf(true);
    expect(lastCat).toBe(BLUEPRINT_CATEGORIES.length - 1);
    expect(p.blocked).toBe(false);
  });

  it('is blocked without Manage Roles / Manage Channels and lists missing permissions', () => {
    const p = plan(
      snap({ botPermissions: REQUIRED_BOT_PERMISSIONS & ~P.ManageChannels & ~P.BanMembers }),
      bp(),
      [],
      opts(),
    );
    expect(p.blocked).toBe(true);
    expect(p.missingBotPermissions).toEqual(expect.arrayContaining(['ManageChannels', 'BanMembers']));
    // Ban Members is stripped from role permissions with a finding.
    const founder = p.changes.find((c) => c.kind === 'role.create' && c.key === 'role:founder');
    expect(founder && 'permissions' in founder && BigInt(founder.permissions) & P.BanMembers).toBe(0n);
    expect(p.findings.some((f) => f.code === 'cannot-grant' && f.key === 'role:founder')).toBe(true);
  });

  it('adopts a single name match, never guesses between several', () => {
    const s = snap();
    const support = role('Support', 2);
    s.roles.push(support, role('Moderator', 1), role('Moderator', 3));
    const p = plan(s, bp(['roles']), [], opts());
    expect(p.changes).toContainEqual(
      expect.objectContaining({ kind: 'role.adopt', key: 'role:support', discordId: support.id }),
    );
    expect(p.changes.some((c) => c.key === 'role:moderator')).toBe(false);
    expect(p.findings).toContainEqual(
      expect.objectContaining({ code: 'ambiguous-match', key: 'role:moderator' }),
    );
  });

  it('never adopts managed (integration) roles', () => {
    const s = snap();
    s.roles.push({ ...role('Bot', 2), managed: true });
    const p = plan(s, bp(['roles']), [], opts());
    expect(keysOf(p, 'role.create')).toContain('role:bot');
  });

  it('adopts a channel only in the existing category, with a compatible type', () => {
    const s = snap();
    const cat = chan('SUPPORT CENTER', 4);
    const inCat = chan('📚・knowledge-base', 0, cat.id);
    const elsewhere = chan('📚・knowledge-base', 0, null);
    const voiceSameName = chan('🔧・troubleshooting', 2, cat.id);
    s.channels.push(cat, inCat, elsewhere, voiceSameName);
    const p = plan(s, bp(['category:support-center']), [], opts());
    expect(p.changes).toContainEqual(
      expect.objectContaining({ kind: 'channel.adopt', key: 'channel:knowledge-base', discordId: inCat.id }),
    );
    expect(keysOf(p, 'channel.create')).toContain('channel:troubleshooting');
  });

  it('START reports renamed and deleted managed resources without changing them; REPAIR fixes them', () => {
    const s = snap();
    const cat = chan('START HERE', 4);
    const welcome = chan('hello', 0, cat.id);
    s.channels.push(cat, welcome);
    const manifest = [
      res('category:start-here', cat.id),
      res('channel:welcome', welcome.id),
      res('channel:rules', '999'),
    ];
    const sel = bp(['category:start-here']);

    const start = plan(s, sel, manifest, opts());
    expect(start.findings).toContainEqual(
      expect.objectContaining({ code: 'renamed', key: 'channel:welcome' }),
    );
    expect(start.findings).toContainEqual(expect.objectContaining({ code: 'deleted', key: 'channel:rules' }));
    expect(start.changes.some((c) => c.key === 'channel:welcome' || c.key === 'channel:rules')).toBe(false);

    const repair = plan(s, sel, manifest, opts({ type: 'REPAIR' }));
    expect(repair.changes).toContainEqual(
      expect.objectContaining({
        kind: 'channel.update',
        key: 'channel:welcome',
        patch: expect.objectContaining({ name: '👋・welcome' }),
      }),
    );
    expect(repair.changes).toContainEqual(
      expect.objectContaining({ kind: 'channel.create', key: 'channel:rules' }),
    );
  });

  it('roles at or above the bot are never touched (hierarchy finding, not a global block)', () => {
    const s = snap();
    const founder = role('Founder', 6);
    s.roles.push(founder);
    const p = plan(s, bp(['roles']), [res('role:founder', founder.id)], opts({ type: 'UPDATE' }));
    expect(p.findings).toContainEqual(
      expect.objectContaining({ code: 'hierarchy', key: 'role:founder', level: 'blocking' }),
    );
    expect(p.blocked).toBe(false);
    expect(p.changes.some((c) => c.key === 'role:founder')).toBe(false);
  });

  it('only reorders roles when the order differs', () => {
    const s = snap({ botHighestPosition: 20 });
    s.roles = [role('@everyone', 0, G), { ...role('GYNX Bot', 20), managed: true }];
    const manifest = BLUEPRINT_ROLES.map((r, i) => {
      const x = role(r.name, 19 - i);
      s.roles.push(x);
      return res(`role:${r.key}`, x.id);
    });
    expect(keysOf(plan(s, bp(['roles']), manifest, opts()), 'role.position')).toEqual([]);
    // swap two
    const a = s.roles.find((r) => r.name === 'Support')!;
    const b = s.roles.find((r) => r.name === 'Moderator')!;
    [a.position, b.position] = [b.position, a.position];
    expect(keysOf(plan(s, bp(['roles']), manifest, opts()), 'role.position')).toHaveLength(
      BLUEPRINT_ROLES.length,
    );
  });

  it('adopted role permissions change only on UPDATE, as disruptive', () => {
    const s = snap();
    const mod = { ...role('Moderator', 2), permissions: P.SendMessages };
    s.roles.push(mod);
    const manifest = [res('role:moderator', mod.id, 'ADOPTED')];
    const repair = plan(s, bp(['roles']), manifest, opts({ type: 'REPAIR' }));
    expect(repair.changes.some((c) => c.kind === 'role.update' && c.key === 'role:moderator')).toBe(false);
    const update = plan(s, bp(['roles']), manifest, opts({ type: 'UPDATE' }));
    expect(update.changes).toContainEqual(
      expect.objectContaining({ kind: 'role.update', key: 'role:moderator', risk: 'disruptive' }),
    );
  });

  it('diffs only managed overwrite targets on adopted channels and marks them disruptive', () => {
    const s = snap();
    const other = role('Gamers', 1);
    s.roles.push(other);
    const cat = chan('STAFF HQ — PRIVATE', 4);
    cat.overwrites = [{ id: other.id, type: 0, allow: P.ViewChannel, deny: 0n }];
    s.channels.push(cat);
    const p = plan(s, bp(['category:staff-hq', 'permissions']), [], opts());
    const ow = p.changes.filter((c) => c.kind === 'overwrite.set' && c.channelKey === 'category:staff-hq');
    expect(ow.length).toBeGreaterThan(0);
    expect(ow.every((c) => c.risk === 'disruptive')).toBe(true);
    expect(ow.some((c) => c.kind === 'overwrite.set' && c.target === '@everyone')).toBe(true);
    expect(ow.some((c) => c.kind === 'overwrite.set' && c.target.includes(other.id))).toBe(false);
    const everyone = ow.find((c) => c.kind === 'overwrite.set' && c.target === '@everyone');
    expect(everyone && 'allow' in everyone && BigInt(everyone.allow) & P.ViewChannel).toBe(0n);
  });

  it('restricted channels deny view to non-designated staff', () => {
    const b = bp();
    const reports = b.categories.flatMap((c) => c.channels).find((c) => c.key === 'staff-reports')!;
    expect(reports.overwrites.get('support')!.deny & P.ViewChannel).toBe(P.ViewChannel);
    expect(reports.overwrites.get('management')!.allow & P.ViewChannel).toBe(P.ViewChannel);
    const events = b.categories.flatMap((c) => c.channels).find((c) => c.key === 'events')!;
    // Read-only override keeps the category's view for members.
    expect(events.overwrites.get('verified')!.allow & P.ViewChannel).toBe(P.ViewChannel);
    expect(events.overwrites.get('verified')!.deny & P.SendMessages).toBe(P.SendMessages);
  });

  it('bindings: unset → safe; overwriting a configured value or enabling verification → disruptive', () => {
    const p = plan(
      snap(),
      bp(),
      [],
      opts({ state: { ...opts().state, bindings: { modLogChannelId: '42' } } }),
    );
    const mod = p.changes.find((c) => c.key === 'binding:modLogChannelId')!;
    expect(mod.risk).toBe('disruptive');
    expect(mod.description).toContain('42');
    expect(p.changes.find((c) => c.key === 'binding:logChannelId')!.risk).toBe('safe');
    expect(p.changes.find((c) => c.key === 'binding:welcome.verifiedRoleId')!.risk).toBe('disruptive');
  });

  it('staff grants require the operator to hold the preset', () => {
    const p = plan(snap(), bp(), [], opts({ operatorPermissions: new Set(['setup.manage']) }));
    expect(keysOf(p, 'grant.set')).toEqual([]);
    expect(p.findings.filter((f) => f.code === 'manual-step' && f.key?.startsWith('grant:')).length).toBe(6);
  });

  it('live messages are not redeployed; excluded channels are left out', () => {
    const cfg = { ...DEFAULT_SETUP_CONFIG, excludedChannels: ['showcase'] as never };
    const p = plan(
      snap(),
      resolveBlueprint(cfg),
      [],
      opts({ state: { ...opts().state, liveMessages: new Set(['message:welcome']) } }),
    );
    expect(keysOf(p, 'message.deploy')).not.toContain('message:welcome');
    expect(keysOf(p, 'channel.create')).not.toContain('channel:showcase');
  });

  it('hash ignores descriptions and changes when the plan changes', () => {
    const a = plan(snap(), bp(), [], opts());
    const b = { ...a, changes: a.changes.map((c) => ({ ...c, description: 'x' })) };
    expect(planHash(a.changes)).toBe(planHash(b.changes));
    expect(planHash(a.changes)).not.toBe(planHash(a.changes.slice(1)));
  });
});
