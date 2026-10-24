import { apiRoute } from '@/server/api';
import { deleteGuide, updateGuide } from '../../_lib/handlers';

export const dynamic = 'force-dynamic';

/** PATCH /api/community/guides/:id (community.manage). */
export const PATCH = apiRoute(updateGuide.opts, updateGuide.handler);
/** DELETE /api/community/guides/:id (community.manage). */
export const DELETE = apiRoute(deleteGuide.opts, deleteGuide.handler);
