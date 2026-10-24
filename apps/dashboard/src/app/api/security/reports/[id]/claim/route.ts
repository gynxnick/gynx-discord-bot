import { security } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** POST /api/security/reports/:id/claim (security.reports.manage). */
export const POST = apiRoute({ permission: 'security.reports.manage' }, async ({ ctx, params }) =>
  security.claimReport(ctx, params.id ?? ''),
);
