import { apiRoute } from '@/server/api';
import { deleteAnnouncement, getAnnouncement, updateAnnouncement } from '../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/announcements/:id (announcements.create). */
export const GET = apiRoute(getAnnouncement.opts, getAnnouncement.handler);
/** PATCH /api/marketing/announcements/:id (announcements.create; scheduled ones also need announcements.publish). */
export const PATCH = apiRoute(updateAnnouncement.opts, updateAnnouncement.handler);
/** DELETE /api/marketing/announcements/:id (announcements.create). */
export const DELETE = apiRoute(deleteAnnouncement.opts, deleteAnnouncement.handler);
