import { apiRoute } from '@/server/api';
import { handlers } from '../_handlers';

export const dynamic = 'force-dynamic';

/** GET /api/analytics/staff?range=… — per-staff activity counts (analytics.view). */
export const GET = apiRoute(handlers.staff.opts, handlers.staff.handler);
