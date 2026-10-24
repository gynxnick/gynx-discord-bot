import { z } from 'zod';
import { security } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

const schema = z.object({ content: z.string().trim().min(1, 'Write a note first.').max(2000) });

/** POST /api/security/reports/:id/notes { content } (security.reports.manage). */
export const POST = apiRoute(
  { permission: 'security.reports.manage', schema },
  async ({ ctx, params, input }) => security.addReportNote(ctx, params.id ?? '', input.content),
);
