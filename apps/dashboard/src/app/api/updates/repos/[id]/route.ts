import { apiRoute } from '@/server/api';
import { deleteRepoRoute, updateRepoRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const PATCH = apiRoute(updateRepoRoute.opts, updateRepoRoute.handler);
export const DELETE = apiRoute(deleteRepoRoute.opts, deleteRepoRoute.handler);
