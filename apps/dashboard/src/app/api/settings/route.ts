import { apiRoute } from '@/server/api';
import { getSettingsRoute, updateSettingsRoute } from './handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(getSettingsRoute.opts, getSettingsRoute.handler);
export const PATCH = apiRoute(updateSettingsRoute.opts, updateSettingsRoute.handler);
