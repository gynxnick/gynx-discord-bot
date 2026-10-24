import { apiRoute } from '@/server/api';
import { integrationHandlers as h } from './handlers';

export const dynamic = 'force-dynamic';

/** GET /api/integrations?kind= — integration configs without secrets (settings.manage). */
export const GET = apiRoute(h.list.opts, h.list.handler);
/** POST /api/integrations — upsert by (kind, name); secret is write-only (settings.manage). */
export const POST = apiRoute(h.upsert.opts, h.upsert.handler);
