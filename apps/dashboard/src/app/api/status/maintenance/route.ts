import { apiRoute } from '@/server/api';
import { listMaintenanceRoute, createMaintenanceRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listMaintenanceRoute.opts, listMaintenanceRoute.handler);
export const POST = apiRoute(createMaintenanceRoute.opts, createMaintenanceRoute.handler);
