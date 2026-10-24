import { z } from 'zod';
import { community } from '@gynx/services';
import { liveRoleContext } from './live-role';
import { defineRoute } from './route-def';

/**
 * Community API route definitions (bound in the sibling route.ts files).
 * Every handler calls a community service with the request ctx; services
 * re-check permissions and own all validation beyond the schemas here.
 */

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

// ── Welcome & onboarding ─────────────────────────────────────────────────────

export const getWelcome = defineRoute({ permission: 'community.manage' }, async ({ ctx }) =>
  community.getWelcomeConfig(ctx),
);

/**
 * Update the welcome config. When the verified role changes, the live role
 * data (position, managed flag, permissions, bot's highest role) is fetched
 * from Discord here — never trusted from the browser.
 */
export const updateWelcome = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.welcomeConfigUpdateSchema },
  async ({ ctx, input }) => {
    let live;
    if (input.verifiedRoleId) {
      const current = await community.getWelcomeConfig(ctx);
      if (current.verifiedRoleId !== input.verifiedRoleId)
        live = await liveRoleContext(ctx, input.verifiedRoleId);
    }
    return community.updateWelcomeConfig(ctx, input, live);
  },
);

// ── Self-roles ───────────────────────────────────────────────────────────────

export const listSelfRoles = defineRoute({ permission: 'community.manage' }, async ({ ctx }) => ({
  items: await community.listSelfRoles(ctx),
}));

export const createSelfRole = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.selfRoleCreateSchema },
  async ({ ctx, input }) => community.createSelfRole(ctx, input, await liveRoleContext(ctx, input.roleId)),
);

export const updateSelfRole = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.selfRoleUpdateSchema },
  async ({ ctx, input, params }) => {
    const id = params.id ?? '';
    let live;
    if (input.enabled === true) {
      // Re-enabling re-checks safety against the role as it is in Discord now.
      const row = (await community.listSelfRoles(ctx)).find((r) => r.id === id);
      if (row && !row.enabled) live = await liveRoleContext(ctx, row.roleId);
    }
    return community.updateSelfRole(ctx, id, input, live);
  },
);

export const deleteSelfRole = defineRoute(
  { permission: 'community.manage', mutation: true },
  async ({ ctx, params }) => {
    await community.deleteSelfRole(ctx, params.id ?? '');
    return { ok: true };
  },
);

// ── FAQ ──────────────────────────────────────────────────────────────────────

export const createFaqCategory = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.faqCategorySchema },
  async ({ ctx, input }) => community.createFaqCategory(ctx, input),
);

export const updateFaqCategory = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.faqCategorySchema.partial().strict() },
  async ({ ctx, input, params }) => community.updateFaqCategory(ctx, params.id ?? '', input),
);

export const deleteFaqCategory = defineRoute(
  { permission: 'community.manage', mutation: true },
  async ({ ctx, params }) => {
    await community.deleteFaqCategory(ctx, params.id ?? '');
    return { ok: true };
  },
);

export const listFaqEntriesQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  categoryId: z.string().min(1).max(64).optional(),
  published: boolParam,
});

export const listFaqEntries = defineRoute(
  { permission: 'community.manage', schema: listFaqEntriesQuery },
  async ({ ctx, input }) => community.listFaqEntries(ctx, input),
);

export const createFaqEntry = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.faqEntrySchema },
  async ({ ctx, input }) => community.createFaqEntry(ctx, input),
);

/** Partial update; mirrors the service's own partial schema (keywords/links without defaults). */
export const faqEntryUpdateSchema = z
  .object({
    categoryId: z.string().min(1).max(64).nullish(),
    question: z.string().trim().min(5).max(200),
    answer: z.string().trim().min(1).max(4000),
    keywords: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
    links: z.array(community.linkSchema).max(5),
    published: z.boolean(),
  })
  .partial()
  .strict();

export const updateFaqEntry = defineRoute(
  { permission: 'community.manage', mutation: true, schema: faqEntryUpdateSchema },
  async ({ ctx, input, params }) => community.updateFaqEntry(ctx, params.id ?? '', input),
);

export const deleteFaqEntry = defineRoute(
  { permission: 'community.manage', mutation: true },
  async ({ ctx, params }) => {
    await community.deleteFaqEntry(ctx, params.id ?? '');
    return { ok: true };
  },
);

// ── Guides ───────────────────────────────────────────────────────────────────

export const listGuides = defineRoute(
  {
    permission: 'community.manage',
    schema: z.object({
      cursor: z.string().min(1).max(64).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  async ({ ctx, input }) => community.listAllGuides(ctx, input),
);

export const createGuide = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.guideSchema },
  async ({ ctx, input }) => community.createGuide(ctx, input),
);

export const updateGuide = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.guideSchema.partial().strict() },
  async ({ ctx, input, params }) => community.updateGuide(ctx, params.id ?? '', input),
);

export const deleteGuide = defineRoute(
  { permission: 'community.manage', mutation: true },
  async ({ ctx, params }) => {
    await community.deleteGuide(ctx, params.id ?? '');
    return { ok: true };
  },
);
