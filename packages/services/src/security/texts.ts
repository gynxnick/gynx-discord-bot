import { defineTexts } from '../core/text';

/** Member- and staff-facing wording for abuse reports and the security audit log. */
export const SecurityText = defineTexts('security', {
  // ── Report categories (shown in Discord embeds) ──────────────────────────────
  categorySpamPhishing: {
    default: 'Spam / phishing',
    help: 'Report category "Spam / phishing" as shown in the staff notification.',
    kind: 'short',
  },
  categoryImpersonation: {
    default: 'Impersonation',
    help: 'Report category "Impersonation" as shown in the staff notification.',
    kind: 'short',
  },
  categoryHarassment: {
    default: 'Harassment',
    help: 'Report category "Harassment" as shown in the staff notification.',
    kind: 'short',
  },
  categoryMaliciousLink: {
    default: 'Malicious link',
    help: 'Report category "Malicious link" as shown in the staff notification.',
    kind: 'short',
  },
  categorySuspiciousActivity: {
    default: 'Suspicious activity',
    help: 'Report category "Suspicious activity" as shown in the staff notification.',
    kind: 'short',
  },
  categoryHostingAbuse: {
    default: 'Hosting abuse',
    help: 'Report category "Hosting abuse" as shown in the staff notification.',
    kind: 'short',
  },
  categoryOther: {
    default: 'Other',
    help: 'Report category "Other" as shown in the staff notification.',
    kind: 'short',
  },

  // ── /report-abuse modal ──────────────────────────────────────────────────────
  reportModalTitle: {
    default: 'Private report',
    help: 'Title of the /report-abuse form (Discord allows 45 characters).',
    kind: 'label',
  },
  reportDescriptionLabel: {
    default: 'What happened?',
    help: 'Label of the description box in the /report-abuse form (max 45 characters).',
    kind: 'label',
  },
  reportDescriptionPlaceholder: {
    default: 'Never include passwords or account credentials.',
    help: 'Placeholder inside the description box of the /report-abuse form.',
    kind: 'short',
  },
  reportEvidenceLabel: {
    default: 'Evidence links (https, one per line, max 5)',
    help: 'Label of the evidence links box in the /report-abuse form (max 45 characters).',
    kind: 'label',
  },
  reportMessageLabel: {
    default: 'Discord message link (optional)',
    help: 'Label of the message link box in the /report-abuse form (max 45 characters).',
    kind: 'label',
  },

  // ── Submission confirmation & errors ─────────────────────────────────────────
  reportReceivedTitle: {
    default: 'Report {ref} received',
    help: 'Title of the private confirmation after submitting a report.',
    vars: ['ref'],
    kind: 'title',
  },
  reportReceivedBody: {
    default:
      'Thank you. Your report is private and only visible to authorised GYNX staff. We may contact you if we need more information.',
    help: 'Text of the private confirmation after submitting a report.',
    kind: 'long',
  },
  reportSelfError: {
    default: 'You cannot report yourself.',
    help: 'Shown when a member names themselves in /report-abuse.',
  },
  reportDuplicateError: {
    default: 'You already have an open report about this ({ref}). Staff will review it.',
    help: 'Shown when a member submits the same report twice within 24 hours.',
    vars: ['ref'],
  },
  reportTooManyOpenError: {
    default: 'You have several open reports already. Please wait for staff to review them.',
    help: 'Shown when a member has too many open reports.',
  },

  // ── Staff handling errors ────────────────────────────────────────────────────
  reportAlreadyClosedError: {
    default: 'This report is already closed.',
    help: 'Shown when staff try to claim a resolved or dismissed report.',
  },
  reportClaimRaceError: {
    default: 'Someone else just claimed this report.',
    help: 'Shown when two staff members claim the same report at once.',
  },
  reportTransitionError: {
    default: 'A {from} report cannot move to {to}.',
    help: 'Shown when staff pick a status change that is not allowed.',
    vars: ['from', 'to'],
  },
  reportResolutionRequiredError: {
    default: 'A resolution summary is required to close a report.',
    help: 'Shown when staff close a report without a resolution summary.',
  },

  // ── Staff notification ───────────────────────────────────────────────────────
  notifyTitle: {
    default: 'New report {ref} · {category}',
    help: 'Title of the private staff notification posted for a new report.',
    vars: ['ref', 'category'],
    kind: 'title',
  },
  notifyReportedUserField: {
    default: 'Reported user',
    help: 'Field name for the reported member in the staff notification.',
    kind: 'title',
  },
  notifyReportedUserNone: {
    default: 'Not specified',
    help: 'Shown in the staff notification when no member was named.',
    kind: 'short',
  },
  notifySubmittedField: {
    default: 'Submitted',
    help: 'Field name for the submission time in the staff notification.',
    kind: 'title',
  },
  notifyEvidenceField: {
    default: 'Evidence',
    help: 'Field name for evidence links in the staff notification.',
    kind: 'title',
  },
  notifyEvidenceNone: {
    default: 'None',
    help: 'Shown in the staff notification when no evidence links were given.',
    kind: 'short',
  },
  notifyMessageField: {
    default: 'Message',
    help: 'Field name for the Discord message link in the staff notification.',
    kind: 'title',
  },
  notifyFooter: {
    default: 'Reports are private. Do not act on a report without investigating it.',
    help: 'Footer of the private staff notification for a new report.',
  },
  claimButton: {
    default: 'Claim',
    help: 'Button on the staff notification to take ownership of a report.',
    kind: 'label',
  },
  openDashboardButton: {
    default: 'Open in dashboard',
    help: 'Link button on the staff notification that opens the report in the dashboard.',
    kind: 'label',
  },
  claimedNotice: {
    default: '🛡️ Claimed by {user} · status **{status}**',
    help: 'Replaces the staff notification buttons once someone claims the report.',
    vars: ['user', 'status'],
  },

  // ── Reporter update DM ───────────────────────────────────────────────────────
  reporterUpdateTitle: {
    default: 'Your report {ref} has been reviewed',
    help: 'Title of the DM sent to the reporter when their report is closed.',
    vars: ['ref'],
    kind: 'title',
  },
  reporterUpdateResolved: {
    default: 'Thanks for letting us know. Our team has reviewed your report and taken appropriate action.',
    help: 'DM text sent to the reporter when their report is resolved.',
    kind: 'long',
  },
  reporterUpdateDismissed: {
    default:
      'Thanks for letting us know. Our team reviewed your report and closed it. If you have new information, you can submit another report.',
    help: 'DM text sent to the reporter when their report is dismissed.',
    kind: 'long',
  },
  reporterUpdateFooter: {
    default: 'For privacy reasons we do not share the details of actions taken against other members.',
    help: 'Footer of the DM sent to the reporter when their report is closed.',
  },

  // ── /audit-log ───────────────────────────────────────────────────────────────
  auditLogTitle: {
    default: 'Security audit log',
    help: 'Title of the /audit-log embed.',
    kind: 'title',
  },
  auditLogEmpty: {
    default: 'No matching events.',
    help: 'Shown by /audit-log when no events match.',
    kind: 'short',
  },
  auditLogLine: {
    default: '{time} **{action}** · {actor} · {result}',
    help: 'One line of /audit-log for an event without a target.',
    vars: ['time', 'action', 'actor', 'result'],
    kind: 'short',
  },
  auditLogLineWithTarget: {
    default: '{time} **{action}** · {actor} · {result} · `{target}`',
    help: 'One line of /audit-log for an event with a target.',
    vars: ['time', 'action', 'actor', 'result', 'target'],
    kind: 'short',
  },
  auditLogSystemActor: {
    default: 'system',
    help: 'Shown in /audit-log as the actor for automatic actions.',
    kind: 'short',
  },
});
