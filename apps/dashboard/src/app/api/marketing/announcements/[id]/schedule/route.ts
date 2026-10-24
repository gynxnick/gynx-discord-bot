import { apiRoute } from '@/server/api';
import { scheduleAnnouncement } from '../../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** POST /api/marketing/announcements/:id/schedule (announcements.publish; mentions also need announcements.mass_mention). */
export const POST = apiRoute(scheduleAnnouncement.opts, scheduleAnnouncement.handler);
