import type { APIEmbed } from 'discord-api-types/v10';
import { formatDuration, formatInZone, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type {
  CommunitySection,
  InfrastructureSection,
  MarketingSection,
  ModerationSection,
  OutstandingSection,
  ReferralSection,
} from './collect';
import { compare, fmtNum, type Metric } from './metrics';
import { ACTIVITY_NOTE, SUPPORT_NOTE, humanise, type ReportData } from './report';

type Field = { name: string; value: string; inline?: boolean };

/** Compact "value (±x%)" for embeds. Unavailable metrics show "n/a" (reason in the dashboard/report). */
export function short(m: Metric<number>, suffix = ''): string {
  if (!m.available) return 'n/a';
  if (m.previous === undefined) return `${fmtNum(m.value)}${suffix}`;
  const c = compare(m.value, m.previous);
  const pct = c.pct === null ? 'n/a' : `${c.pct > 0 ? '+' : ''}${c.pct}%`;
  return `${fmtNum(m.value)}${suffix} (${pct})`;
}

const rec = (m: Metric<Record<string, number>>) =>
  !m.available
    ? 'n/a'
    : Object.entries(m.value)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${humanise(k)} ${v}`)
        .join(', ') || 'none';

const unavailableNote = (ms: Array<Metric<unknown>>) => {
  const reasons = [
    ...new Set(
      ms.filter((m): m is { available: false; reason: string } => !m.available).map((m) => m.reason),
    ),
  ];
  return reasons.length ? `\n_Not available — ${reasons.join('; ')}_` : '';
};

export function communityFields(c: CommunitySection): Field[] {
  const top =
    c.topChannels.available && c.topChannels.value.length
      ? c.topChannels.value.map((t) => `<#${t.channelId}> ${fmtNum(t.messages)}`).join('\n')
      : 'n/a';
  return [
    {
      name: 'Community growth',
      value:
        `Members: **${c.totalMembers.available ? fmtNum(c.totalMembers.value) : 'n/a'}**${c.totalMembers.available && c.totalMembers.note ? ` (${c.totalMembers.note})` : ''}\n` +
        `Joins ${short(c.joins)} · Leaves ${short(c.leaves)} · Net ${short(c.netGrowth)}` +
        unavailableNote([c.totalMembers, c.joins]),
    },
    {
      name: 'Observed message activity',
      value:
        `Active members (≥${c.activeMemberThreshold} msg): ${short(c.activeMembers)}\nMessages: ${short(c.messages)}\nDAU ${short(c.dau)} · WAU ${short(c.wau)} · MAU ${short(c.mau)}` +
        unavailableNote([c.messages]),
    },
    { name: 'Top channels', value: top, inline: true },
  ];
}

export function moderationFields(m: ModerationSection): Field[] {
  return [
    {
      name: 'Moderation',
      value: `Actions: ${short(m.actions)}\n${rec(m.actionsByType)}` + unavailableNote([m.actions]),
    },
    {
      name: 'Automod',
      value:
        `Detections: ${short(m.automodDetections)} · False positives: ${short(m.automodFalsePositives)}\n${rec(m.automodByRule)}` +
        unavailableNote([m.automodDetections]),
    },
    {
      name: 'Abuse reports',
      value:
        `Received ${short(m.reportsReceived)} · Resolved ${short(m.reportsResolved)} · Dismissed ${short(m.reportsDismissed)}\nOpen backlog: **${short(m.openReportBacklog)}**` +
        unavailableNote([m.reportsReceived]),
    },
  ];
}

export function infrastructureFields(i: InfrastructureSection): Field[] {
  const uptime = i.uptime.length
    ? i.uptime
        .slice(0, 10)
        .map((s) => `${truncate(s.name, 40)}: ${s.uptimePct === null ? 'no data' : `${s.uptimePct}%`}`)
        .join('\n')
    : 'No public monitored services';
  return [
    {
      name: 'Incidents',
      value:
        `Opened ${short(i.incidentsOpened)} · Resolved ${short(i.incidentsResolved)}\n${rec(i.incidentsBySeverity)}\n` +
        `Total time: ${i.incidentMinutes.available ? formatDuration(i.incidentMinutes.value * 60_000) : 'n/a'} · Auto ${short(i.autoIncidents)} / Manual ${short(i.manualIncidents)}` +
        unavailableNote([i.incidentsOpened]),
    },
    { name: 'Uptime (public services)', value: uptime },
  ];
}

export function marketingFields(k: MarketingSection, r?: ReferralSection): Field[] {
  const fields: Field[] = [
    {
      name: 'Announcements & links',
      value: `Published ${short(k.announcementsPublished)} · Reactions ${short(k.announcementReactions)}\nTracked link clicks: ${short(k.trackedLinkClicks)}${k.trackedLinkClicks.available && k.trackedLinkClicks.note ? ` (${k.trackedLinkClicks.note})` : ''}`,
    },
    {
      name: 'Engagement',
      value: `RSVPs ${short(k.eventRsvps)} · Giveaway entries ${short(k.giveawayEntries)}\nPoll ballots ${short(k.pollBallots)} · Suggestions ${short(k.suggestionsCreated)}`,
    },
    {
      name: 'Partner applications',
      value: `${short(k.partnerApplications)}\n${rec(k.partnerApplicationsByStatus)}`,
    },
  ];
  if (r) {
    fields.push({
      name: 'Referrals',
      value:
        `Tracked joins ${short(r.attributedJoins)}\nConfirmed ${short(r.confirmed)} · Ambiguous ${short(r.ambiguous)} · Unknown ${short(r.unknown)}\nFlagged ${short(r.flagged)}` +
        unavailableNote([r.attributedJoins]),
    });
  }
  return fields;
}

export function outstandingField(o: OutstandingSection): Field {
  const items = [
    `Open reports > 72h: **${o.staleAbuseReports}**`,
    `Active incidents: **${o.activeIncidents.length}**${
      o.activeIncidents.length
        ? ` (${o.activeIncidents
            .slice(0, 3)
            .map((a) => a.ref)
            .join(', ')})`
        : ''
    }`,
    `Dead-letter jobs: **${o.deadJobs}**`,
    `Flagged referrals: **${o.flaggedReferrals}**`,
    `Partner apps pending > 7d: **${o.stalePartnerApplications}**`,
  ];
  return { name: 'Needs attention', value: items.join('\n') };
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
      title: `${opts.title ?? 'Weekly CEO report'} · ${range}`,
      url:
        opts.dashboardUrl && opts.reportId
          ? `${opts.dashboardUrl}/analytics/reports/${opts.reportId}`
          : undefined,
      description: d.summary.map((b) => `• ${b}`).join('\n'),
      fields: [
        {
          name: 'Community',
          value: `Members ${c.totalMembers.available ? fmtNum(c.totalMembers.value) : 'n/a'} · Net ${short(c.netGrowth)}\nActive ${short(c.activeMembers)} · Messages ${short(c.messages)}`,
          inline: true,
        },
        {
          name: 'Infrastructure',
          value: `Incidents ${short(d.infrastructure.incidentsOpened)}\nIncident time ${d.infrastructure.incidentMinutes.available ? formatDuration(d.infrastructure.incidentMinutes.value * 60_000) : 'n/a'}`,
          inline: true,
        },
        {
          name: 'Moderation & security',
          value: `Actions ${short(d.moderation.actions)} · Automod ${short(d.moderation.automodDetections)}\nReports ${short(d.moderation.reportsReceived)} · Backlog ${short(d.moderation.openReportBacklog)}`,
          inline: true,
        },
        {
          name: 'Announcements & referrals',
          value: `Published ${short(d.marketing.announcementsPublished)} · Clicks ${short(d.marketing.trackedLinkClicks)}\nConfirmed referrals ${short(d.referrals.confirmed)} · Unknown ${short(d.referrals.unknown)}`,
          inline: true,
        },
        outstandingField(d.outstanding),
        { name: 'Support', value: SUPPORT_NOTE },
      ],
      footer: truncate(
        `Full report attached (Markdown) · ${ACTIVITY_NOTE.split(' — ')[0]} · ${opts.footer ?? 'GYNX.GG'}`,
        2048,
      ),
      timestamp: new Date(d.generatedAt),
    }),
  ];
}
