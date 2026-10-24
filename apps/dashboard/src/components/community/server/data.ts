import 'server-only';
import type { Ctx } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import type { ChannelOption, RoleOption } from '../picker-utils';

/** Postable channel types: GUILD_TEXT (0) and GUILD_ANNOUNCEMENT (5). Categories (4) are kept for grouping. */
const KEEP_TYPES = new Set([0, 4, 5]);

/** Guild channels for pickers. `error` is true when Discord could not be reached (pickers fall back to ID input). */
export async function loadChannels(ctx: Ctx): Promise<{ channels: ChannelOption[]; error: boolean }> {
  if (!ctx.discord) return { channels: [], error: true };
  try {
    const rows = await ctx.discord.listChannels(ctx.guildId);
    return {
      channels: rows
        .filter((c) => KEEP_TYPES.has(c.type))
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })),
      error: false,
    };
  } catch (err) {
    ctx.log.warn({ err: { message: (err as Error).message } }, 'channel list failed');
    return { channels: [], error: true };
  }
}

/** Guild roles (highest first, without @everyone) for pickers. */
export async function loadRoles(ctx: Ctx): Promise<{ roles: RoleOption[]; error: boolean }> {
  if (!ctx.discord) return { roles: [], error: true };
  try {
    const rows = await ctx.discord.listRoles(ctx.guildId);
    return {
      roles: rows
        .filter((r) => r.id !== ctx.guildId)
        .map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed }))
        .sort((a, b) => b.position - a.position),
      error: false,
    };
  } catch (err) {
    ctx.log.warn({ err: { message: (err as Error).message } }, 'role list failed');
    return { roles: [], error: true };
  }
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/**
 * Run a service read for a page. User-safe AppErrors (module disabled, not
 * found, …) become `{ ok: false }` so the page can render an explanation;
 * anything else is rethrown to the section error boundary.
 */
export async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isAppError(e) && e.httpStatus < 500) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

/** Plain-object copy safe to pass from a server component into a client component (Dates → ISO strings). */
export function serialize<T>(value: T): Jsonify<T> {
  return JSON.parse(JSON.stringify(value)) as Jsonify<T>;
}

export type Jsonify<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Jsonify<U>>
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;
