import { apiRoute } from '@/server/api';
import { confirmRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(confirmRoute.opts, confirmRoute.handler);
