import { apiRoute } from '@/server/api';
import { getAutomodConfigRoute, updateAutomodConfigRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(getAutomodConfigRoute.opts, getAutomodConfigRoute.handler);
export const PATCH = apiRoute(updateAutomodConfigRoute.opts, updateAutomodConfigRoute.handler);
