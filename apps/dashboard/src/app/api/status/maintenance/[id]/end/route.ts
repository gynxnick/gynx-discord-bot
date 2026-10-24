import { apiRoute } from '@/server/api';
import { endMaintenanceRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(endMaintenanceRoute.opts, endMaintenanceRoute.handler);
