import { apiRoute } from '@/server/api';
import { getRecordRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(getRecordRoute.opts, getRecordRoute.handler);
