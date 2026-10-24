import { apiRoute } from '@/server/api';
import { handlers } from '../../_handlers';

export const dynamic = 'force-dynamic';

/** GET /api/analytics/reports/:id — report incl. Markdown and data (analytics.view). */
export const GET = apiRoute(handlers.getReport.opts, handlers.getReport.handler);
