import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  Events,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import {
  MODULES,
  MODULE_LABELS,
  analytics,
  brandEmbed,
  getGuildConfig,
  type ModuleKey,
} from '@gynx/services';
import { WEEKDAYS, dateKeyInZone, discordTimestamp, isValidTimeZone, truncate } from '@gynx/shared';
import { respond } from '../../framework/reply';
import { on, type BotModule, type BotRuntime, type HandlerCtx } from '../../framework/types';
import { ActivityCollector } from './collector';

const T = analytics.AnalyticsText;

// ── Activity collection ────────────────────────────────────────────────────

const FLUSH_MS = 60_000;
const MEMBER_COUNT_MS = 60 * 60_000;

interface CollectionState {
  collector: ActivityCollector;
  tz: string;
  enabled: boolean;
}
let state: CollectionState | null = null;

async function refreshConfig(rt: BotRuntime, s: CollectionState): Promise<void> {
  const cfg = await getGuildConfig(rt.deps.db, rt.env.DISCORD_GUILD_ID);
  s.tz = isValidTimeZone(cfg.timezone) ? cfg.timezone : 'UTC';
  s.enabled = cfg.enabledModules.includes('analytics');
}

async function snapshotMemberCount(rt: BotRuntime): Promise<void> {
  const guild = rt.client.guilds.cache.get(rt.env.DISCORD_GUILD_ID);
  if (guild) await analytics.recordMemberCount(rt.deps.db, guild.id, guild.memberCount, new Date());
}

function startCollection(rt: BotRuntime): CollectionState {
  const guildId = rt.env.DISCORD_GUILD_ID;
  const s: CollectionState = {
    collector: new ActivityCollector(
      (batch) => analytics.flushActivity(rt.deps.db, guildId, batch),
      (err) => rt.log.warn({ err }, 'activity flush failed; counts re-queued'),
    ),
    tz: 'UTC',
    enabled: true,
  };
  const safe = (p: Promise<unknown>, what: string) =>
    p.catch((err: unknown) => rt.log.warn({ err }, `${what} failed`));
  void safe(refreshConfig(rt, s), 'analytics config refresh');
  void safe(snapshotMemberCount(rt), 'member count snapshot');
  setInterval(() => {
    void safe(s.collector.flush(), 'activity flush');
    void safe(refreshConfig(rt, s), 'analytics config refresh');
  }, FLUSH_MS).unref();
  setInterval(() => void safe(snapshotMemberCount(rt), 'member count snapshot'), MEMBER_COUNT_MS).unref();
  // Best-effort flush on shutdown: the process may exit before it completes (≤ 60 s of counts lost).
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.once(sig, () => void safe(s.collector.flush(), 'shutdown activity flush'));
  return s;
}

// ── Command helpers ────────────────────────────────────────────────────────

const periodOption = (o: SlashCommandStringOption) =>
  o
    .setName('period')
    .setDescription('Time range (default 7 days)')
    .addChoices(
      { name: 'Last 7 days', value: '7d' },
      { name: 'Last 30 days', value: '30d' },
      { name: 'Last 90 days', value: '90d' },
    );

const getPeriod = (i: ChatInputCommandInteraction): analytics.RangePreset =>
  (i.options.getString('period') as analytics.RangePreset | null) ?? '7d';

function dashboardRow(h: HandlerCtx, path: string) {
  const url = h.rt.deps.dashboardUrl;
  if (!url || !/^https?:\/\//.test(url)) return [];
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          label: T.openDashboard(),
          url: `${url}${path}`,
        },
      ],
    },
  ];
}

const rangeLabel = (p: { start: string; end: string }) =>
  `${discordTimestamp(new Date(p.start), 'd')} – ${discordTimestamp(new Date(p.end), 'd')}`;

const analyticsCommand = new SlashCommandBuilder()
  .setName('analytics')
  .setDescription('Key community, moderation, infrastructure and marketing metrics')
  .addStringOption(periodOption)
  .addStringOption((o) =>
    o
      .setName('section')
      .setDescription('Which section to show (default overview)')
      .addChoices(
        { name: 'Overview', value: 'overview' },
        { name: 'Community', value: 'community' },
        { name: 'Moderation & security', value: 'moderation' },
        { name: 'Infrastructure', value: 'infrastructure' },
        { name: 'Marketing & engagement', value: 'marketing' },
      ),
  );

const staffStatsCommand = new SlashCommandBuilder()
  .setName('staff-stats')
  .setDescription('Per-staff activity counts (moderation, reports, incidents, partner reviews)')
  .addStringOption(periodOption);

const CHANNEL_KIND_CHOICES = (Object.keys(analytics.CHANNEL_KINDS) as analytics.ChannelKind[]).map((k) => ({
  name: analytics.CHANNEL_KIND_LABELS[k],
  value: k,
}));
const ROLE_KIND_CHOICES = (Object.keys(analytics.ROLE_KINDS) as analytics.RoleKind[]).map((k) => ({
  name: analytics.ROLE_KIND_LABELS[k],
  value: k,
}));
const MODULE_CHOICES = MODULES.map((m) => ({ name: MODULE_LABELS[m], value: m }));
const DAY_CHOICES = WEEKDAYS.map((d) => ({ name: d.charAt(0) + d.slice(1).toLowerCase(), value: d }));

const configCommand = new SlashCommandBuilder()
  .setName('config')
  .setDescription('View and change bot settings for this server')
  .addSubcommand((s) => s.setName('view').setDescription('Show the current settings'))
  .addSubcommand((s) =>
    s
      .setName('timezone')
      .setDescription('Set the server time zone used for schedules and reports')
      .addStringOption((o) =>
        o
          .setName('zone')
          .setDescription('IANA time zone, e.g. Europe/London')
          .setRequired(true)
          .setMaxLength(64),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('module')
      .setDescription('Enable or disable a module')
      .addSubcommand((s) =>
        s
          .setName('enable')
          .setDescription('Enable a module')
          .addStringOption((o) =>
            o
              .setName('module')
              .setDescription('Module')
              .setRequired(true)
              .addChoices(...MODULE_CHOICES),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('disable')
          .setDescription('Disable a module')
          .addStringOption((o) =>
            o
              .setName('module')
              .setDescription('Module')
              .setRequired(true)
              .addChoices(...MODULE_CHOICES),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('channel')
      .setDescription('Configure channels')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Set a channel')
          .addStringOption((o) =>
            o
              .setName('kind')
              .setDescription('Which channel')
              .setRequired(true)
              .addChoices(...CHANNEL_KIND_CHOICES),
          )
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('role')
      .setDescription('Configure roles')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Set a role')
          .addStringOption((o) =>
            o
              .setName('kind')
              .setDescription('Which role')
              .setRequired(true)
              .addChoices(...ROLE_KIND_CHOICES),
          )
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('support-url')
      .setDescription('External support system link')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Set the support URL (https)')
          .addStringOption((o) =>
            o.setName('url').setDescription('https://…').setRequired(true).setMaxLength(500),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('report')
      .setDescription('Weekly CEO report')
      .addSubcommand((s) =>
        s
          .setName('schedule')
          .setDescription('Set the weekly report day and time (server time zone)')
          .addStringOption((o) =>
            o
              .setName('day')
              .setDescription('Weekday')
              .setRequired(true)
              .addChoices(...DAY_CHOICES),
          )
          .addStringOption((o) =>
            o
              .setName('time')
              .setDescription('HH:MM, 24-hour')
              .setRequired(true)
              .setMinLength(5)
              .setMaxLength(5),
          ),
      ),
  );

function settingsEmbed(s: analytics.GuildSettings) {
  const notSet = T.settingsNotSet();
  const ch = (Object.keys(analytics.CHANNEL_KINDS) as analytics.ChannelKind[]).map(
    (k) => `${analytics.CHANNEL_KIND_LABELS[k]}: ${s.channels[k] ? `<#${s.channels[k]}>` : notSet}`,
  );
  const roles = (Object.keys(analytics.ROLE_KINDS) as analytics.RoleKind[]).map(
    (k) => `${analytics.ROLE_KIND_LABELS[k]}: ${s.roles[k] ? `<@&${s.roles[k]}>` : notSet}`,
  );
  const mods = MODULES.map((m) => `${s.enabledModules.includes(m) ? '✅' : '⛔'} ${MODULE_LABELS[m]}`);
  const rs = s.reportSchedule;
  const sched = rs
    ? T.settingsReportSchedule({
        state: rs.enabled ? T.settingsReportEnabled() : T.settingsReportDisabled(),
        day: rs.day.toLowerCase(),
        time: rs.time,
        timezone: rs.timezone,
      }) +
      (rs.nextRunAt
        ? `\n${T.settingsReportNext({ time: discordTimestamp(new Date(rs.nextRunAt), 'F') })}`
        : '')
    : T.settingsReportNotConfigured();
  return brandEmbed({
    title: T.settingsTitle(),
    fields: [
      { name: T.settingsTimezoneField(), value: s.timezone, inline: true },
      { name: T.settingsSupportUrlField(), value: s.supportUrl ?? notSet, inline: true },
      { name: T.settingsEmbedFooterField(), value: truncate(s.embedFooter, 100), inline: true },
      { name: T.settingsModulesField(), value: mods.join('\n') },
      { name: T.settingsChannelsField(), value: ch.join('\n') },
      { name: T.settingsRolesField(), value: roles.join('\n') },
      { name: T.settingsReportField(), value: sched },
      {
        name: T.settingsStatusField(),
        value: T.settingsStatusValue({
          interval: s.status.checkIntervalSeconds,
          failures: s.status.failureThreshold,
          recoveries: s.status.recoveryThreshold,
          cooldown: s.status.alertCooldownMinutes,
        }),
      },
      {
        name: T.settingsRetentionField(),
        value: T.settingsRetentionValue({
          diagnosticHours: s.retention.diagnosticHours,
          reportDays: s.retention.reportDays,
          auditDays: s.retention.auditDays,
          healthCheckDays: s.retention.healthCheckDays,
          activityDays: s.retention.activityDays,
        }),
      },
      {
        name: T.settingsAnalyticsField(),
        value: T.settingsAnalyticsValue({
          minMessages: s.activeMemberMinMessages,
          reporterUpdates: s.reportNotifyReporter ? T.settingsOn() : T.settingsOff(),
        }),
      },
    ],
    footer: T.settingsFooter(),
  });
}

async function runConfig(i: ChatInputCommandInteraction, h: HandlerCtx): Promise<void> {
  const group = i.options.getSubcommandGroup(false);
  const sub = i.options.getSubcommand(true);
  const done = async (s: analytics.GuildSettings, message: string) =>
    respond(i, { content: T.configSuccess({ message }), embeds: [settingsEmbed(s)] });

  if (!group && sub === 'view') {
    await respond(i, {
      embeds: [settingsEmbed(await analytics.getSettings(h.ctx))],
      components: dashboardRow(h, '/settings') as never,
    });
    return;
  }
  if (!group && sub === 'timezone') {
    const zone = i.options.getString('zone', true).trim();
    const s = await analytics.updateSettings(h.ctx, { timezone: zone });
    await done(s, T.configTimezoneSet({ timezone: s.timezone }));
    return;
  }
  if (group === 'module') {
    const mod = i.options.getString('module', true) as ModuleKey;
    const current = await analytics.getSettings(h.ctx);
    const next =
      sub === 'enable'
        ? [...new Set([...current.enabledModules, mod])]
        : current.enabledModules.filter((m) => m !== mod);
    const s = await analytics.updateSettings(h.ctx, { enabledModules: next as ModuleKey[] });
    const module = MODULE_LABELS[mod];
    await done(s, sub === 'enable' ? T.configModuleEnabled({ module }) : T.configModuleDisabled({ module }));
    return;
  }
  if (group === 'channel' && sub === 'set') {
    const kind = i.options.getString('kind', true) as analytics.ChannelKind;
    const channel = i.options.getChannel('channel', true);
    const s = await analytics.updateSettings(h.ctx, { channels: { [kind]: channel.id } });
    await done(
      s,
      T.configChannelSet({ kind: analytics.CHANNEL_KIND_LABELS[kind], channel: `<#${channel.id}>` }),
    );
    return;
  }
  if (group === 'role' && sub === 'set') {
    const kind = i.options.getString('kind', true) as analytics.RoleKind;
    const role = i.options.getRole('role', true);
    if (role.managed) {
      await respond(i, { content: T.configRoleManaged() });
      return;
    }
    const s = await analytics.updateSettings(h.ctx, { roles: { [kind]: role.id } });
    await done(s, T.configRoleSet({ kind: analytics.ROLE_KIND_LABELS[kind], role: `<@&${role.id}>` }));
    return;
  }
  if (group === 'support-url' && sub === 'set') {
    const s = await analytics.updateSettings(h.ctx, { supportUrl: i.options.getString('url', true).trim() });
    await done(s, T.configSupportUrlUpdated());
    return;
  }
  if (group === 'report' && sub === 'schedule') {
    const s = await analytics.updateSettings(h.ctx, {
      reportSchedule: {
        day: i.options.getString('day', true) as (typeof WEEKDAYS)[number],
        time: i.options.getString('time', true).trim(),
      },
    });
    await done(s, T.configReportScheduleUpdated());
    return;
  }
  await respond(i, { content: T.configUnknownCommand() });
}

async function runAnalytics(i: ChatInputCommandInteraction, h: HandlerCtx): Promise<void> {
  await i.deferReply({ flags: 64 });
  const period = getPeriod(i);
  const sectionName = i.options.getString('section') ?? 'overview';
  const components = dashboardRow(h, '/analytics') as never;

  if (sectionName === 'overview') {
    const data = await analytics.getOverview(h.ctx, period);
    const [embed] = analytics.reportEmbeds(data, { title: T.overviewTitle({ period }) });
    await respond(i, {
      embeds: [
        {
          ...embed!,
          url: undefined,
          footer: { text: T.overviewFooter() },
        },
      ],
      components,
    });
    return;
  }
  let fields: Array<{ name: string; value: string; inline?: boolean }>;
  let range: { start: string; end: string };
  if (sectionName === 'community') {
    const r = await analytics.getCommunityMetrics(h.ctx, period);
    fields = analytics.communityFields(r.metrics);
    range = r.period;
  } else if (sectionName === 'moderation') {
    const r = await analytics.getModerationMetrics(h.ctx, period);
    fields = analytics.moderationFields(r.metrics);
    range = r.period;
  } else if (sectionName === 'infrastructure') {
    const r = await analytics.getInfrastructureMetrics(h.ctx, period);
    fields = analytics.infrastructureFields(r.metrics);
    range = r.period;
  } else {
    const r = await analytics.getMarketingMetrics(h.ctx, period);
    fields = analytics.marketingFields(r.metrics, r.referrals);
    range = r.period;
  }
  await respond(i, {
    embeds: [
      brandEmbed({
        title: T.sectionTitle({ section: sectionName, period }),
        description: T.sectionDescription({ range: rangeLabel(range), period }),
        fields,
        footer: T.sectionFooter(),
      }),
    ],
    components,
  });
}

async function runStaffStats(i: ChatInputCommandInteraction, h: HandlerCtx): Promise<void> {
  await i.deferReply({ flags: 64 });
  const period = getPeriod(i);
  const r = await analytics.staffStats(h.ctx, period);
  const lines = r.rows.slice(0, 20).map((s) =>
    T.staffStatsLine({
      user: `<@${s.userId}>`,
      modActions: s.moderationActions,
      claimed: s.reportsClaimed,
      resolved: s.reportsResolved,
      incidentUpdates: s.incidentUpdates,
      partnerReviews: s.partnerReviews,
    }),
  );
  await respond(i, {
    embeds: [
      brandEmbed({
        title: T.staffStatsTitle({ period }),
        description: `${rangeLabel(r.period)}\n\n${lines.join('\n') || T.staffStatsEmpty()}`,
        footer: T.staffStatsFooter(),
      }),
    ],
    components: dashboardRow(h, '/analytics/staff') as never,
  });
}

export const analyticsModule: BotModule = {
  name: 'analytics',
  commands: [
    { module: 'analytics', data: analyticsCommand.toJSON(), execute: runAnalytics },
    { module: 'analytics', data: staffStatsCommand.toJSON(), execute: runStaffStats },
    { module: 'core', data: configCommand.toJSON(), execute: runConfig },
  ],
  components: [],
  events: [
    on(Events.ClientReady, async (rt) => {
      state ??= startCollection(rt);
    }),
    on(Events.MessageCreate, async (rt, message) => {
      if (!state || !state.enabled) return;
      if (!message.inGuild() || message.guildId !== rt.env.DISCORD_GUILD_ID) return;
      if (message.author.bot || message.webhookId || message.system) return;
      state.collector.record(
        dateKeyInZone(message.createdAt, state.tz),
        message.channelId,
        message.author.id,
      );
    }),
  ],
};
