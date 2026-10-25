import { apiRoute } from '@/server/api';
import { listTextRoute, resetTextRoute, setTextRoute } from '../text-handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listTextRoute.opts, listTextRoute.handler);
export const PUT = apiRoute(setTextRoute.opts, setTextRoute.handler);
export const DELETE = apiRoute(resetTextRoute.opts, resetTextRoute.handler);
