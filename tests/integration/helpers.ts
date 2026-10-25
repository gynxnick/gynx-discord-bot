import { randomInt } from 'node:crypto';
import { inject } from 'vitest';
import { createLogger } from '@gynx/config';
import { createDb, ensureGuild, type PrismaClient } from '@gynx/database';
import { ALL_PERMISSIONS, type PermissionKey } from '@gynx/permissions';
import {
  makeCtx,
  type Actor,
  type Ctx,
  type DiscordPort,
  type MessageBody,
  type ServiceDeps,
} from '@gynx/services';
import { MemoryRateLimiter } from '@gynx/shared';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  if (!client) client = createDb(inject('databaseUrl'));
  return client;
}

let seq = 0;
/**
 * Snowflake-shaped id, unique across parallel test workers:
 * 1 + 13-digit ms timestamp + 4 random digits + 2-digit per-worker sequence (20 digits).
 */
export function snowflake(): string {
  seq = (seq + 1) % 100;
  return `1${Date.now()}${String(randomInt(10_000)).padStart(4, '0')}${String(seq).padStart(2, '0')}`;
}

/** A fresh, isolated guild per test so tests never share state. */
export async function freshGuild(): Promise<string> {
  const id = snowflake();
  await ensureGuild(testDb(), id, `Test Guild ${id}`);
  return id;
}

export interface FakeDiscord extends DiscordPort {
  sent: Array<{ channelId: string; body: MessageBody }>;
  dms: Array<{ userId: string; body: MessageBody }>;
  edits: Array<{ channelId: string; messageId: string; body: Partial<MessageBody> }>;
  roleChanges: Array<{ op: 'add' | 'remove'; userId: string; roleId: string }>;
  deletedChannels: string[];
  deletedMessages: Array<{ channelId: string; messageId: string }>;
  threads: Array<{ channelId: string; messageId: string; name: string }>;
  failNextSend?: Error;
}

/** In-memory DiscordPort that records every side effect for assertions. */
export function fakeDiscord(overrides: Partial<DiscordPort> = {}): FakeDiscord {
  let n = 0;
  const id = () => `9${String(++n).padStart(17, '0')}`;
  const fake: FakeDiscord = {
    sent: [],
    dms: [],
    edits: [],
    roleChanges: [],
    deletedChannels: [],
    deletedMessages: [],
    threads: [],
    async sendMessage(channelId, body) {
      if (fake.failNextSend) {
        const e = fake.failNextSend;
        fake.failNextSend = undefined;
        throw e;
      }
      fake.sent.push({ channelId, body });
      return { id: id() };
    },
    async editMessage(channelId, messageId, body) {
      fake.edits.push({ channelId, messageId, body });
    },
    async sendDm(userId, body) {
      fake.dms.push({ userId, body });
      return { id: id() };
    },
    async getGuild(guildId) {
      return { id: guildId, name: 'Test', ownerId: '100000000000000000', memberCount: 100 };
    },
    async getMember(_g, userId) {
      return { userId, roles: [], joinedAt: new Date(0).toISOString(), username: 'member', avatar: null };
    },
    async listRoles() {
      return [];
    },
    async listChannels() {
      return [];
    },
    async addRole(_g, userId, roleId) {
      fake.roleChanges.push({ op: 'add', userId, roleId });
    },
    async removeRole(_g, userId, roleId) {
      fake.roleChanges.push({ op: 'remove', userId, roleId });
    },
    async createInvite() {
      return { code: `inv${id()}` };
    },
    async listInvites() {
      return [];
    },
    async deleteChannel(channelId) {
      fake.deletedChannels.push(channelId);
    },
    async deleteMessage(channelId, messageId) {
      fake.deletedMessages.push({ channelId, messageId });
    },
    async startThread(channelId, messageId, name) {
      fake.threads.push({ channelId, messageId, name });
      return { id: id() };
    },
    ...overrides,
  };
  return fake;
}

export const silentLog = createLogger('test', 'silent');

export function testDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps & { discord: FakeDiscord } {
  return {
    db: testDb(),
    log: silentLog,
    now: () => new Date(),
    rateLimiter: new MemoryRateLimiter(),
    discord: fakeDiscord(),
    encryptionKey: 'a'.repeat(64),
    dashboardUrl: 'https://dash.test',
    linkSigningSecret: 'test-link-secret-test-link-secret',
    ...overrides,
  } as ServiceDeps & { discord: FakeDiscord };
}

/** Build a Ctx for a user with exactly the given permissions (or 'all'). */
export function ctxAs(
  guildId: string,
  perms: PermissionKey[] | 'all' = [],
  opts: { userId?: string; deps?: ServiceDeps; roleIds?: string[] } = {},
): Ctx {
  const actor: Actor = {
    userId: opts.userId ?? snowflake(),
    roleIds: opts.roleIds ?? [],
    permissions: new Set(perms === 'all' ? ALL_PERMISSIONS : perms),
    isSystem: false,
    source: 'bot',
  };
  return makeCtx(opts.deps ?? testDeps(), guildId, actor, 'test');
}

/** Run `tick` until no more jobs are claimed (each tick claims at most 10). */
export async function drainJobs(
  runner: { tick(now?: Date): Promise<number> },
  now?: Date,
  maxTicks = 50,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if ((await runner.tick(now)) === 0) return;
  }
}
