import { apiRoute } from '@/server/api';
import { publishAnnouncement } from '../../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** POST /api/marketing/announcements/:id/publish (announcements.publish; mentions also need announcements.mass_mention). */
export const POST = apiRoute(publishAnnouncement.opts, publishAnnouncement.handler);
