import { security } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/security/reports — filtered, cursor-paginated list (security.reports.view). */
export const GET = apiRoute(
  { permission: 'security.reports.view', schema: security.listReportsSchema },
  async ({ ctx, input }) => security.listReports(ctx, input),
);
