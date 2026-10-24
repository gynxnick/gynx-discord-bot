import { apiRoute } from '@/server/api';
import { handlers } from '../_handlers';

export const dynamic = 'force-dynamic';

/** GET /api/analytics/overview?range=7d|30d|90d|custom&start=YYYY-MM-DD&end=YYYY-MM-DD (analytics.view). */
export const GET = apiRoute(handlers.overview.opts, handlers.overview.handler);
