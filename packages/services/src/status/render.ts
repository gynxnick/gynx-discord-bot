import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { IncidentSeverity, IncidentStatus, ServiceState } from '@gynx/database';
import { EMBED_COLORS, SEVERITY_COLORS, discordTimestamp, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type { OverallState, PublicIncident, PublicMaintenance, PublicService, PublicStatus, UptimeRow } from './public';

/**
 * Member-facing renderers. They only accept public projections, so monitoring
 * internals (targets, error classes) can't leak into Discord output.
 */

export const STATE_EMOJI: Record<ServiceState, string> = {
  OPERATIONAL: '🟢',
  DEGRADED: '🟡',
  OUTAGE: '🔴',
  MAINTENANCE: '🔧',
  UNKNOWN: '⚪',
};

export const STATE_LABEL: Record<ServiceState, string> = {
  OPERATIONAL: 'Operational',
  DEGRADED: 'Degraded performance',
  OUTAGE: 'Outage',
  MAINTENANCE: 'Under maintenance',
  UNKNOWN: 'Status unknown',
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  INVESTIGATING: 'Investigating',
  IDENTIFIED: 'Identified',
  MONITORING: 'Monitoring',
  RESOLVED: 'Resolved',
};

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = { MINOR: 'Minor', MAJOR: 'Major', CRITICAL: 'Critical' };

const OVERALL: Record<OverallState, { text: string; color: number }> = {
  OPERATIONAL: { text: '🟢 All systems operational', color: EMBED_COLORS.success },
  DEGRADED: { text: '🟡 Some systems are experiencing degraded performance', color: EMBED_COLORS.warning },
  OUTAGE: { text: '🔴 Some systems are experiencing an outage', color: EMBED_COLORS.danger },
  MAINTENANCE: { text: '🔧 Scheduled maintenance in progress', color: EMBED_COLORS.primary },
  UNKNOWN: { text: '⚪ Status is not available yet — checks are still starting up', color: EMBED_COLORS.neutral },
  NO_SERVICES: { text: '⚪ No services are being monitored publicly yet', color: EMBED_COLORS.neutral },
};

const STATE_COLOR: Record<ServiceState, number> = {
  OPERATIONAL: EMBED_COLORS.success,
  DEGRADED: EMBED_COLORS.warning,
  OUTAGE: EMBED_COLORS.danger,
  MAINTENANCE: EMBED_COLORS.primary,
  UNKNOWN: EMBED_COLORS.neutral,
};

export const serviceLine = (s: PublicService) =>
  `${STATE_EMOJI[s.state]} **${s.name}**${s.region ? ` · ${s.region}` : ''} — ${STATE_LABEL[s.state]}`;

const incidentLine = (i: PublicIncident) =>
  `**${i.ref}** · ${truncate(i.title, 80)} · ${INCIDENT_STATUS_LABEL[i.status]} · ${SEVERITY_LABEL[i.severity]} · since ${discordTimestamp(i.startedAt, 'R')}`;

const maintenanceLine = (m: PublicMaintenance) =>
  `🔧 **${truncate(m.title, 80)}** · ${discordTimestamp(m.startsAt, 'f')} → ${discordTimestamp(m.endsAt, 't')}${m.status === 'IN_PROGRESS' ? ' · in progress' : ''}${
    m.services.length ? `\n   Affects: ${m.services.map((s) => s.name).join(', ')}` : ''
  }`;

/** Join lines but stay under Discord's field limit. */
function joinCapped(lines: string[], max = 1000): string {
  const out: string[] = [];
  let len = 0;
  for (const [idx, l] of lines.entries()) {
    if (len + l.length + 1 > max - 20) {
      out.push(`…and ${lines.length - idx} more`);
      break;
    }
    out.push(l);
    len += l.length + 1;
  }
  return out.join('\n');
}

export function statusPageEmbed(s: PublicStatus): APIEmbed {
  const o = OVERALL[s.overall];
  return brandEmbed({
    title: 'GYNX.GG Service Status',
    color: o.color,
    description: o.text,
    fields: [
      { name: 'Services', value: s.services.length ? joinCapped(s.services.map(serviceLine)) : 'No public services configured.' },
      { name: 'Active incidents', value: s.activeIncidents.length ? joinCapped(s.activeIncidents.map(incidentLine)) : 'None' },
      { name: 'Upcoming maintenance', value: s.upcomingMaintenance.length ? joinCapped(s.upcomingMaintenance.slice(0, 3).map(maintenanceLine)) : 'None scheduled' },
    ],
    footer: 'Status is checked automatically · Times shown in your local time zone',
    timestamp: s.generatedAt,
  });
}

/** Subscribe/unsubscribe buttons under /status. */
export function statusButtons(): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Notify me about incidents', custom_id: 'statusui:sub:all', emoji: { name: '🔔' } },
        { type: 2, style: 2, label: 'Stop notifications', custom_id: 'statusui:unsub:all' },
        { type: 2, style: 2, label: 'Incident history', custom_id: 'statusui:history:-' },
      ],
    },
  ];
}

export function uptimeEmbed(rows: UptimeRow[], days: number): APIEmbed {
  const lines = rows.map((r) => `**${r.name}** — ${r.label}${r.totalChecks ? ` (${r.okChecks}/${r.totalChecks} checks)` : ''}`);
  return brandEmbed({
    title: `Uptime · last ${days === 1 ? '24 hours' : `${days} days`}`,
    description: lines.length ? joinCapped(lines, 3900) : 'No public services are being monitored yet.',
    footer: 'Uptime = successful checks ÷ total checks. "no data" means no checks were recorded in this period.',
  });
}

function incidentColor(i: Pick<PublicIncident, 'status' | 'severity'>): number {
  return i.status === 'RESOLVED' ? EMBED_COLORS.success : SEVERITY_COLORS[i.severity];
}

/** The persistent incident message in the incident channel (edited on every update). */
export function incidentEmbed(i: PublicIncident): APIEmbed {
  const timeline = i.updates
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map((u) => `${discordTimestamp(u.createdAt, 'f')} · **${INCIDENT_STATUS_LABEL[u.status]}** — ${truncate(u.message, 300)}`);
  return brandEmbed({
    title: `${i.status === 'RESOLVED' ? '✅' : '⚠️'} ${i.ref} · ${i.title}`,
    color: incidentColor(i),
    description: truncate(i.description, 1500),
    fields: [
      { name: 'Status', value: INCIDENT_STATUS_LABEL[i.status], inline: true },
      { name: 'Severity', value: SEVERITY_LABEL[i.severity], inline: true },
      { name: 'Started', value: discordTimestamp(i.startedAt, 'f'), inline: true },
      ...(i.services.length ? [{ name: 'Affected services', value: i.services.map((s) => s.name).join(', '), inline: false }] : []),
      ...(i.regions.length ? [{ name: 'Regions', value: i.regions.join(', '), inline: false }] : []),
      ...(i.resolvedAt ? [{ name: 'Resolved', value: discordTimestamp(i.resolvedAt, 'f'), inline: true }] : []),
      ...(i.resolutionSummary ? [{ name: 'Resolution', value: truncate(i.resolutionSummary, 1000), inline: false }] : []),
      ...(timeline.length ? [{ name: 'Updates', value: joinCapped(timeline), inline: false }] : []),
    ],
    footer: 'GYNX.GG Incident',
  });
}

/** A short line posted under the incident message for each update. */
export function incidentUpdateEmbed(i: Pick<PublicIncident, 'ref' | 'title' | 'status' | 'severity'>, u: { status: IncidentStatus; message: string; createdAt: Date }): APIEmbed {
  return brandEmbed({
    title: `${i.ref} · ${INCIDENT_STATUS_LABEL[u.status]}`,
    color: u.status === 'RESOLVED' ? EMBED_COLORS.success : SEVERITY_COLORS[i.severity],
    description: truncate(u.message, 2000),
    timestamp: u.createdAt,
  });
}

export function incidentDmEmbed(i: PublicIncident, u: { status: IncidentStatus; message: string; createdAt: Date }, guildName?: string): APIEmbed {
  return brandEmbed({
    title: `${i.ref} · ${truncate(i.title, 200)}`,
    color: incidentColor({ status: u.status, severity: i.severity }),
    description: `**${INCIDENT_STATUS_LABEL[u.status]}** — ${truncate(u.message, 1500)}`,
    fields: [
      { name: 'Severity', value: SEVERITY_LABEL[i.severity], inline: true },
      ...(i.services.length ? [{ name: 'Affected', value: i.services.map((s) => s.name).join(', '), inline: true }] : []),
    ],
    footer: `You're receiving this because you subscribed to status updates${guildName ? ` in ${guildName}` : ''}. Use /subscribe-status remove to stop.`,
    timestamp: u.createdAt,
  });
}

/** Automatic state-change alert for the status channel. */
export function alertEmbed(s: Pick<PublicService, 'name' | 'region' | 'state'>, from: ServiceState | null): APIEmbed {
  const recovered = s.state === 'OPERATIONAL' && from !== null && from !== 'OPERATIONAL' && from !== 'UNKNOWN';
  return brandEmbed({
    title: `${STATE_EMOJI[s.state]} ${s.name} · ${recovered ? 'Recovered' : STATE_LABEL[s.state]}`,
    color: STATE_COLOR[s.state],
    description:
      s.state === 'OUTAGE'
        ? `We're seeing problems with **${s.name}** and are looking into it.`
        : s.state === 'DEGRADED'
          ? `**${s.name}** is responding slower than usual or partially impaired.`
          : `**${s.name}** is operating normally again.`,
    fields: s.region ? [{ name: 'Region', value: s.region, inline: true }] : [],
    footer: 'Automatic status alert · /status for the full overview',
  });
}

export type MaintenancePhase = 'scheduled' | 'rescheduled' | 'started' | 'completed' | 'cancelled';

export function maintenanceEmbed(m: PublicMaintenance, phase: MaintenancePhase): APIEmbed {
  const titles: Record<MaintenancePhase, string> = {
    scheduled: '🔧 Scheduled maintenance',
    rescheduled: '🔧 Maintenance rescheduled',
    started: '🔧 Maintenance started',
    completed: '✅ Maintenance completed',
    cancelled: 'Maintenance cancelled',
  };
  return brandEmbed({
    title: `${titles[phase]} · ${truncate(m.title, 180)}`,
    color: phase === 'completed' ? EMBED_COLORS.success : phase === 'cancelled' ? EMBED_COLORS.neutral : EMBED_COLORS.primary,
    description: phase === 'cancelled' ? 'This maintenance will not take place.' : truncate(m.description, 1500),
    fields: [
      { name: 'Starts', value: discordTimestamp(m.startsAt, 'F'), inline: true },
      { name: 'Ends', value: discordTimestamp(m.endsAt, 'F'), inline: true },
      ...(m.services.length ? [{ name: 'Affected services', value: m.services.map((s) => s.name).join(', '), inline: false }] : []),
    ],
  });
}

export function incidentsListEmbed(active: PublicIncident[], resolved: PublicIncident[], page: number): APIEmbed {
  const resolvedLines = resolved.map(
    (i) => `**${i.ref}** · ${truncate(i.title, 80)} · ${SEVERITY_LABEL[i.severity]} · ${discordTimestamp(i.startedAt, 'd')}${i.resolvedAt ? ` → resolved ${discordTimestamp(i.resolvedAt, 'R')}` : ''}`,
  );
  return brandEmbed({
    title: 'Incidents',
    fields: [
      ...(page === 0 ? [{ name: 'Active', value: active.length ? joinCapped(active.map(incidentLine)) : 'No active incidents 🎉' }] : []),
      { name: page === 0 ? 'Recently resolved' : `Resolved · page ${page + 1}`, value: resolvedLines.length ? joinCapped(resolvedLines) : 'No resolved incidents on record.' },
    ],
  });
}
