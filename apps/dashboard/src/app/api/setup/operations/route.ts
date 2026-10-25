import { apiRoute } from '@/server/api';
import { listOperationsRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listOperationsRoute.opts, listOperationsRoute.handler);
