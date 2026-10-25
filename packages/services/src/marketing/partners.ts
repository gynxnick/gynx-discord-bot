import { PermissionFlagsBits } from 'discord-api-types/v10';
import { z } from 'zod';
import {
  nextSequence,
  type PartnerApplication,
  type PartnerCampaign,
  type PartnerCategory,
  type PartnerStatus,
  type Prisma,
} from '@gynx/database';
import {
  conflict,
  cursorArgs,
  forbidden,
  formatRef,
  invalidState,
  notFound,
  paginationSchema,
  redactSecrets,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import { makeCtx, systemActor, type Ctx, type ServiceDeps } from '../core/context';
import type { DiscordPort } from '../core/discord-port';
import { enqueueJob } from '../core/jobs';
import { countedReferralWhere } from './referrals';
import { MarketingText as T } from './texts';

// ─── Category questions ─────────────────────────────────────────────────────

export const PARTNER_CATEGORIES = [
  'CONTENT_CREATOR',
  'GAMING_COMMUNITY',
  'COMMUNITY_PARTNER',
  'OTHER',
] as const satisfies readonly PartnerCategory[];

export const PARTNER_CATEGORY_LABELS: Record<PartnerCategory, string> = {
  CONTENT_CREATOR: 'Content creator',
  GAMING_COMMUNITY: 'Gaming community',
  COMMUNITY_PARTNER: 'Community partner',
  OTHER: 'Other',
};

const CATEGORY_TEXT: Record<PartnerCategory, keyof typeof T> = {
  CONTENT_CREATOR: 'categoryContentCreator',
  GAMING_COMMUNITY: 'categoryGamingCommunity',
  COMMUNITY_PARTNER: 'categoryCommunityPartner',
  OTHER: 'categoryOther',
};

/**
 * Editable category name for messages sent in Discord (resolved at call time).
 * PARTNER_CATEGORY_LABELS stays for the dashboard.
 */
export const partnerCategoryLabel = (c: PartnerCategory): string => T[CATEGORY_TEXT[c]]();

export interface PartnerQuestion {
  id: string;
  label: string; // ≤45 chars (Discord modal label limit); dashboard wording
  /** Editable text key used for this question in Discord (see partnerQuestionLabel). */
  text: keyof typeof T;
  style: 'short' | 'paragraph';
  required: boolean;
  maxLength: number;
  placeholder?: string;
}

/** At most 5 questions per category (Discord modal limit). */
export const PARTNER_QUESTIONS: Record<PartnerCategory, PartnerQuestion[]> = {
  CONTENT_CREATOR: [
    {
      id: 'channels',
      label: 'Channel links (one per line)',
      text: 'qCreatorChannels',
      style: 'paragraph',
      required: true,
      maxLength: 500,
      placeholder: 'https://youtube.com/@you',
    },
    {
      id: 'audience',
      label: 'Platforms and approximate audience size',
      text: 'qCreatorAudience',
      style: 'short',
      required: true,
      maxLength: 200,
    },
    {
      id: 'content',
      label: 'What content do you make?',
      text: 'qCreatorContent',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
    {
      id: 'proposal',
      label: 'How would you like to partner with us?',
      text: 'qCreatorProposal',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
  ],
  GAMING_COMMUNITY: [
    {
      id: 'community',
      label: 'Community name and link',
      text: 'qGamingCommunity',
      style: 'short',
      required: true,
      maxLength: 200,
    },
    {
      id: 'size',
      label: 'Approximate member count',
      text: 'qGamingSize',
      style: 'short',
      required: true,
      maxLength: 50,
    },
    {
      id: 'games',
      label: 'Games your community plays',
      text: 'qGamingGames',
      style: 'short',
      required: true,
      maxLength: 200,
    },
    {
      id: 'proposal',
      label: 'How would you like to partner with us?',
      text: 'qGamingProposal',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
  ],
  COMMUNITY_PARTNER: [
    {
      id: 'organisation',
      label: 'Organisation name and website',
      text: 'qCommunityOrganisation',
      style: 'short',
      required: true,
      maxLength: 200,
    },
    {
      id: 'about',
      label: 'Tell us about your organisation',
      text: 'qCommunityAbout',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
    {
      id: 'proposal',
      label: 'What partnership do you propose?',
      text: 'qCommunityProposal',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
  ],
  OTHER: [
    {
      id: 'about',
      label: 'Who are you / what do you represent?',
      text: 'qOtherAbout',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
    {
      id: 'proposal',
      label: 'What partnership do you propose?',
      text: 'qOtherProposal',
      style: 'paragraph',
      required: true,
      maxLength: 1000,
    },
    {
      id: 'links',
      label: 'Relevant links (optional)',
      text: 'qOtherLinks',
      style: 'paragraph',
      required: false,
      maxLength: 500,
    },
  ],
};

/** Editable question wording for Discord (modal labels, review posts, errors), resolved at call time. */
export const partnerQuestionLabel = (q: Pick<PartnerQuestion, 'text'>): string => T[q.text]();

const OPEN_STATUSES: PartnerStatus[] = ['PENDING', 'UNDER_REVIEW'];

export const submitApplicationSchema = z.object({
  category: z.enum(PARTNER_CATEGORIES),
  answers: z.record(z.string().max(64), z.string().max(2000)),
});

function cleanAnswers(category: PartnerCategory, answers: Record<string, string>): Record<string, string> {
  const questions = PARTNER_QUESTIONS[category];
  const known = new Set(questions.map((q) => q.id));
  const unknown = Object.keys(answers).filter((k) => !known.has(k));
  if (unknown.length) throw validation(T.unexpectedAnswers());
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = (answers[q.id] ?? '').trim();
    if (q.required && !v) throw validation(T.answerRequired({ question: partnerQuestionLabel(q) }));
    if (v.length > q.maxLength)
      throw validation(T.answerTooLong({ question: partnerQuestionLabel(q), max: q.maxLength }));
    // Stored faithfully (secrets redacted); every echo path neutralises mentions at render time.
    if (v) out[q.id] = redactSecrets(v, { maskIps: false });
  }
  return out;
}

/** Submit a partner application. One open (pending / under review) application per member. */
export async function submitPartnerApplication(
  ctx: Ctx,
  raw: z.input<typeof submitApplicationSchema>,
): Promise<PartnerApplication> {
  await requireModule(ctx, 'referrals');
  const input = submitApplicationSchema.parse(raw);
  const answers = cleanAnswers(input.category, input.answers);
  await requireRate(ctx, 'partners.apply', 3, 86_400);

  return ctx.db.$transaction(async (tx) => {
    // Serialise per applicant so two concurrent submissions can't both pass the check.
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`partner-app:${ctx.guildId}:${ctx.actor.userId}`}))) AS l`;
    const open = await tx.partnerApplication.findFirst({
      where: { guildId: ctx.guildId, applicantId: ctx.actor.userId, status: { in: OPEN_STATUSES } },
      select: { ref: true },
    });
    if (open) throw conflict(T.alreadyOpenApplication({ ref: open.ref }));
    const number = await nextSequence(tx, ctx.guildId, 'partner_application');
    const app = await tx.partnerApplication.create({
      data: {
        guildId: ctx.guildId,
        number,
        ref: formatRef('P', number),
        applicantId: ctx.actor.userId,
        category: input.category,
        answers,
      },
    });
    await audit(
      ctx,
      {
        action: 'partners.application.submit',
        targetType: 'PartnerApplication',
        targetId: app.id,
        metadata: { ref: app.ref, category: app.category },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: 'marketing.partner.notify',
      dedupeKey: `marketing.partner.notify:${app.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { applicationId: app.id },
    });
    return app;
  });
}

/** Applicant-facing view: never includes internal notes or reviewer identity. */
export type ApplicantView = Pick<
  PartnerApplication,
  'id' | 'ref' | 'category' | 'status' | 'decisionNote' | 'createdAt' | 'reviewedAt'
>;

export async function myPartnerApplications(ctx: Ctx): Promise<ApplicantView[]> {
  await requireModule(ctx, 'referrals');
  return ctx.db.partnerApplication.findMany({
    where: { guildId: ctx.guildId, applicantId: ctx.actor.userId },
    select: {
      id: true,
      ref: true,
      category: true,
      status: true,
      decisionNote: true,
      createdAt: true,
      reviewedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}

export const listApplicationsSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  category: z.enum(PARTNER_CATEGORIES).optional(),
});

export async function listPartnerApplications(
  ctx: Ctx,
  raw: z.input<typeof listApplicationsSchema> = {},
): Promise<Page<PartnerApplication>> {
  await requirePermission(ctx, 'partners.review');
  const f = listApplicationsSchema.parse(raw);
  const rows = await ctx.db.partnerApplication.findMany({
    where: { guildId: ctx.guildId, status: f.status, category: f.category },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

export async function getPartnerApplication(ctx: Ctx, id: string) {
  await requirePermission(ctx, 'partners.review');
  const app = await ctx.db.partnerApplication.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { campaigns: true },
  });
  if (!app) throw notFound('Application');
  return app;
}

async function loadForReview(ctx: Ctx, id: string): Promise<PartnerApplication> {
  await requirePermission(ctx, 'partners.review');
  const app = await ctx.db.partnerApplication.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!app) throw notFound('Application');
  if (app.applicantId === ctx.actor.userId) throw forbidden(T.cannotReviewOwnApplication());
  return app;
}

export async function startPartnerReview(ctx: Ctx, id: string): Promise<PartnerApplication> {
  const app = await loadForReview(ctx, id);
  if (app.status === 'UNDER_REVIEW' && app.reviewerId === ctx.actor.userId) return app;
  if (app.status !== 'PENDING')
    throw invalidState(app.status === 'UNDER_REVIEW' ? T.alreadyReviewing() : T.alreadyDecided());
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.partnerApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'UNDER_REVIEW', reviewerId: ctx.actor.userId, reviewStartedAt: ctx.now() },
    });
    if (r.count === 0) throw conflict(T.reviewStartRace());
    await audit(
      ctx,
      {
        action: 'partners.application.review_start',
        targetType: 'PartnerApplication',
        targetId: id,
        metadata: { ref: app.ref },
      },
      tx,
    );
    return tx.partnerApplication.findUniqueOrThrow({ where: { id } });
  });
}

export const decideApplicationSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  /** Shown to the applicant. */
  decisionNote: z.string().trim().min(3).max(1000),
  /** Staff-only; never shown to the applicant. */
  internalNotes: z.string().trim().max(2000).optional(),
  campaignName: z.string().trim().min(1).max(80).optional(),
});

/** Approve or reject. Approval creates a partner campaign (announce rights off) and queues the DM + role grant. */
export async function decidePartnerApplication(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof decideApplicationSchema>,
) {
  const input = decideApplicationSchema.parse(raw);
  const app = await loadForReview(ctx, id);
  if (!OPEN_STATUSES.includes(app.status)) throw invalidState(T.alreadyDecided());
  if (
    app.status === 'UNDER_REVIEW' &&
    app.reviewerId &&
    app.reviewerId !== ctx.actor.userId &&
    !can(ctx, 'settings.manage')
  ) {
    throw conflict(T.anotherReviewer());
  }
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.partnerApplication.updateMany({
      where: { id, status: app.status },
      data: {
        status: input.decision,
        reviewerId: ctx.actor.userId,
        reviewStartedAt: app.reviewStartedAt ?? ctx.now(),
        reviewedAt: ctx.now(),
        decisionNote: redactSecrets(input.decisionNote, { maskIps: false }),
        internalNotes: input.internalNotes
          ? redactSecrets(input.internalNotes, { maskIps: false })
          : app.internalNotes,
      },
    });
    if (r.count === 0) throw conflict(T.applicationChanged());
    let campaign: PartnerCampaign | null = null;
    if (input.decision === 'APPROVED') {
      campaign = await tx.partnerCampaign.create({
        data: {
          guildId: ctx.guildId,
          applicationId: id,
          partnerId: app.applicantId,
          name: input.campaignName ?? T.defaultCampaignName({ ref: app.ref }),
          canAnnounce: false,
        },
      });
    }
    await audit(
      ctx,
      {
        action: `partners.application.${input.decision === 'APPROVED' ? 'approve' : 'reject'}`,
        targetType: 'PartnerApplication',
        targetId: id,
        metadata: { ref: app.ref, campaignId: campaign?.id ?? null },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: 'marketing.partner.decision',
      dedupeKey: `marketing.partner.decision:${id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { applicationId: id },
    });
    return { application: await tx.partnerApplication.findUniqueOrThrow({ where: { id } }), campaign };
  });
}

// ─── Partner role safety ────────────────────────────────────────────────────

/** Discord permission bits that must never be held by the partner role. */
export const PRIVILEGED_DISCORD_BITS: Record<string, bigint> = {
  Administrator: PermissionFlagsBits.Administrator,
  ManageGuild: PermissionFlagsBits.ManageGuild,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  MentionEveryone: PermissionFlagsBits.MentionEveryone,
  ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
};

/** Names of privileged bits present in a role's permission bitfield string. Unparseable → treated as privileged. */
export function privilegedDiscordPermissions(bitfield: string): string[] {
  let bits: bigint;
  try {
    bits = BigInt(bitfield);
  } catch {
    return ['Unparseable'];
  }
  return Object.entries(PRIVILEGED_DISCORD_BITS)
    .filter(([, bit]) => (bits & bit) === bit)
    .map(([name]) => name);
}

export type PartnerRoleOutcome =
  'granted' | 'already-granted' | 'not-configured' | 'refused' | 'not-approved' | 'member-missing';

/**
 * Worker step: grant GuildConfig.partnerRoleId to an approved applicant, but
 * only after verifying the role carries none of the privileged permission
 * bits. Refusals are audited; staff permissions are never granted.
 */
export async function grantPartnerRole(
  deps: ServiceDeps & { discord: DiscordPort },
  applicationId: string,
): Promise<PartnerRoleOutcome> {
  const app = await deps.db.partnerApplication.findUnique({ where: { id: applicationId } });
  if (!app || app.status !== 'APPROVED') return 'not-approved';
  if (app.roleGranted) return 'already-granted';
  const sys = makeCtx(deps, app.guildId, systemActor('worker'));
  const cfg = await getGuildConfig(deps.db, app.guildId);
  const roleId = cfg.partnerRoleId;
  if (!roleId) return 'not-configured';

  const refuse = async (reason: string, extra: Record<string, unknown> = {}) => {
    await audit(sys, {
      action: 'partners.role.refused',
      targetType: 'PartnerApplication',
      targetId: app.id,
      result: 'DENIED',
      metadata: { roleId, reason, ...extra },
    });
    deps.log.error({ roleId, reason, ...extra }, 'refused to grant partner role');
    return 'refused' as const;
  };
  if (roleId === app.guildId) return refuse('everyone-role');
  const roles = await deps.discord.listRoles(app.guildId);
  const role = roles.find((r) => r.id === roleId);
  if (!role) return refuse('role-not-found');
  if (role.managed) return refuse('managed-role');
  const privileged = privilegedDiscordPermissions(role.permissions);
  if (privileged.length) return refuse('privileged-permissions', { privileged });

  const member = await deps.discord.getMember(app.guildId, app.applicantId);
  if (!member) return 'member-missing';
  if (!member.roles.includes(roleId)) {
    await deps.discord.addRole(
      app.guildId,
      app.applicantId,
      roleId,
      `Partner application ${app.ref} approved`,
    );
  }
  await deps.db.$transaction(async (tx) => {
    await tx.partnerApplication.update({ where: { id: app.id }, data: { roleGranted: true } });
    await audit(
      sys,
      {
        action: 'partners.role.granted',
        targetType: 'PartnerApplication',
        targetId: app.id,
        metadata: { roleId, userId: app.applicantId },
      },
      tx,
    );
  });
  return 'granted';
}

/** Marker so the decision DM is sent at most once even if the job is retried. */
export async function decisionDmAlreadySent(db: Ctx['db'], applicationId: string): Promise<boolean> {
  const a = await db.partnerApplication.findUnique({
    where: { id: applicationId },
    select: { decisionNotifiedAt: true },
  });
  return !!a?.decisionNotifiedAt;
}

export async function markDecisionDmSent(
  deps: ServiceDeps,
  app: Pick<PartnerApplication, 'id' | 'guildId'>,
  delivered: boolean,
): Promise<void> {
  await deps.db.partnerApplication.update({
    where: { id: app.id },
    data: { decisionNotifiedAt: deps.now() },
  });
  await audit(makeCtx(deps, app.guildId, systemActor('worker')), {
    action: 'partners.application.notified',
    targetType: 'PartnerApplication',
    targetId: app.id,
    metadata: { delivered },
  });
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export const listCampaignsSchema = paginationSchema.extend({
  partnerId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  active: z.boolean().optional(),
});

/** Staff see all campaigns; a partner sees only their own. */
export async function listPartnerCampaigns(
  ctx: Ctx,
  raw: z.input<typeof listCampaignsSchema> = {},
): Promise<Page<PartnerCampaign>> {
  await requireModule(ctx, 'referrals');
  const f = listCampaignsSchema.parse(raw);
  const staff = can(ctx, 'partners.review');
  const where: Prisma.PartnerCampaignWhereInput = {
    guildId: ctx.guildId,
    active: f.active,
    partnerId: staff ? f.partnerId : ctx.actor.userId,
  };
  const rows = await ctx.db.partnerCampaign.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  canAnnounce: z.boolean().optional(),
});

export async function updatePartnerCampaign(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof updateCampaignSchema>,
): Promise<PartnerCampaign> {
  await requirePermission(ctx, 'partners.review', 'partners.campaign.update');
  const input = updateCampaignSchema.parse(raw);
  const c = await ctx.db.partnerCampaign.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!c) throw notFound('Partner campaign');
  // Letting a partner campaign announce is a settings-level decision.
  if (input.canAnnounce === true && !c.canAnnounce)
    await requirePermission(ctx, 'settings.manage', 'partners.campaign.can_announce');
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.partnerCampaign.update({ where: { id }, data: input });
    await audit(
      ctx,
      {
        action: 'partners.campaign.update',
        targetType: 'PartnerCampaign',
        targetId: id,
        metadata: { fields: Object.keys(input), canAnnounce: updated.canAnnounce },
      },
      tx,
    );
    return updated;
  });
}

/** Measured outcomes only: VALID confirmed joins via the campaign's invites, and tracked-link clicks. */
export async function partnerCampaignAnalytics(ctx: Ctx, id: string) {
  await requireModule(ctx, 'referrals');
  const c = await ctx.db.partnerCampaign.findFirst({
    where: { id, guildId: ctx.guildId },
    include: {
      invites: { select: { code: true, active: true } },
      links: { select: { slug: true, targetUrl: true, clicks: true, active: true } },
    },
  });
  if (!c) throw notFound('Partner campaign');
  if (c.partnerId !== ctx.actor.userId && !can(ctx, 'partners.review'))
    await requirePermission(ctx, 'referrals.view', 'partners.campaign.analytics');
  const codes = c.invites.map((i) => i.code);
  const [validJoins, flaggedJoins] = codes.length
    ? await Promise.all([
        ctx.db.referralAttribution.count({
          where: { ...countedReferralWhere(ctx.guildId), inviteCode: { in: codes } },
        }),
        ctx.db.referralAttribution.count({
          where: { guildId: ctx.guildId, inviteCode: { in: codes }, status: { in: ['FLAGGED', 'DISPUTED'] } },
        }),
      ])
    : [0, 0];
  return {
    campaign: {
      id: c.id,
      name: c.name,
      partnerId: c.partnerId,
      active: c.active,
      canAnnounce: c.canAnnounce,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
    },
    invites: c.invites,
    validJoins,
    joinsUnderReview: flaggedJoins,
    links: c.links,
    linkClicks: c.links.reduce((s, l) => s + l.clicks, 0),
  };
}
