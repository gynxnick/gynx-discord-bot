import { connect, isIP } from 'node:net';
import { z } from 'zod';
import {
  AppError,
  isAppError,
  isValidPort,
  resolveSafeTarget,
  type SafeTarget,
  type SafeTargetOptions,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { getGame } from './registry';
import { emptyInfo, type GameServerInfo } from './types';

/**
 * Live network checks (server queries, /portcheck).
 *
 * Safety model:
 *  - Only hosts under PORTCHECK_ALLOWED_SUFFIXES (authorized GYNX endpoints) may be
 *    contacted. An empty list disables every live check.
 *  - Every target goes through `resolveSafeTarget` (blocks private/reserved ranges)
 *    and we connect to the pinned address only (no re-resolution → no DNS rebinding).
 *  - Strict timeouts, per-user rate limits, and output never contains resolved IPs.
 *  - The bot only reads public query data; it never controls a game server.
 */

export interface LiveNetOptions {
  /** Parsed from env PORTCHECK_ALLOWED_SUFFIXES (see `parseAllowedSuffixes`). */
  allowedSuffixes: readonly string[];
  /** Tests only: injectable DNS resolver. */
  resolver?: SafeTargetOptions['resolver'];
  /** Tests only: permit loopback targets for fake local servers. Never set in production code. */
  allowPrivate?: boolean;
  /** Total time budget for a query (default 5 s). */
  timeoutMs?: number;
}

export const LIVE_DISABLED_MESSAGE =
  'Live server checks are disabled: no authorized GYNX endpoints are configured on this bot (PORTCHECK_ALLOWED_SUFFIXES).';

export function parseAllowedSuffixes(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, ''))
    .filter((s) => s.length > 0);
}

export const liveChecksEnabled = (opts: Pick<LiveNetOptions, 'allowedSuffixes'>) =>
  opts.allowedSuffixes.length > 0;

/** Authorize + resolve + pin. Throws INVALID_STATE when live checks are disabled. */
export async function resolveGameTarget(host: string, opts: LiveNetOptions): Promise<SafeTarget> {
  if (!liveChecksEnabled(opts)) throw new AppError('INVALID_STATE', LIVE_DISABLED_MESSAGE);
  return resolveSafeTarget(host, {
    allowedSuffixes: [...opts.allowedSuffixes],
    resolver: opts.resolver,
    allowPrivate: opts.allowPrivate,
  });
}

/** Host for logs/audit: never store an IP literal. */
const safeHostLabel = (host: string) =>
  isIP(host.trim()) ? '[IP]' : host.trim().toLowerCase().slice(0, 253);

const hostSchema = z.string().trim().min(1).max(253);
const portSchema = z.coerce.number().int().refine(isValidPort, 'Port must be between 1 and 65535.');

export const queryServerSchema = z.object({
  game: z.string().trim().min(1).max(40),
  host: hostSchema,
  port: portSchema.optional(),
});

export interface ServerQueryResult {
  gameId: string;
  gameName: string;
  /** Hostname only — never the resolved IP. */
  hostname: string;
  info: GameServerInfo;
}

/** Query a game server's public status (players, version, MOTD). */
export async function queryServer(
  ctx: Ctx,
  raw: z.input<typeof queryServerSchema>,
  opts: LiveNetOptions,
): Promise<ServerQueryResult> {
  await requireModule(ctx, 'games');
  const input = queryServerSchema.parse(raw);
  const game = getGame(input.game);
  if (!liveChecksEnabled(opts)) throw new AppError('INVALID_STATE', LIVE_DISABLED_MESSAGE);
  await requireRate(ctx, 'games.query', 5, 60);
  const target = await resolveGameTarget(input.host, opts);
  const ports = game.queryPorts(input.port);
  const firstPort = ports[0] ?? game.defaultPort;
  const base = { gameId: game.id, gameName: game.name, hostname: target.hostname };

  if (!game.query || game.queryProtocol === 'none') {
    return {
      ...base,
      info: emptyInfo(firstPort, `${game.name} has no public query protocol, so live data is unavailable.`),
    };
  }
  const budget = opts.timeoutMs ?? 5000;
  const perAttempt = Math.max(1000, Math.floor(budget / ports.length));
  let lastError: unknown;
  for (const port of ports) {
    try {
      const info = await game.query(target.address, port, {
        hostname: target.hostname,
        family: target.family,
        timeoutMs: perAttempt,
      });
      return { ...base, info };
    } catch (e) {
      lastError = e;
    }
  }
  ctx.log.debug(
    { game: game.id, host: target.hostname, err: isAppError(lastError) ? lastError.message : 'error' },
    'game query failed',
  );
  return {
    ...base,
    info: emptyInfo(
      firstPort,
      'The server did not answer the status query. It may be offline, starting up, or have queries disabled.',
    ),
  };
}

export type PortCheckResult = 'open' | 'closed' | 'timeout' | 'unreachable';

/** Low-level TCP connect probe to a pinned address. */
export function tcpProbe(
  address: string,
  port: number,
  timeoutMs = 3000,
  family?: 4 | 6,
): Promise<{ result: PortCheckResult; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect({ host: address, port, family });
    let done = false;
    const finish = (result: PortCheckResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ result, latencyMs: result === 'open' ? Date.now() - started : null });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    socket.once('connect', () => finish('open'));
    socket.on('error', (err: NodeJS.ErrnoException) =>
      finish(err.code === 'ECONNREFUSED' ? 'closed' : 'unreachable'),
    );
  });
}

export const portCheckSchema = z.object({ host: hostSchema, port: portSchema });

export interface PortCheckOutcome {
  hostname: string;
  port: number;
  result: PortCheckResult;
  latencyMs: number | null;
}

/**
 * TCP reachability test from the bot's network to an authorized endpoint.
 * Rate-limited (3 per 5 min per user) and audited (hostname only, never IPs).
 */
export async function portCheck(
  ctx: Ctx,
  raw: z.input<typeof portCheckSchema>,
  opts: LiveNetOptions,
): Promise<PortCheckOutcome> {
  await requireModule(ctx, 'games');
  const input = portCheckSchema.parse(raw);
  if (!liveChecksEnabled(opts)) throw new AppError('INVALID_STATE', LIVE_DISABLED_MESSAGE);
  await requireRate(ctx, 'games.portcheck', 3, 300);

  let target: SafeTarget;
  try {
    target = await resolveGameTarget(input.host, opts);
  } catch (e) {
    await audit(ctx, {
      action: 'games.portcheck',
      result: 'DENIED',
      metadata: {
        host: safeHostLabel(input.host),
        port: input.port,
        reason: isAppError(e) ? e.code : 'error',
      },
    });
    throw e;
  }
  const probe = await tcpProbe(target.address, input.port, 3000, target.family);
  await audit(ctx, {
    action: 'games.portcheck',
    targetType: 'Host',
    targetId: target.hostname,
    metadata: { host: target.hostname, port: input.port, result: probe.result, latencyMs: probe.latencyMs },
  });
  return { hostname: target.hostname, port: input.port, ...probe };
}
