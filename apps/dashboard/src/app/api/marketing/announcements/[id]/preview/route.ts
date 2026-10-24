import { apiRoute } from '@/server/api';
import { previewAnnouncement } from '../../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/announcements/:id/preview (announcements.publish). */
export const GET = apiRoute(previewAnnouncement.opts, previewAnnouncement.handler);
