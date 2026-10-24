import { apiRoute } from '@/server/api';
import { cancelMaintenanceRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(cancelMaintenanceRoute.opts, cancelMaintenanceRoute.handler);
