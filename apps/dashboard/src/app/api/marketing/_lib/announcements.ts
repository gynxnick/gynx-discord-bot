import { z } from 'zod';
import { marketing } from '@gynx/services';
import { defineRoute } from '../../community/_lib/route-def';

/**
 * Announcement + template API route definitions (bound in the sibling route.ts
 * files under /api/marketing/announcements and /api/marketing/templates).
 *
 * Permissions: `apiRoute` takes a single key, so
 *  - reads and draft edits declare `announcements.create`. The services also
 *    accept `announcements.publish` for reads; publish-only staff get their
 *    data from the server-rendered pages (which accept either key) instead.
 *  - preview / publish / schedule / cancel declare `announcements.publish`.
 *  - mass mentions (@everyone/@here/roles) additionally need
 *    `announcements.mass_mention`; the service enforces it (→ 403).
 */

const version = z.number().int().min(1).max(1_000_000);

// ── Announcements ────────────────────────────────────────────────────────────

/** Query-string variant of the service list schema (all values arrive as strings). */
export const listAnnouncementsQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED']).optional(),
  type: z.enum(marketing.ANNOUNCEMENT_TYPES).optional(),
});

/** GET /api/marketing/announcements */
export const listAnnouncements = defineRoute(
  { permission: ['announcements.create', 'announcements.publish'], schema: listAnnouncementsQuery },
  async ({ ctx, input }) => marketing.listAnnouncements(ctx, input),
);

/** POST /api/marketing/announcements — create a draft (optionally from a template). */
export const createAnnouncement = defineRoute(
  { permission: 'announcements.create', mutation: true, schema: marketing.createAnnouncementSchema },
  async ({ ctx, input }) => marketing.createAnnouncement(ctx, input),
);

/** GET /api/marketing/announcements/:id — with deliveries and tracked links. */
export const getAnnouncement = defineRoute(
  { permission: ['announcements.create', 'announcements.publish'] },
  async ({ ctx, params }) => marketing.getAnnouncement(ctx, params.id ?? ''),
);

export const updateAnnouncementBody = marketing.updateAnnouncementSchema.extend({
  /** Version the editor loaded; rejects stale edits with 409. */
  expectedVersion: version.optional(),
});

/** PATCH /api/marketing/announcements/:id */
export const updateAnnouncement = defineRoute(
  { permission: 'announcements.create', mutation: true, schema: updateAnnouncementBody },
  async ({ ctx, input, params }) => {
    const { expectedVersion, ...fields } = input;
    return marketing.updateAnnouncement(ctx, params.id ?? '', fields, expectedVersion);
  },
);

/** DELETE /api/marketing/announcements/:id (drafts, cancelled or failed only). */
export const deleteAnnouncement = defineRoute(
  { permission: 'announcements.create', mutation: true },
  async ({ ctx, params }) => {
    await marketing.deleteAnnouncement(ctx, params.id ?? '');
    return { ok: true };
  },
);

/**
 * GET /api/marketing/announcements/:id/preview — the rendered payload, the
 * current `version` (pass it back as `expectedVersion`) and the mention warning.
 */
export const previewAnnouncement = defineRoute(
  { permission: 'announcements.publish' },
  async ({ ctx, params }) => marketing.previewAnnouncement(ctx, params.id ?? ''),
);

export const publishBody = z
  .object({
    expectedVersion: version,
    confirmMentions: z.boolean().optional(),
  })
  .strict();

/** POST /api/marketing/announcements/:id/publish `{ expectedVersion, confirmMentions }` */
export const publishAnnouncement = defineRoute(
  { permission: 'announcements.publish', mutation: true, schema: publishBody },
  async ({ ctx, input, params }) =>
    marketing.publishAnnouncement(ctx, params.id ?? '', {
      expectedVersion: input.expectedVersion,
      confirmMentions: input.confirmMentions,
    }),
);

export const scheduleBody = marketing.scheduleSchema
  .extend({
    expectedVersion: version,
    confirmMentions: z.boolean().optional(),
  })
  .strict();

/** POST /api/marketing/announcements/:id/schedule `{ when: "YYYY-MM-DD HH:MM", timezone?, expectedVersion, confirmMentions }` */
export const scheduleAnnouncement = defineRoute(
  { permission: 'announcements.publish', mutation: true, schema: scheduleBody },
  async ({ ctx, input, params }) =>
    marketing.scheduleAnnouncement(
      ctx,
      params.id ?? '',
      { when: input.when, timezone: input.timezone },
      { expectedVersion: input.expectedVersion, confirmMentions: input.confirmMentions },
    ),
);

/** POST /api/marketing/announcements/:id/cancel (scheduled only). */
export const cancelAnnouncement = defineRoute(
  { permission: 'announcements.publish', mutation: true },
  async ({ ctx, params }) => marketing.cancelAnnouncement(ctx, params.id ?? ''),
);

/** GET /api/marketing/announcements/:id/analytics — reactions + tracked-link clicks (no impressions: Discord has none). */
export const getAnnouncementAnalytics = defineRoute(
  { permission: ['announcements.create', 'announcements.publish', 'analytics.view'] },
  async ({ ctx, params }) => marketing.getAnnouncementAnalytics(ctx, params.id ?? ''),
);

// ── Templates ────────────────────────────────────────────────────────────────

/** GET /api/marketing/templates (seeds the default templates on first use). */
export const listTemplates = defineRoute(
  { permission: ['announcements.create', 'announcements.publish'] },
  async ({ ctx }) => ({ items: await marketing.listTemplates(ctx) }),
);

/** POST /api/marketing/templates */
export const createTemplate = defineRoute(
  { permission: 'announcements.create', mutation: true, schema: marketing.templateSchema },
  async ({ ctx, input }) => marketing.createTemplate(ctx, input),
);

/** PATCH /api/marketing/templates/:id */
export const updateTemplate = defineRoute(
  { permission: 'announcements.create', mutation: true, schema: marketing.templateSchema.partial().strict() },
  async ({ ctx, input, params }) => marketing.updateTemplate(ctx, params.id ?? '', input),
);

/** DELETE /api/marketing/templates/:id */
export const deleteTemplate = defineRoute(
  { permission: 'announcements.create', mutation: true },
  async ({ ctx, params }) => {
    await marketing.deleteTemplate(ctx, params.id ?? '');
    return { ok: true };
  },
);
