import { apiRoute } from '@/server/api';
import { handlers } from '../../_handlers';

export const dynamic = 'force-dynamic';

/** PATCH / DELETE /api/analytics/definitions/:id (settings.manage). */
export const PATCH = apiRoute(handlers.updateDefinition.opts, handlers.updateDefinition.handler);
export const DELETE = apiRoute(handlers.deleteDefinition.opts, handlers.deleteDefinition.handler);
