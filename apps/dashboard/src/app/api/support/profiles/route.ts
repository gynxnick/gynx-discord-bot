import { apiRoute } from '@/server/api';
import { listDuty, setProfile } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(listDuty.opts, listDuty.handler);
export const POST = apiRoute(setProfile.opts, setProfile.handler);
