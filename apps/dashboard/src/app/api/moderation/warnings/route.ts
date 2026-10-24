import { apiRoute } from '@/server/api';
import { listWarningsRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listWarningsRoute.opts, listWarningsRoute.handler);
