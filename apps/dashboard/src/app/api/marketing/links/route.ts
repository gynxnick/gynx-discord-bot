import { apiRoute } from '@/server/api';
import { createTrackedLink, listTrackedLinks } from '../_lib/links';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/links (announcements.create — see the note in _lib/links.ts). */
export const GET = apiRoute(listTrackedLinks.opts, listTrackedLinks.handler);
/** POST /api/marketing/links (announcements.create). */
export const POST = apiRoute(createTrackedLink.opts, createTrackedLink.handler);
