import { apiRoute } from '@/server/api';
import { createFaqEntry, listFaqEntries } from '../../_lib/handlers';

export const dynamic = 'force-dynamic';

/** GET /api/community/faq/entries (community.manage; includes drafts). */
export const GET = apiRoute(listFaqEntries.opts, listFaqEntries.handler);
/** POST /api/community/faq/entries (community.manage). */
export const POST = apiRoute(createFaqEntry.opts, createFaqEntry.handler);
