import { apiRoute } from '@/server/api';
import { createFaqCategory } from '../../_lib/handlers';

export const dynamic = 'force-dynamic';

/** POST /api/community/faq/categories (community.manage). */
export const POST = apiRoute(createFaqCategory.opts, createFaqCategory.handler);
