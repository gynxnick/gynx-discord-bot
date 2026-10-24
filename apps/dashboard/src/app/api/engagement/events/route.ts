import { apiRoute } from '@/server/api';
import { createEvent, listEvents } from '../_lib/events';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/events (events.manage). */
export const GET = apiRoute(listEvents.opts, listEvents.handler);
/** POST /api/engagement/events (events.manage). */
export const POST = apiRoute(createEvent.opts, createEvent.handler);
