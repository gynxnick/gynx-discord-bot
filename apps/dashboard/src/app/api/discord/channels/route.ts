import { apiRoute } from '@/server/api';
import { listChannelsRoute } from './handlers';

export const dynamic = 'force-dynamic';

/** GET /api/discord/channels (dashboard.access). */
export const GET = apiRoute(listChannelsRoute.opts, listChannelsRoute.handler);
