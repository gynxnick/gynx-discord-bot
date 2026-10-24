import { apiRoute } from '@/server/api';
import { getAnnouncementAnalytics } from '../../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/announcements/:id/analytics (announcements.create). */
export const GET = apiRoute(getAnnouncementAnalytics.opts, getAnnouncementAnalytics.handler);
