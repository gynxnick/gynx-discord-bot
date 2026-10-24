import { apiRoute } from '@/server/api';
import { updateEvent } from '../../_lib/events';

export const dynamic = 'force-dynamic';

/** PATCH /api/engagement/events/:id (events.manage; scheduled events only). */
export const PATCH = apiRoute(updateEvent.opts, updateEvent.handler);
