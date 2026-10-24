import { z, type ZodTypeAny } from 'zod';
import { analytics, getGuildConfig, type Ctx } from '@gynx/services';
import { validation } from '@gynx/shared';
import { attachmentDisposition } from '../../../components/analytics/format';
import {
  periodQuerySchema,
  resolvePeriod,
  type PeriodQuery,
  type ResolvedRange,
} from '../../../components/analytics/period';
import type { ApiHandler, ApiOptions } from '../../../server/api-core';

/**
 * Analytics API handler specs, bound to Next.js routes with `apiRoute(spec.opts, spec.handler)`.
 * Kept free of `@/` aliases and `server-only` so integration tests can drive them through `executeApi`.
 */

function spec<S extends ZodTypeAny | undefined = undefined>(
  opts: ApiOptions<S>,
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>,
) {
  return { opts, handler };
}

/** Resolve ?range/start/end (custom dates in the guild timezone); invalid input → 400. */
async function rangeFromQuery(ctx: Ctx, q: PeriodQuery): Promise<ResolvedRange> {
  const cfg = await getGuildConfig(ctx.db, ctx.guildId);
  const sel = resolvePeriod(q, cfg.timezone);
  if (sel.error) throw validation(sel.error.replace(/ Showing the last 7 days\.$/, ''));
  return sel.range;
}

const exportSchema = z.object({ format: z.enum(analytics.EXPORT_FORMATS) });

export const handlers = {
  /** GET /api/analytics/overview?range=7d|30d|90d|custom&start&end (analytics.view). */
  overview: spec({ permission: 'analytics.view', schema: periodQuerySchema }, async ({ ctx, input }) =>
    analytics.getOverview(ctx, await rangeFromQuery(ctx, input)),
  ),

  /** GET /api/analytics/staff?range=… (analytics.view). */
  staff: spec({ permission: 'analytics.view', schema: periodQuerySchema }, async ({ ctx, input }) =>
    analytics.staffStats(ctx, await rangeFromQuery(ctx, input)),
  ),

  /** GET /api/analytics/reports (analytics.view). */
  listReports: spec(
    { permission: 'analytics.view', schema: analytics.listReportsSchema },
    async ({ ctx, input }) => analytics.listReports(ctx, input),
  ),

  /** GET /api/analytics/reports/:id (analytics.view). */
  getReport: spec({ permission: 'analytics.view' }, async ({ ctx, params }) =>
    analytics.getReport(ctx, params.id ?? ''),
  ),

  /** GET /api/analytics/reports/:id/export?format=markdown|json|csv (analytics.export) → file download; audited by the service. */
  exportReport: spec(
    {
      permission: 'analytics.export',
      schema: exportSchema,
      rateLimit: { limit: 20, windowSeconds: 60, key: 'analytics-export' },
    },
    async ({ ctx, input, params }) => {
      const file = await analytics.exportReport(ctx, params.id ?? '', input.format);
      return new Response(file.content, {
        status: 200,
        headers: {
          'content-type': file.contentType,
          'content-disposition': attachmentDisposition(file.filename),
          'x-content-type-options': 'nosniff',
        },
      });
    },
  ),

  /** POST /api/analytics/reports/:id/retry (settings.manage). */
  retryDelivery: spec({ permission: 'settings.manage', mutation: true }, async ({ ctx, params }) => {
    await analytics.retryReportDelivery(ctx, params.id ?? '');
    return { ok: true };
  }),

  /** GET /api/analytics/definitions (analytics.view). */
  listDefinitions: spec({ permission: 'analytics.view' }, async ({ ctx }) => ({
    definitions: await analytics.listReportDefinitions(ctx),
  })),

  /** POST /api/analytics/definitions (settings.manage). */
  createDefinition: spec(
    { permission: 'settings.manage', schema: analytics.reportDefinitionSchema },
    async ({ ctx, input }) => ({
      definition: await analytics.createReportDefinition(ctx, input),
    }),
  ),

  /** PATCH /api/analytics/definitions/:id (settings.manage). */
  updateDefinition: spec(
    { permission: 'settings.manage', schema: analytics.reportDefinitionPatchSchema },
    async ({ ctx, input, params }) => ({
      definition: await analytics.updateReportDefinition(ctx, params.id ?? '', input),
    }),
  ),

  /** DELETE /api/analytics/definitions/:id (settings.manage). Reports generated from it are deleted with it. */
  deleteDefinition: spec({ permission: 'settings.manage' }, async ({ ctx, params }) => {
    await analytics.deleteReportDefinition(ctx, params.id ?? '');
    return { ok: true };
  }),
};
