import { apiRoute } from '@/server/api';
import { updateServiceRoute, deleteServiceRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const PATCH = apiRoute(updateServiceRoute.opts, updateServiceRoute.handler);
export const DELETE = apiRoute(deleteServiceRoute.opts, deleteServiceRoute.handler);
