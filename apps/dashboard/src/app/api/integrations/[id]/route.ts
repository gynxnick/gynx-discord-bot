import { apiRoute } from '@/server/api';
import { integrationHandlers as h } from '../handlers';

export const dynamic = 'force-dynamic';

/** DELETE /api/integrations/:id (settings.manage). */
export const DELETE = apiRoute(h.remove.opts, h.remove.handler);
