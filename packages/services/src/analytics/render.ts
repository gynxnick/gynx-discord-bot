import type { APIEmbed } from 'discord-api-types/v10';
import { formatDuration, formatInZone, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { CoreText } from '../core/texts';
import type {
  CommunitySection,
  InfrastructureSection,
  MarketingSection,
  ModerationSection,
  OutstandingSection,
  ReferralSection,
} from './collect';
import { compare, fmtNum, type Metric } from './metrics';
import { humanise, type ReportData } from './report';
import { AnalyticsText as T } from './texts';

type Field = { name: string; value: string; inline?: boolean };

/** Compact "value (±x%)" for embeds. Unavailable metrics show "n/a" (reason in the dashboard/report). */
export function short(m: Metric<number>, suffix = ''): string {
  if (!m.available) return T.na();
  if (m.previous === undefined) return `${fmtNum(m.value)}${suffix}`;
  const c = compare(m.value, m.previous);
  const pct = c.pct === null ? T.na() : `${c.pct > 0 ? '+' : ''}${c.pct}%`;
  return `${fmtNum(m.value)}${suffix} (${pct})`;
}

const rec = (m: Metric<Record<string, number>>) =>
  !m.available
    ? T.na()
    : Object.entries(m.value)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${humanise(k)} ${v}`)
        .join(', ') || T.none();

const unavailableNote = (ms: Array<Metric<unknown>>) => {
  const reasons = [
    ...new Set(
      ms.filter((m): m is { available: false; reason: string } => !m.available).map((m) => m.reason),
    ),
  ];
  return reasons.length ? `\n${T.unavailableNote({ reasons: reasons.join('; ') })}` : '';
};

const duration = (m: Metric<number>) => (m.available ? formatDuration(m.value * 60_000) : T.na());

export function communityFields(c: CommunitySection): Field[] {
  const top =
    c.topChannels.available && c.topChannels.value.length
      ? c.topChannels.value.map((t) => `<#${t.channelId}> ${fmtNum(t.messages)}`).join('\n')
      : T.na();
  return [
    {
      name: T.communityGrowthField(),
      value:
        T.communityGrowthValue({
          members: c.totalMembers.available ? fmtNum(c.totalMembers.value) : T.na(),
          membersNote: c.totalMembers.available && c.totalMembers.note ? ` (${c.totalMembers.note})` : '',
          joins: short(c.joins),
          leaves: short(c.leaves),
          net: short(c.netGrowth),
        }) + unavailableNote([c.totalMembers, c.joins]),
    },
    {
      name: T.activityField(),
      value:
        T.activityValue({
          threshold: c.activeMemberThreshold,
          active: short(c.activeMembers),
          messages: short(c.messages),
          dau: short(c.dau),
          wau: short(c.wau),
          mau: short(c.mau),
        }) + unavailableNote([c.messages]),
    },
    { name: T.topChannelsField(), value: top, inline: true },
  ];
}

export function moderationFields(m: ModerationSection): Field[] {
  return [
    {
      name: T.moderationField(),
      value:
        T.moderationValue({ actions: short(m.actions), byType: rec(m.actionsByType) }) +
        unavailableNote([m.actions]),
    },
    {
      name: T.automodField(),
      value:
        T.automodValue({
          detections: short(m.automodDetections),
          falsePositives: short(m.automodFalsePositives),
          byRule: rec(m.automodByRule),
        }) + unavailableNote([m.automodDetections]),
    },
    {
      name: T.abuseReportsField(),
      value:
        T.abuseReportsValue({
          received: short(m.reportsReceived),
          resolved: short(m.reportsResolved),
          dismissed: short(m.reportsDismissed),
          backlog: short(m.openReportBacklog),
        }) + unavailableNote([m.reportsReceived]),
    },
  ];
}

export function infrastructureFields(i: InfrastructureSection): Field[] {
  const uptime = i.uptime.length
    ? i.uptime
        .slice(0, 10)
        .map((s) => `${truncate(s.name, 40)}: ${s.uptimePct === null ? T.noData() : `${s.uptimePct}%`}`)
        .join('\n')
    : T.uptimeNone();
  return [
    {
      name: T.incidentsField(),
      value:
        T.incidentsValue({
          opened: short(i.incidentsOpened),
          resolved: short(i.incidentsResolved),
          bySeverity: rec(i.incidentsBySeverity),
          time: duration(i.incidentMinutes),
          auto: short(i.autoIncidents),
          manual: short(i.manualIncidents),
        }) + unavailableNote([i.incidentsOpened]),
    },
    { name: T.uptimeField(), value: uptime },
  ];
}

export function marketingFields(k: MarketingSection, r?: ReferralSection): Field[] {
  const fields: Field[] = [
    {
      name: T.announcementsField(),
      value: T.announcementsValue({
        published: short(k.announcementsPublished),
        reactions: short(k.announcementReactions),
        clicks: short(k.trackedLinkClicks),
        clicksNote:
          k.trackedLinkClicks.available && k.trackedLinkClicks.note ? ` (${k.trackedLinkClicks.note})` : '',
      }),
    },
    {
      name: T.engagementField(),
      value: T.engagementValue({
        rsvps: short(k.eventRsvps),
        giveaways: short(k.giveawayEntries),
        polls: short(k.pollBallots),
        suggestions: short(k.suggestionsCreated),
      }),
    },
    {
      name: T.partnerApplicationsField(),
      value: `${short(k.partnerApplications)}\n${rec(k.partnerApplicationsByStatus)}`,
    },
  ];
  if (r) {
    fields.push({
      name: T.referralsField(),
      value:
        T.referralsValue({
          joins: short(r.attributedJoins),
          confirmed: short(r.confirmed),
          ambiguous: short(r.ambiguous),
          unknown: short(r.unknown),
          flagged: short(r.flagged),
        }) + unavailableNote([r.attributedJoins]),
    });
  }
  return fields;
}

export function outstandingField(o: OutstandingSection): Field {
  const refs = o.activeIncidents.length
    ? ` (${o.activeIncidents
        .slice(0, 3)
        .map((a) => a.ref)
        .join(', ')})`
    : '';
  return {
    name: T.needsAttentionField(),
    value: T.needsAttentionValue({
      staleReports: o.staleAbuseReports,
      activeIncidents: o.activeIncidents.length,
      incidentRefs: refs,
      deadJobs: o.deadJobs,
      flaggedReferrals: o.flaggedReferrals,
      stalePartnerApps: o.stalePartnerApplications,
    }),
  };
}

export interface ReportEmbedOptions {
  title?: string;
  dashboardUrl?: string;
  reportId?: string;
  footer?: string;
}

/** Summary embed posted with a delivered report (the full Markdown is attached). */
export function reportEmbeds(d: ReportData, opts: ReportEmbedOptions = {}): APIEmbed[] {
  const tz = d.timezone;
  const range = `${formatInZone(new Date(d.period.start), tz, { dateStyle: 'medium', timeStyle: undefined })} – ${formatInZone(new Date(d.period.end), tz, { dateStyle: 'medium', timeStyle: undefined })}`;
  const c = d.community;
  return [
    brandEmbed({
      title: T.reportEmbedTitle({ title: opts.title ?? T.reportDefaultTitle(), range }),
      url:
        opts.dashboardUrl && opts.reportId
          ? `${opts.dashboardUrl}/analytics/reports/${opts.reportId}`
          : undefined,
      description: d.summary.map((b) => `• ${b}`).join('\n'),
      fields: [
        {
          name: T.summaryCommunityField(),
          value: T.summaryCommunityValue({
            members: c.totalMembers.available ? fmtNum(c.totalMembers.value) : T.na(),
            net: short(c.netGrowth),
            active: short(c.activeMembers),
            messages: short(c.messages),
          }),
          inline: true,
        },
        {
          name: T.summaryInfrastructureField(),
          value: T.summaryInfrastructureValue({
            incidents: short(d.infrastructure.incidentsOpened),
            time: duration(d.infrastructure.incidentMinutes),
          }),
          inline: true,
        },
        {
          name: T.summaryModerationField(),
          value: T.summaryModerationValue({
            actions: short(d.moderation.actions),
            automod: short(d.moderation.automodDetections),
            reports: short(d.moderation.reportsReceived),
            backlog: short(d.moderation.openReportBacklog),
          }),
          inline: true,
        },
        {
          name: T.summaryMarketingField(),
          value: T.summaryMarketingValue({
            published: short(d.marketing.announcementsPublished),
            clicks: short(d.marketing.trackedLinkClicks),
            confirmed: short(d.referrals.confirmed),
            unknown: short(d.referrals.unknown),
          }),
          inline: true,
        },
        outstandingField(d.outstanding),
        { name: T.summarySupportField(), value: T.supportNote() },
      ],
      footer: truncate(T.summaryFooter({ footer: opts.footer ?? CoreText.embedFooter() }), 2048),
      timestamp: new Date(d.generatedAt),
    }),
  ];
}
