import { apiRoute } from '@/server/api';
import { listIncidentsRoute, createIncidentRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listIncidentsRoute.opts, listIncidentsRoute.handler);
export const POST = apiRoute(createIncidentRoute.opts, createIncidentRoute.handler);
