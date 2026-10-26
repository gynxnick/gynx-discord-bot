import { apiRoute } from '@/server/api';
import { createRepoRoute, listReposRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listReposRoute.opts, listReposRoute.handler);
export const POST = apiRoute(createRepoRoute.opts, createRepoRoute.handler);
