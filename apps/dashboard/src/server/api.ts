import 'server-only';
import type { z, ZodTypeAny } from 'zod';
import { errorResponse, executeApi, type ApiHandler, type ApiOptions } from './api-core';
import { getDeps, getLogger } from './deps';
import { dashboardOrigin, getEnv } from './env';

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

/**
 * Wrap a Next.js route handler with session auth, CSRF/origin checks for
 * mutations, permission enforcement (audited), per-session rate limiting, Zod
 * validation and safe error mapping. Responses are same-origin only (no CORS headers).
 *
 *   export const POST = apiRoute({ permission: 'security.reports.manage', schema }, async ({ ctx, input }) => …);
 */
export function apiRoute<S extends ZodTypeAny | undefined = undefined>(
  opts: ApiOptions<S>,
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>,
) {
  return async (req: Request, route?: RouteContext): Promise<Response> => {
    let rt;
    try {
      const env = getEnv();
      rt = { deps: getDeps(), guildId: env.DISCORD_GUILD_ID, dashboardOrigin: dashboardOrigin() };
    } catch (err) {
      getLogger().error({ err: { message: (err as Error).message } }, 'dashboard misconfigured');
      return errorResponse(500, 'CONFIG', 'The dashboard is not configured correctly.', 'config');
    }
    const rawParams = route ? await route.params : {};
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams ?? {})) if (typeof v === 'string') params[k] = v;
    return executeApi(opts, handler, req, params, rt);
  };
}
