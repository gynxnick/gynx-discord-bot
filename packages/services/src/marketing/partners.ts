import { PermissionFlagsBits } from 'discord-api-types/v10';
import { z } from 'zod';
import { nextSequence, type PartnerApplication, type PartnerCampaign, type PartnerCategory, type PartnerStatus, type Prisma } from '@gynx/database';
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

// ─── Category questions ─────────────────────────────────────────────────────

export const PARTNER_CATEGORIES = ['CONTENT_CREATOR', 'GAMING_COMMUNITY', 'COMMUNITY_PARTNER', 'OTHER'] as const satisfies readonly PartnerCategory[];

export const PARTNER_CATEGORY_LABELS: Record<PartnerCategory, string> = {
  CONTENT_CREATOR: 'Content creator',
  GAMING_COMMUNITY: 'Gaming community',
  COMMUNITY_PARTNER: 'Community partner',
  OTHER: 'Other',
};

export interface PartnerQuestion {
  id: string;
  label: string; // ≤45 chars (Discord modal label limit)
  style: 'short' | 'paragraph';
  required: boolean;
  maxLength: number;
  placeholder?: string;
}

/** At most 5 questions per category (Discord modal limit). */
export const PARTNER_QUESTIONS: Record<PartnerCategory, PartnerQuestion[]> = {
  CONTENT_CREATOR: [
    { id: 'channels', label: 'Channel links (one per line)', style: 'paragraph', required: true, maxLength: 500, placeholder: 'https://youtube.com/@you' },
    { id: 'audience', label: 'Platforms and approximate audience size', style: 'short', required: true, maxLength: 200 },
    { id: 'content', label: 'What content do you make?', style: 'paragraph', required: true, maxLength: 1000 },
    { id: 'proposal', label: 'How would you like to partner with us?', style: 'paragraph', required: true, maxLength: 1000 },
  ],
  GAMING_COMMUNITY: [
    { id: 'community', label: 'Community name and link', style: 'short', required: true, maxLength: 200 },
    { id: 'size', label: 'Approximate member count', style: 'short', required: true, maxLength: 50 },
    { id: 'games', label: 'Games your community plays', style: 'short', required: true, maxLength: 200 },
    { id: 'proposal', label: 'How would you like to partner with us?', style: 'paragraph', required: true, maxLength: 1000 },
  ],
  COMMUNITY_PARTNER: [
    { id: 'organisation', label: 'Organisation name and website', style: 'short', required: true, maxLength: 200 },
    { id: 'about', label: 'Tell us about your organisation', style: 'paragraph', required: true, maxLength: 1000 },
    { id: 'proposal', label: 'What partnership do you propose?', style: 'paragraph', required: true, maxLength: 1000 },
  ],
  OTHER: [
    { id: 'about', label: 'Who are you / what do you represent?', style: 'paragraph', required: true, maxLength: 1000 },
    { id: 'proposal', label: 'What partnership do you propose?', style: 'paragraph', required: true, maxLength: 1000 },
    { id: 'links', label: 'Relevant links (optional)', style: 'paragraph', required: false, maxLength: 500 },
  ],
};

const OPEN_STATUSES: PartnerStatus[] = ['PENDING', 'UNDER_REVIEW'];

export const submitApplicationSchema = z.object({
  category: z.enum(PARTNER_CATEGORIES),
  answers: z.record(z.string().max(64), z.string().max(2000)),
});

function cleanAnswers(category: PartnerCategory, answers: Record<string, string>): Record<string, string> {
  const questions = PARTNER_QUESTIONS[category];
  const known = new Set(questions.map((q) => q.id));
  const unknown = Object.keys(answers).filter((k) => !known.has(k));
  if (unknown.length) throw validation('Unexpected answers were submitted.');
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = (answers[q.id] ?? '').trim();
    if (q.required && !v) throw validation(`Please answer: ${q.label}`);
    if (v.length > q.maxLength) throw validation(`"${q.label}" is too long (max ${q.maxLength} characters).`);
    // Stored faithfully (secrets redacted); every echo path neutralises mentions at render time.
    if (v) out[q.id] = redactSecrets(v, { maskIps: false });
  }
  return out;
}

/** Submit a partner application. One open (pending / under review) application per member. */
export async function submitPartnerApplication(ctx: Ctx, raw: z.input<typeof submitApplicationSchema>): Promise<PartnerApplication> {
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
    if (open) throw conflict(`You already have an open application (${open.ref}). Please wait for the team to review it.`);
    const number = await nextSequence(tx, ctx.guildId, 'partner_application');
    const app = await tx.partnerApplication.create({
      data: { guildId: ctx.guildId, number, ref: formatRef('P', number), applicantId: ctx.actor.userId, category: input.category, answers },
    });
    await audit(ctx, { action: 'partners.application.submit', targetType: 'PartnerApplication', targetId: app.id, metadata: { ref: app.ref, category: app.category } }, tx);
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
export type ApplicantView = Pick<PartnerApplication, 'id' | 'ref' | 'category' | 'status' | 'decisionNote' | 'createdAt' | 'reviewedAt'>;

export async function myPartnerApplications(ctx: Ctx): Promise<ApplicantView[]> {
  await requireModule(ctx, 'referrals');
  return ctx.db.partnerApplication.findMany({
    where: { guildId: ctx.guildId, applicantId: ctx.actor.userId },
    select: { id: true, ref: true, category: true, status: true, decisionNote: true, createdAt: true, reviewedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}

export const listApplicationsSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  category: z.enum(PARTNER_CATEGORIES).optional(),
});

export async function listPartnerApplications(ctx: Ctx, raw: z.input<typeof listApplicationsSchema> = {}): Promise<Page<PartnerApplication>> {
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
  const app = await ctx.db.partnerApplication.findFirst({ where: { id, guildId: ctx.guildId }, include: { campaigns: true } });
  if (!app) throw notFound('Application');
  return app;
}

async function loadForReview(ctx: Ctx, id: string): Promise<PartnerApplication> {
  await requirePermission(ctx, 'partners.review');
  const app = await ctx.db.partnerApplication.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!app) throw notFound('Application');
  if (app.applicantId === ctx.actor.userId) throw forbidden('You cannot review your own application.');
  return app;
}

export async function startPartnerReview(ctx: Ctx, id: string): Promise<PartnerApplication> {
  const app = await loadForReview(ctx, id);
  if (app.status === 'UNDER_REVIEW' && app.reviewerId === ctx.actor.userId) return app;
  if (app.status !== 'PENDING') throw invalidState(app.status === 'UNDER_REVIEW' ? 'Someone is already reviewing this application.' : 'This application was already decided.');
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.partnerApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'UNDER_REVIEW', reviewerId: ctx.actor.userId, reviewStartedAt: ctx.now() },
    });
    if (r.count === 0) throw conflict('Someone else just started reviewing this application.');
    await audit(ctx, { action: 'partners.application.review_start', targetType: 'PartnerApplication', targetId: id, metadata: { ref: app.ref } }, tx);
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
export async function decidePartnerApplication(ctx: Ctx, id: string, raw: z.input<typeof decideApplicationSchema>) {
  const input = decideApplicationSchema.parse(raw);
  const app = await loadForReview(ctx, id);
  if (!OPEN_STATUSES.includes(app.status)) throw invalidState('This application was already decided.');
  if (app.status === 'UNDER_REVIEW' && app.reviewerId && app.reviewerId !== ctx.actor.userId && !can(ctx, 'settings.manage')) {
    throw conflict('Another reviewer is handling this application.');
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
        internalNotes: input.internalNotes ? redactSecrets(input.internalNotes, { maskIps: false }) : app.internalNotes,
      },
    });
    if (r.count === 0) throw conflict('This application changed in the meantime.');
    let campaign: PartnerCampaign | null = null;
    if (input.decision === 'APPROVED') {
      campaign = await tx.partnerCampaign.create({
        data: { guildId: ctx.guildId, applicationId: id, partnerId: app.applicantId, name: input.campaignName ?? `${app.ref} partnership`, canAnnounce: false },
      });
    }
    await audit(ctx, { action: `partners.application.${input.decision === 'APPROVED' ? 'approve' : 'reject'}`, targetType: 'PartnerApplication', targetId: id, metadata: { ref: app.ref, campaignId: campaign?.id ?? null } }, tx);
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

export type PartnerRoleOutcome = 'granted' | 'already-granted' | 'not-configured' | 'refused' | 'not-approved' | 'member-missing';

/**
 * Worker step: grant GuildConfig.partnerRoleId to an approved applicant, but
 * only after verifying the role carries none of the privileged permission
 * bits. Refusals are audited; staff permissions are never granted.
 */
export async function grantPartnerRole(deps: ServiceDeps & { discord: DiscordPort }, applicationId: string): Promise<PartnerRoleOutcome> {
  const app = await deps.db.partnerApplication.findUnique({ where: { id: applicationId } });
  if (!app || app.status !== 'APPROVED') return 'not-approved';
  if (app.roleGranted) return 'already-granted';
  const sys = makeCtx(deps, app.guildId, systemActor('worker'));
  const cfg = await getGuildConfig(deps.db, app.guildId);
  const roleId = cfg.partnerRoleId;
  if (!roleId) return 'not-configured';

  const refuse = async (reason: string, extra: Record<string, unknown> = {}) => {
    await audit(sys, { action: 'partners.role.refused', targetType: 'PartnerApplication', targetId: app.id, result: 'DENIED', metadata: { roleId, reason, ...extra } });
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
    await deps.discord.addRole(app.guildId, app.applicantId, roleId, `Partner application ${app.ref} approved`);
  }
  await deps.db.$transaction(async (tx) => {
    await tx.partnerApplication.update({ where: { id: app.id }, data: { roleGranted: true } });
    await audit(sys, { action: 'partners.role.granted', targetType: 'PartnerApplication', targetId: app.id, metadata: { roleId, userId: app.applicantId } }, tx);
  });
  return 'granted';
}

/** Marker so the decision DM is sent at most once even if the job is retried. */
export async function decisionDmAlreadySent(db: Ctx['db'], applicationId: string): Promise<boolean> {
  const e = await db.securityAuditEvent.findFirst({ where: { action: 'partners.application.notified', targetId: applicationId }, select: { id: true } });
  return e !== null;
}

export async function markDecisionDmSent(deps: ServiceDeps, app: Pick<PartnerApplication, 'id' | 'guildId'>, delivered: boolean): Promise<void> {
  await audit(makeCtx(deps, app.guildId, systemActor('worker')), { action: 'partners.application.notified', targetType: 'PartnerApplication', targetId: app.id, metadata: { delivered } });
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export const listCampaignsSchema = paginationSchema.extend({
  partnerId: z.string().regex(/^\d{17,20}$/).optional(),
  active: z.boolean().optional(),
});

/** Staff see all campaigns; a partner sees only their own. */
export async function listPartnerCampaigns(ctx: Ctx, raw: z.input<typeof listCampaignsSchema> = {}): Promise<Page<PartnerCampaign>> {
  await requireModule(ctx, 'referrals');
  const f = listCampaignsSchema.parse(raw);
  const staff = can(ctx, 'partners.review');
  const where: Prisma.PartnerCampaignWhereInput = { guildId: ctx.guildId, active: f.active, partnerId: staff ? f.partnerId : ctx.actor.userId };
  const rows = await ctx.db.partnerCampaign.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(f) });
  return toPage(rows, f.limit);
}

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  canAnnounce: z.boolean().optional(),
});

export async function updatePartnerCampaign(ctx: Ctx, id: string, raw: z.input<typeof updateCampaignSchema>): Promise<PartnerCampaign> {
  await requirePermission(ctx, 'partners.review', 'partners.campaign.update');
  const input = updateCampaignSchema.parse(raw);
  const c = await ctx.db.partnerCampaign.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!c) throw notFound('Partner campaign');
  // Letting a partner campaign announce is a settings-level decision.
  if (input.canAnnounce === true && !c.canAnnounce) await requirePermission(ctx, 'settings.manage', 'partners.campaign.can_announce');
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.partnerCampaign.update({ where: { id }, data: input });
    await audit(ctx, { action: 'partners.campaign.update', targetType: 'PartnerCampaign', targetId: id, metadata: { fields: Object.keys(input), canAnnounce: updated.canAnnounce } }, tx);
    return updated;
  });
}

/** Measured outcomes only: VALID confirmed joins via the campaign's invites, and tracked-link clicks. */
export async function partnerCampaignAnalytics(ctx: Ctx, id: string) {
  await requireModule(ctx, 'referrals');
  const c = await ctx.db.partnerCampaign.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { invites: { select: { code: true, active: true } }, links: { select: { slug: true, targetUrl: true, clicks: true, active: true } } },
  });
  if (!c) throw notFound('Partner campaign');
  if (c.partnerId !== ctx.actor.userId && !can(ctx, 'partners.review')) await requirePermission(ctx, 'referrals.view', 'partners.campaign.analytics');
  const codes = c.invites.map((i) => i.code);
  const [validJoins, flaggedJoins] = codes.length
    ? await Promise.all([
        ctx.db.referralAttribution.count({ where: { ...countedReferralWhere(ctx.guildId), inviteCode: { in: codes } } }),
        ctx.db.referralAttribution.count({ where: { guildId: ctx.guildId, inviteCode: { in: codes }, status: { in: ['FLAGGED', 'DISPUTED'] } } }),
      ])
    : [0, 0];
  return {
    campaign: { id: c.id, name: c.name, partnerId: c.partnerId, active: c.active, canAnnounce: c.canAnnounce, startsAt: c.startsAt, endsAt: c.endsAt },
    invites: c.invites,
    validJoins,
    joinsUnderReview: flaggedJoins,
    links: c.links,
    linkClicks: c.links.reduce((s, l) => s + l.clicks, 0),
  };
}
