import { apiRoute } from '@/server/api';
import { previewRoute } from '../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(previewRoute.opts, previewRoute.handler);
