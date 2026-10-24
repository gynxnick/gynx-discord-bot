import { apiRoute } from '@/server/api';
import { createTemplate, listTemplates } from '../_lib/announcements';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/templates (announcements.create). */
export const GET = apiRoute(listTemplates.opts, listTemplates.handler);
/** POST /api/marketing/templates (announcements.create). */
export const POST = apiRoute(createTemplate.opts, createTemplate.handler);
