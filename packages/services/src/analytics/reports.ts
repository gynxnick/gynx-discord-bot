import {
  isUniqueViolation,
  type Db,
  type GeneratedReport,
  type Prisma,
  type PrismaClient,
  type ReportDefinition,
} from '@gynx/database';
import {
  WEEKDAYS,
  dateKeyInZone,
  isValidTimeZone,
  nextWeeklyOccurrence,
  redactSecrets,
  truncate,
  zonedParts,
  zonedToUtc,
  type Weekday,
} from '@gynx/shared';
import { getGuildConfig } from '../core/config';
import type { MessageBody } from '../core/discord-port';
import { enqueueJob } from '../core/jobs';
import type { Period } from './metrics';
import { reportEmbeds } from './render';
import { buildReportData, renderMarkdown, type ReportData } from './report';

export const DEFAULT_REPORT_NAME = 'Weekly CEO report';
export const DELIVER_JOB = 'analytics.report.deliver';
export const deliverDedupeKey = (reportId: string) => `${DELIVER_JOB}:${reportId}`;

const asWeekday = (d: string): Weekday =>
  (WEEKDAYS as readonly string[]).includes(d) ? (d as Weekday) : 'MONDAY';
const safeTz = (tz: string, fallback = 'UTC') =>
  isValidTimeZone(tz) ? tz : isValidTimeZone(fallback) ? fallback : 'UTC';

/**
 * The most recent scheduled occurrence that is ≤ now, starting from the stored
 * `nextRunAt`. If the worker was down for several cycles, the missed periods are
 * skipped and only the latest due period is generated (no burst of stale reports).
 */
export function latestDueOccurrence(
  nextRunAt: Date,
  now: Date,
  day: Weekday,
  time: string,
  tz: string,
): Date {
  let due = nextRunAt;
  for (let i = 0; i < 1000; i++) {
    const n = nextWeeklyOccurrence(due, day, time, tz);
    if (n.getTime() > now.getTime()) break;
    due = n;
  }
  return due;
}

/** Report window ending at `end`, `periodDays` calendar days long at the same wall-clock time (DST-safe). */
export function reportPeriodFor(end: Date, periodDays: number, tz: string): Period {
  const p = zonedParts(end, tz);
  return { start: zonedToUtc(p.year, p.month, p.day - periodDays, p.hour, p.minute, tz), end };
}

export function nextRunFor(def: Pick<ReportDefinition, 'day' | 'time' | 'timezone'>, after: Date): Date {
  return nextWeeklyOccurrence(after, asWeekday(def.day), def.time, safeTz(def.timezone));
}

export interface WeeklyReportSeed {
  enabled: boolean;
  day: Weekday;
  time: string;
  defaultTimezone: string;
}

/** Ensure the default weekly CEO report definition exists (never overwrites staff edits). */
export async function ensureDefaultReportDefinition(
  db: Db,
  guildId: string,
  seed: WeeklyReportSeed,
  now: Date,
): Promise<ReportDefinition | null> {
  if (!seed.enabled) return null;
  const cfg = await getGuildConfig(db, guildId);
  // GuildConfig.timezone defaults to UTC; a non-default value wins over DEFAULT_TIMEZONE.
  const timezone = safeTz(cfg.timezone !== 'UTC' ? cfg.timezone : seed.defaultTimezone);
  return db.reportDefinition.upsert({
    where: { guildId_name: { guildId, name: DEFAULT_REPORT_NAME } },
    create: {
      guildId,
      name: DEFAULT_REPORT_NAME,
      day: seed.day,
      time: seed.time,
      timezone,
      periodDays: 7,
      channelId: cfg.reportChannelId,
      nextRunAt: nextWeeklyOccurrence(now, seed.day, seed.time, timezone),
    },
    update: {},
  });
}

/**
 * Generate (or return the existing) report for a definition + period. Idempotent:
 * the unique (definitionId, periodStart) constraint guarantees one report per period
 * even with concurrent workers.
 */
export async function generateReport(
  db: Db,
  def: ReportDefinition,
  period: Period,
  now: Date,
): Promise<{ report: GeneratedReport; created: boolean }> {
  const existing = await db.generatedReport.findUnique({
    where: { definitionId_periodStart: { definitionId: def.id, periodStart: period.start } },
  });
  if (existing) return { report: existing, created: false };

  const cfg = await getGuildConfig(db, def.guildId);
  const tz = safeTz(def.timezone, cfg.timezone);
  const data = await buildReportData(db, {
    guildId: def.guildId,
    period,
    opts: { tz, now, activeMemberMinMessages: cfg.activeMemberMinMessages },
  });
  const markdown = renderMarkdown(data, def.name);
  try {
    const report = await db.generatedReport.create({
      data: {
        guildId: def.guildId,
        definitionId: def.id,
        periodStart: period.start,
        periodEnd: period.end,
        data: data as unknown as Prisma.InputJsonValue,
        markdown,
      },
    });
    const weekStart = dateKeyInZone(period.start, tz);
    const flat = data.flat as unknown as Prisma.InputJsonValue;
    await db.analyticsWeekly.upsert({
      where: { guildId_weekStart: { guildId: def.guildId, weekStart } },
      create: { guildId: def.guildId, weekStart, metrics: flat, computedAt: now },
      update: { metrics: flat, computedAt: now },
    });
    return { report, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const report = await db.generatedReport.findUniqueOrThrow({
      where: { definitionId_periodStart: { definitionId: def.id, periodStart: period.start } },
    });
    return { report, created: false };
  }
}

export interface DueReportResult {
  definitionId: string;
  reportId: string;
  created: boolean;
  periodStart: Date;
}

/**
 * Scheduler step (worker, every few minutes): initialise missing `nextRunAt`, generate
 * every due report, enqueue its delivery job and advance the schedule.
 */
export async function runDueReports(
  db: PrismaClient,
  guildId: string,
  now: Date,
  seed: WeeklyReportSeed,
): Promise<DueReportResult[]> {
  await ensureDefaultReportDefinition(db, guildId, seed, now);
  const defs = await db.reportDefinition.findMany({ where: { guildId, enabled: true } });
  const results: DueReportResult[] = [];
  for (const def of defs) {
    if (!def.nextRunAt) {
      await db.reportDefinition.update({ where: { id: def.id }, data: { nextRunAt: nextRunFor(def, now) } });
      continue;
    }
    if (def.nextRunAt.getTime() > now.getTime()) continue;
    const tz = safeTz(def.timezone);
    const end = latestDueOccurrence(def.nextRunAt, now, asWeekday(def.day), def.time, tz);
    const period = reportPeriodFor(end, def.periodDays, tz);
    const { report, created } = await generateReport(db, def, period, now);
    await db.$transaction(async (tx) => {
      if (!report.deliveredAt) {
        await enqueueJob(tx, {
          type: DELIVER_JOB,
          dedupeKey: deliverDedupeKey(report.id),
          runAt: now,
          guildId,
          payload: { reportId: report.id },
        });
      }
      await tx.reportDefinition.updateMany({
        where: { id: def.id, nextRunAt: def.nextRunAt },
        data: { lastRunAt: now, nextRunAt: nextRunFor(def, end) },
      });
    });
    results.push({ definitionId: def.id, reportId: report.id, created, periodStart: period.start });
  }
  return results;
}

export interface ReportFile {
  name: string;
  data: Buffer;
}
/** Sends a channel message with one file attachment. The worker implements it with @discordjs/rest. */
export type ReportSender = (
  channelId: string,
  body: MessageBody,
  file: ReportFile,
) => Promise<{ id: string }>;

export type DeliveryOutcome = 'delivered' | 'already-delivered' | 'no-channel' | 'missing';

export const reportFileName = (r: Pick<GeneratedReport, 'periodStart' | 'periodEnd'>, tz: string) =>
  `gynx-report-${dateKeyInZone(r.periodStart, tz)}_${dateKeyInZone(new Date(r.periodEnd.getTime() - 1), tz)}.md`;

/**
 * Deliver a generated report: summary embed + the full Markdown as a .md attachment.
 * Never regenerates. On failure the error is recorded and rethrown so the job runner
 * retries *delivery only* with backoff.
 */
export async function deliverReport(
  db: Db,
  reportId: string,
  send: ReportSender,
  opts: { now: Date; dashboardUrl?: string },
): Promise<DeliveryOutcome> {
  const report = await db.generatedReport.findUnique({
    where: { id: reportId },
    include: { definition: true },
  });
  if (!report) return 'missing';
  if (report.deliveredAt) return 'already-delivered';
  const cfg = await getGuildConfig(db, report.guildId);
  const channelId = report.definition.channelId ?? cfg.reportChannelId;
  if (!channelId) {
    await db.generatedReport.update({
      where: { id: report.id },
      data: { deliveryError: 'No report channel configured (set it with /config channel set report).' },
    });
    return 'no-channel';
  }
  const data = report.data as unknown as ReportData;
  const tz = safeTz(data.timezone ?? report.definition.timezone);
  try {
    const msg = await send(
      channelId,
      {
        embeds: reportEmbeds(data, {
          title: report.definition.name,
          dashboardUrl: opts.dashboardUrl,
          reportId: report.id,
          footer: cfg.embedFooter,
        }),
      },
      { name: reportFileName(report, tz), data: Buffer.from(report.markdown, 'utf8') },
    );
    await db.generatedReport.update({
      where: { id: report.id },
      data: { deliveredAt: opts.now, messageId: msg.id, deliveryError: null },
    });
    return 'delivered';
  } catch (e) {
    const message = truncate(redactSecrets(e instanceof Error ? e.message : String(e)), 500);
    await db.generatedReport.update({ where: { id: report.id }, data: { deliveryError: message } });
    throw e;
  }
}
