import { apiRoute } from '@/server/api';
import { handlers } from '../_handlers';

export const dynamic = 'force-dynamic';

/** GET (analytics.view) / POST (settings.manage) /api/analytics/definitions — report schedules. */
export const GET = apiRoute(handlers.listDefinitions.opts, handlers.listDefinitions.handler);
export const POST = apiRoute(handlers.createDefinition.opts, handlers.createDefinition.handler);
