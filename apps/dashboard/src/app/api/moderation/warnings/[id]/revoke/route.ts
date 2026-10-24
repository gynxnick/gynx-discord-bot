import { apiRoute } from '@/server/api';
import { revokeWarningRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(revokeWarningRoute.opts, revokeWarningRoute.handler);
