import { apiRoute } from '@/server/api';
import { getConfigRoute, updateConfigRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(getConfigRoute.opts, getConfigRoute.handler);
export const PATCH = apiRoute(updateConfigRoute.opts, updateConfigRoute.handler);
