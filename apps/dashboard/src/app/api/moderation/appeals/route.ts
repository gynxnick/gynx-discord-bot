import { apiRoute } from '@/server/api';
import { listAppealsRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listAppealsRoute.opts, listAppealsRoute.handler);
