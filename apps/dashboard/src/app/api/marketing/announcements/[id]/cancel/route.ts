import { apiRoute } from '@/server/api';
import { cancelAnnouncement } from '../../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** POST /api/marketing/announcements/:id/cancel (announcements.publish). */
export const POST = apiRoute(cancelAnnouncement.opts, cancelAnnouncement.handler);
