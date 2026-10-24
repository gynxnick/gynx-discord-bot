import { apiRoute } from '@/server/api';
import { addIncidentUpdateRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(addIncidentUpdateRoute.opts, addIncidentUpdateRoute.handler);
