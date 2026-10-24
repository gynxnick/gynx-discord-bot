import { apiRoute } from '@/server/api';
import { listEventAttendees } from '../../../_lib/events';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/events/:id/attendees (events.manage). */
export const GET = apiRoute(listEventAttendees.opts, listEventAttendees.handler);
