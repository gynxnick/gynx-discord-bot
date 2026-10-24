import { apiRoute } from '@/server/api';
import { handlers } from '../../../_handlers';

export const dynamic = 'force-dynamic';

/** GET /api/analytics/reports/:id/export?format=markdown|json|csv — attachment download (analytics.export, audited). */
export const GET = apiRoute(handlers.exportReport.opts, handlers.exportReport.handler);
