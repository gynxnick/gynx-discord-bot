import { expect } from 'vitest';
import { DiscordAPIError } from '@discordjs/rest';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { PermissionKey } from '@gynx/permissions';
import { cancelJob, setup } from '@gynx/services';
import { ctxAs, fakeDiscord, freshGuild, testDb, testDeps, type FakeDiscord } from './helpers';

type GuildSnapshot = setup.GuildSnapshot;
type SnapshotChannel = setup.SnapshotChannel;
type SnapshotRole = setup.SnapshotRole;
type DiscordAdminPort = setup.DiscordAdminPort;

const ALL_BITS = Object.values(P).reduce((a, b) => a | b, 0n);

export function apiError(status: number, code: number, message: string, retryAfterSeconds?: number) {
  const raw = {
    message,
    code,
    ...(retryAfterSeconds !== undefined ? { retry_after: retryAfterSeconds } : {}),
  };
  return new DiscordAPIError(raw, code, status, 'POST', '/fake', {});
}
const missingPermissions = () => apiError(403, 50013, 'Missing Permissions');
const unknown = (what: string) => apiError(404, 10003, `Unknown ${what}`);

interface Failure {
  method: string;
  /** Throw on the (skip+1)-th call to `method`. */
  skip: number;
  times: number;
  error: () => unknown;
  seen: number;
}

/**
 * In-memory guild that behaves like Discord for the setup engine:
 * role hierarchy (new roles at position 1; nothing at/above the bot's highest
 * role can be managed), permission rules (the bot cannot grant permissions it
 * lacks → 403 50013), per-target overwrites, messages, injected failures and a
 * call log.
 */
export class FakeGuild implements DiscordAdminPort {
  readonly guildId: string;
  readonly ownerId = '100000000000000001';
  readonly botUserId = '100000000000000002';
  readonly botRoleId: string;
  roles: SnapshotRole[] = [];
  channels: SnapshotChannel[] = [];
  messages = new Map<string, Array<{ id: string; authorId: string }>>();
  calls: Array<{ method: string; args: unknown[] }> = [];
  private failures: Failure[] = [];
  private seq = 0;
  /** Messages + other DiscordPort side effects (sendMessage creates real fake messages). */
  readonly discord: FakeDiscord;

  constructor(guildId: string, opts: { botPermissions?: bigint; everyonePermissions?: bigint } = {}) {
    this.guildId = guildId;
    this.botRoleId = this.id();
    this.roles.push(
      this.role(
        guildId,
        '@everyone',
        0,
        opts.everyonePermissions ?? P.ViewChannel | P.SendMessages | P.ReadMessageHistory,
      ),
      {
        ...this.role(this.botRoleId, 'GYNX Bot', 1, opts.botPermissions ?? this.defaultBotPermissions()),
        managed: true,
      },
    );
    this.discord = fakeDiscord({
      sendMessage: async (channelId, body) => {
        if (!this.channels.some((c) => c.id === channelId)) throw unknown('Channel');
        const id = this.id();
        this.messages.set(channelId, [
          ...(this.messages.get(channelId) ?? []),
          { id, authorId: this.botUserId },
        ]);
        this.discord.sent.push({ channelId, body });
        return { id };
      },
      editMessage: async (channelId, messageId, body) => {
        if (!this.messages.get(channelId)?.some((m) => m.id === messageId)) throw unknown('Message');
        this.discord.edits.push({ channelId, messageId, body });
      },
      deleteMessage: async (channelId, messageId) => {
        this.messages.set(
          channelId,
          (this.messages.get(channelId) ?? []).filter((m) => m.id !== messageId),
        );
        this.discord.deletedMessages.push({ channelId, messageId });
      },
      getGuild: async (id) => {
        return { id, name: 'Test', ownerId: this.ownerId, memberCount: 10 };
      },
    });
  }

  defaultBotPermissions(): bigint {
    return setupRequired();
  }

  id(): string {
    this.seq++;
    return `8${String(this.seq).padStart(17, '0')}`;
  }

  role(id: string, name: string, position: number, permissions = 0n): SnapshotRole {
    return { id, name, color: 0, position, permissions, managed: false, hoist: false, mentionable: false };
  }

  // ── Test helpers ───────────────────────────────────────────────────────────

  get botRole(): SnapshotRole {
    return this.roles.find((r) => r.id === this.botRoleId)!;
  }
  get botPermissions(): bigint {
    const everyone = this.roles.find((r) => r.id === this.guildId)!;
    const perms = everyone.permissions | this.botRole.permissions;
    return (perms & P.Administrator) !== 0n ? ALL_BITS : perms;
  }

  addRole(
    name: string,
    opts: { position?: number; permissions?: bigint; managed?: boolean } = {},
  ): SnapshotRole {
    const r = { ...this.role(this.id(), name, 0, opts.permissions ?? 0n), managed: opts.managed ?? false };
    const pos = opts.position ?? 1;
    for (const x of this.roles) if (x.id !== this.guildId && x.position >= pos) x.position++;
    r.position = pos;
    this.roles.push(r);
    return r;
  }

  addChannel(
    name: string,
    type: number,
    opts: { parentId?: string | null; overwrites?: SnapshotChannel['overwrites']; topic?: string } = {},
  ): SnapshotChannel {
    const c: SnapshotChannel = {
      id: this.id(),
      name,
      type,
      parentId: opts.parentId ?? null,
      position: this.channels.length,
      topic: opts.topic ?? null,
      rateLimitPerUser: 0,
      overwrites: opts.overwrites ?? [],
    };
    this.channels.push(c);
    return c;
  }

  postMemberMessage(channelId: string, authorId = '100000000000000099') {
    const id = this.id();
    this.messages.set(channelId, [...(this.messages.get(channelId) ?? []), { id, authorId }]);
    return id;
  }

  channelByName(name: string) {
    return this.channels.find((c) => c.name === name);
  }
  roleByName(name: string) {
    return this.roles.find((r) => r.name === name);
  }

  /** Make the (skip+1)-th call of `method` (and the next `times-1`) throw. */
  failOn(method: keyof DiscordAdminPort, error: () => unknown, opts: { skip?: number; times?: number } = {}) {
    this.failures.push({ method, skip: opts.skip ?? 0, times: opts.times ?? 1, error, seen: 0 });
  }

  count(method: string) {
    return this.calls.filter((c) => c.method === method).length;
  }

  private enter(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    for (const f of this.failures) {
      if (f.method !== method) continue;
      f.seen++;
      if (f.seen > f.skip && f.seen <= f.skip + f.times) throw f.error();
    }
  }

  private requirePerm(bit: bigint) {
    if ((this.botPermissions & bit) === 0n) throw missingPermissions();
  }
  private requireGrantable(bits: bigint) {
    if ((bits & ~this.botPermissions) !== 0n) throw missingPermissions();
  }
  private manageable(role: SnapshotRole) {
    if (role.id === this.guildId) return;
    if (role.managed || role.position >= this.botRole.position) throw missingPermissions();
  }
  private normalise() {
    const others = this.roles.filter((r) => r.id !== this.guildId).sort((a, b) => a.position - b.position);
    others.forEach((r, i) => (r.position = i + 1));
  }

  // ── DiscordAdminPort ───────────────────────────────────────────────────────

  async snapshot(guildId: string): Promise<GuildSnapshot> {
    this.enter('snapshot', [guildId]);
    const clone = <T>(v: T): T => structuredClone(v);
    return {
      guildId: this.guildId,
      ownerId: this.ownerId,
      botUserId: this.botUserId,
      botPermissions: this.botPermissions,
      botHighestPosition: this.botRole.position,
      roles: clone(this.roles),
      channels: clone(this.channels),
    };
  }

  async createRole(_g: string, data: Parameters<DiscordAdminPort['createRole']>[1]) {
    this.enter('createRole', [data]);
    this.requirePerm(P.ManageRoles);
    this.requireGrantable(data.permissions);
    const r = this.addRole(data.name, { position: 1, permissions: data.permissions });
    Object.assign(r, { color: data.color, hoist: data.hoist, mentionable: data.mentionable });
    return structuredClone(r);
  }

  async editRole(_g: string, roleId: string, data: Parameters<DiscordAdminPort['editRole']>[2]) {
    this.enter('editRole', [roleId, data]);
    this.requirePerm(P.ManageRoles);
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) throw unknown('Role');
    this.manageable(r);
    if (data.permissions !== undefined) this.requireGrantable(data.permissions);
    Object.assign(r, data);
  }

  async setRolePositions(_g: string, positions: Array<{ id: string; position: number }>) {
    this.enter('setRolePositions', [positions]);
    this.requirePerm(P.ManageRoles);
    const bot = this.botRole.position;
    for (const p of positions) {
      const r = this.roles.find((x) => x.id === p.id);
      if (!r) throw unknown('Role');
      this.manageable(r);
      if (p.position >= bot) throw missingPermissions();
    }
    const moved = new Set(positions.map((p) => p.id));
    for (const p of positions) this.roles.find((x) => x.id === p.id)!.position = p.position;
    // Ties: a moved role takes the slot, the other one goes below it.
    const others = this.roles.filter((r) => r.id !== this.guildId);
    others.sort((a, b) => a.position - b.position || (moved.has(a.id) ? 1 : 0) - (moved.has(b.id) ? 1 : 0));
    others.forEach((r, i) => (r.position = i + 1));
  }

  async deleteRole(_g: string, roleId: string) {
    this.enter('deleteRole', [roleId]);
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) return;
    this.manageable(r);
    this.roles = this.roles.filter((x) => x.id !== roleId);
    for (const c of this.channels) c.overwrites = c.overwrites.filter((o) => o.id !== roleId);
    this.normalise();
  }

  async createChannel(_g: string, data: Parameters<DiscordAdminPort['createChannel']>[1]) {
    this.enter('createChannel', [data]);
    this.requirePerm(P.ManageChannels);
    for (const o of data.overwrites ?? []) this.requireGrantable(o.allow | o.deny);
    if (data.parentId && !this.channels.some((c) => c.id === data.parentId && c.type === 4))
      throw unknown('Channel');
    const c = this.addChannel(data.name, data.type, {
      parentId: data.parentId ?? null,
      overwrites: (data.overwrites ?? []).map((o) => ({ ...o })),
      topic: data.topic,
    });
    c.rateLimitPerUser = data.rateLimitPerUser ?? 0;
    return structuredClone(c);
  }

  async editChannel(channelId: string, data: Parameters<DiscordAdminPort['editChannel']>[1]) {
    this.enter('editChannel', [channelId, data]);
    this.requirePerm(P.ManageChannels);
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw unknown('Channel');
    if (data.name !== undefined) c.name = data.name;
    if (data.parentId !== undefined) c.parentId = data.parentId;
    if (data.topic !== undefined) c.topic = data.topic;
    if (data.rateLimitPerUser !== undefined) c.rateLimitPerUser = data.rateLimitPerUser;
    if (data.position !== undefined) c.position = data.position;
  }

  async setOverwrite(channelId: string, target: { id: string; type: 0 | 1 }, allow: bigint, deny: bigint) {
    this.enter('setOverwrite', [channelId, target, allow, deny]);
    this.requirePerm(P.ManageRoles);
    this.requireGrantable(allow | deny);
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw unknown('Channel');
    c.overwrites = [
      ...c.overwrites.filter((o) => o.id !== target.id),
      { id: target.id, type: target.type, allow, deny },
    ];
  }

  async deleteOverwrite(channelId: string, targetId: string) {
    this.enter('deleteOverwrite', [channelId, targetId]);
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) return;
    c.overwrites = c.overwrites.filter((o) => o.id !== targetId);
  }

  async deleteChannel(channelId: string) {
    this.enter('deleteChannel', [channelId]);
    this.requirePerm(P.ManageChannels);
    this.channels = this.channels.filter((c) => c.id !== channelId);
    for (const c of this.channels) if (c.parentId === channelId) c.parentId = null;
    this.messages.delete(channelId);
  }

  async hasNonBotMessages(channelId: string, botUserId: string) {
    this.enter('hasNonBotMessages', [channelId]);
    return (this.messages.get(channelId) ?? []).some((m) => m.authorId !== botUserId);
  }

  async messageExists(channelId: string, messageId: string) {
    this.enter('messageExists', [channelId, messageId]);
    return (this.messages.get(channelId) ?? []).some((m) => m.id === messageId);
  }
}

function setupRequired(): bigint {
  // Everything the blueprint needs, without Administrator.
  return (
    P.ManageRoles |
    P.ManageChannels |
    P.ViewChannel |
    P.ReadMessageHistory |
    P.SendMessages |
    P.SendMessagesInThreads |
    P.EmbedLinks |
    P.AttachFiles |
    P.AddReactions |
    P.UseExternalEmojis |
    P.ManageMessages |
    P.KickMembers |
    P.BanMembers |
    P.ModerateMembers |
    P.Connect |
    P.Speak |
    P.MuteMembers |
    P.MoveMembers |
    P.CreatePublicThreads
  );
}

// ── Test harness ─────────────────────────────────────────────────────────────

export const VIEW = P.ViewChannel;
export const noSleep = { sleep: async () => undefined, baseDelayMs: 1 };

export const ALL_CHANNELS = setup.BLUEPRINT_CATEGORIES.flatMap((c) =>
  c.channels.map((ch) => ({ ...ch, category: c })),
);

export async function harness(opts: { botPermissions?: bigint; perms?: PermissionKey[] | 'all' } = {}) {
  const guildId = await freshGuild();
  const guild = new FakeGuild(guildId, { botPermissions: opts.botPermissions });
  const deps = testDeps({ discordAdmin: guild, discord: guild.discord });
  const admin = ctxAs(guildId, opts.perms ?? 'all', { deps });
  return { guildId, guild, deps, admin, db: testDb() };
}
export type Harness = Awaited<ReturnType<typeof harness>>;

/** preview → confirm (accepting disruptive) → execute directly (the job is cancelled to keep the queue clean). */
export async function apply(
  h: Harness,
  type: 'START' | 'REPAIR' | 'UPDATE' = 'START',
  selection?: setup.ComponentKey[],
) {
  const preview = await setup.previewOperation(h.admin, { type, selection });
  const confirmed = await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true });
  expect(confirmed.status).toBe('QUEUED');
  await cancelJob(h.db, `${setup.SETUP_APPLY_JOB}:${preview.operationId}`);
  const summary = await setup.executeSetupOperation(h.deps, preview.operationId, noSleep);
  return { preview, summary };
}

export async function rollback(h: Harness, operationId?: string) {
  const preview = await setup.previewRollback(h.admin, operationId);
  const confirmed = await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true });
  expect(confirmed.status).toBe('QUEUED');
  await cancelJob(h.db, `${setup.SETUP_APPLY_JOB}:${preview.operationId}`);
  const summary = await setup.executeSetupOperation(h.deps, preview.operationId, noSleep);
  return { preview, summary };
}

export const manifest = (h: Harness) => h.db.setupResource.findMany({ where: { guildId: h.guildId } });
export const resourceId = async (h: Harness, key: string) =>
  (
    await h.db.setupResource.findUnique({
      where: { guildId_blueprintKey: { guildId: h.guildId, blueprintKey: key } },
    })
  )?.discordResourceId;
