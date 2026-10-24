import { apiRoute } from '@/server/api';
import { handlers } from '../../../_handlers';

export const dynamic = 'force-dynamic';

/** POST /api/analytics/reports/:id/retry — re-queue delivery (settings.manage). */
export const POST = apiRoute(handlers.retryDelivery.opts, handlers.retryDelivery.handler);
