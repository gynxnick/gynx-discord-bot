import { security } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/security/audit — audit log search (audit.view). */
export const GET = apiRoute(
  { permission: 'audit.view', schema: security.auditQuerySchema },
  async ({ ctx, input }) => security.searchAuditLog(ctx, input),
);
