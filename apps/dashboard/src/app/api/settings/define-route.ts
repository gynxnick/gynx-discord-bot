import type { z, ZodTypeAny } from 'zod';
import type { ApiHandler, ApiOptions } from '../../../server/api-core';

/**
 * A route definition (options + handler) kept free of Next.js / `server-only`
 * imports so integration tests can run it through `executeApi` directly.
 * `route.ts` files bind it with `apiRoute(def.opts, def.handler)`.
 *
 * For routes whose service accepts ANY of several permissions, `opts.permission`
 * is `dashboard.access` and the service performs (and audits) the any-of check.
 */
export interface RouteDef<S extends ZodTypeAny | undefined> {
  opts: ApiOptions<S>;
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>;
}

export function defineRoute<S extends ZodTypeAny | undefined = undefined>(
  opts: ApiOptions<S>,
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>,
): RouteDef<S> {
  return { opts, handler };
}
