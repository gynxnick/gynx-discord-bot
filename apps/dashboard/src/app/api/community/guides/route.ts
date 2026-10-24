import { apiRoute } from '@/server/api';
import { createGuide, listGuides } from '../_lib/handlers';

export const dynamic = 'force-dynamic';

/** GET /api/community/guides (community.manage; includes drafts). */
export const GET = apiRoute(listGuides.opts, listGuides.handler);
/** POST /api/community/guides (community.manage). */
export const POST = apiRoute(createGuide.opts, createGuide.handler);
