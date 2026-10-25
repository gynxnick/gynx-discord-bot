import { apiRoute } from '@/server/api';
import { cancelRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(cancelRoute.opts, cancelRoute.handler);
