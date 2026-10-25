import { createHash, randomBytes } from 'node:crypto';
import type { Logger } from '@gynx/config';
import type { DashboardSession, PrismaClient } from '@gynx/database';
import { isPermissionKey, type PermissionKey } from '@gynx/permissions';
import { resolveActor, type Actor, type DiscordPort } from '@gynx/services';

/**
 * Server-side dashboard sessions (framework-free so they can be integration
 * tested). The browser holds an opaque random token; the database stores only
 * its SHA-256 hash, so a database leak does not yield usable sessions.
 */

export const PERMS_REFRESH_MS = 5 * 60_000;
/** If Discord is unreachable, cached permissions are trusted at most this long. */
export const PERMS_MAX_STALE_MS = 30 * 60_000;
const LAST_SEEN_THROTTLE_MS = 60_000;

export interface SessionStoreDeps {
  db: PrismaClient;
  discord: DiscordPort;
  log: Logger;
  now: () => Date;
}

export interface SessionInfo {
  id: string;
  userId: string;
  guildId: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
  permissions: ReadonlySet<PermissionKey>;
  csrfToken: string;
  expiresAt: Date;
}

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const toPermSet = (keys: readonly string[]): Set<PermissionKey> => new Set(keys.filter(isPermissionKey));

export function toSessionInfo(row: DashboardSession): SessionInfo {
  return {
    id: row.id,
    userId: row.userId,
    guildId: row.guildId,
    username: row.username,
    avatar: row.avatar,
    roleIds: row.roleIds,
    permissions: toPermSet(row.permissions),
    csrfToken: row.csrfToken,
    expiresAt: row.expiresAt,
  };
}

export interface CreateSessionInput {
  userId: string;
  guildId: string;
  username: string;
  avatar: string | null;
  roleIds: readonly string[];
  permissions: Iterable<PermissionKey>;
  ttlHours: number;
  userAgent?: string | null;
}

export async function createSession(
  db: PrismaClient,
  input: CreateSessionInput,
  now: Date,
): Promise<{ token: string; session: SessionInfo }> {
  const token = randomBytes(32).toString('base64url');
  const row = await db.dashboardSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      csrfToken: randomBytes(32).toString('base64url'),
      userId: input.userId,
      guildId: input.guildId,
      username: input.username.slice(0, 100),
      avatar: input.avatar,
      roleIds: [...input.roleIds],
      permissions: [...input.permissions],
      permsRefreshedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + input.ttlHours * 3_600_000),
      userAgent: input.userAgent ? input.userAgent.slice(0, 256) : null,
    },
  });
  return { token, session: toSessionInfo(row) };
}

export async function revokeSession(db: PrismaClient, sessionId: string, now: Date): Promise<void> {
  await db.dashboardSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Revoke all of a user's sessions (e.g. after losing access). */
export async function revokeUserSessions(
  db: PrismaClient,
  guildId: string,
  userId: string,
  now: Date,
): Promise<number> {
  const r = await db.dashboardSession.updateMany({
    where: { guildId, userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return r.count;
}

export interface MemberAuthorization {
  ok: true;
  actor: Actor;
  username: string;
  avatar: string | null;
  roleIds: string[];
  guildName: string;
}
/**
 * `unavailable` means the dashboard itself can't check right now. It never revokes
 * an existing session; `detail` explains why so admins see an actionable message.
 */
export type AuthorizationFailure =
  | { ok: false; reason: 'not_member' | 'no_access' }
  | { ok: false; reason: 'unavailable'; detail?: 'bot_missing' | 'bot_token' };

const httpStatusOf = (e: unknown): number | undefined =>
  typeof e === 'object' &&
  e !== null &&
  'status' in e &&
  typeof (e as { status: unknown }).status === 'number'
    ? (e as { status: number }).status
    : undefined;

/**
 * Decide whether a Discord user may use the dashboard: they must be a member of
 * the configured guild and resolve to `dashboard.access` through StaffPermission
 * grants (the guild owner always has every permission).
 */
export async function authorizeMember(
  deps: Pick<SessionStoreDeps, 'db' | 'discord'>,
  guildId: string,
  userId: string,
  fallbackName: string,
): Promise<MemberAuthorization | AuthorizationFailure> {
  let guild: Awaited<ReturnType<DiscordPort['getGuild']>>;
  let member: Awaited<ReturnType<DiscordPort['getMember']>>;
  try {
    [guild, member] = await Promise.all([
      deps.discord.getGuild(guildId),
      deps.discord.getMember(guildId, userId),
    ]);
  } catch (err) {
    const status = httpStatusOf(err);
    // 401: the bot token is invalid. 403 Missing Access: the bot isn't in the guild.
    if (status === 401) return { ok: false, reason: 'unavailable', detail: 'bot_token' };
    if (status === 403) return { ok: false, reason: 'unavailable', detail: 'bot_missing' };
    return { ok: false, reason: 'unavailable' };
  }
  if (!guild) return { ok: false, reason: 'unavailable', detail: 'bot_missing' };
  if (!member) return { ok: false, reason: 'not_member' };
  const roleIds = member.roles.filter((r) => r !== guildId);
  const actor = await resolveActor(deps.db, guildId, {
    userId,
    roleIds,
    isGuildOwner: guild.ownerId === userId,
    source: 'dashboard',
    displayName: member.username || fallbackName,
  });
  if (!actor.permissions.has('dashboard.access')) return { ok: false, reason: 'no_access' };
  return {
    ok: true,
    actor,
    username: member.username || fallbackName,
    avatar: member.avatar,
    roleIds,
    guildName: guild.name,
  };
}

export type SessionLookup =
  | { ok: true; session: SessionInfo }
  | {
      ok: false;
      reason: 'missing' | 'not_found' | 'expired' | 'revoked' | 'wrong_guild' | 'access_lost' | 'stale';
    };

/**
 * Resolve a raw session token into a live session:
 *  - looks up by token hash; rejects expired/revoked sessions and other guilds
 *  - throttles `lastSeenAt` writes
 *  - every 5 minutes re-reads the member's roles from Discord and re-resolves
 *    permissions; a member who left the guild or lost `dashboard.access` has the
 *    session revoked immediately.
 */
export async function loadSession(
  deps: SessionStoreDeps,
  guildId: string,
  token: string | undefined | null,
): Promise<SessionLookup> {
  if (!token || token.length < 20 || token.length > 200) return { ok: false, reason: 'missing' };
  const now = deps.now();
  const row = await deps.db.dashboardSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.guildId !== guildId) return { ok: false, reason: 'wrong_guild' };

  let current = row;
  const stale = now.getTime() - row.permsRefreshedAt.getTime();
  if (stale >= PERMS_REFRESH_MS) {
    let auth: MemberAuthorization | AuthorizationFailure;
    try {
      auth = await authorizeMember(deps, guildId, row.userId, row.username);
    } catch (err) {
      deps.log.warn(
        { err: { message: (err as Error).message }, sessionId: row.id },
        'session permission refresh failed',
      );
      auth = { ok: false, reason: 'unavailable' };
    }
    if (!auth.ok && auth.reason !== 'unavailable') {
      await revokeSession(deps.db, row.id, now);
      deps.log.info(
        { sessionId: row.id, userId: row.userId, reason: auth.reason },
        'dashboard session revoked on refresh',
      );
      return { ok: false, reason: 'access_lost' };
    }
    if (!auth.ok) {
      // Discord temporarily unavailable: keep cached permissions for a bounded time.
      if (stale >= PERMS_MAX_STALE_MS) return { ok: false, reason: 'stale' };
    } else {
      current = await deps.db.dashboardSession.update({
        where: { id: row.id },
        data: {
          roleIds: auth.roleIds,
          permissions: [...auth.actor.permissions],
          username: auth.username.slice(0, 100),
          avatar: auth.avatar,
          permsRefreshedAt: now,
          lastSeenAt: now,
        },
      });
      return { ok: true, session: toSessionInfo(current) };
    }
  }

  if (now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS) {
    await deps.db.dashboardSession
      .update({ where: { id: row.id }, data: { lastSeenAt: now } })
      .catch(() => undefined);
  }
  return { ok: true, session: toSessionInfo(current) };
}

/** Housekeeping: delete sessions that expired or were revoked more than `graceDays` ago. */
export async function purgeOldSessions(db: PrismaClient, now: Date, graceDays = 7): Promise<number> {
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000);
  const r = await db.dashboardSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return r.count;
}
