import { apiRoute } from '@/server/api';
import { listEventsRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listEventsRoute.opts, listEventsRoute.handler);
