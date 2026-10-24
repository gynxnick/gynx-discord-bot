import { apiRoute } from '@/server/api';
import { listServicesRoute, createServiceRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listServicesRoute.opts, listServicesRoute.handler);
export const POST = apiRoute(createServiceRoute.opts, createServiceRoute.handler);
