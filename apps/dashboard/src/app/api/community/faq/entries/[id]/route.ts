import { apiRoute } from '@/server/api';
import { deleteFaqEntry, updateFaqEntry } from '../../../_lib/handlers';

export const dynamic = 'force-dynamic';

/** PATCH /api/community/faq/entries/:id (community.manage). */
export const PATCH = apiRoute(updateFaqEntry.opts, updateFaqEntry.handler);
/** DELETE /api/community/faq/entries/:id (community.manage). */
export const DELETE = apiRoute(deleteFaqEntry.opts, deleteFaqEntry.handler);
