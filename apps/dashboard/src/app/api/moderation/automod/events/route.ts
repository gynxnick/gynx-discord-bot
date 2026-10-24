import { apiRoute } from '@/server/api';
import { listAutomodEventsRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listAutomodEventsRoute.opts, listAutomodEventsRoute.handler);
