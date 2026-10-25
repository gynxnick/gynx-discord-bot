import { defineTexts } from '../core/text';

/** Defaults kept as constants: tests and the dashboard reference them directly. */
export const SUPPORT_NOTE =
  'Support metrics: handled in the external support system (not tracked by the bot)';
export const ACTIVITY_NOTE =
  'Community activity figures are observed message activity only — Discord provides no view or impression data.';

/**
 * Wording for /analytics, /staff-stats, /config and the weekly report (summary embed
 * and the Markdown report's headings and labels). Computed values (numbers,
 * comparisons, metric notes and "not available" reasons) are passed in as placeholders.
 */
export const AnalyticsText = defineTexts('analytics', {
  // ── Shared ────────────────────────────────────────────────────────────────
  na: {
    default: 'n/a',
    help: 'Shown in analytics embeds and the report for a value or comparison with no data.',
    kind: 'short',
  },
  none: {
    default: 'none',
    help: 'Shown for an empty breakdown (e.g. no moderation actions by type) in analytics embeds and the report.',
    kind: 'short',
  },
  noData: {
    default: 'no data',
    help: 'Uptime shown for a monitored service with no checks in the period.',
    kind: 'short',
  },
  notAvailable: {
    default: 'Not available — {reason}',
    help: 'Shown in the weekly report for a metric that cannot be measured. {reason} explains why.',
    vars: ['reason'],
  },
  unavailableNote: {
    default: '_Not available — {reasons}_',
    help: 'Line under an /analytics embed field listing why some metrics are unavailable.',
    vars: ['reasons'],
  },
  supportNote: {
    default: SUPPORT_NOTE,
    help: 'Support section of the weekly report and its summary embed.',
  },
  activityNote: {
    default: ACTIVITY_NOTE,
    help: 'Note at the top of the Community growth section of the weekly report.',
  },
  openDashboard: {
    default: 'Open dashboard',
    help: 'Link button under /analytics, /staff-stats and /config view.',
    kind: 'label',
  },

  // ── /analytics ────────────────────────────────────────────────────────────
  overviewTitle: {
    default: 'Analytics · last {period}',
    help: 'Title prefix of the /analytics overview embed (the date range is appended). {period} is 7d/30d/90d.',
    vars: ['period'],
    kind: 'title',
  },
  overviewFooter: {
    default:
      'Observed message activity only — Discord provides no view data. Comparisons vs previous equal period.',
    help: 'Footer of the /analytics overview embed.',
  },
  sectionTitle: {
    default: 'Analytics · {section} · last {period}',
    help: 'Title of an /analytics section embed. {section} is the chosen section, {period} 7d/30d/90d.',
    vars: ['section', 'period'],
    kind: 'title',
  },
  sectionDescription: {
    default: '{range}\nPercentages compare with the previous {period}. "n/a" = no comparable data.',
    help: 'Description of an /analytics section embed. {range} is the date range.',
    vars: ['range', 'period'],
    kind: 'long',
  },
  sectionFooter: {
    default: 'Observed message activity only — Discord provides no view or impression data.',
    help: 'Footer of an /analytics section embed.',
  },

  // ── /analytics section fields ─────────────────────────────────────────────
  communityGrowthField: {
    default: 'Community growth',
    help: 'Field name in /analytics community.',
    kind: 'title',
  },
  communityGrowthValue: {
    default: 'Members: **{members}**{membersNote}\nJoins {joins} · Leaves {leaves} · Net {net}',
    help: 'Community growth field in /analytics community. {membersNote} is an optional " (note)".',
    vars: ['members', 'membersNote', 'joins', 'leaves', 'net'],
  },
  activityField: {
    default: 'Observed message activity',
    help: 'Field name in /analytics community.',
    kind: 'title',
  },
  activityValue: {
    default:
      'Active members (≥{threshold} msg): {active}\nMessages: {messages}\nDAU {dau} · WAU {wau} · MAU {mau}',
    help: 'Message activity field in /analytics community.',
    vars: ['threshold', 'active', 'messages', 'dau', 'wau', 'mau'],
  },
  topChannelsField: {
    default: 'Top channels',
    help: 'Field name in /analytics community.',
    kind: 'title',
  },
  moderationField: {
    default: 'Moderation',
    help: 'Field name in /analytics moderation.',
    kind: 'title',
  },
  moderationValue: {
    default: 'Actions: {actions}\n{byType}',
    help: 'Moderation field in /analytics moderation. {byType} is the per-type breakdown.',
    vars: ['actions', 'byType'],
  },
  automodField: {
    default: 'Automod',
    help: 'Field name in /analytics moderation.',
    kind: 'title',
  },
  automodValue: {
    default: 'Detections: {detections} · False positives: {falsePositives}\n{byRule}',
    help: 'Automod field in /analytics moderation. {byRule} is the per-rule breakdown.',
    vars: ['detections', 'falsePositives', 'byRule'],
  },
  abuseReportsField: {
    default: 'Abuse reports',
    help: 'Field name in /analytics moderation.',
    kind: 'title',
  },
  abuseReportsValue: {
    default: 'Received {received} · Resolved {resolved} · Dismissed {dismissed}\nOpen backlog: **{backlog}**',
    help: 'Abuse reports field in /analytics moderation.',
    vars: ['received', 'resolved', 'dismissed', 'backlog'],
  },
  incidentsField: {
    default: 'Incidents',
    help: 'Field name in /analytics infrastructure.',
    kind: 'title',
  },
  incidentsValue: {
    default:
      'Opened {opened} · Resolved {resolved}\n{bySeverity}\nTotal time: {time} · Auto {auto} / Manual {manual}',
    help: 'Incidents field in /analytics infrastructure. {bySeverity} is the per-severity breakdown.',
    vars: ['opened', 'resolved', 'bySeverity', 'time', 'auto', 'manual'],
  },
  uptimeField: {
    default: 'Uptime (public services)',
    help: 'Field name in /analytics infrastructure.',
    kind: 'title',
  },
  uptimeNone: {
    default: 'No public monitored services',
    help: 'Uptime field in /analytics infrastructure when no public services are monitored.',
    kind: 'short',
  },
  announcementsField: {
    default: 'Announcements & links',
    help: 'Field name in /analytics marketing.',
    kind: 'title',
  },
  announcementsValue: {
    default: 'Published {published} · Reactions {reactions}\nTracked link clicks: {clicks}{clicksNote}',
    help: 'Announcements field in /analytics marketing. {clicksNote} is an optional " (note)".',
    vars: ['published', 'reactions', 'clicks', 'clicksNote'],
  },
  engagementField: {
    default: 'Engagement',
    help: 'Field name in /analytics marketing.',
    kind: 'title',
  },
  engagementValue: {
    default: 'RSVPs {rsvps} · Giveaway entries {giveaways}\nPoll ballots {polls} · Suggestions {suggestions}',
    help: 'Engagement field in /analytics marketing.',
    vars: ['rsvps', 'giveaways', 'polls', 'suggestions'],
  },
  partnerApplicationsField: {
    default: 'Partner applications',
    help: 'Field name in /analytics marketing.',
    kind: 'title',
  },
  referralsField: {
    default: 'Referrals',
    help: 'Field name in /analytics marketing.',
    kind: 'title',
  },
  referralsValue: {
    default:
      'Tracked joins {joins}\nConfirmed {confirmed} · Ambiguous {ambiguous} · Unknown {unknown}\nFlagged {flagged}',
    help: 'Referrals field in /analytics marketing.',
    vars: ['joins', 'confirmed', 'ambiguous', 'unknown', 'flagged'],
  },
  needsAttentionField: {
    default: 'Needs attention',
    help: 'Field name on the weekly report summary embed and /analytics overview.',
    kind: 'title',
  },
  needsAttentionValue: {
    default:
      'Open reports > 72h: **{staleReports}**\nActive incidents: **{activeIncidents}**{incidentRefs}\nDead-letter jobs: **{deadJobs}**\nFlagged referrals: **{flaggedReferrals}**\nPartner apps pending > 7d: **{stalePartnerApps}**',
    help: 'Needs attention field. {incidentRefs} is an optional " (INC-1, INC-2)" list.',
    vars: [
      'staleReports',
      'activeIncidents',
      'incidentRefs',
      'deadJobs',
      'flaggedReferrals',
      'stalePartnerApps',
    ],
  },

  // ── Weekly report summary embed ───────────────────────────────────────────
  reportDefaultTitle: {
    default: 'Weekly CEO report',
    help: 'Report title used when no report name is given (summary embed and Markdown report).',
    kind: 'title',
  },
  reportEmbedTitle: {
    default: '{title} · {range}',
    help: 'Title of the weekly report summary embed and /analytics overview. {title} is the report name.',
    vars: ['title', 'range'],
    kind: 'title',
  },
  summaryCommunityField: {
    default: 'Community',
    help: 'Field name on the weekly report summary embed and /analytics overview.',
    kind: 'title',
  },
  summaryCommunityValue: {
    default: 'Members {members} · Net {net}\nActive {active} · Messages {messages}',
    help: 'Community field on the weekly report summary embed and /analytics overview.',
    vars: ['members', 'net', 'active', 'messages'],
  },
  summaryInfrastructureField: {
    default: 'Infrastructure',
    help: 'Field name on the weekly report summary embed and /analytics overview.',
    kind: 'title',
  },
  summaryInfrastructureValue: {
    default: 'Incidents {incidents}\nIncident time {time}',
    help: 'Infrastructure field on the weekly report summary embed and /analytics overview.',
    vars: ['incidents', 'time'],
  },
  summaryModerationField: {
    default: 'Moderation & security',
    help: 'Field name on the weekly report summary embed and /analytics overview.',
    kind: 'title',
  },
  summaryModerationValue: {
    default: 'Actions {actions} · Automod {automod}\nReports {reports} · Backlog {backlog}',
    help: 'Moderation field on the weekly report summary embed and /analytics overview.',
    vars: ['actions', 'automod', 'reports', 'backlog'],
  },
  summaryMarketingField: {
    default: 'Announcements & referrals',
    help: 'Field name on the weekly report summary embed and /analytics overview.',
    kind: 'title',
  },
  summaryMarketingValue: {
    default: 'Published {published} · Clicks {clicks}\nConfirmed referrals {confirmed} · Unknown {unknown}',
    help: 'Announcements & referrals field on the weekly report summary embed and /analytics overview.',
    vars: ['published', 'clicks', 'confirmed', 'unknown'],
  },
  summarySupportField: {
    default: 'Support',
    help: 'Field name on the weekly report summary embed and /analytics overview.',
    kind: 'title',
  },
  summaryFooter: {
    default:
      'Full report attached (Markdown) · Community activity figures are observed message activity only · {footer}',
    help: 'Footer of the weekly report summary embed. {footer} is the server embed footer.',
    vars: ['footer'],
  },

  // ── Executive summary bullets ─────────────────────────────────────────────
  summaryGrowth: {
    default: 'Community: net growth of {net} members ({joins} joins, {leaves} leaves){total}.',
    help: 'Executive summary bullet on member growth. {total} is the optional total-members part.',
    vars: ['net', 'joins', 'leaves', 'total'],
  },
  summaryGrowthTotal: {
    default: '; {members} members total',
    help: 'Appended to the member growth summary bullet when the total is known.',
    vars: ['members'],
    kind: 'short',
  },
  summaryMembersOnly: {
    default: 'Community: {members} members ({note}); join/leave data not available.',
    help: 'Executive summary bullet when only the member total is known.',
    vars: ['members', 'note'],
  },
  summaryLatestSnapshot: {
    default: 'latest snapshot',
    help: 'Note used in the member-total summary bullet when no other note exists.',
    kind: 'short',
  },
  summaryActivity: {
    default: 'Activity: {active} active members sent {messages} messages (observed message activity).',
    help: 'Executive summary bullet on message activity.',
    vars: ['active', 'messages'],
  },
  summaryNoIncidents: {
    default: 'Infrastructure: no incidents were opened this period.',
    help: 'Executive summary bullet when no incidents were opened.',
  },
  summaryIncidents: {
    default: 'Infrastructure: {incidents} opened ({serious} major/critical){time}.',
    help: 'Executive summary bullet on incidents. {incidents} is e.g. "2 incidents"; {time} the optional total time part.',
    vars: ['incidents', 'serious', 'time'],
  },
  summaryIncidentTime: {
    default: ', {time} total incident time',
    help: 'Appended to the incidents summary bullet when incident time is known.',
    vars: ['time'],
    kind: 'short',
  },
  summarySecurity: {
    default: 'Security: {reports} ({stale} older than 72h){received}',
    help: 'Executive summary bullet on the abuse report backlog. {reports} is e.g. "4 open abuse reports".',
    vars: ['reports', 'stale', 'received'],
  },
  summarySecurityReceived: {
    default: '; {count} received this period.',
    help: 'Appended to the security summary bullet when received reports are known.',
    vars: ['count'],
    kind: 'short',
  },
  summaryAttention: {
    default: 'Needs attention: {items}.',
    help: 'Executive summary bullet listing outstanding items.',
    vars: ['items'],
  },
  summaryNotableChange: {
    default: 'Notable change: {metric} {direction} {pct}% to {value} (from {previous}).',
    help: 'Executive summary bullet for a large change. {direction} is the "up"/"down" text.',
    vars: ['metric', 'direction', 'pct', 'value', 'previous'],
  },
  changeUp: { default: 'up', help: 'Direction word in a "Notable change" summary bullet.', kind: 'short' },
  changeDown: {
    default: 'down',
    help: 'Direction word in a "Notable change" summary bullet.',
    kind: 'short',
  },
  summaryCoverage: {
    default:
      'Data coverage: {missing} of {total} metrics are not available for this period (see sections below).',
    help: 'Executive summary bullet when many metrics are unavailable.',
    vars: ['missing', 'total'],
  },
  summaryNoIssues: {
    default: 'No outstanding issues requiring attention were detected.',
    help: 'Executive summary bullet when nothing needs attention.',
  },
  countIncidentOne: {
    default: '{count} incident',
    help: 'Summary bullets: one incident.',
    vars: ['count'],
    kind: 'short',
  },
  countIncidentMany: {
    default: '{count} incidents',
    help: 'Summary bullets: several incidents.',
    vars: ['count'],
    kind: 'short',
  },
  countOpenReportOne: {
    default: '{count} open abuse report',
    help: 'Security summary bullet: one open report.',
    vars: ['count'],
    kind: 'short',
  },
  countOpenReportMany: {
    default: '{count} open abuse reports',
    help: 'Security summary bullet: several open reports.',
    vars: ['count'],
    kind: 'short',
  },
  countActiveIncidentOne: {
    default: '{count} active incident',
    help: 'Needs attention summary bullet: one active incident.',
    vars: ['count'],
    kind: 'short',
  },
  countActiveIncidentMany: {
    default: '{count} active incidents',
    help: 'Needs attention summary bullet: several active incidents.',
    vars: ['count'],
    kind: 'short',
  },
  countFailedJobOne: {
    default: '{count} failed background job',
    help: 'Needs attention summary bullet: one failed job.',
    vars: ['count'],
    kind: 'short',
  },
  countFailedJobMany: {
    default: '{count} failed background jobs',
    help: 'Needs attention summary bullet: several failed jobs.',
    vars: ['count'],
    kind: 'short',
  },
  countFlaggedReferralOne: {
    default: '{count} flagged referral',
    help: 'Needs attention summary bullet: one flagged referral.',
    vars: ['count'],
    kind: 'short',
  },
  countFlaggedReferralMany: {
    default: '{count} flagged referrals',
    help: 'Needs attention summary bullet: several flagged referrals.',
    vars: ['count'],
    kind: 'short',
  },
  countPendingPartnerAppOne: {
    default: '{count} partner application pending > 7 days',
    help: 'Needs attention summary bullet: one stale partner application.',
    vars: ['count'],
    kind: 'short',
  },
  countPendingPartnerAppMany: {
    default: '{count} partner applications pending > 7 days',
    help: 'Needs attention summary bullet: several stale partner applications.',
    vars: ['count'],
    kind: 'short',
  },

  // ── Markdown report: headings ─────────────────────────────────────────────
  mdTitle: {
    default: '{title} — GYNX.GG',
    help: 'Top heading of the Markdown report. {title} is the report name.',
    vars: ['title'],
    kind: 'title',
  },
  mdPeriod: {
    default: 'Period: {period}',
    help: 'Markdown report: period line.',
    vars: ['period'],
    kind: 'short',
  },
  mdGenerated: {
    default: 'Generated: {time}',
    help: 'Markdown report: generation time line.',
    vars: ['time'],
    kind: 'short',
  },
  mdHeadingSummary: {
    default: '1. Executive summary',
    help: 'Markdown report: section 1 heading.',
    kind: 'title',
  },
  mdHeadingCommunity: {
    default: '2. Community growth',
    help: 'Markdown report: section 2 heading.',
    kind: 'title',
  },
  mdHeadingSupport: { default: '3. Support', help: 'Markdown report: section 3 heading.', kind: 'title' },
  mdHeadingInfrastructure: {
    default: '4. Infrastructure incidents',
    help: 'Markdown report: section 4 heading.',
    kind: 'title',
  },
  mdHeadingModeration: {
    default: '5. Moderation & security trends',
    help: 'Markdown report: section 5 heading.',
    kind: 'title',
  },
  mdHeadingMarketing: {
    default: '6. Announcements & referral results',
    help: 'Markdown report: section 6 heading.',
    kind: 'title',
  },
  mdHeadingOutstanding: {
    default: '7. Outstanding issues requiring attention',
    help: 'Markdown report: section 7 heading.',
    kind: 'title',
  },
  mdHeadingComparison: {
    default: '8. Comparison vs previous period',
    help: 'Markdown report: section 8 heading.',
    kind: 'title',
  },
  mdVsPrevious: {
    default: 'vs previous: {change}',
    help: 'Markdown report: comparison appended to a metric line.',
    vars: ['change'],
    kind: 'short',
  },
  mdVsPreviousMinutes: {
    default: 'vs previous: {change} min',
    help: 'Markdown report: comparison appended to the total incident time line.',
    vars: ['change'],
    kind: 'short',
  },

  // ── Markdown report: section 2 labels ─────────────────────────────────────
  mdTotalMembers: { default: 'Total members', help: 'Markdown report label (community).', kind: 'short' },
  mdJoins: { default: 'Joins', help: 'Markdown report label (community).', kind: 'short' },
  mdLeaves: { default: 'Leaves', help: 'Markdown report label (community).', kind: 'short' },
  mdNetGrowth: { default: 'Net growth', help: 'Markdown report label (community).', kind: 'short' },
  mdActiveMembers: { default: 'Active members', help: 'Markdown report label (community).', kind: 'short' },
  mdMessages: { default: 'Messages', help: 'Markdown report label (community).', kind: 'short' },
  mdDau: { default: 'Daily active (avg)', help: 'Markdown report label (community).', kind: 'short' },
  mdWau: { default: 'Weekly active', help: 'Markdown report label (community).', kind: 'short' },
  mdMau: { default: 'Monthly active', help: 'Markdown report label (community).', kind: 'short' },
  mdTopChannels: {
    default: 'Top channels by messages',
    help: 'Markdown report label (community).',
    kind: 'short',
  },
  mdChannelEntry: {
    default: 'channel {channelId} ({count})',
    help: 'Markdown report: one entry of the top channels list.',
    vars: ['channelId', 'count'],
    kind: 'short',
  },

  // ── Markdown report: section 4 labels ─────────────────────────────────────
  mdIncidentsOpened: {
    default: 'Incidents opened',
    help: 'Markdown report label (infrastructure).',
    kind: 'short',
  },
  mdIncidentsResolved: {
    default: 'Incidents resolved',
    help: 'Markdown report label (infrastructure).',
    kind: 'short',
  },
  mdBySeverity: { default: 'By severity', help: 'Markdown report label (infrastructure).', kind: 'short' },
  mdTotalIncidentTime: {
    default: 'Total incident time',
    help: 'Markdown report label (infrastructure).',
    kind: 'short',
  },
  mdAutoDetected: {
    default: 'Auto-detected',
    help: 'Markdown report label (infrastructure).',
    kind: 'short',
  },
  mdManuallyDeclared: {
    default: 'Manually declared',
    help: 'Markdown report label (infrastructure).',
    kind: 'short',
  },
  mdUptime: { default: 'Uptime', help: 'Markdown report label (infrastructure).', kind: 'short' },
  mdNoPublicServices: {
    default: 'no public monitored services',
    help: 'Markdown report: reason uptime is unavailable.',
    kind: 'short',
  },
  mdColService: { default: 'Service', help: 'Markdown report: uptime table column.', kind: 'short' },
  mdColUptime: { default: 'Uptime', help: 'Markdown report: uptime table column.', kind: 'short' },
  mdColChecks: { default: 'Checks', help: 'Markdown report: uptime table column.', kind: 'short' },

  // ── Markdown report: section 5 labels ─────────────────────────────────────
  mdModerationActions: {
    default: 'Moderation actions',
    help: 'Markdown report label (moderation).',
    kind: 'short',
  },
  mdByType: { default: 'By type', help: 'Markdown report label (moderation).', kind: 'short' },
  mdAutomodDetections: {
    default: 'Automod detections',
    help: 'Markdown report label (moderation).',
    kind: 'short',
  },
  mdByRule: { default: 'By rule', help: 'Markdown report label (moderation).', kind: 'short' },
  mdAutomodFalsePositives: {
    default: 'Automod false positives',
    help: 'Markdown report label (moderation).',
    kind: 'short',
  },
  mdReportsReceived: {
    default: 'Abuse reports received',
    help: 'Markdown report label (moderation).',
    kind: 'short',
  },
  mdReportsResolved: { default: 'Resolved', help: 'Markdown report label (moderation).', kind: 'short' },
  mdReportsDismissed: { default: 'Dismissed', help: 'Markdown report label (moderation).', kind: 'short' },
  mdReportsByCategory: {
    default: 'Reports by category',
    help: 'Markdown report label (moderation).',
    kind: 'short',
  },
  mdOpenBacklog: {
    default: 'Open report backlog',
    help: 'Markdown report label (moderation).',
    kind: 'short',
  },

  // ── Markdown report: section 6 labels ─────────────────────────────────────
  mdAnnouncementsPublished: {
    default: 'Announcements published',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdAnnouncementReactions: {
    default: 'Announcement reactions',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdTrackedClicks: {
    default: 'Tracked link clicks',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdPartnerApplications: {
    default: 'Partner applications',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdApplicationsByStatus: {
    default: 'Applications by status',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdEventRsvps: {
    default: 'Event RSVPs (going)',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdGiveawayEntries: {
    default: 'Giveaway entries',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdPollBallots: { default: 'Poll ballots', help: 'Markdown report label (announcements).', kind: 'short' },
  mdSuggestionsCreated: {
    default: 'Suggestions created',
    help: 'Markdown report label (announcements).',
    kind: 'short',
  },
  mdReferralJoins: {
    default: 'Referral-tracked joins',
    help: 'Markdown report label (referrals).',
    kind: 'short',
  },
  mdReferralsConfirmed: { default: 'Confirmed', help: 'Markdown report label (referrals).', kind: 'short' },
  mdReferralsAmbiguous: { default: 'Ambiguous', help: 'Markdown report label (referrals).', kind: 'short' },
  mdReferralsUnknown: {
    default: 'Unknown source',
    help: 'Markdown report label (referrals).',
    kind: 'short',
  },
  mdReferralsFlagged: {
    default: 'Flagged for review',
    help: 'Markdown report label (referrals).',
    kind: 'short',
  },
  mdTopReferrers: {
    default: 'Top referrers (valid, confirmed)',
    help: 'Markdown report label (referrals).',
    kind: 'short',
  },
  mdTopReferrersUnavailable: {
    default: 'Top referrers',
    help: 'Markdown report label (referrals) when the list is unavailable.',
    kind: 'short',
  },
  mdReferrerEntry: {
    default: 'user {userId} ({count})',
    help: 'Markdown report: one entry of the top referrers list.',
    vars: ['userId', 'count'],
    kind: 'short',
  },

  // ── Markdown report: section 7 labels ─────────────────────────────────────
  mdAsOf: {
    default: 'As of {time}:',
    help: 'Markdown report: outstanding issues timestamp.',
    vars: ['time'],
    kind: 'short',
  },
  mdStaleReports: {
    default: 'Open abuse reports older than 72h',
    help: 'Markdown report label (outstanding issues).',
    kind: 'short',
  },
  mdActiveIncidents: {
    default: 'Active incidents',
    help: 'Markdown report label (outstanding issues).',
    kind: 'short',
  },
  mdDeadJobs: {
    default: 'Dead-letter background jobs',
    help: 'Markdown report label (outstanding issues).',
    kind: 'short',
  },
  mdFlaggedReferrals: {
    default: 'Flagged referrals awaiting review',
    help: 'Markdown report label (outstanding issues).',
    kind: 'short',
  },
  mdStalePartnerApps: {
    default: 'Partner applications pending > 7 days',
    help: 'Markdown report label (outstanding issues).',
    kind: 'short',
  },

  // ── Markdown report: section 8 ────────────────────────────────────────────
  mdPreviousPeriod: {
    default: 'Previous period: {start} – {end}',
    help: 'Markdown report: previous period line in the comparison section.',
    vars: ['start', 'end'],
    kind: 'short',
  },
  mdColMetric: { default: 'Metric', help: 'Markdown report: comparison table column.', kind: 'short' },
  mdColThisPeriod: {
    default: 'This period',
    help: 'Markdown report: comparison table column.',
    kind: 'short',
  },
  mdColPrevious: { default: 'Previous', help: 'Markdown report: comparison table column.', kind: 'short' },
  mdColChange: { default: 'Change', help: 'Markdown report: comparison table column.', kind: 'short' },

  // ── /staff-stats ──────────────────────────────────────────────────────────
  staffStatsTitle: {
    default: 'Staff activity · last {period}',
    help: 'Title of the /staff-stats embed. {period} is 7d/30d/90d.',
    vars: ['period'],
    kind: 'title',
  },
  staffStatsLine: {
    default:
      '{user} — mod actions **{modActions}** · reports claimed **{claimed}** / resolved **{resolved}** · incident updates **{incidentUpdates}** · partner reviews **{partnerReviews}**',
    help: 'One staff member line in /staff-stats.',
    vars: ['user', 'modActions', 'claimed', 'resolved', 'incidentUpdates', 'partnerReviews'],
  },
  staffStatsEmpty: {
    default: 'No staff activity recorded in this period.',
    help: 'Shown in /staff-stats when nobody did anything.',
  },
  staffStatsFooter: {
    default: 'Counts only. Activity is not a measure of quality — use with context.',
    help: 'Footer of the /staff-stats embed.',
  },

  // ── /config ───────────────────────────────────────────────────────────────
  settingsTitle: { default: 'Server settings', help: 'Title of the /config settings embed.', kind: 'title' },
  settingsFooter: {
    default: 'Change advanced settings in the dashboard.',
    help: 'Footer of the /config settings embed.',
  },
  settingsNotSet: {
    default: '_not set_',
    help: '/config settings embed: shown for a channel, role or URL that is not configured.',
    kind: 'short',
  },
  settingsTimezoneField: { default: 'Time zone', help: '/config settings embed field name.', kind: 'title' },
  settingsSupportUrlField: {
    default: 'Support URL',
    help: '/config settings embed field name.',
    kind: 'title',
  },
  settingsEmbedFooterField: {
    default: 'Embed footer',
    help: '/config settings embed field name.',
    kind: 'title',
  },
  settingsModulesField: { default: 'Modules', help: '/config settings embed field name.', kind: 'title' },
  settingsChannelsField: { default: 'Channels', help: '/config settings embed field name.', kind: 'title' },
  settingsRolesField: { default: 'Roles', help: '/config settings embed field name.', kind: 'title' },
  settingsReportField: {
    default: 'Weekly report',
    help: '/config settings embed field name.',
    kind: 'title',
  },
  settingsReportEnabled: {
    default: 'Enabled',
    help: '/config settings embed: weekly report schedule is on.',
    kind: 'short',
  },
  settingsReportDisabled: {
    default: 'Disabled',
    help: '/config settings embed: weekly report schedule is off.',
    kind: 'short',
  },
  settingsReportSchedule: {
    default: '{state} · {day} {time} ({timezone})',
    help: '/config settings embed: weekly report schedule. {state} is Enabled/Disabled.',
    vars: ['state', 'day', 'time', 'timezone'],
    kind: 'short',
  },
  settingsReportNext: {
    default: 'Next: {time}',
    help: '/config settings embed: next weekly report run.',
    vars: ['time'],
    kind: 'short',
  },
  settingsReportNotConfigured: {
    default: 'Not configured yet',
    help: '/config settings embed: no weekly report schedule exists.',
    kind: 'short',
  },
  settingsStatusField: {
    default: 'Status thresholds',
    help: '/config settings embed field name.',
    kind: 'title',
  },
  settingsStatusValue: {
    default:
      'Check every {interval}s · fail after {failures} · recover after {recoveries} · alert cooldown {cooldown}m',
    help: '/config settings embed: status monitoring thresholds.',
    vars: ['interval', 'failures', 'recoveries', 'cooldown'],
  },
  settingsRetentionField: { default: 'Retention', help: '/config settings embed field name.', kind: 'title' },
  settingsRetentionValue: {
    default:
      'Diagnostics {diagnosticHours}h · reports {reportDays}d · audit {auditDays}d · health checks {healthCheckDays}d · activity {activityDays}d',
    help: '/config settings embed: data retention periods.',
    vars: ['diagnosticHours', 'reportDays', 'auditDays', 'healthCheckDays', 'activityDays'],
  },
  settingsAnalyticsField: { default: 'Analytics', help: '/config settings embed field name.', kind: 'title' },
  settingsAnalyticsValue: {
    default: 'Active member = ≥ {minMessages} message(s) in period · reporter updates {reporterUpdates}',
    help: '/config settings embed: analytics settings. {reporterUpdates} is the on/off text.',
    vars: ['minMessages', 'reporterUpdates'],
  },
  settingsOn: {
    default: 'on',
    help: '/config settings embed: a setting that is switched on.',
    kind: 'short',
  },
  settingsOff: {
    default: 'off',
    help: '/config settings embed: a setting that is switched off.',
    kind: 'short',
  },
  configSuccess: {
    default: '✅ {message}',
    help: 'Reply after a /config change. {message} is the specific confirmation below.',
    vars: ['message'],
  },
  configTimezoneSet: {
    default: 'Time zone set to **{timezone}**.',
    help: 'Confirmation after /config timezone.',
    vars: ['timezone'],
  },
  configModuleEnabled: {
    default: '{module} enabled.',
    help: 'Confirmation after /config module enable.',
    vars: ['module'],
  },
  configModuleDisabled: {
    default: '{module} disabled.',
    help: 'Confirmation after /config module disable.',
    vars: ['module'],
  },
  configChannelSet: {
    default: '{kind} channel set to {channel}.',
    help: 'Confirmation after /config channel set. {kind} is the channel kind, {channel} the channel mention.',
    vars: ['kind', 'channel'],
  },
  configRoleSet: {
    default: '{kind} role set to {role}.',
    help: 'Confirmation after /config role set. {kind} is the role kind, {role} the role mention.',
    vars: ['kind', 'role'],
  },
  configRoleManaged: {
    default: 'That role is managed by an integration and cannot be used here.',
    help: 'Shown when /config role set is given a bot/integration role.',
  },
  configSupportUrlUpdated: {
    default: 'Support URL updated.',
    help: 'Confirmation after /config support-url set.',
  },
  configReportScheduleUpdated: {
    default: 'Weekly report schedule updated.',
    help: 'Confirmation after /config report schedule.',
  },
  configUnknownCommand: {
    default: 'Unknown settings command.',
    help: 'Shown for an unrecognised /config subcommand.',
  },

  // ── Settings validation errors ────────────────────────────────────────────
  errorEveryoneRole: {
    default: 'The @everyone role cannot be used as the {kind} role.',
    help: 'Error when @everyone is chosen for a configurable role.',
    vars: ['kind'],
  },
  errorPartnerRoleConflict: {
    default:
      'The partner role cannot also be the {kind} role — partners must never receive staff pings or escalations.',
    help: 'Error when the partner role is also the staff ping or escalation role.',
    vars: ['kind'],
  },
  errorPartnerRolePrivileged: {
    default: 'That role holds privileged staff permissions ({permissions}) and cannot be the partner role.',
    help: 'Error when the chosen partner role has privileged staff permissions.',
    vars: ['permissions'],
  },
  errorPrivateChannelConflict: {
    default:
      'The {privateKind} channel is staff-only and cannot be the same as the public {publicKind} channel.',
    help: 'Error when a staff-only channel is also set as a public channel.',
    vars: ['privateKind', 'publicKind'],
  },
});
