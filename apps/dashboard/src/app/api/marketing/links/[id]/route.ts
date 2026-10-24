import { apiRoute } from '@/server/api';
import { setTrackedLinkActive } from '../../_lib/links';

export const dynamic = 'force-dynamic';

/** PATCH /api/marketing/links/:id `{ active }` (announcements.create). */
export const PATCH = apiRoute(setTrackedLinkActive.opts, setTrackedLinkActive.handler);
