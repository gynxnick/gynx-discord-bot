import { apiRoute } from '@/server/api';
import { setNoteRoute } from '../../../handlers';

export const dynamic = 'force-dynamic';

export const PUT = apiRoute(setNoteRoute.opts, setNoteRoute.handler);
