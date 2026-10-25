import type { ModerationType } from '@gynx/database';
import { defineTexts } from '../core/text';

/** Member- and staff-facing wording for moderation, automod and appeals. */
export const ModerationText = defineTexts('moderation', {
  // ── Action names ────────────────────────────────────────────────────────────
  actionWarn: {
    default: 'Warning',
    help: 'Name of a warning in modlog posts, command replies and /appeal suggestions.',
    kind: 'short',
  },
  actionTimeout: {
    default: 'Timeout',
    help: 'Name of a timeout in modlog posts, command replies and /appeal suggestions.',
    kind: 'short',
  },
  actionUntimeout: {
    default: 'Timeout removed',
    help: 'Name of a timeout removal in modlog posts.',
    kind: 'short',
  },
  actionKick: {
    default: 'Kick',
    help: 'Name of a kick in modlog posts, command replies and /appeal suggestions.',
    kind: 'short',
  },
  actionBan: {
    default: 'Ban',
    help: 'Name of a ban in modlog posts, command replies and /appeal suggestions.',
    kind: 'short',
  },
  actionUnban: {
    default: 'Unban',
    help: 'Name of an unban in modlog posts.',
    kind: 'short',
  },
  actionMessageDelete: {
    default: 'Message deleted',
    help: 'Name of an automod message deletion in modlog posts.',
    kind: 'short',
  },
  moderatorAutomod: {
    default: 'Automod',
    help: 'Shown as the moderator in modlog posts for automatic actions.',
    kind: 'short',
  },
  moderatorSystem: {
    default: 'GYNX System',
    help: 'Shown as the moderator in modlog posts for actions done by background jobs (e.g. temp-ban expiry).',
    kind: 'short',
  },
  durationPermanent: {
    default: 'Permanent',
    help: 'Duration shown for permanent bans (modlog post and ban DM).',
    kind: 'short',
  },

  // ── Modlog post ─────────────────────────────────────────────────────────────
  modlogTitle: {
    default: '{ref} · {action}',
    help: 'Title of a modlog post. {ref} is the case reference, {action} the action name.',
    vars: ['ref', 'action'],
    kind: 'title',
  },
  modlogTitleFailed: {
    default: '{ref} · {action} (failed)',
    help: 'Title of a modlog post for an action Discord rejected.',
    vars: ['ref', 'action'],
    kind: 'title',
  },
  modlogFieldTarget: { default: 'Target', help: 'Modlog post field name: the member.', kind: 'title' },
  modlogFieldModerator: {
    default: 'Moderator',
    help: 'Modlog post field name: who took the action.',
    kind: 'title',
  },
  modlogFieldReason: { default: 'Reason', help: 'Modlog post field name: the reason.', kind: 'title' },
  modlogFieldDuration: {
    default: 'Duration',
    help: 'Modlog post field name: timeout/ban length.',
    kind: 'title',
  },
  modlogFieldExpires: {
    default: 'Expires',
    help: 'Modlog post field name: when the action ends.',
    kind: 'title',
  },
  modlogFieldStatus: {
    default: 'Status',
    help: 'Modlog post field name: shown when the action failed.',
    kind: 'title',
  },
  modlogStatusFailed: {
    default: 'Failed: {error}',
    help: 'Modlog post "Status" value when Discord rejected the action.',
    vars: ['error'],
  },
  modlogUnknownError: {
    default: 'unknown error',
    help: 'Used in the modlog "Status" value when no error detail was recorded.',
    kind: 'short',
  },
  modlogFieldDmDelivered: {
    default: 'DM delivered',
    help: 'Modlog post field name: whether the member got a DM.',
    kind: 'title',
  },
  modlogDmYes: {
    default: 'Yes',
    help: 'Modlog post "DM delivered" value when the DM arrived.',
    kind: 'short',
  },
  modlogDmNo: { default: 'No', help: 'Modlog post "DM delivered" value when the DM failed.', kind: 'short' },

  // ── DM to the member ────────────────────────────────────────────────────────
  dmTitleWarn: {
    default: 'You received a warning in {server}',
    help: 'Title of the DM a member receives when warned.',
    vars: ['server'],
    kind: 'title',
  },
  dmTitleTimeout: {
    default: 'You have been timed out in {server}',
    help: 'Title of the DM a member receives when timed out.',
    vars: ['server'],
    kind: 'title',
  },
  dmTitleKick: {
    default: 'You have been removed in {server}',
    help: 'Title of the DM a member receives when kicked.',
    vars: ['server'],
    kind: 'title',
  },
  dmTitleBan: {
    default: 'You have been banned in {server}',
    help: 'Title of the DM a member receives when banned.',
    vars: ['server'],
    kind: 'title',
  },
  dmTitleOther: {
    default: 'Moderation notice in {server}',
    help: 'Title of a moderation DM for any other action.',
    vars: ['server'],
    kind: 'title',
  },
  dmReason: {
    default: '**Reason:** {reason}',
    help: 'Reason line in the moderation DM.',
    vars: ['reason'],
  },
  dmDuration: {
    default: '**Duration:** {duration}',
    help: 'Duration line in the moderation DM (timeouts and bans).',
    vars: ['duration'],
  },
  dmAppealSupportUrl: {
    default: 'If you believe this was a mistake, you can appeal through our support system: {url}.',
    help: 'Kick/ban DM appeal hint when a support link is configured.',
    vars: ['url'],
  },
  dmAppealSupportTeam: {
    default: 'If you believe this was a mistake, you can appeal by contacting the support team.',
    help: 'Kick/ban DM appeal hint when no support link is configured.',
  },
  dmAppealCommand: {
    default: 'If you believe this was a mistake, use `/appeal` in the server and select this action.',
    help: 'Warning/timeout DM appeal hint.',
  },
  dmFooter: {
    default: 'Please review the server rules.',
    help: 'Footer of the moderation DM.',
    kind: 'short',
  },

  // ── Appeal review card (modlog channel) ─────────────────────────────────────
  appealStaffTitle: {
    default: 'New appeal',
    help: 'Title of the staff appeal card for a general appeal.',
    kind: 'title',
  },
  appealStaffTitleWithAction: {
    default: 'New appeal · {ref} ({action})',
    help: 'Title of the staff appeal card for an appeal against a specific action.',
    vars: ['ref', 'action'],
    kind: 'title',
  },
  appealFieldMember: {
    default: 'Member',
    help: 'Staff appeal card field name: the appellant.',
    kind: 'title',
  },
  appealFieldSubmitted: {
    default: 'Submitted',
    help: 'Staff appeal card field name: when it was submitted.',
    kind: 'title',
  },
  appealFieldOriginalReason: {
    default: 'Original reason',
    help: 'Staff appeal card field name: reason of the appealed action.',
    kind: 'title',
  },
  appealFooterBan: {
    default: 'Ban appeals require ban permission to review.',
    help: 'Footer of the staff appeal card for ban appeals.',
    kind: 'short',
  },
  appealFooterDefault: {
    default: 'Review requires moderation permission.',
    help: 'Footer of the staff appeal card for other appeals.',
    kind: 'short',
  },
  appealAcceptButton: { default: 'Accept', help: 'Accept button on the staff appeal card.', kind: 'label' },
  appealDenyButton: { default: 'Deny', help: 'Deny button on the staff appeal card.', kind: 'label' },

  // ── Appeal decision DM ──────────────────────────────────────────────────────
  appealDecisionTitle: {
    default: 'Appeal update · {server}',
    help: 'Title of the DM telling a member their appeal was reviewed.',
    vars: ['server'],
    kind: 'title',
  },
  appealAccepted: {
    default: 'Your appeal has been **accepted**.',
    help: 'Appeal decision DM: general appeal accepted.',
  },
  appealAcceptedFor: {
    default: 'Your appeal for {ref} has been **accepted**.',
    help: 'Appeal decision DM: appeal against a specific action accepted.',
    vars: ['ref'],
  },
  appealDenied: {
    default: 'Your appeal has been **denied**.',
    help: 'Appeal decision DM: general appeal denied.',
  },
  appealDeniedFor: {
    default: 'Your appeal for {ref} has been **denied**.',
    help: 'Appeal decision DM: appeal against a specific action denied.',
    vars: ['ref'],
  },
  appealStaffNote: {
    default: '**Note from staff:** {note}',
    help: 'Appeal decision DM: the reviewer note, when one was written.',
    vars: ['note'],
  },
  appealNewInfoUrl: {
    default: 'If you have new information, you can contact support: {url}',
    help: 'Denied appeal DM hint when a support link is configured.',
    vars: ['url'],
  },
  appealNewInfoTeam: {
    default: 'If you have new information, please contact the support team.',
    help: 'Denied appeal DM hint when no support link is configured.',
  },

  // ── Hierarchy denials ───────────────────────────────────────────────────────
  hierarchySelf: {
    default: 'You cannot moderate yourself.',
    help: 'Error when a moderator targets themselves.',
  },
  hierarchyOwner: {
    default: 'The server owner cannot be moderated.',
    help: 'Error when a moderator targets the server owner.',
  },
  hierarchyHigherRole: {
    default: 'That member has an equal or higher role than you.',
    help: 'Error when the target outranks the moderator.',
  },
  hierarchyBotRole: {
    default: "That member's top role is at or above mine, so I can't act on them.",
    help: "Error when the target outranks the bot's role.",
  },
  hierarchyStaff: {
    default: 'That member is staff. Only senior moderators (with ban permission) can moderate staff.',
    help: 'Error when a junior moderator targets staff.',
  },

  // ── Action validation ───────────────────────────────────────────────────────
  timeoutDurationRequired: {
    default: 'A duration is required for a timeout (e.g. 30m, 2h, 1d).',
    help: 'Error when /timeout has no duration.',
  },
  timeoutDurationInvalid: {
    default: 'Invalid duration. Use a format like 30m, 2h or 1d.',
    help: 'Error when a timeout duration cannot be read.',
  },
  timeoutDurationRange: {
    default: 'Timeouts must be between 1 minute and 28 days.',
    help: 'Error when a timeout duration is out of range.',
  },
  banDurationInvalid: {
    default: 'Invalid duration. Use a format like 12h, 7d or 4w.',
    help: 'Error when a temporary ban duration cannot be read.',
  },
  banDurationRange: {
    default: 'Temporary bans must be between 1 minute and 365 days.',
    help: 'Error when a temporary ban duration is out of range.',
  },
  durationNotAllowed: {
    default: 'A duration cannot be set for {action}.',
    help: 'Error when a duration is given for an action that has none. {action} is e.g. "warn" or "kick".',
    vars: ['action'],
  },
  deleteMessagesBanOnly: {
    default: 'Message deletion only applies to bans.',
    help: 'Error when message deletion is requested for a non-ban action.',
  },
  memberInfoRequired: {
    default: 'Member information is required for this action.',
    help: 'Error when the bot could not provide member details for a hierarchy check.',
  },
  botsCannotBeWarned: {
    default: 'Bots cannot be warned or timed out. Kick or ban them instead.',
    help: 'Error when warning or timing out a bot.',
  },
  discordRejectedDefault: {
    default: 'Discord rejected the action.',
    help: 'Failure reason recorded (and shown in the modlog) when Discord gave no detail.',
  },
  tempBanExpiredReason: {
    default: 'Temporary ban {ref} expired',
    help: 'Reason recorded for the automatic unban when a temporary ban ends (modlog and Discord audit log).',
    vars: ['ref'],
    kind: 'short',
  },
  notMember: {
    default: 'That user is not a member of this server.',
    help: 'Error when /warn, /timeout or /kick targets someone not in the server.',
  },
  discordRequestFailed: {
    default: 'Discord request failed.',
    help: 'Error detail when Discord rejects an action without an explanation.',
  },
  auditLogReason: {
    default: '{reason} — by {moderator}',
    help: 'Reason written to the Discord audit log for manual actions. {moderator} is the moderator tag.',
    vars: ['reason', 'moderator'],
  },

  // ── Command replies ─────────────────────────────────────────────────────────
  actionFailed: {
    default: 'Discord rejected the {action}: {error}\nRecorded as failed ({ref}).',
    help: 'Reply when Discord rejects /warn, /timeout, /kick or /ban. {action} is the lowercase action name.',
    vars: ['action', 'error', 'ref'],
  },
  actionAppliedTitle: {
    default: '{ref} · {action} applied',
    help: 'Title of the reply after /warn, /timeout, /kick or /ban succeeds.',
    vars: ['ref', 'action'],
    kind: 'title',
  },
  replyFieldMember: { default: 'Member', help: 'Action reply field name: the member.', kind: 'title' },
  replyFieldDmDelivered: {
    default: 'DM delivered',
    help: 'Action reply field name: whether the DM arrived.',
    kind: 'title',
  },
  replyDmYes: {
    default: 'Yes',
    help: 'Action reply "DM delivered" value when the DM arrived.',
    kind: 'short',
  },
  replyDmNo: {
    default: 'No (DMs closed)',
    help: 'Action reply "DM delivered" value when the DM failed.',
    kind: 'short',
  },
  replyFieldExpires: {
    default: 'Expires',
    help: 'Action reply field name: when a timeout/temp ban ends.',
    kind: 'title',
  },
  replyFieldActiveWarnings: {
    default: 'Active warnings',
    help: 'Action reply field name after /warn: active warning count.',
    kind: 'title',
  },
  replyFieldSuggestion: {
    default: 'Suggested next step',
    help: 'Action reply field name after /warn: advisory next step.',
    kind: 'title',
  },

  // ── Escalation suggestions ──────────────────────────────────────────────────
  escalationBan: {
    default: '{count} active warnings — consider a ban (senior moderator review).',
    help: 'Suggested next step (/warn, /warnings) at the highest warning level.',
    vars: ['count'],
  },
  escalationKick: {
    default: '{count} active warnings — consider a 24h timeout or a kick.',
    help: 'Suggested next step (/warn, /warnings) once the timeout strike count is reached.',
    vars: ['count'],
  },
  escalationTimeout: {
    default: '{count} active warnings — consider a {minutes}-minute timeout.',
    help: 'Suggested next step (/warn, /warnings) once the warning strike count is reached.',
    vars: ['count', 'minutes'],
  },
  escalationWarn: {
    default: '{count} active warning(s) — a warning is proportionate.',
    help: 'Suggested next step (/warn, /warnings) below the warning strike count.',
    vars: ['count'],
  },

  // ── /warnings ───────────────────────────────────────────────────────────────
  warningsTitle: {
    default: 'Active warnings · {user}',
    help: 'Title of the /warnings reply.',
    vars: ['user'],
    kind: 'title',
  },
  warningsLine: {
    default: '**{ref}** · {created} · {reason}',
    help: 'One warning in /warnings (no expiry). {created} is a relative time.',
    vars: ['ref', 'created', 'reason'],
  },
  warningsLineExpires: {
    default: '**{ref}** · {created} · {reason} · expires {expires}',
    help: 'One warning in /warnings with an expiry. {created} and {expires} are relative times.',
    vars: ['ref', 'created', 'reason', 'expires'],
  },
  warningsEmpty: { default: 'No active warnings.', help: '/warnings reply when the member has none.' },
  warningsFieldActive: { default: 'Active', help: '/warnings field name: active count.', kind: 'title' },
  warningsFieldSuggestion: {
    default: 'Suggested next step',
    help: '/warnings field name: advisory next step.',
    kind: 'title',
  },
  warningsFooter: {
    default: 'Suggestions are advisory and never applied automatically.',
    help: 'Footer of the /warnings reply.',
    kind: 'short',
  },

  // ── /appeal (member) ────────────────────────────────────────────────────────
  appealModalTitle: { default: 'Moderation appeal', help: 'Title of the /appeal form.', kind: 'label' },
  appealModalTitleFor: {
    default: 'Appeal {ref}',
    help: 'Title of the /appeal form for a specific action.',
    vars: ['ref'],
    kind: 'label',
  },
  appealStatementLabel: {
    default: 'Why should this be reconsidered?',
    help: 'Label of the text box in the /appeal form.',
    kind: 'label',
  },
  appealStatementPlaceholder: {
    default: 'Explain calmly and honestly. Staff will review your appeal.',
    help: 'Placeholder of the text box in the /appeal form.',
    kind: 'short',
  },
  appealAutocompleteOption: {
    default: '{ref} · {action} · {reason}',
    help: 'One suggestion in the /appeal action list.',
    vars: ['ref', 'action', 'reason'],
    kind: 'short',
  },
  appealSubmittedTitle: {
    default: 'Appeal submitted',
    help: 'Title of the reply after /appeal.',
    kind: 'title',
  },
  appealSubmitted: {
    default:
      "Your appeal has been sent to the moderation team. You'll receive a DM when it has been reviewed.\nReference: `{reference}`",
    help: 'Reply after a general /appeal.',
    vars: ['reference'],
  },
  appealSubmittedFor: {
    default:
      "Your appeal for {ref} has been sent to the moderation team. You'll receive a DM when it has been reviewed.\nReference: `{reference}`",
    help: 'Reply after /appeal for a specific action.',
    vars: ['ref', 'reference'],
  },
  appealActionNotFound: {
    default: 'A moderation action with that reference on your account was not found.',
    help: "Error when /appeal names an action that doesn't exist or isn't the member's.",
  },
  appealNotAppealable: {
    default: 'That action cannot be appealed.',
    help: 'Error for a non-appealable action.',
  },
  appealNotInEffect: {
    default: 'That action is no longer in effect, so there is nothing to appeal.',
    help: 'Error when appealing an expired or reversed action.',
  },
  appealPending: {
    default: 'You already have a pending appeal.',
    help: 'Error when a member already has a pending general appeal.',
  },
  appealPendingFor: {
    default: 'You already have a pending appeal for {ref}.',
    help: 'Error when a member already has a pending appeal for this action.',
    vars: ['ref'],
  },

  // ── Appeal review (staff) ───────────────────────────────────────────────────
  reviewModalAcceptTitle: {
    default: 'Accept appeal',
    help: 'Title of the accept-appeal form.',
    kind: 'label',
  },
  reviewModalDenyTitle: { default: 'Deny appeal', help: 'Title of the deny-appeal form.', kind: 'label' },
  reviewNoteLabel: {
    default: 'Note to the member (optional)',
    help: 'Label of the note box in the appeal review form.',
    kind: 'label',
  },
  reviewSummaryAccepted: {
    default: 'Accepted by {moderator}',
    help: 'Replaces the staff appeal card after acceptance.',
    vars: ['moderator'],
  },
  reviewSummaryDenied: {
    default: 'Denied by {moderator}',
    help: 'Replaces the staff appeal card after denial.',
    vars: ['moderator'],
  },
  manualReversalTitle: {
    default: 'Appeal accepted',
    help: 'Title of the reminder to reverse a timeout/ban after accepting an appeal.',
    kind: 'title',
  },
  manualReversalBody: {
    default:
      'Remember to reverse the action on Discord (remove the timeout or unban the user). The member has been notified.',
    help: 'Reminder to reverse a timeout/ban on Discord after accepting an appeal.',
  },
  appealNotFound: {
    default: 'Appeal was not found.',
    help: 'Error when reviewing an appeal that no longer exists.',
  },
  appealOwnReview: {
    default: 'You cannot review your own appeal.',
    help: 'Error when staff review their own appeal.',
  },
  appealAlreadyReviewed: {
    default: 'This appeal has already been reviewed.',
    help: 'Error when reviewing an appeal that was already decided.',
  },
  appealReviewConflict: {
    default: 'Someone else just reviewed this appeal.',
    help: 'Error when two staff review the same appeal at once.',
  },

  // ── Automod ─────────────────────────────────────────────────────────────────
  automodReasonPhishing: {
    default: 'Message contains a suspected scam / phishing link.',
    help: 'Automod reason (notice and recorded reason): phishing link.',
  },
  automodReasonBlockedDomain: {
    default: 'Links to {domain} are not allowed here.',
    help: 'Automod reason: blocked domain.',
    vars: ['domain'],
  },
  automodReasonInviteNewAccount: {
    default: 'New accounts cannot post server invites yet.',
    help: 'Automod reason: invite from a new account.',
  },
  automodReasonInvite: {
    default: 'Server invites are not allowed here.',
    help: 'Automod reason: server invite.',
  },
  automodReasonMentions: {
    default: 'Too many mentions in one message ({count}).',
    help: 'Automod reason: mass mentions.',
    vars: ['count'],
  },
  automodReasonBlockedPhrase: {
    default: 'Message contains a blocked word or phrase.',
    help: 'Automod reason: blocked phrase.',
  },
  automodReasonDuplicate: {
    default: 'Same message sent {count} times in a short period.',
    help: 'Automod reason: duplicate messages.',
    vars: ['count'],
  },
  automodReasonBurst: {
    default: 'Sending messages too quickly ({count} in {seconds}s).',
    help: 'Automod reason: message burst.',
    vars: ['count', 'seconds'],
  },
  automodActionReason: {
    default: 'Automod: {reason}',
    help: 'Reason recorded for automatic warnings/timeouts (modlog, DM, audit log).',
    vars: ['reason'],
  },
  automodTimeoutFailed: {
    default: 'timeout failed',
    help: 'Failure detail recorded when an automatic timeout fails without an explanation.',
    kind: 'short',
  },
  noticeRemoved: {
    default: 'your message was removed',
    help: 'Start of the automod channel notice when the message was deleted.',
    kind: 'short',
  },
  noticeFlagged: {
    default: 'your message was flagged',
    help: 'Start of the automod channel notice when the message could not be deleted.',
    kind: 'short',
  },
  noticeDelete: {
    default: '{base}. {reason}',
    help: 'Automod channel notice (after the member mention). {base} is the removed/flagged text.',
    vars: ['base', 'reason'],
  },
  noticeWarn: {
    default: '{base} and you received a warning. {reason}',
    help: 'Automod channel notice when the member was also warned.',
    vars: ['base', 'reason'],
  },
  noticeTimeout: {
    default: '{base} and you have been timed out for {duration}. {reason}',
    help: 'Automod channel notice when the member was also timed out.',
    vars: ['base', 'duration', 'reason'],
  },
});

/** Display name of a moderation action type, resolved at call time. */
export function actionLabel(type: ModerationType): string {
  switch (type) {
    case 'WARN':
      return ModerationText.actionWarn();
    case 'TIMEOUT':
      return ModerationText.actionTimeout();
    case 'UNTIMEOUT':
      return ModerationText.actionUntimeout();
    case 'KICK':
      return ModerationText.actionKick();
    case 'BAN':
      return ModerationText.actionBan();
    case 'UNBAN':
      return ModerationText.actionUnban();
    case 'MESSAGE_DELETE':
      return ModerationText.actionMessageDelete();
  }
}
