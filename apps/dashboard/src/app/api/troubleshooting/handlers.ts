import { z, type ZodTypeAny } from 'zod';
import { troubleshooting } from '@gynx/services';
import { paginationSchema } from '@gynx/shared';
import type { ApiHandler, ApiOptions } from '../../../server/api-core';

/**
 * Troubleshooting API handlers (troubleshooting.manage), framework-free so
 * integration tests can drive them through `executeApi`. Route files bind
 * them with apiRoute. Services re-check permissions and validate input.
 */

const define = <S extends ZodTypeAny | undefined = undefined>(
  opts: ApiOptions<S>,
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>,
) => ({ opts, handler });

const PERM = 'troubleshooting.manage' as const;

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Query-string version of the service list schema (booleans arrive as strings). */
export const articleListQuery = troubleshooting.listArticlesSchema.extend({
  published: boolParam.optional(),
});

export const flowValidateSchema = z.object({ definition: z.unknown() });

export const troubleshootingHandlers = {
  // ── Knowledge base ──
  listArticles: define({ permission: PERM, schema: articleListQuery }, async ({ ctx, input }) =>
    troubleshooting.listArticles(ctx, input),
  ),
  createArticle: define(
    { permission: PERM, schema: troubleshooting.articleInputSchema, mutation: true },
    async ({ ctx, input }) => troubleshooting.createArticle(ctx, input),
  ),
  updateArticle: define(
    { permission: PERM, schema: troubleshooting.articleUpdateSchema, mutation: true },
    async ({ ctx, params, input }) => troubleshooting.updateArticle(ctx, params.id ?? '', input),
  ),
  deleteArticle: define({ permission: PERM, mutation: true }, async ({ ctx, params }) => {
    await troubleshooting.deleteArticle(ctx, params.id ?? '');
    return { ok: true };
  }),
  seed: define(
    { permission: PERM, mutation: true, rateLimit: { limit: 5, windowSeconds: 60, key: 'kb-seed' } },
    async ({ ctx }) => troubleshooting.seedDefaultContent(ctx),
  ),

  // ── Flows ──
  listFlows: define({ permission: PERM }, async ({ ctx }) => {
    const [items, stats] = await Promise.all([
      troubleshooting.listFlows(ctx, { includeDrafts: true }),
      troubleshooting.flowStats(ctx),
    ]);
    return { items, stats };
  }),
  createFlow: define(
    { permission: PERM, schema: troubleshooting.flowInputSchema, mutation: true },
    async ({ ctx, input }) => troubleshooting.createFlow(ctx, input),
  ),
  updateFlow: define(
    { permission: PERM, schema: troubleshooting.flowUpdateSchema, mutation: true },
    async ({ ctx, params, input }) => troubleshooting.updateFlow(ctx, params.id ?? '', input),
  ),
  deleteFlow: define({ permission: PERM, mutation: true }, async ({ ctx, params }) => {
    await troubleshooting.deleteFlow(ctx, params.id ?? '');
    return { ok: true };
  }),
  /** Dry-run structural validation; returns the service's messages verbatim. */
  validateFlow: define(
    {
      permission: PERM,
      schema: flowValidateSchema,
      mutation: true,
      rateLimit: { limit: 120, windowSeconds: 60, key: 'flow-validate' },
    },
    async ({ input }) => {
      const v = troubleshooting.validateFlowDefinition(input.definition);
      return { ok: v.ok, errors: v.errors };
    },
  ),

  // ── Diagnostics (read-only) ──
  listDiagnostics: define({ permission: PERM, schema: paginationSchema }, async ({ ctx, input }) =>
    troubleshooting.listDiagnostics(ctx, input),
  ),
  getDiagnostic: define({ permission: PERM }, async ({ ctx, params }) =>
    troubleshooting.getDiagnostic(ctx, params.id ?? ''),
  ),
};
