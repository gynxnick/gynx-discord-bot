import { z } from 'zod';
import { listTexts, resetText, setText, setTextSchema } from '@gynx/services';
import { defineRoute } from './define-route';

/** GET /api/settings/text: every bot text with its default and this server's override (settings.manage). */
export const listTextRoute = defineRoute({ permission: 'settings.manage' }, async ({ ctx }) => ({
  items: await listTexts(ctx),
}));

/** PUT /api/settings/text: save one override (validated against placeholders and Discord limits). */
export const setTextRoute = defineRoute(
  {
    permission: 'settings.manage',
    mutation: true,
    schema: setTextSchema,
    rateLimit: { limit: 60, windowSeconds: 60, key: 'text' },
  },
  async ({ ctx, input }) => setText(ctx, input),
);

/** DELETE /api/settings/text: reset one text to its default. */
export const resetTextRoute = defineRoute(
  {
    permission: 'settings.manage',
    mutation: true,
    schema: z.object({ key: z.string().min(3).max(120) }).strict(),
    rateLimit: { limit: 60, windowSeconds: 60, key: 'text' },
  },
  async ({ ctx, input }) => {
    await resetText(ctx, input.key);
    return { ok: true };
  },
);
