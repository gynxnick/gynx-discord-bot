import { apiRoute } from '@/server/api';
import { overviewRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(overviewRoute.opts, overviewRoute.handler);
