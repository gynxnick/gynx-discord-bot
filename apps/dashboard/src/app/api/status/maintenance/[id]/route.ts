import { apiRoute } from '@/server/api';
import { updateMaintenanceRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const PATCH = apiRoute(updateMaintenanceRoute.opts, updateMaintenanceRoute.handler);
