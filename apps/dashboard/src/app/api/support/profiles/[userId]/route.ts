import { apiRoute } from '@/server/api';
import { removeProfile } from '../../handlers';

export const dynamic = 'force-dynamic';

export const DELETE = apiRoute(removeProfile.opts, removeProfile.handler);
