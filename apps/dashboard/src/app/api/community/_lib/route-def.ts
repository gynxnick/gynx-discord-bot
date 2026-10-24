import type { z, ZodTypeAny } from 'zod';
import type { ApiHandler, ApiOptions } from '../../../../server/api-core';

/**
 * A route definition: `apiRoute` options + handler, kept framework-free so
 * the same object is bound in `route.ts` (`apiRoute(def.opts, def.handler)`)
 * and exercised directly by integration tests through `executeApi`.
 * Relative imports only (no `@/` alias, no `server-only`) for that reason.
 */
export interface RouteDef<S extends ZodTypeAny | undefined> {
  opts: ApiOptions<S>;
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>;
}

export function defineRoute<S extends ZodTypeAny | undefined = undefined>(
  opts: ApiOptions<S>,
  handler: RouteDef<S>['handler'],
): RouteDef<S> {
  return { opts, handler };
}
