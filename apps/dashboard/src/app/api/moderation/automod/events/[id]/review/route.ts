import { apiRoute } from '@/server/api';
import { reviewAutomodEventRoute } from '../../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(reviewAutomodEventRoute.opts, reviewAutomodEventRoute.handler);
