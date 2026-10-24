import type { Logger } from '@gynx/config';
import type { PrismaClient } from '@gynx/database';
import { ALL_PERMISSIONS, type PermissionKey } from '@gynx/permissions';
import { MemoryRateLimiter, type RateLimiter } from '@gynx/shared';
import type { DiscordPort } from './discord-port';

/**
 * Who is performing an operation. Permissions are resolved once per request /
 * interaction (see `resolveActor`) and every service re-checks them — the
 * dashboard UI or Discord command visibility is never trusted.
 */
export interface Actor {
  userId: string;
  roleIds: readonly string[];
  permissions: ReadonlySet<PermissionKey>;
  isSystem: boolean;
  source: 'bot' | 'dashboard' | 'worker';
  displayName?: string;
}

export interface ServiceDeps {
  db: PrismaClient;
  log: Logger;
  now: () => Date;
  rateLimiter: RateLimiter;
  /** Optional: only processes that talk to Discord provide it. */
  discord?: DiscordPort;
  /** 64-hex AES key for integration secrets. */
  encryptionKey?: string;
  /** Public dashboard base URL, used for authenticated links (transcripts, reports). */
  dashboardUrl?: string;
  /** Secret used to sign short-lived links. */
  linkSigningSecret?: string;
}

export interface Ctx extends ServiceDeps {
  guildId: string;
  actor: Actor;
  correlationId?: string;
}

export function systemActor(source: Actor['source'] = 'worker'): Actor {
  return {
    userId: 'system',
    roleIds: [],
    permissions: new Set(ALL_PERMISSIONS),
    isSystem: true,
    source,
    displayName: 'GYNX System',
  };
}

export function memberActor(userId: string, roleIds: readonly string[] = [], source: Actor['source'] = 'bot'): Actor {
  return { userId, roleIds, permissions: new Set(), isSystem: false, source };
}

export function makeCtx(deps: ServiceDeps, guildId: string, actor: Actor, correlationId?: string): Ctx {
  return { ...deps, guildId, actor, correlationId };
}

export const defaultRateLimiter = (): RateLimiter => new MemoryRateLimiter();
