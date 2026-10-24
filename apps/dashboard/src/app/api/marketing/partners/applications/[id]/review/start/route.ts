import { apiRoute } from '@/server/api';
import { startPartnerReview } from '../../../../../_lib/partners';

export const dynamic = 'force-dynamic';

/** POST /api/marketing/partners/applications/:id/review/start (partners.review). */
export const POST = apiRoute(startPartnerReview.opts, startPartnerReview.handler);
