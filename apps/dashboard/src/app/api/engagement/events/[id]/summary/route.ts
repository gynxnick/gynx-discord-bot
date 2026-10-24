import { apiRoute } from '@/server/api';
import { postEventSummary } from '../../../_lib/events';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/events/:id/summary (events.manage). */
export const POST = apiRoute(postEventSummary.opts, postEventSummary.handler);
