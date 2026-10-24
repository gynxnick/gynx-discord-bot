import { apiRoute } from '@/server/api';
import { setServiceStateRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(setServiceStateRoute.opts, setServiceStateRoute.handler);
