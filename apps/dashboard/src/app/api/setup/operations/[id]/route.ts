import { apiRoute } from '@/server/api';
import { getOperationRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(getOperationRoute.opts, getOperationRoute.handler);
