import { apiRoute } from '@/server/api';
import { reviewAppealRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(reviewAppealRoute.opts, reviewAppealRoute.handler);
