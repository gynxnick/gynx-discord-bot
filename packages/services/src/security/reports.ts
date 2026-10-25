import { z } from 'zod';
import { nextSequence, type AbuseReport, type AbuseReportStatus, type Prisma } from '@gynx/database';
import {
  AppError,
  conflict,
  cursorArgs,
  formatRef,
  invalidState,
  notFound,
  paginationSchema,
  redactSecrets,
  toPage,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';
import { SecurityText } from './texts';

export const REPORT_CATEGORIES = [
  'SPAM_PHISHING',
  'IMPERSONATION',
  'HARASSMENT',
  'MALICIOUS_LINK',
  'SUSPICIOUS_ACTIVITY',
  'HOSTING_ABUSE',
  'OTHER',
] as const;

export const CATEGORY_LABELS: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  SPAM_PHISHING: 'Spam / phishing',
  IMPERSONATION: 'Impersonation',
  HARASSMENT: 'Harassment',
  MALICIOUS_LINK: 'Malicious link',
  SUSPICIOUS_ACTIVITY: 'Suspicious activity',
  HOSTING_ABUSE: 'Hosting abuse',
  OTHER: 'Other',
};

type ReportCategory = (typeof REPORT_CATEGORIES)[number];
const CATEGORY_TEXT: Record<ReportCategory, () => string> = {
  SPAM_PHISHING: () => SecurityText.categorySpamPhishing(),
  IMPERSONATION: () => SecurityText.categoryImpersonation(),
  HARASSMENT: () => SecurityText.categoryHarassment(),
  MALICIOUS_LINK: () => SecurityText.categoryMaliciousLink(),
  SUSPICIOUS_ACTIVITY: () => SecurityText.categorySuspiciousActivity(),
  HOSTING_ABUSE: () => SecurityText.categoryHostingAbuse(),
  OTHER: () => SecurityText.categoryOther(),
};

/**
 * Category label for Discord messages, resolved at call time so server overrides apply.
 * (`CATEGORY_LABELS` stays for slash-command choices and the dashboard.)
 */
export const reportCategoryLabel = (c: ReportCategory): string => CATEGORY_TEXT[c]();

const snowflake = z.string().regex(/^\d{17,20}$/);
const evidenceUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https:\/\//i.test(u), 'Evidence links must use https://');
const discordMessageLink = z
  .string()
  .trim()
  .regex(
    /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}$/,
    'Must be a Discord message link',
  );

export const submitReportSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  reportedUserId: snowflake.optional(),
  description: z.string().trim().min(20, 'Please describe what happened (at least 20 characters).').max(2000),
  evidenceUrls: z.array(evidenceUrl).max(5).default([]),
  messageLink: discordMessageLink.optional(),
});
export type SubmitReportInput = z.input<typeof submitReportSchema>;

/** NEW → TRIAGED → INVESTIGATING → RESOLVED, with DISMISSED reachable from any open state. */
const TRANSITIONS: Record<AbuseReportStatus, readonly AbuseReportStatus[]> = {
  NEW: ['TRIAGED', 'INVESTIGATING', 'DISMISSED'],
  TRIAGED: ['INVESTIGATING', 'RESOLVED', 'DISMISSED'],
  INVESTIGATING: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};
export const canTransitionReport = (from: AbuseReportStatus, to: AbuseReportStatus) =>
  TRANSITIONS[from].includes(to);

const DUPLICATE_WINDOW_MS = 24 * 3_600_000;
const MAX_OPEN_PER_REPORTER = 5;

/**
 * Submit a private report. Never punishes anyone automatically; it only
 * records the report and notifies staff through a background job.
 */
export async function submitReport(ctx: Ctx, raw: SubmitReportInput): Promise<AbuseReport> {
  await requireModule(ctx, 'security');
  const input = submitReportSchema.parse(raw);
  await requireRate(ctx, 'security.report', 3, 3600);

  if (input.reportedUserId === ctx.actor.userId)
    throw new AppError('VALIDATION', SecurityText.reportSelfError());

  const openStatuses: AbuseReportStatus[] = ['NEW', 'TRIAGED', 'INVESTIGATING'];
  const [duplicate, openCount] = await Promise.all([
    ctx.db.abuseReport.findFirst({
      where: {
        guildId: ctx.guildId,
        reporterId: ctx.actor.userId,
        category: input.category,
        reportedUserId: input.reportedUserId ?? null,
        status: { in: openStatuses },
        createdAt: { gte: new Date(ctx.now().getTime() - DUPLICATE_WINDOW_MS) },
      },
      select: { ref: true },
    }),
    ctx.db.abuseReport.count({
      where: { guildId: ctx.guildId, reporterId: ctx.actor.userId, status: { in: openStatuses } },
    }),
  ]);
  if (duplicate) throw conflict(SecurityText.reportDuplicateError({ ref: duplicate.ref }));
  if (openCount >= MAX_OPEN_PER_REPORTER) throw conflict(SecurityText.reportTooManyOpenError());

  return ctx.db.$transaction(async (tx) => {
    const number = await nextSequence(tx, ctx.guildId, 'abuse_report');
    const report = await tx.abuseReport.create({
      data: {
        guildId: ctx.guildId,
        number,
        ref: formatRef('R', number),
        category: input.category,
        reporterId: ctx.actor.userId,
        reportedUserId: input.reportedUserId ?? null,
        description: redactSecrets(input.description, { maskIps: false }),
        evidenceUrls: input.evidenceUrls,
        messageLink: input.messageLink ?? null,
      },
    });
    // Audit intentionally excludes the description (allegations stay in the access-controlled report).
    await audit(
      ctx,
      {
        action: 'security.report.submit',
        targetType: 'AbuseReport',
        targetId: report.id,
        metadata: { ref: report.ref, category: report.category },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: 'security.report.notify',
      dedupeKey: `security.report.notify:${report.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { reportId: report.id },
    });
    return report;
  });
}

/** Staff-facing projection. Reporter identity is only included for `security.reports.manage`. */
export type ReportView = Omit<AbuseReport, 'reporterId'> & { reporterId: string | null };

function project(ctx: Ctx, r: AbuseReport): ReportView {
  return { ...r, reporterId: can(ctx, 'security.reports.manage') ? r.reporterId : null };
}

export const listReportsSchema = paginationSchema.extend({
  status: z.enum(['NEW', 'TRIAGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED']).optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
  assigneeId: snowflake.optional(),
  q: z.string().trim().max(100).optional(),
});

export async function listReports(
  ctx: Ctx,
  raw: z.input<typeof listReportsSchema>,
): Promise<Page<ReportView>> {
  await requirePermission(ctx, 'security.reports.view');
  const f = listReportsSchema.parse(raw);
  const where: Prisma.AbuseReportWhereInput = {
    guildId: ctx.guildId,
    status: f.status,
    category: f.category,
    assigneeId: f.assigneeId,
    ...(f.q ? { OR: [{ ref: { equals: f.q.toUpperCase() } }, { reportedUserId: f.q }] } : {}),
  };
  const rows = await ctx.db.abuseReport.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  const page = toPage(rows, f.limit);
  return { ...page, items: page.items.map((r) => project(ctx, r)) };
}

export async function getReport(ctx: Ctx, id: string) {
  await requirePermission(ctx, 'security.reports.view');
  const r = await ctx.db.abuseReport.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { notes: { orderBy: { createdAt: 'asc' } } },
  });
  if (!r) throw notFound('Report');
  const { notes, ...report } = r;
  return { report: project(ctx, report), notes: can(ctx, 'security.reports.manage') ? notes : [] };
}

async function loadForUpdate(ctx: Ctx, id: string): Promise<AbuseReport> {
  await requirePermission(ctx, 'security.reports.manage');
  const r = await ctx.db.abuseReport.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!r) throw notFound('Report');
  return r;
}

export async function claimReport(ctx: Ctx, id: string): Promise<AbuseReport> {
  const r = await loadForUpdate(ctx, id);
  if (r.assigneeId === ctx.actor.userId) return r;
  if (r.status === 'RESOLVED' || r.status === 'DISMISSED')
    throw invalidState(SecurityText.reportAlreadyClosedError());
  return ctx.db.$transaction(async (tx) => {
    // Conditional update prevents two staff claiming simultaneously.
    const res = await tx.abuseReport.updateMany({
      where: { id, assigneeId: r.assigneeId },
      data: { assigneeId: ctx.actor.userId, status: r.status === 'NEW' ? 'TRIAGED' : r.status },
    });
    if (res.count === 0) throw conflict(SecurityText.reportClaimRaceError());
    await audit(
      ctx,
      {
        action: 'security.report.claim',
        targetType: 'AbuseReport',
        targetId: id,
        metadata: { previousAssignee: r.assigneeId },
      },
      tx,
    );
    return tx.abuseReport.findUniqueOrThrow({ where: { id } });
  });
}

export const updateStatusSchema = z.object({
  status: z.enum(['TRIAGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED']),
  resolution: z.string().trim().max(2000).optional(),
});

export async function updateReportStatus(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof updateStatusSchema>,
): Promise<AbuseReport> {
  const input = updateStatusSchema.parse(raw);
  const r = await loadForUpdate(ctx, id);
  if (!canTransitionReport(r.status, input.status)) {
    throw invalidState(
      SecurityText.reportTransitionError({ from: r.status.toLowerCase(), to: input.status.toLowerCase() }),
    );
  }
  const closing = input.status === 'RESOLVED' || input.status === 'DISMISSED';
  if (closing && !input.resolution)
    throw new AppError('VALIDATION', SecurityText.reportResolutionRequiredError());

  const cfg = await getGuildConfig(ctx.db, ctx.guildId);
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.abuseReport.update({
      where: { id },
      data: {
        status: input.status,
        resolution: input.resolution ? redactSecrets(input.resolution, { maskIps: false }) : r.resolution,
        resolvedAt: closing ? ctx.now() : null,
        assigneeId: r.assigneeId ?? ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'security.report.status',
        targetType: 'AbuseReport',
        targetId: id,
        metadata: { from: r.status, to: input.status },
      },
      tx,
    );
    if (closing && r.notifyReporter && cfg.reportNotifyReporter) {
      await enqueueJob(tx, {
        type: 'security.report.reporter-update',
        dedupeKey: `security.report.reporter-update:${id}`,
        runAt: ctx.now(),
        guildId: ctx.guildId,
        payload: { reportId: id },
      });
    }
    return updated;
  });
}

export async function addReportNote(ctx: Ctx, id: string, content: string) {
  const text = z.string().trim().min(1).max(2000).parse(content);
  await loadForUpdate(ctx, id);
  return ctx.db.$transaction(async (tx) => {
    const note = await tx.abuseReportNote.create({
      data: { reportId: id, authorId: ctx.actor.userId, content: redactSecrets(text, { maskIps: false }) },
    });
    await audit(ctx, { action: 'security.report.note', targetType: 'AbuseReport', targetId: id }, tx);
    return note;
  });
}

/** Retention: delete closed reports (and their notes) older than the configured window. */
export async function purgeExpiredReports(db: Ctx['db'], guildId: string, now: Date): Promise<number> {
  const cfg = await getGuildConfig(db, guildId);
  const cutoff = new Date(now.getTime() - cfg.reportRetentionDays * 86_400_000);
  const res = await db.abuseReport.deleteMany({
    where: { guildId, status: { in: ['RESOLVED', 'DISMISSED'] }, resolvedAt: { lt: cutoff } },
  });
  return res.count;
}
