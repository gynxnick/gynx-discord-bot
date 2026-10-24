import { apiRoute } from '@/server/api';
import { searchRecordsRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(searchRecordsRoute.opts, searchRecordsRoute.handler);
