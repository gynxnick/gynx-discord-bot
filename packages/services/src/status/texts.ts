import { defineTexts } from '../core/text';

/** Member-facing wording of the status module (status page, live board, alerts, incidents, DMs). */
export const StatusText = defineTexts('status', {
  // ── Labels ────────────────────────────────────────────────────────────────
  stateOperational: { default: 'Operational', help: 'Service state label: operational.', kind: 'short' },
  stateDegraded: {
    default: 'Degraded performance',
    help: 'Service state label: degraded.',
    kind: 'short',
  },
  stateOutage: { default: 'Outage', help: 'Service state label: outage.', kind: 'short' },
  stateMaintenance: {
    default: 'Under maintenance',
    help: 'Service state label: under maintenance.',
    kind: 'short',
  },
  stateUnknown: { default: 'Status unknown', help: 'Service state label: unknown.', kind: 'short' },
  incidentInvestigating: {
    default: 'Investigating',
    help: 'Incident status label: investigating.',
    kind: 'short',
  },
  incidentIdentified: { default: 'Identified', help: 'Incident status label: identified.', kind: 'short' },
  incidentMonitoring: { default: 'Monitoring', help: 'Incident status label: monitoring.', kind: 'short' },
  incidentResolved: { default: 'Resolved', help: 'Incident status label: resolved.', kind: 'short' },
  severityMinor: { default: 'Minor', help: 'Incident severity label: minor.', kind: 'short' },
  severityMajor: { default: 'Major', help: 'Incident severity label: major.', kind: 'short' },
  severityCritical: { default: 'Critical', help: 'Incident severity label: critical.', kind: 'short' },
  allServices: {
    default: 'All services',
    help: 'Name for "every service" in subscriptions and the service autocomplete.',
    kind: 'short',
  },

  // ── Overall status (status page / live board description) ────────────────
  overallOperational: {
    default: '🟢 All systems operational',
    help: 'Status page headline when everything is operational.',
  },
  overallDegraded: {
    default: '🟡 Some systems are experiencing degraded performance',
    help: 'Status page headline when a service is degraded.',
  },
  overallOutage: {
    default: '🔴 Some systems are experiencing an outage',
    help: 'Status page headline when a service has an outage.',
  },
  overallMaintenance: {
    default: '🔧 Scheduled maintenance in progress',
    help: 'Status page headline during maintenance.',
  },
  overallUnknown: {
    default: '⚪ Status is not available yet — checks are still starting up',
    help: 'Status page headline before the first checks have run.',
  },
  overallNoServices: {
    default: '⚪ No services are being monitored publicly yet',
    help: 'Status page headline when no public services exist.',
  },

  // ── Status page (/status and live board) ──────────────────────────────────
  pageTitle: {
    default: 'GYNX.GG Service Status',
    help: 'Title of the /status embed and live board.',
    kind: 'title',
  },
  pageServicesField: { default: 'Services', help: 'Status page field name: service list.', kind: 'title' },
  pageNoServices: {
    default: 'No public services configured.',
    help: 'Status page: shown when there are no public services.',
  },
  pageIncidentsField: {
    default: 'Active incidents',
    help: 'Status page field name: active incidents.',
    kind: 'title',
  },
  pageNoIncidents: { default: 'None', help: 'Status page: shown when there are no active incidents.' },
  pageMaintenanceField: {
    default: 'Upcoming maintenance',
    help: 'Status page field name: upcoming maintenance.',
    kind: 'title',
  },
  pageNoMaintenance: {
    default: 'None scheduled',
    help: 'Status page: shown when no maintenance is scheduled.',
  },
  pageFooter: {
    default: 'Status is checked automatically · Times shown in your local time zone',
    help: 'Footer of the /status embed.',
    kind: 'short',
  },
  incidentSince: {
    default: 'since {time}',
    help: 'End of an active-incident line. {time} is a relative timestamp.',
    vars: ['time'],
    kind: 'short',
  },
  maintenanceInProgress: {
    default: 'in progress',
    help: 'Marker on an upcoming-maintenance line that has already started.',
    kind: 'short',
  },
  maintenanceAffects: {
    default: 'Affects: {services}',
    help: 'Second line of an upcoming-maintenance entry listing affected services.',
    vars: ['services'],
  },
  listMore: {
    default: '…and {count} more',
    help: 'Shown when a list is cut short to fit Discord limits.',
    vars: ['count'],
    kind: 'short',
  },
  buttonSubscribe: {
    default: 'Notify me about incidents',
    help: 'Button under /status and the live board: subscribe to DMs.',
    kind: 'label',
  },
  buttonUnsubscribe: {
    default: 'Stop notifications',
    help: 'Button under /status and the live board: unsubscribe.',
    kind: 'label',
  },
  buttonHistory: {
    default: 'Incident history',
    help: 'Button under /status and the live board: show incidents.',
    kind: 'label',
  },

  // ── Live board ────────────────────────────────────────────────────────────
  boardUpdatedLine: {
    default: 'Live board · updated {time}',
    help: 'Last line of the live status board. {time} is a relative timestamp.',
    vars: ['time'],
  },
  boardFooter: {
    default: 'Updates automatically · Use the buttons for alerts and history',
    help: 'Footer of the live status board.',
    kind: 'short',
  },
  boardMovedTitle: {
    default: 'Status board moved',
    help: 'Title put on the old board message when the board moves channel.',
    kind: 'title',
  },
  boardMovedBody: {
    default: 'The live status board is now in {channel}.',
    help: 'Text put on the old board message when the board moves. {channel} is the new channel.',
    vars: ['channel'],
  },

  // ── /uptime ───────────────────────────────────────────────────────────────
  uptimeTitle: {
    default: 'Uptime · last {period}',
    help: 'Title of the /uptime embed. {period} is e.g. "24 hours" or "30 days".',
    vars: ['period'],
    kind: 'title',
  },
  uptimePeriod24h: { default: '24 hours', help: '/uptime period name for one day.', kind: 'short' },
  uptimePeriodDays: {
    default: '{days} days',
    help: '/uptime period name for several days.',
    vars: ['days'],
    kind: 'short',
  },
  uptimeLine: {
    default: '**{service}** — {uptime}',
    help: 'One service line in /uptime. {uptime} is the percentage or "no data".',
    vars: ['service', 'uptime'],
  },
  uptimeChecks: {
    default: '({ok}/{total} checks)',
    help: 'Check count appended to an /uptime line.',
    vars: ['ok', 'total'],
    kind: 'short',
  },
  uptimeNoData: {
    default: 'no data',
    help: '/uptime value when no checks were recorded.',
    kind: 'short',
  },
  uptimeEmpty: {
    default: 'No public services are being monitored yet.',
    help: '/uptime when there are no public services.',
  },
  uptimeFooter: {
    default:
      'Uptime = successful checks ÷ total checks. "no data" means no checks were recorded in this period.',
    help: 'Footer of the /uptime embed.',
  },

  // ── Incident messages (incident channel) ─────────────────────────────────
  incidentTitleOpen: {
    default: '⚠️ {ref} · {title}',
    help: 'Title of an open incident message in the incident channel.',
    vars: ['ref', 'title'],
    kind: 'title',
  },
  incidentTitleResolved: {
    default: '✅ {ref} · {title}',
    help: 'Title of a resolved incident message in the incident channel.',
    vars: ['ref', 'title'],
    kind: 'title',
  },
  fieldStatus: { default: 'Status', help: 'Incident embed field name: status.', kind: 'title' },
  fieldSeverity: {
    default: 'Severity',
    help: 'Incident embed and DM field name: severity.',
    kind: 'title',
  },
  fieldStarted: { default: 'Started', help: 'Incident embed field name: start time.', kind: 'title' },
  fieldAffectedServices: {
    default: 'Affected services',
    help: 'Incident and maintenance embed field name: affected services.',
    kind: 'title',
  },
  fieldRegions: { default: 'Regions', help: 'Incident embed field name: regions.', kind: 'title' },
  fieldResolved: { default: 'Resolved', help: 'Incident embed field name: resolve time.', kind: 'title' },
  fieldResolution: {
    default: 'Resolution',
    help: 'Incident embed field name: resolution summary.',
    kind: 'title',
  },
  fieldUpdates: { default: 'Updates', help: 'Incident embed field name: update timeline.', kind: 'title' },
  incidentFooter: { default: 'GYNX.GG Incident', help: 'Footer of incident messages.', kind: 'short' },
  incidentUpdateTitle: {
    default: '{ref} · {status}',
    help: 'Title of the short update posted under an incident message.',
    vars: ['ref', 'status'],
    kind: 'title',
  },

  // ── Subscriber DMs ────────────────────────────────────────────────────────
  dmTitle: {
    default: '{ref} · {title}',
    help: 'Title of an incident DM to subscribers.',
    vars: ['ref', 'title'],
    kind: 'title',
  },
  dmDescription: {
    default: '**{status}** — {message}',
    help: 'Body of an incident DM to subscribers.',
    vars: ['status', 'message'],
    kind: 'long',
  },
  dmFieldAffected: { default: 'Affected', help: 'Incident DM field name: affected services.', kind: 'title' },
  dmFooter: {
    default:
      "You're receiving this because you subscribed to status updates. Use /subscribe-status remove to stop.",
    help: 'Footer of incident DMs (server name unknown).',
  },
  dmFooterGuild: {
    default:
      "You're receiving this because you subscribed to status updates in {guild}. Use /subscribe-status remove to stop.",
    help: 'Footer of incident DMs naming the server.',
    vars: ['guild'],
  },

  // ── Automatic alerts (status channel) ────────────────────────────────────
  alertTitle: {
    default: '{emoji} {service} · {state}',
    help: 'Title of an automatic state-change alert.',
    vars: ['emoji', 'service', 'state'],
    kind: 'title',
  },
  alertRecovered: {
    default: 'Recovered',
    help: 'State shown in an alert title when a service recovers.',
    kind: 'short',
  },
  alertOutage: {
    default: "We're seeing problems with **{service}** and are looking into it.",
    help: 'Alert body when a service has an outage.',
    vars: ['service'],
  },
  alertDegraded: {
    default: '**{service}** is responding slower than usual or partially impaired.',
    help: 'Alert body when a service is degraded.',
    vars: ['service'],
  },
  alertOperational: {
    default: '**{service}** is operating normally again.',
    help: 'Alert body for any other state change (recovery, maintenance).',
    vars: ['service'],
  },
  alertFieldRegion: { default: 'Region', help: 'Alert field name: region.', kind: 'title' },
  alertFooter: {
    default: 'Automatic status alert · /status for the full overview',
    help: 'Footer of automatic alerts.',
    kind: 'short',
  },

  // ── Maintenance notices (status channel and DMs) ─────────────────────────
  maintenanceScheduledTitle: {
    default: '🔧 Scheduled maintenance · {title}',
    help: 'Title of a new maintenance announcement.',
    vars: ['title'],
    kind: 'title',
  },
  maintenanceRescheduledTitle: {
    default: '🔧 Maintenance rescheduled · {title}',
    help: 'Title when maintenance is rescheduled.',
    vars: ['title'],
    kind: 'title',
  },
  maintenanceStartedTitle: {
    default: '🔧 Maintenance started · {title}',
    help: 'Title when maintenance starts.',
    vars: ['title'],
    kind: 'title',
  },
  maintenanceCompletedTitle: {
    default: '✅ Maintenance completed · {title}',
    help: 'Title when maintenance is completed.',
    vars: ['title'],
    kind: 'title',
  },
  maintenanceCancelledTitle: {
    default: 'Maintenance cancelled · {title}',
    help: 'Title when maintenance is cancelled.',
    vars: ['title'],
    kind: 'title',
  },
  maintenanceCancelledBody: {
    default: 'This maintenance will not take place.',
    help: 'Body of a maintenance cancellation notice.',
  },
  fieldStarts: { default: 'Starts', help: 'Maintenance embed field name: start time.', kind: 'title' },
  fieldEnds: { default: 'Ends', help: 'Maintenance embed field name: end time.', kind: 'title' },

  // ── /incidents ────────────────────────────────────────────────────────────
  incidentsTitle: { default: 'Incidents', help: 'Title of the /incidents embed.', kind: 'title' },
  incidentsActiveField: {
    default: 'Active',
    help: '/incidents field name: active incidents.',
    kind: 'title',
  },
  incidentsNoActive: { default: 'No active incidents 🎉', help: '/incidents when nothing is active.' },
  incidentsRecentField: {
    default: 'Recently resolved',
    help: '/incidents field name: resolved incidents (first page).',
    kind: 'title',
  },
  incidentsResolvedPageField: {
    default: 'Resolved · page {page}',
    help: '/incidents field name on later pages.',
    vars: ['page'],
    kind: 'title',
  },
  incidentsNoResolved: {
    default: 'No resolved incidents on record.',
    help: '/incidents when there is no resolved history.',
  },
  incidentsResolvedAt: {
    default: '→ resolved {time}',
    help: 'End of a resolved-incident line. {time} is a relative timestamp.',
    vars: ['time'],
    kind: 'short',
  },
  buttonNewest: { default: 'Newest', help: '/incidents button: back to the first page.', kind: 'label' },
  buttonOlder: { default: 'Older', help: '/incidents button: next page.', kind: 'label' },

  // ── /subscribe-status and status buttons ─────────────────────────────────
  subscribedTitle: { default: 'Subscribed', help: 'Title of the subscribe confirmation.', kind: 'title' },
  subscribedBody: {
    default:
      "You'll get a DM for **{severity}+** incidents affecting **{service}**. Make sure DMs from server members are allowed.",
    help: '/subscribe-status add confirmation (without maintenance).',
    vars: ['severity', 'service'],
  },
  subscribedBodyMaintenance: {
    default:
      "You'll get a DM for **{severity}+** incidents affecting **{service}** and for scheduled maintenance. Make sure DMs from server members are allowed.",
    help: '/subscribe-status add confirmation (with maintenance).',
    vars: ['severity', 'service'],
  },
  quickSubscribedBody: {
    default:
      "You'll get a DM about incidents and maintenance affecting GYNX.GG services. Use `/subscribe-status` to fine-tune.",
    help: 'Confirmation after clicking "Notify me about incidents".',
  },
  unsubscribedTitle: {
    default: 'Unsubscribed',
    help: 'Title of the unsubscribe confirmation.',
    kind: 'title',
  },
  unsubscribedOne: {
    default: 'Removed {count} subscription.',
    help: '/subscribe-status remove: one subscription removed.',
    vars: ['count'],
  },
  unsubscribedMany: {
    default: 'Removed {count} subscriptions.',
    help: '/subscribe-status remove: several subscriptions removed.',
    vars: ['count'],
  },
  nothingToRemoveTitle: {
    default: 'Nothing to remove',
    help: '/subscribe-status remove title when nothing matched.',
    kind: 'title',
  },
  nothingToRemoveBody: {
    default: "You weren't subscribed to that.",
    help: '/subscribe-status remove when nothing matched.',
  },
  quickUnsubscribedBody: {
    default: 'You will no longer receive status DMs.',
    help: 'Confirmation after clicking "Stop notifications".',
  },
  notSubscribedTitle: {
    default: 'Not subscribed',
    help: 'Title after clicking "Stop notifications" with no subscriptions.',
    kind: 'title',
  },
  notSubscribedBody: {
    default: "You didn't have any status subscriptions.",
    help: 'Shown after clicking "Stop notifications" with no subscriptions.',
  },
  subscriptionsTitle: {
    default: 'Your status subscriptions',
    help: 'Title of /subscribe-status list.',
    kind: 'title',
  },
  subscriptionLine: {
    default: '• **{service}** · {severity}+',
    help: 'One line of /subscribe-status list (no maintenance).',
    vars: ['service', 'severity'],
  },
  subscriptionLineMaintenance: {
    default: '• **{service}** · {severity}+ · maintenance',
    help: 'One line of /subscribe-status list (with maintenance).',
    vars: ['service', 'severity'],
  },
  subscriptionsEmpty: {
    default: 'You have no status subscriptions. Use `/subscribe-status add` to get notified.',
    help: '/subscribe-status list when there are none.',
  },
  subscriptionLimit: {
    default: 'You have reached the maximum number of status subscriptions.',
    help: 'Error when a member has too many status subscriptions.',
  },
});
