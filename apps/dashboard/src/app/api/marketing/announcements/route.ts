import { apiRoute } from '@/server/api';
import { createAnnouncement, listAnnouncements } from '../_lib/announcements';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/announcements (announcements.create). */
export const GET = apiRoute(listAnnouncements.opts, listAnnouncements.handler);
/** POST /api/marketing/announcements (announcements.create). */
export const POST = apiRoute(createAnnouncement.opts, createAnnouncement.handler);
