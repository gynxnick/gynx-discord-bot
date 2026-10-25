import { apiRoute } from '@/server/api';
import { endSession } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(endSession.opts, endSession.handler);
