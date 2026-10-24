import { apiRoute } from '@/server/api';
import { getIncidentRoute, editIncidentRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(getIncidentRoute.opts, getIncidentRoute.handler);
export const PATCH = apiRoute(editIncidentRoute.opts, editIncidentRoute.handler);
