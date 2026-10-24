import { security } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/security/reports/:id — report + notes (notes only with security.reports.manage). */
export const GET = apiRoute({ permission: 'security.reports.view' }, async ({ ctx, params }) =>
  security.getReport(ctx, params.id ?? ''),
);
