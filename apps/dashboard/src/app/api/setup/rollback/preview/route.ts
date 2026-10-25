import { apiRoute } from '@/server/api';
import { rollbackPreviewRoute } from '../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(rollbackPreviewRoute.opts, rollbackPreviewRoute.handler);
