import { security } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** POST /api/security/reports/:id/status { status, resolution? } (security.reports.manage). */
export const POST = apiRoute(
  { permission: 'security.reports.manage', schema: security.updateStatusSchema },
  async ({ ctx, params, input }) => security.updateReportStatus(ctx, params.id ?? '', input),
);
