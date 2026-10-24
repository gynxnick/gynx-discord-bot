import { apiRoute } from '@/server/api';
import { deleteTemplate, updateTemplate } from '../../_lib/announcements';

export const dynamic = 'force-dynamic';

/** PATCH /api/marketing/templates/:id (announcements.create). */
export const PATCH = apiRoute(updateTemplate.opts, updateTemplate.handler);
/** DELETE /api/marketing/templates/:id (announcements.create). */
export const DELETE = apiRoute(deleteTemplate.opts, deleteTemplate.handler);
