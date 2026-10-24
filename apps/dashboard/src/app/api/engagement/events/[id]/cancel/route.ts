import { apiRoute } from '@/server/api';
import { cancelEvent } from '../../../_lib/events';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/events/:id/cancel (events.manage). */
export const POST = apiRoute(cancelEvent.opts, cancelEvent.handler);
