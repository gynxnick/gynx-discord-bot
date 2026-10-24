import { z } from 'zod';
import { isUniqueViolation, type GeneratedReport, type Prisma, type ReportDefinition } from '@gynx/database';
import {
  WEEKDAYS,
  conflict,
  cursorArgs,
  invalidState,
  isValidTimeZone,
  notFound,
  paginationSchema,
  toPage,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import {
  collectCommunity,
  collectInfrastructure,
  collectMarketing,
  collectModeration,
  collectOutstanding,
  collectReferrals,
  mergeSection,
  sourcePresence,
  type CollectOptions,
  type SourcePresence,
} from './collect';
import { previousPeriod, type Period } from './metrics';
import { buildReportData, toCsv, type ReportData } from './report';
import { deliverDedupeKey, DELIVER_JOB, nextRunFor, reportFileName } from './reports';

// ── Ranges ─────────────────────────────────────────────────────────────────

export const RANGE_PRESETS = ['7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const rangeSchema = z.union([
  z.enum(RANGE_PRESETS),
  z
    .object({ start: z.coerce.date(), end: z.coerce.date() })
    .refine((r) => r.end.getTime() > r.start.getTime(), 'End must be after start.')
    .refine(
      (r) => r.end.getTime() - r.start.getTime() <= 366 * 86_400_000,
      'Ranges are limited to one year.',
    ),
]);
export type RangeInput = z.input<typeof rangeSchema>;

/** Preset ranges end "now" and cover the preceding N × 24h. */
export function resolveRange(raw: RangeInput, now: Date): Period {
  const r = rangeSchema.parse(raw);
  if (typeof r === 'string')
    return { start: new Date(now.getTime() - Number.parseInt(r, 10) * 86_400_000), end: now };
  return { start: r.start, end: r.end };
}

async function viewContext(
  ctx: Ctx,
  raw: RangeInput,
): Promise<{ period: Period; opts: CollectOptions; src: SourcePresence }> {
  const cfg = await requireModule(ctx, 'analytics');
  await requirePermission(ctx, 'analytics.view');
  await requireRate(ctx, 'analytics.query', 30, 60);
  const now = ctx.now();
  const period = resolveRange(raw, now);
  const opts: CollectOptions = {
    tz: isValidTimeZone(cfg.timezone) ? cfg.timezone : 'UTC',
    now,
    activeMemberMinMessages: cfg.activeMemberMinMessages,
  };
  return { period, opts, src: await sourcePresence(ctx.db, ctx.guildId) };
}

const periodJson = (p: Period) => ({ start: p.start.toISOString(), end: p.end.toISOString() });

async function section<S extends object>(
  ctx: Ctx,
  raw: RangeInput,
  fn: (db: Ctx['db'], g: string, p: Period, o: CollectOptions, s: SourcePresence) => Promise<S>,
) {
  const { period, opts, src } = await viewContext(ctx, raw);
  const prev = previousPeriod(period);
  const [cur, before] = await Promise.all([
    fn(ctx.db, ctx.guildId, period, opts, src),
    fn(ctx.db, ctx.guildId, prev, opts, src),
  ]);
  return {
    period: periodJson(period),
    previousPeriod: periodJson(prev),
    timezone: opts.tz,
    metrics: mergeSection(cur, before),
  };
}

// ── Dashboard / bot read API (analytics.view) ──────────────────────────────

/** Every section for the range plus executive summary and flat comparison table (computed live). */
export async function getOverview(ctx: Ctx, range: RangeInput): Promise<ReportData> {
  const { period, opts } = await viewContext(ctx, range);
  return buildReportData(ctx.db, { guildId: ctx.guildId, period, opts });
}

export const getCommunityMetrics = (ctx: Ctx, range: RangeInput) => section(ctx, range, collectCommunity);
export const getReferralMetrics = (ctx: Ctx, range: RangeInput) => section(ctx, range, collectReferrals);
export const getModerationMetrics = (ctx: Ctx, range: RangeInput) => section(ctx, range, collectModeration);
export const getInfrastructureMetrics = (ctx: Ctx, range: RangeInput) =>
  section(ctx, range, collectInfrastructure);
export async function getMarketingMetrics(ctx: Ctx, range: RangeInput) {
  const [marketing, referrals] = await Promise.all([
    section(ctx, range, collectMarketing),
    section(ctx, range, collectReferrals),
  ]);
  return { ...marketing, referrals: referrals.metrics };
}

export async function getOutstandingIssues(ctx: Ctx) {
  await requireModule(ctx, 'analytics');
  await requirePermission(ctx, 'analytics.view');
  return collectOutstanding(ctx.db, ctx.guildId, ctx.now());
}

export interface StaffStatsRow {
  userId: string;
  moderationActions: number;
  reportsClaimed: number;
  reportsResolved: number;
  incidentUpdates: number;
  partnerReviews: number;
  total: number;
}

/** Per-staff activity counts for the range (counts only — no content). */
export async function staffStats(
  ctx: Ctx,
  range: RangeInput,
): Promise<{ period: { start: string; end: string }; rows: StaffStatsRow[] }> {
  const { period } = await viewContext(ctx, range);
  const g = ctx.guildId;
  const at = { gte: period.start, lt: period.end };
  const [mod, claimed, resolved, updates, reviews] = await Promise.all([
    ctx.db.moderationAction.groupBy({
      by: ['moderatorId'],
      where: { guildId: g, createdAt: at, moderatorId: { not: 'automod' } },
      _count: { _all: true },
    }),
    ctx.db.securityAuditEvent.groupBy({
      by: ['actorId'],
      where: { guildId: g, action: 'security.report.claim', result: 'SUCCESS', createdAt: at },
      _count: { _all: true },
    }),
    ctx.db.abuseReport.groupBy({
      by: ['assigneeId'],
      where: { guildId: g, status: 'RESOLVED', resolvedAt: at, assigneeId: { not: null } },
      _count: { _all: true },
    }),
    ctx.db.incidentUpdate.groupBy({
      by: ['authorId'],
      where: { createdAt: at, incident: { guildId: g } },
      _count: { _all: true },
    }),
    ctx.db.partnerApplication.groupBy({
      by: ['reviewerId'],
      where: { guildId: g, reviewedAt: at, reviewerId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const rows = new Map<string, StaffStatsRow>();
  const add = (userId: string | null, key: keyof Omit<StaffStatsRow, 'userId' | 'total'>, n: number) => {
    if (!userId || userId === 'system' || userId === 'automod') return;
    let r = rows.get(userId);
    if (!r)
      rows.set(
        userId,
        (r = {
          userId,
          moderationActions: 0,
          reportsClaimed: 0,
          reportsResolved: 0,
          incidentUpdates: 0,
          partnerReviews: 0,
          total: 0,
        }),
      );
    r[key] += n;
    r.total += n;
  };
  for (const r of mod) add(r.moderatorId, 'moderationActions', r._count._all);
  for (const r of claimed) add(r.actorId, 'reportsClaimed', r._count._all);
  for (const r of resolved) add(r.assigneeId, 'reportsResolved', r._count._all);
  for (const r of updates) add(r.authorId, 'incidentUpdates', r._count._all);
  for (const r of reviews) add(r.reviewerId, 'partnerReviews', r._count._all);
  return {
    period: periodJson(period),
    rows: [...rows.values()].sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId)),
  };
}

// ── Generated reports ──────────────────────────────────────────────────────

export const listReportsSchema = paginationSchema.extend({
  definitionId: z.string().min(1).max(64).optional(),
});
export type ReportListItem = Omit<GeneratedReport, 'data' | 'markdown'>;

export async function listReports(
  ctx: Ctx,
  raw: z.input<typeof listReportsSchema> = {},
): Promise<Page<ReportListItem>> {
  await requireModule(ctx, 'analytics');
  await requirePermission(ctx, 'analytics.view');
  const q = listReportsSchema.parse(raw);
  const rows = await ctx.db.generatedReport.findMany({
    where: { guildId: ctx.guildId, definitionId: q.definitionId },
    orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      guildId: true,
      definitionId: true,
      periodStart: true,
      periodEnd: true,
      deliveredAt: true,
      deliveryError: true,
      messageId: true,
      createdAt: true,
    },
    ...cursorArgs(q),
  });
  return toPage(rows, q.limit);
}

export async function getReport(ctx: Ctx, id: string): Promise<GeneratedReport & { definitionName: string }> {
  await requireModule(ctx, 'analytics');
  await requirePermission(ctx, 'analytics.view');
  const r = await ctx.db.generatedReport.findFirst({
    where: { id, guildId: ctx.guildId },
    include: { definition: { select: { name: true } } },
  });
  if (!r) throw notFound('Report');
  const { definition, ...report } = r;
  return { ...report, definitionName: definition.name };
}

export const EXPORT_FORMATS = ['markdown', 'json', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Export a generated report. CSV = the flat metric table. Audited. */
export async function exportReport(
  ctx: Ctx,
  reportId: string,
  format: ExportFormat,
): Promise<{ filename: string; contentType: string; content: string }> {
  await requireModule(ctx, 'analytics');
  await requirePermission(ctx, 'analytics.export', 'analytics.export');
  const fmt = z.enum(EXPORT_FORMATS).parse(format);
  await requireRate(ctx, 'analytics.export', 20, 60);
  const r = await ctx.db.generatedReport.findFirst({ where: { id: reportId, guildId: ctx.guildId } });
  if (!r) throw notFound('Report');
  const data = r.data as unknown as ReportData;
  const base = reportFileName(r, data.timezone ?? 'UTC').replace(/\.md$/, '');
  const out =
    fmt === 'markdown'
      ? { filename: `${base}.md`, contentType: 'text/markdown; charset=utf-8', content: r.markdown }
      : fmt === 'json'
        ? {
            filename: `${base}.json`,
            contentType: 'application/json',
            content: JSON.stringify(data, null, 2),
          }
        : {
            filename: `${base}.csv`,
            contentType: 'text/csv; charset=utf-8',
            content: toCsv(data.flat ?? []),
          };
  await audit(ctx, {
    action: 'analytics.export',
    targetType: 'GeneratedReport',
    targetId: r.id,
    metadata: { format: fmt },
  });
  return out;
}

/** Re-queue delivery of an undelivered report (e.g. after fixing the channel). Never regenerates. */
export async function retryReportDelivery(ctx: Ctx, reportId: string): Promise<void> {
  await requirePermission(ctx, 'settings.manage');
  const r = await ctx.db.generatedReport.findFirst({
    where: { id: reportId, guildId: ctx.guildId },
    select: { id: true, deliveredAt: true },
  });
  if (!r) throw notFound('Report');
  if (r.deliveredAt) throw invalidState('This report has already been delivered.');
  const now = ctx.now();
  await ctx.db.$transaction(async (tx) => {
    const key = deliverDedupeKey(r.id);
    const existing = await tx.scheduledJob.findUnique({ where: { dedupeKey: key } });
    if (!existing) {
      await tx.scheduledJob.create({
        data: {
          type: DELIVER_JOB,
          dedupeKey: key,
          runAt: now,
          guildId: ctx.guildId,
          payload: { reportId: r.id },
        },
      });
    } else if (existing.status !== 'PENDING' && existing.status !== 'RUNNING') {
      await tx.scheduledJob.update({
        where: { id: existing.id },
        data: { status: 'PENDING', attempts: 0, runAt: now, lastError: null },
      });
    }
    await audit(
      ctx,
      { action: 'analytics.report.redeliver', targetType: 'GeneratedReport', targetId: r.id },
      tx,
    );
  });
}

// ── Report definitions (settings.manage to change) ─────────────────────────

const snowflake = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)');
const tzSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimeZone, 'Unknown time zone (use an IANA name such as Europe/London)');

export const reportDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  day: z.enum(WEEKDAYS),
  time: timeSchema,
  timezone: tzSchema,
  periodDays: z.number().int().min(1).max(31).default(7),
  channelId: snowflake.nullable().default(null),
});
export const reportDefinitionPatchSchema = reportDefinitionSchema.partial();

export async function listReportDefinitions(ctx: Ctx): Promise<ReportDefinition[]> {
  await requirePermission(ctx, 'analytics.view');
  return ctx.db.reportDefinition.findMany({ where: { guildId: ctx.guildId }, orderBy: { name: 'asc' } });
}

export async function createReportDefinition(
  ctx: Ctx,
  raw: z.input<typeof reportDefinitionSchema>,
): Promise<ReportDefinition> {
  await requirePermission(ctx, 'settings.manage', 'analytics.report-definition.create');
  const input = reportDefinitionSchema.parse(raw);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const def = await tx.reportDefinition.create({
        data: {
          ...input,
          guildId: ctx.guildId,
          nextRunAt: input.enabled ? nextRunFor(input, ctx.now()) : null,
        },
      });
      await audit(
        ctx,
        {
          action: 'analytics.report-definition.create',
          targetType: 'ReportDefinition',
          targetId: def.id,
          metadata: { ...input },
        },
        tx,
      );
      return def;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A report definition with that name already exists.');
    throw e;
  }
}

export async function updateReportDefinition(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof reportDefinitionPatchSchema>,
): Promise<ReportDefinition> {
  await requirePermission(ctx, 'settings.manage', 'analytics.report-definition.update');
  const patch = reportDefinitionPatchSchema.parse(raw);
  const def = await ctx.db.reportDefinition.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!def) throw notFound('Report definition');
  const changed = changedKeys(def as unknown as Record<string, unknown>, patch);
  if (changed.length === 0) return def;
  const merged = { ...def, ...patch };
  const scheduleChanged = changed.some((k) => ['day', 'time', 'timezone', 'enabled'].includes(k));
  const data: Prisma.ReportDefinitionUpdateInput = { ...patch };
  if (scheduleChanged) data.nextRunAt = merged.enabled ? nextRunFor(merged, ctx.now()) : null;
  try {
    return await ctx.db.$transaction(async (tx) => {
      const updated = await tx.reportDefinition.update({ where: { id }, data });
      await audit(
        ctx,
        {
          action: 'analytics.report-definition.update',
          targetType: 'ReportDefinition',
          targetId: id,
          metadata: diffMetadata(def as unknown as Record<string, unknown>, patch, changed),
        },
        tx,
      );
      return updated;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A report definition with that name already exists.');
    throw e;
  }
}

export async function deleteReportDefinition(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'settings.manage', 'analytics.report-definition.delete');
  const def = await ctx.db.reportDefinition.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!def) throw notFound('Report definition');
  await ctx.db.$transaction(async (tx) => {
    await tx.reportDefinition.delete({ where: { id } });
    await audit(
      ctx,
      {
        action: 'analytics.report-definition.delete',
        targetType: 'ReportDefinition',
        targetId: id,
        metadata: { name: def.name },
      },
      tx,
    );
  });
}

// ── Diff helpers (shared with settings) ────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function changedKeys(before: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => patch[k] !== undefined && !same(before[k], patch[k]));
}

/** Audit metadata containing before/after for the changed keys only. */
export function diffMetadata(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  keys: readonly string[],
) {
  return {
    changed: [...keys],
    before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])),
    after: Object.fromEntries(keys.map((k) => [k, patch[k] ?? null])),
  };
}
