import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { IncidentSeverity, IncidentStatus, ServiceState } from '@gynx/database';
import { EMBED_COLORS, SEVERITY_COLORS, discordTimestamp, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type {
  OverallState,
  PublicIncident,
  PublicMaintenance,
  PublicService,
  PublicStatus,
  UptimeRow,
} from './public';
import { StatusText } from './texts';

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

/** Service state label, resolved at call time so server overrides apply. */
export function stateLabel(state: ServiceState): string {
  switch (state) {
    case 'OPERATIONAL':
      return StatusText.stateOperational();
    case 'DEGRADED':
      return StatusText.stateDegraded();
    case 'OUTAGE':
      return StatusText.stateOutage();
    case 'MAINTENANCE':
      return StatusText.stateMaintenance();
    default:
      return StatusText.stateUnknown();
  }
}

export function incidentStatusLabel(s: IncidentStatus): string {
  switch (s) {
    case 'INVESTIGATING':
      return StatusText.incidentInvestigating();
    case 'IDENTIFIED':
      return StatusText.incidentIdentified();
    case 'MONITORING':
      return StatusText.incidentMonitoring();
    default:
      return StatusText.incidentResolved();
  }
}

export function severityLabel(s: IncidentSeverity): string {
  switch (s) {
    case 'MINOR':
      return StatusText.severityMinor();
    case 'MAJOR':
      return StatusText.severityMajor();
    default:
      return StatusText.severityCritical();
  }
}

/**
 * Default severity names, only for slash-command choices (registered statically
 * with Discord, so not editable). Everything rendered uses `severityLabel()`.
 */
export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  MINOR: 'Minor',
  MAJOR: 'Major',
  CRITICAL: 'Critical',
};

const OVERALL_COLOR: Record<OverallState, number> = {
  OPERATIONAL: EMBED_COLORS.success,
  DEGRADED: EMBED_COLORS.warning,
  OUTAGE: EMBED_COLORS.danger,
  MAINTENANCE: EMBED_COLORS.primary,
  UNKNOWN: EMBED_COLORS.neutral,
  NO_SERVICES: EMBED_COLORS.neutral,
};

function overallText(o: OverallState): string {
  switch (o) {
    case 'OPERATIONAL':
      return StatusText.overallOperational();
    case 'DEGRADED':
      return StatusText.overallDegraded();
    case 'OUTAGE':
      return StatusText.overallOutage();
    case 'MAINTENANCE':
      return StatusText.overallMaintenance();
    case 'UNKNOWN':
      return StatusText.overallUnknown();
    default:
      return StatusText.overallNoServices();
  }
}

const STATE_COLOR: Record<ServiceState, number> = {
  OPERATIONAL: EMBED_COLORS.success,
  DEGRADED: EMBED_COLORS.warning,
  OUTAGE: EMBED_COLORS.danger,
  MAINTENANCE: EMBED_COLORS.primary,
  UNKNOWN: EMBED_COLORS.neutral,
};

export const serviceLine = (s: PublicService) =>
  `${STATE_EMOJI[s.state]} **${s.name}**${s.region ? ` · ${s.region}` : ''} — ${stateLabel(s.state)}`;

const incidentLine = (i: PublicIncident) =>
  `**${i.ref}** · ${truncate(i.title, 80)} · ${incidentStatusLabel(i.status)} · ${severityLabel(i.severity)} · ${StatusText.incidentSince({ time: discordTimestamp(i.startedAt, 'R') })}`;

const maintenanceLine = (m: PublicMaintenance) =>
  `🔧 **${truncate(m.title, 80)}** · ${discordTimestamp(m.startsAt, 'f')} → ${discordTimestamp(m.endsAt, 't')}${m.status === 'IN_PROGRESS' ? ` · ${StatusText.maintenanceInProgress()}` : ''}${
    m.services.length
      ? `\n   ${StatusText.maintenanceAffects({ services: m.services.map((s) => s.name).join(', ') })}`
      : ''
  }`;

/** Join lines but stay under Discord's field limit. */
function joinCapped(lines: string[], max = 1000): string {
  const out: string[] = [];
  let len = 0;
  for (const [idx, l] of lines.entries()) {
    if (len + l.length + 1 > max - 20) {
      out.push(StatusText.listMore({ count: lines.length - idx }));
      break;
    }
    out.push(l);
    len += l.length + 1;
  }
  return out.join('\n');
}

export function statusPageEmbed(s: PublicStatus): APIEmbed {
  return brandEmbed({
    title: StatusText.pageTitle(),
    color: OVERALL_COLOR[s.overall],
    description: overallText(s.overall),
    fields: [
      {
        name: StatusText.pageServicesField(),
        value: s.services.length ? joinCapped(s.services.map(serviceLine)) : StatusText.pageNoServices(),
      },
      {
        name: StatusText.pageIncidentsField(),
        value: s.activeIncidents.length
          ? joinCapped(s.activeIncidents.map(incidentLine))
          : StatusText.pageNoIncidents(),
      },
      {
        name: StatusText.pageMaintenanceField(),
        value: s.upcomingMaintenance.length
          ? joinCapped(s.upcomingMaintenance.slice(0, 3).map(maintenanceLine))
          : StatusText.pageNoMaintenance(),
      },
    ],
    footer: StatusText.pageFooter(),
    timestamp: s.generatedAt,
  });
}

/** Subscribe/unsubscribe buttons under /status. */
export function statusButtons(): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: StatusText.buttonSubscribe(),
          custom_id: 'statusui:sub:all',
          emoji: { name: '🔔' },
        },
        { type: 2, style: 2, label: StatusText.buttonUnsubscribe(), custom_id: 'statusui:unsub:all' },
        { type: 2, style: 2, label: StatusText.buttonHistory(), custom_id: 'statusui:history:-' },
      ],
    },
  ];
}

export function uptimeEmbed(rows: UptimeRow[], days: number): APIEmbed {
  const lines = rows.map((r) => {
    const line = StatusText.uptimeLine({
      service: r.name,
      uptime: r.uptimePct === null ? StatusText.uptimeNoData() : r.label,
    });
    return r.totalChecks
      ? `${line} ${StatusText.uptimeChecks({ ok: r.okChecks, total: r.totalChecks })}`
      : line;
  });
  return brandEmbed({
    title: StatusText.uptimeTitle({
      period: days === 1 ? StatusText.uptimePeriod24h() : StatusText.uptimePeriodDays({ days }),
    }),
    description: lines.length ? joinCapped(lines, 3900) : StatusText.uptimeEmpty(),
    footer: StatusText.uptimeFooter(),
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
    .map(
      (u) =>
        `${discordTimestamp(u.createdAt, 'f')} · **${incidentStatusLabel(u.status)}** — ${truncate(u.message, 300)}`,
    );
  const titleVars = { ref: i.ref, title: i.title };
  return brandEmbed({
    title:
      i.status === 'RESOLVED'
        ? StatusText.incidentTitleResolved(titleVars)
        : StatusText.incidentTitleOpen(titleVars),
    color: incidentColor(i),
    description: truncate(i.description, 1500),
    fields: [
      { name: StatusText.fieldStatus(), value: incidentStatusLabel(i.status), inline: true },
      { name: StatusText.fieldSeverity(), value: severityLabel(i.severity), inline: true },
      { name: StatusText.fieldStarted(), value: discordTimestamp(i.startedAt, 'f'), inline: true },
      ...(i.services.length
        ? [
            {
              name: StatusText.fieldAffectedServices(),
              value: i.services.map((s) => s.name).join(', '),
              inline: false,
            },
          ]
        : []),
      ...(i.regions.length
        ? [{ name: StatusText.fieldRegions(), value: i.regions.join(', '), inline: false }]
        : []),
      ...(i.resolvedAt
        ? [{ name: StatusText.fieldResolved(), value: discordTimestamp(i.resolvedAt, 'f'), inline: true }]
        : []),
      ...(i.resolutionSummary
        ? [
            {
              name: StatusText.fieldResolution(),
              value: truncate(i.resolutionSummary, 1000),
              inline: false,
            },
          ]
        : []),
      ...(timeline.length
        ? [{ name: StatusText.fieldUpdates(), value: joinCapped(timeline), inline: false }]
        : []),
    ],
    footer: StatusText.incidentFooter(),
  });
}

/** A short line posted under the incident message for each update. */
export function incidentUpdateEmbed(
  i: Pick<PublicIncident, 'ref' | 'title' | 'status' | 'severity'>,
  u: { status: IncidentStatus; message: string; createdAt: Date },
): APIEmbed {
  return brandEmbed({
    title: StatusText.incidentUpdateTitle({ ref: i.ref, status: incidentStatusLabel(u.status) }),
    color: u.status === 'RESOLVED' ? EMBED_COLORS.success : SEVERITY_COLORS[i.severity],
    description: truncate(u.message, 2000),
    timestamp: u.createdAt,
  });
}

export function incidentDmEmbed(
  i: PublicIncident,
  u: { status: IncidentStatus; message: string; createdAt: Date },
  guildName?: string,
): APIEmbed {
  return brandEmbed({
    title: StatusText.dmTitle({ ref: i.ref, title: truncate(i.title, 200) }),
    color: incidentColor({ status: u.status, severity: i.severity }),
    description: StatusText.dmDescription({
      status: incidentStatusLabel(u.status),
      message: truncate(u.message, 1500),
    }),
    fields: [
      { name: StatusText.fieldSeverity(), value: severityLabel(i.severity), inline: true },
      ...(i.services.length
        ? [
            {
              name: StatusText.dmFieldAffected(),
              value: i.services.map((s) => s.name).join(', '),
              inline: true,
            },
          ]
        : []),
    ],
    footer: guildName ? StatusText.dmFooterGuild({ guild: guildName }) : StatusText.dmFooter(),
    timestamp: u.createdAt,
  });
}

/** Automatic state-change alert for the status channel. */
export function alertEmbed(
  s: Pick<PublicService, 'name' | 'region' | 'state'>,
  from: ServiceState | null,
): APIEmbed {
  const recovered =
    s.state === 'OPERATIONAL' && from !== null && from !== 'OPERATIONAL' && from !== 'UNKNOWN';
  const service = { service: s.name };
  return brandEmbed({
    title: StatusText.alertTitle({
      emoji: STATE_EMOJI[s.state],
      service: s.name,
      state: recovered ? StatusText.alertRecovered() : stateLabel(s.state),
    }),
    color: STATE_COLOR[s.state],
    description:
      s.state === 'OUTAGE'
        ? StatusText.alertOutage(service)
        : s.state === 'DEGRADED'
          ? StatusText.alertDegraded(service)
          : StatusText.alertOperational(service),
    fields: s.region ? [{ name: StatusText.alertFieldRegion(), value: s.region, inline: true }] : [],
    footer: StatusText.alertFooter(),
  });
}

export type MaintenancePhase = 'scheduled' | 'rescheduled' | 'started' | 'completed' | 'cancelled';

function maintenanceTitle(phase: MaintenancePhase, title: string): string {
  const vars = { title };
  switch (phase) {
    case 'scheduled':
      return StatusText.maintenanceScheduledTitle(vars);
    case 'rescheduled':
      return StatusText.maintenanceRescheduledTitle(vars);
    case 'started':
      return StatusText.maintenanceStartedTitle(vars);
    case 'completed':
      return StatusText.maintenanceCompletedTitle(vars);
    default:
      return StatusText.maintenanceCancelledTitle(vars);
  }
}

export function maintenanceEmbed(m: PublicMaintenance, phase: MaintenancePhase): APIEmbed {
  return brandEmbed({
    title: maintenanceTitle(phase, truncate(m.title, 180)),
    color:
      phase === 'completed'
        ? EMBED_COLORS.success
        : phase === 'cancelled'
          ? EMBED_COLORS.neutral
          : EMBED_COLORS.primary,
    description:
      phase === 'cancelled' ? StatusText.maintenanceCancelledBody() : truncate(m.description, 1500),
    fields: [
      { name: StatusText.fieldStarts(), value: discordTimestamp(m.startsAt, 'F'), inline: true },
      { name: StatusText.fieldEnds(), value: discordTimestamp(m.endsAt, 'F'), inline: true },
      ...(m.services.length
        ? [
            {
              name: StatusText.fieldAffectedServices(),
              value: m.services.map((s) => s.name).join(', '),
              inline: false,
            },
          ]
        : []),
    ],
  });
}

export function incidentsListEmbed(
  active: PublicIncident[],
  resolved: PublicIncident[],
  page: number,
): APIEmbed {
  const resolvedLines = resolved.map(
    (i) =>
      `**${i.ref}** · ${truncate(i.title, 80)} · ${severityLabel(i.severity)} · ${discordTimestamp(i.startedAt, 'd')}${i.resolvedAt ? ` ${StatusText.incidentsResolvedAt({ time: discordTimestamp(i.resolvedAt, 'R') })}` : ''}`,
  );
  return brandEmbed({
    title: StatusText.incidentsTitle(),
    fields: [
      ...(page === 0
        ? [
            {
              name: StatusText.incidentsActiveField(),
              value: active.length ? joinCapped(active.map(incidentLine)) : StatusText.incidentsNoActive(),
            },
          ]
        : []),
      {
        name:
          page === 0
            ? StatusText.incidentsRecentField()
            : StatusText.incidentsResolvedPageField({ page: page + 1 }),
        value: resolvedLines.length ? joinCapped(resolvedLines) : StatusText.incidentsNoResolved(),
      },
    ],
  });
}
