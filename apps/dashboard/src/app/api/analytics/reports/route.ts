import { apiRoute } from '@/server/api';
import { handlers } from '../_handlers';

export const dynamic = 'force-dynamic';

/** GET /api/analytics/reports — generated reports, newest first (analytics.view). */
export const GET = apiRoute(handlers.listReports.opts, handlers.listReports.handler);
