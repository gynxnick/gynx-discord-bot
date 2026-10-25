import { z } from 'zod';
import type { GuildConfig, Prisma } from '@gynx/database';
import { privilegedKeysIn } from '@gynx/permissions';
import {
  AppError,
  WEEKDAYS,
  isValidTimeZone,
  nextWeeklyOccurrence,
  validation,
  type Weekday,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import { MODULES, getGuildConfig } from '../core/config';
import type { Ctx } from '../core/context';
import { DEFAULT_REPORT_NAME } from './reports';
import { AnalyticsText } from './texts';
import { changedKeys, diffMetadata } from './service';

/** Channel kinds configurable with `/config channel set` → GuildConfig column. */
export const CHANNEL_KINDS = {
  log: 'logChannelId',
  modLog: 'modLogChannelId',
  statusBoard: 'statusBoardChannelId',
  supportStatus: 'supportStatusChannelId',
  status: 'statusChannelId',
  incident: 'incidentChannelId',
  announcement: 'announcementChannelId',
  suggestion: 'suggestionChannelId',
  security: 'securityChannelId',
  report: 'reportChannelId',
  event: 'eventChannelId',
  partnerReview: 'partnerReviewChannelId',
} as const satisfies Record<string, keyof GuildConfig>;
export type ChannelKind = keyof typeof CHANNEL_KINDS;
export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  log: 'Bot log',
  modLog: 'Moderation log',
  statusBoard: 'Live status board',
  supportStatus: 'Support status panel',
  status: 'Status alerts',
  incident: 'Incident updates',
  announcement: 'Announcements',
  suggestion: 'Suggestions',
  security: 'Security (private)',
  report: 'CEO reports (private)',
  event: 'Events',
  partnerReview: 'Partner review (private)',
};

/** Staff-only channels must never be the same as a public-facing channel. */
const PRIVATE_CHANNELS: readonly ChannelKind[] = ['log', 'modLog', 'security', 'report', 'partnerReview'];
const PUBLIC_CHANNELS: readonly ChannelKind[] = [
  'statusBoard',
  'supportStatus',
  'status',
  'incident',
  'announcement',
  'suggestion',
  'event',
];

export const ROLE_KINDS = {
  staffPing: 'staffPingRoleId',
  escalation: 'escalationRoleId',
  statusAlert: 'statusAlertRoleId',
  partner: 'partnerRoleId',
} as const satisfies Record<string, keyof GuildConfig>;
export type RoleKind = keyof typeof ROLE_KINDS;
export const ROLE_KIND_LABELS: Record<RoleKind, string> = {
  staffPing: 'Staff ping',
  escalation: 'Escalation',
  statusAlert: 'Status alerts',
  partner: 'Partner',
};

const snowflake = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https:\/\//i.test(u), 'The support URL must use https://');
const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const settingsPatchSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine(isValidTimeZone, 'Unknown time zone (use an IANA name such as Europe/London)'),
    enabledModules: z.array(z.enum(MODULES)).max(MODULES.length),
    channels: z
      .object(
        Object.fromEntries(
          Object.keys(CHANNEL_KINDS).map((k) => [k, snowflake.nullable().optional()]),
        ) as Record<ChannelKind, z.ZodOptional<z.ZodNullable<typeof snowflake>>>,
      )
      .strict(),
    roles: z
      .object(
        Object.fromEntries(
          Object.keys(ROLE_KINDS).map((k) => [k, snowflake.nullable().optional()]),
        ) as Record<RoleKind, z.ZodOptional<z.ZodNullable<typeof snowflake>>>,
      )
      .strict(),
    supportUrl: httpsUrl.nullable(),
    websiteUrl: httpsUrl.nullable(),
    dutyMaxHours: int(1, 48),
    status: z
      .object({
        checkIntervalSeconds: int(15, 3600),
        failureThreshold: int(1, 20),
        recoveryThreshold: int(1, 20),
        alertCooldownMinutes: int(0, 1440),
      })
      .partial()
      .strict(),
    retention: z
      .object({
        diagnosticHours: int(1, 168),
        reportDays: int(30, 3650),
        auditDays: int(90, 3650),
        healthCheckDays: int(7, 365),
        activityDays: int(30, 730),
      })
      .partial()
      .strict(),
    activeMemberMinMessages: int(1, 1000),
    reportNotifyReporter: z.boolean(),
    suggestionThreads: z.boolean(),
    embedFooter: z.string().trim().min(1).max(100),
    reportSchedule: z
      .object({
        day: z.enum(WEEKDAYS),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)'),
        enabled: z.boolean().optional(),
      })
      .strict(),
  })
  .partial()
  .strict();
export type SettingsPatch = z.input<typeof settingsPatchSchema>;

export interface GuildSettings {
  timezone: string;
  enabledModules: string[];
  channels: Record<ChannelKind, string | null>;
  roles: Record<RoleKind, string | null>;
  supportUrl: string | null;
  websiteUrl: string | null;
  dutyMaxHours: number;
  status: {
    checkIntervalSeconds: number;
    failureThreshold: number;
    recoveryThreshold: number;
    alertCooldownMinutes: number;
  };
  retention: {
    diagnosticHours: number;
    reportDays: number;
    auditDays: number;
    healthCheckDays: number;
    activityDays: number;
  };
  activeMemberMinMessages: number;
  reportNotifyReporter: boolean;
  suggestionThreads: boolean;
  embedFooter: string;
  reportSchedule: {
    day: string;
    time: string;
    timezone: string;
    enabled: boolean;
    nextRunAt: string | null;
    channelId: string | null;
  } | null;
}

function toView(
  cfg: GuildConfig,
  def: {
    day: string;
    time: string;
    timezone: string;
    enabled: boolean;
    nextRunAt: Date | null;
    channelId: string | null;
  } | null,
): GuildSettings {
  return {
    timezone: cfg.timezone,
    enabledModules: [...cfg.enabledModules],
    channels: Object.fromEntries(Object.entries(CHANNEL_KINDS).map(([k, col]) => [k, cfg[col]])) as Record<
      ChannelKind,
      string | null
    >,
    roles: Object.fromEntries(Object.entries(ROLE_KINDS).map(([k, col]) => [k, cfg[col]])) as Record<
      RoleKind,
      string | null
    >,
    supportUrl: cfg.supportUrl,
    websiteUrl: cfg.websiteUrl,
    dutyMaxHours: cfg.dutyMaxHours,
    status: {
      checkIntervalSeconds: cfg.statusCheckIntervalSeconds,
      failureThreshold: cfg.statusFailureThreshold,
      recoveryThreshold: cfg.statusRecoveryThreshold,
      alertCooldownMinutes: cfg.statusAlertCooldownMinutes,
    },
    retention: {
      diagnosticHours: cfg.diagnosticRetentionHours,
      reportDays: cfg.reportRetentionDays,
      auditDays: cfg.auditRetentionDays,
      healthCheckDays: cfg.healthCheckRetentionDays,
      activityDays: cfg.activityRetentionDays,
    },
    activeMemberMinMessages: cfg.activeMemberMinMessages,
    reportNotifyReporter: cfg.reportNotifyReporter,
    suggestionThreads: cfg.suggestionThreads,
    embedFooter: cfg.embedFooter,
    reportSchedule: def
      ? {
          day: def.day,
          time: def.time,
          timezone: def.timezone,
          enabled: def.enabled,
          nextRunAt: def.nextRunAt?.toISOString() ?? null,
          channelId: def.channelId,
        }
      : null,
  };
}

export async function getSettings(ctx: Ctx): Promise<GuildSettings> {
  await requirePermission(ctx, 'settings.manage');
  const cfg = await getGuildConfig(ctx.db, ctx.guildId);
  const def = await ctx.db.reportDefinition.findUnique({
    where: { guildId_name: { guildId: ctx.guildId, name: DEFAULT_REPORT_NAME } },
  });
  return toView(cfg, def);
}

type ConfigColumns = Partial<Omit<GuildConfig, 'guildId' | 'updatedAt'>>;

/** Map a validated patch onto GuildConfig columns. */
function toColumns(p: z.output<typeof settingsPatchSchema>): ConfigColumns {
  const c: ConfigColumns = {};
  if (p.timezone !== undefined) c.timezone = p.timezone;
  if (p.enabledModules !== undefined) c.enabledModules = MODULES.filter((m) => p.enabledModules!.includes(m));
  for (const [k, v] of Object.entries(p.channels ?? {}))
    if (v !== undefined) (c as Record<string, unknown>)[CHANNEL_KINDS[k as ChannelKind]] = v;
  for (const [k, v] of Object.entries(p.roles ?? {}))
    if (v !== undefined) (c as Record<string, unknown>)[ROLE_KINDS[k as RoleKind]] = v;
  if (p.supportUrl !== undefined) c.supportUrl = p.supportUrl;
  if (p.websiteUrl !== undefined) c.websiteUrl = p.websiteUrl;
  if (p.dutyMaxHours !== undefined) c.dutyMaxHours = p.dutyMaxHours;
  const s = p.status ?? {};
  if (s.checkIntervalSeconds !== undefined) c.statusCheckIntervalSeconds = s.checkIntervalSeconds;
  if (s.failureThreshold !== undefined) c.statusFailureThreshold = s.failureThreshold;
  if (s.recoveryThreshold !== undefined) c.statusRecoveryThreshold = s.recoveryThreshold;
  if (s.alertCooldownMinutes !== undefined) c.statusAlertCooldownMinutes = s.alertCooldownMinutes;
  const r = p.retention ?? {};
  if (r.diagnosticHours !== undefined) c.diagnosticRetentionHours = r.diagnosticHours;
  if (r.reportDays !== undefined) c.reportRetentionDays = r.reportDays;
  if (r.auditDays !== undefined) c.auditRetentionDays = r.auditDays;
  if (r.healthCheckDays !== undefined) c.healthCheckRetentionDays = r.healthCheckDays;
  if (r.activityDays !== undefined) c.activityRetentionDays = r.activityDays;
  if (p.activeMemberMinMessages !== undefined) c.activeMemberMinMessages = p.activeMemberMinMessages;
  if (p.reportNotifyReporter !== undefined) c.reportNotifyReporter = p.reportNotifyReporter;
  if (p.suggestionThreads !== undefined) c.suggestionThreads = p.suggestionThreads;
  if (p.embedFooter !== undefined) c.embedFooter = p.embedFooter;
  return c;
}

/** Cross-field safety rules evaluated on the merged (resulting) configuration. */
async function validateMerged(ctx: Ctx, merged: GuildConfig, changed: readonly string[]): Promise<void> {
  for (const [kind, col] of Object.entries(ROLE_KINDS)) {
    if (changed.includes(col) && merged[col] === ctx.guildId)
      throw validation(AnalyticsText.errorEveryoneRole({ kind: ROLE_KIND_LABELS[kind as RoleKind] }));
  }
  const partner = merged.partnerRoleId;
  if (partner) {
    for (const kind of ['staffPing', 'escalation'] as const) {
      if (merged[ROLE_KINDS[kind]] === partner) {
        throw new AppError(
          'FORBIDDEN',
          AnalyticsText.errorPartnerRoleConflict({ kind: ROLE_KIND_LABELS[kind] }),
        );
      }
    }
    if (changed.includes('partnerRoleId')) {
      const grants = await ctx.db.staffPermission.findMany({
        where: { guildId: ctx.guildId, subjectType: 'ROLE', subjectId: partner, effect: 'ALLOW' },
        select: { permission: true },
      });
      const privileged = grants.flatMap((g) => privilegedKeysIn(g.permission));
      if (privileged.length > 0) {
        throw new AppError(
          'FORBIDDEN',
          AnalyticsText.errorPartnerRolePrivileged({ permissions: [...new Set(privileged)].join(', ') }),
        );
      }
    }
  }
  for (const priv of PRIVATE_CHANNELS) {
    const id = merged[CHANNEL_KINDS[priv]];
    if (!id) continue;
    for (const pub of PUBLIC_CHANNELS) {
      if (
        merged[CHANNEL_KINDS[pub]] === id &&
        (changed.includes(CHANNEL_KINDS[priv]) || changed.includes(CHANNEL_KINDS[pub]))
      ) {
        throw validation(
          AnalyticsText.errorPrivateChannelConflict({
            privateKind: CHANNEL_KIND_LABELS[priv],
            publicKind: CHANNEL_KIND_LABELS[pub],
          }),
        );
      }
    }
  }
}

/**
 * Update guild settings (settings.manage). Validates every field, enforces cross-field
 * safety rules, keeps the default weekly report definition in sync (timezone, channel,
 * schedule) and audits before/after values of the changed keys only.
 */
export async function updateSettings(ctx: Ctx, raw: SettingsPatch): Promise<GuildSettings> {
  await requirePermission(ctx, 'settings.manage', 'settings.update');
  const patch = settingsPatchSchema.parse(raw);
  const before = await getGuildConfig(ctx.db, ctx.guildId);
  const cols = toColumns(patch);
  const changed = changedKeys(before as unknown as Record<string, unknown>, cols as Record<string, unknown>);
  const merged = { ...before, ...cols } as GuildConfig;
  await validateMerged(ctx, merged, changed);

  const now = ctx.now();
  return ctx.db.$transaction(async (tx) => {
    const cfg = changed.length
      ? await tx.guildConfig.update({
          where: { guildId: ctx.guildId },
          data: Object.fromEntries(
            changed.map((k) => [k, (cols as Record<string, unknown>)[k]]),
          ) as Prisma.GuildConfigUpdateInput,
        })
      : before;

    let def = await tx.reportDefinition.findUnique({
      where: { guildId_name: { guildId: ctx.guildId, name: DEFAULT_REPORT_NAME } },
    });
    const defBefore = def
      ? {
          day: def.day,
          time: def.time,
          timezone: def.timezone,
          enabled: def.enabled,
          channelId: def.channelId,
        }
      : null;
    const sched = patch.reportSchedule;
    if (sched || (def && (changed.includes('timezone') || changed.includes('reportChannelId')))) {
      const day = (sched?.day ?? def?.day ?? 'MONDAY') as Weekday;
      const time = sched?.time ?? def?.time ?? '09:00';
      const enabled = sched?.enabled ?? def?.enabled ?? true;
      const timezone = changed.includes('timezone') || !def ? cfg.timezone : def.timezone;
      const channelId = changed.includes('reportChannelId') || !def ? cfg.reportChannelId : def.channelId;
      const nextRunAt = enabled ? nextWeeklyOccurrence(now, day, time, timezone) : null;
      def = def
        ? await tx.reportDefinition.update({
            where: { id: def.id },
            data: { day, time, enabled, timezone, channelId, nextRunAt },
          })
        : await tx.reportDefinition.create({
            data: {
              guildId: ctx.guildId,
              name: DEFAULT_REPORT_NAME,
              day,
              time,
              enabled,
              timezone,
              channelId,
              periodDays: 7,
              nextRunAt,
            },
          });
    }
    const defAfter = def
      ? {
          day: def.day,
          time: def.time,
          timezone: def.timezone,
          enabled: def.enabled,
          channelId: def.channelId,
        }
      : null;
    const scheduleChanged = JSON.stringify(defBefore) !== JSON.stringify(defAfter);

    if (changed.length || scheduleChanged) {
      await audit(
        ctx,
        {
          action: 'settings.update',
          targetType: 'GuildConfig',
          targetId: ctx.guildId,
          metadata: {
            ...diffMetadata(
              before as unknown as Record<string, unknown>,
              cols as Record<string, unknown>,
              changed,
            ),
            ...(scheduleChanged ? { reportSchedule: { before: defBefore, after: defAfter } } : {}),
          },
        },
        tx,
      );
    }
    return toView(cfg, def);
  });
}
