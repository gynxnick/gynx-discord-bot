import { apiRoute } from '@/server/api';
import { deleteFaqCategory, updateFaqCategory } from '../../../_lib/handlers';

export const dynamic = 'force-dynamic';

/** PATCH /api/community/faq/categories/:id (community.manage). */
export const PATCH = apiRoute(updateFaqCategory.opts, updateFaqCategory.handler);
/** DELETE /api/community/faq/categories/:id — entries become uncategorised (community.manage). */
export const DELETE = apiRoute(deleteFaqCategory.opts, deleteFaqCategory.handler);
