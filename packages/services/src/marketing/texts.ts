import { defineTexts } from '../core/text';

/**
 * Member- and staff-facing wording for announcements (previews, confirmations,
 * mention warnings), referrals and the partner programme.
 * Announcement content itself (and template defaults) is written by staff and is not here.
 */
export const MarketingText = defineTexts('marketing', {
  // ── Announcement types ──────────────────────────────────────────────────
  typeGeneral: { default: 'General', help: 'Announcement type name: General.', kind: 'short' },
  typeMaintenance: { default: 'Maintenance', help: 'Announcement type name: Maintenance.', kind: 'short' },
  typeGameLaunch: { default: 'Game launch', help: 'Announcement type name: Game launch.', kind: 'short' },
  typeFeatureRelease: {
    default: 'Feature release',
    help: 'Announcement type name: Feature release.',
    kind: 'short',
  },
  typeMilestone: { default: 'Milestone', help: 'Announcement type name: Milestone.', kind: 'short' },
  typeReviewRequest: {
    default: 'Review request',
    help: 'Announcement type name: Review request.',
    kind: 'short',
  },
  typePoll: { default: 'Poll', help: 'Announcement type name: Poll.', kind: 'short' },
  typeEvent: { default: 'Event', help: 'Announcement type name: Event.', kind: 'short' },
  typeReferralCampaign: {
    default: 'Referral campaign',
    help: 'Announcement type name: Referral campaign.',
    kind: 'short',
  },

  // ── Announcement editor modal ───────────────────────────────────────────
  annModalTitleNew: {
    default: 'New announcement',
    help: 'Title of the /announce create form (max 45 characters shown).',
    kind: 'short',
  },
  annModalTitleSchedule: {
    default: 'Schedule an announcement',
    help: 'Title of the /schedule-announcement form (max 45 characters shown).',
    kind: 'short',
  },
  annModalTitleLabel: { default: 'Title', help: 'Announcement form: title field label.', kind: 'short' },
  annModalBodyLabel: { default: 'Body', help: 'Announcement form: body field label.', kind: 'short' },
  annModalImageLabel: {
    default: 'Image URL (https, optional)',
    help: 'Announcement form: image URL field label.',
    kind: 'short',
  },
  annModalColorLabel: {
    default: 'Colour (hex, optional)',
    help: 'Announcement form: colour field label.',
    kind: 'short',
  },

  // ── Announcement preview & confirmation ─────────────────────────────────
  previewHeader: {
    default: '**Preview** · {channel} · will be {when}',
    help: 'First line above an announcement preview.',
    vars: ['channel', 'when'],
  },
  previewWhenScheduled: {
    default: 'scheduled for {time}',
    help: 'Preview header: used as {when} for a scheduled announcement.',
    vars: ['time'],
    kind: 'short',
  },
  previewWhenNow: {
    default: 'published now',
    help: 'Preview header: used as {when} when publishing immediately.',
    kind: 'short',
  },
  previewWarningLine: {
    default: '⚠️ {warning}',
    help: 'Preview: line showing the mass-mention warning.',
    vars: ['warning'],
  },
  previewMessageText: {
    default: 'Message text: `{content}`',
    help: 'Preview: shows the ping text that will be sent with the announcement.',
    vars: ['content'],
  },
  btnPublishNow: { default: 'Publish now', help: 'Preview button: publish immediately.', kind: 'label' },
  btnSchedule: { default: 'Schedule', help: 'Preview button: confirm the schedule.', kind: 'label' },
  btnCancel: { default: 'Cancel', help: 'Preview/confirmation button: cancel.', kind: 'label' },
  btnPreview: { default: 'Preview', help: 'Button after saving a draft: open the preview.', kind: 'label' },
  btnKeepDraft: {
    default: 'Keep as draft',
    help: 'Button after drafting a scheduled announcement: do not schedule.',
    kind: 'label',
  },
  btnConfirmNotify: {
    default: 'Yes, notify members',
    help: 'Second-confirmation button for announcements that ping members.',
    kind: 'label',
  },
  draftSaved: {
    default: 'Draft saved: `{id}`. Preview it before publishing.',
    help: 'Reply after /announce create saves a draft.',
    vars: ['id'],
  },
  draftSavedSchedule: {
    default: 'Draft saved: `{id}`. Confirm to schedule it for {time}.',
    help: 'Reply after /schedule-announcement saves a new draft.',
    vars: ['id', 'time'],
  },
  secondConfirm: {
    default: '⚠️ **Second confirmation required**\n{warning}\n\nAre you sure?',
    help: 'Second confirmation step before an announcement that pings members.',
    vars: ['warning'],
  },
  scheduledDone: {
    default: '✅ Scheduled for {time}. Use `/announce cancel` to stop it.',
    help: 'Shown after an announcement is scheduled.',
    vars: ['time'],
  },
  queuedDone: {
    default: '✅ Queued — it will be posted within a few seconds.',
    help: 'Shown after an announcement is queued for immediate publishing.',
  },
  dismissed: {
    default: 'Cancelled. Nothing was posted.',
    help: 'Shown when the publish/schedule confirmation is cancelled.',
  },
  previewOutdated: {
    default: 'This announcement was edited after this preview. Preview it again.',
    help: 'Error when confirming an outdated preview.',
  },
  roleOptionRequired: {
    default: 'Pick the role to ping with the `role` option.',
    help: 'Error for /announce create with mention "A role" but no role.',
  },
  templateNotFound: { default: 'Template was not found.', help: 'Error when the chosen template is gone.' },
  cancelledTitle: {
    default: 'Announcement cancelled',
    help: 'Title after /announce cancel.',
    kind: 'title',
  },
  cancelledBody: {
    default: '“{title}” will not be posted.',
    help: 'Text after /announce cancel. {title} is the announcement title.',
    vars: ['title'],
  },
  listTitle: { default: 'Announcements', help: 'Title of /announce list.', kind: 'title' },
  listEmpty: { default: 'No announcements yet.', help: '/announce list when there are none.' },
  templatesTitle: {
    default: 'Announcement templates',
    help: 'Title of /announce templates.',
    kind: 'title',
  },
  templatesHint: {
    default: 'Use `/announce create template:` to start from one.',
    help: 'Hint under the /announce templates list.',
  },

  // ── Mass-mention warnings ───────────────────────────────────────────────
  warnEveryoneCount: {
    default: 'This will ping @everyone and notify about {count} members.',
    help: 'Mention warning for @everyone when the member count is known.',
    vars: ['count'],
  },
  warnEveryone: {
    default: 'This will ping @everyone and notify every member of the server.',
    help: 'Mention warning for @everyone when the member count is unknown.',
  },
  warnHereCount: {
    default: 'This will ping @here and notify every online member (up to {count} members).',
    help: 'Mention warning for @here when the member count is known.',
    vars: ['count'],
  },
  warnHere: {
    default: 'This will ping @here and notify every online member.',
    help: 'Mention warning for @here when the member count is unknown.',
  },
  warnRoleCount: {
    default: 'This will ping {role} and notify {count} members.',
    help: 'Mention warning for a role ping when the role size is known.',
    vars: ['role', 'count'],
  },
  warnRole: {
    default: 'This will ping {role} and notify everyone with that role.',
    help: 'Mention warning for a role ping when the role size is unknown.',
    vars: ['role'],
  },
  massMentionRequired: {
    default: 'You need the mass-mention permission to ping @everyone, @here or roles.',
    help: 'Error when someone without mass-mention rights queues a pinging announcement.',
  },
  mentionRoleRequired: {
    default: 'A role is required for role mentions.',
    help: 'Error when a role mention has no valid role.',
  },
  mentionChooseRole: { default: 'Choose a role to mention.', help: 'Error: role mention without a role.' },
  mentionEveryoneRole: {
    default: 'Use the @everyone mention mode instead of the @everyone role.',
    help: 'Error: the @everyone role was picked as the role to mention.',
  },
  confirmMentions: {
    default: 'This announcement pings members. Confirm the mention warning to continue.',
    help: 'Error when publishing a pinging announcement without confirming the warning.',
  },

  // ── Announcement errors ─────────────────────────────────────────────────
  templateNameTaken: {
    default: 'A template with that name already exists.',
    help: 'Error when saving a template with a duplicate name.',
  },
  titleBodyRequired: {
    default: 'A title and body are required.',
    help: 'Error when an announcement has no title or body.',
  },
  channelRequired: {
    default: 'Choose a channel (no default announcement channel is configured).',
    help: 'Error when no channel was picked and no default is configured.',
  },
  notEditable: {
    default: 'This announcement can no longer be edited.',
    help: 'Error when editing a published announcement.',
  },
  changedReload: {
    default: 'This announcement changed in the meantime. Reload and try again.',
    help: 'Error when an edit races with another change.',
  },
  changed: {
    default: 'This announcement changed in the meantime.',
    help: 'Error when a delete/cancel races with another change.',
  },
  changedPreviewAgain: {
    default: 'This announcement changed in the meantime. Preview it again.',
    help: 'Error when publishing races with another change.',
  },
  notDeletable: {
    default: 'Only drafts, cancelled or failed announcements can be deleted.',
    help: 'Error when deleting a scheduled or published announcement.',
  },
  alreadyPublished: {
    default: 'This announcement was already published.',
    help: 'Error when publishing an already published announcement.',
  },
  publishingNow: {
    default: 'This announcement is being published right now.',
    help: 'Error when publishing an announcement that is being sent.',
  },
  editedSincePreview: {
    default: 'This announcement was edited after you previewed it. Preview it again before publishing.',
    help: 'Error when the announcement changed after the preview was shown.',
  },
  cancelPublishing: {
    default: 'This announcement is being published right now and can no longer be cancelled.',
    help: 'Error when cancelling an announcement that is being sent.',
  },
  cancelNotScheduled: {
    default: 'Only scheduled announcements can be cancelled.',
    help: 'Error when cancelling an announcement that is not scheduled.',
  },

  // ── Scheduling input ────────────────────────────────────────────────────
  scheduleBadTimezone: {
    default: 'Unknown time zone "{timezone}". Use an IANA name like Europe/London.',
    help: 'Error for an unknown time zone.',
    vars: ['timezone'],
  },
  scheduleBadFormat: {
    default: 'Use the format YYYY-MM-DD HH:MM, e.g. 2026-11-05 18:30.',
    help: 'Error when the schedule time has the wrong format.',
  },
  scheduleInvalidDateTime: {
    default: 'That date or time is not valid.',
    help: 'Error for an impossible month/hour/minute.',
  },
  scheduleNoSuchDate: { default: 'That date does not exist.', help: 'Error for a date like 2026-02-30.' },
  scheduleDstGap: {
    default: 'That time does not exist in this time zone (daylight-saving change). Pick another time.',
    help: 'Error for a time skipped by a daylight-saving change.',
  },
  scheduleInvalidTime: { default: 'That time is not valid.', help: 'Error for an unreadable schedule time.' },
  scheduleTooSoon: {
    default: 'Pick a time at least one minute in the future.',
    help: 'Error when the schedule time is in the past or too soon.',
  },
  scheduleTooFar: {
    default: 'Announcements can be scheduled at most a year ahead.',
    help: 'Error when the schedule time is more than a year ahead.',
  },

  // ── Referrals ───────────────────────────────────────────────────────────
  inviteCampaignTitle: {
    default: 'Campaign invite · {campaign}',
    help: 'Title of /referral create for a campaign invite.',
    vars: ['campaign'],
    kind: 'title',
  },
  inviteTitleNew: { default: 'Your personal invite', help: 'Title of /referral create.', kind: 'title' },
  inviteTitleExisting: {
    default: 'Your personal invite (existing)',
    help: 'Title of /referral create when the member already had an invite.',
    kind: 'title',
  },
  inviteExplainer: {
    default:
      'When someone joins with this link we credit you only if we can confirm it was your invite. Joins from new accounts, rejoins or bursts are reviewed by staff first.',
    help: 'Text under the invite link in /referral create.',
    kind: 'long',
  },
  inviteFooter: {
    default: 'Referrals are for community growth only — there are no rewards or payouts.',
    help: 'Footer of /referral create.',
    kind: 'short',
  },
  statsTitle: { default: 'Your referrals', help: 'Title of /referral stats.', kind: 'title' },
  statsConfirmed: { default: 'Confirmed', help: '/referral stats field name.', kind: 'title' },
  statsLast30Days: { default: 'Last 30 days', help: '/referral stats field name.', kind: 'title' },
  statsUnderReview: { default: 'Under review', help: '/referral stats field name.', kind: 'title' },
  statsNotCounted: { default: 'Not counted', help: '/referral stats field name.', kind: 'title' },
  statsInvites: { default: 'Your invites', help: '/referral stats field name.', kind: 'title' },
  statsNoInvites: {
    default: 'None yet — use `/referral create`.',
    help: '/referral stats when the member has no invites.',
  },
  statsFooter: {
    default: 'Only joins we can attribute with certainty are counted.',
    help: 'Footer of /referral stats.',
    kind: 'short',
  },
  leaderboardAllTime: { default: 'All time', help: 'Leaderboard period name.', kind: 'short' },
  leaderboardLastDays: {
    default: 'Last {days} days',
    help: 'Leaderboard period name for 7/30 days.',
    vars: ['days'],
    kind: 'short',
  },
  leaderboardTitle: {
    default: 'Referral leaderboard · {period}',
    help: 'Title of /referral leaderboard.',
    vars: ['period'],
    kind: 'title',
  },
  leaderboardLine: {
    default: '**{rank}.** {user} — {count}',
    help: 'One row of the referral leaderboard.',
    vars: ['rank', 'user', 'count'],
  },
  leaderboardEmpty: {
    default: 'No confirmed referrals in this period yet.',
    help: 'Leaderboard when there are no referrals.',
  },
  leaderboardFooter: {
    default: 'Confirmed and reviewed referrals only.',
    help: 'Footer of /referral leaderboard.',
    kind: 'short',
  },
  flaggedTitle: { default: 'Flagged referrals', help: 'Title of /referral review (list).', kind: 'title' },
  flaggedLine: {
    default: '`{id}` · {member} via {referrer} · {time}\n> {reason}',
    help: 'One flagged referral in /referral review.',
    vars: ['id', 'member', 'referrer', 'time', 'reason'],
  },
  flaggedDefaultReason: {
    default: 'flagged',
    help: 'Reason shown when a flagged referral has none.',
    kind: 'short',
  },
  flaggedEmpty: { default: 'Nothing to review.', help: '/referral review when nothing is flagged.' },
  reviewNeedsDecisionAndNote: {
    default: 'Provide both a decision and a note.',
    help: 'Error for /referral review without decision or note.',
  },
  reviewedTitle: { default: 'Referral reviewed', help: 'Title after /referral review.', kind: 'title' },
  reviewedBody: {
    default: 'Marked **{status}**.',
    help: 'Text after /referral review.',
    vars: ['status'],
  },
  flagNewAccount: {
    default: 'Account younger than {days} days',
    help: 'Referral flag reason: new account (stored when the join is recorded).',
    vars: ['days'],
    kind: 'short',
  },
  flagRejoin: {
    default: 'Member was already attributed before (rejoin)',
    help: 'Referral flag reason: rejoin.',
    kind: 'short',
  },
  flagSelfReferral: {
    default: 'Referrer invited themselves',
    help: 'Referral flag reason: self-referral.',
    kind: 'short',
  },
  flagBurst: {
    default: 'More than {count} joins via this invite within 10 minutes',
    help: 'Referral flag reason: join burst.',
    vars: ['count'],
    kind: 'short',
  },
  partnerCampaignInactive: {
    default: 'That partner campaign is not active.',
    help: 'Error when creating an invite for an inactive partner campaign.',
  },
  discordUnavailable: {
    default: 'Discord is not available in this process.',
    help: 'Error when an invite cannot be created because Discord is unreachable.',
  },
  inviteAlreadyRegistered: {
    default: 'That invite is already registered.',
    help: 'Error when an invite code is already tracked.',
  },
  onlyConfirmedValid: {
    default: 'Only confirmed attributions with a referrer can be marked valid.',
    help: 'Error when marking an unconfirmed referral valid.',
  },
  cannotReviewOwnReferral: {
    default: 'You cannot review your own referrals.',
    help: 'Error when staff review their own referral.',
  },

  // ── Partner programme ───────────────────────────────────────────────────
  categoryContentCreator: { default: 'Content creator', help: 'Partner category name.', kind: 'short' },
  categoryGamingCommunity: { default: 'Gaming community', help: 'Partner category name.', kind: 'short' },
  categoryCommunityPartner: { default: 'Community partner', help: 'Partner category name.', kind: 'short' },
  categoryOther: { default: 'Other', help: 'Partner category name.', kind: 'short' },
  qCreatorChannels: {
    default: 'Channel links (one per line)',
    help: 'Partner form (content creator) question. Max 45 characters shown.',
    kind: 'short',
  },
  qCreatorAudience: {
    default: 'Platforms and approximate audience size',
    help: 'Partner form (content creator) question. Max 45 characters shown.',
    kind: 'short',
  },
  qCreatorContent: {
    default: 'What content do you make?',
    help: 'Partner form (content creator) question. Max 45 characters shown.',
    kind: 'short',
  },
  qCreatorProposal: {
    default: 'How would you like to partner with us?',
    help: 'Partner form (content creator) question. Max 45 characters shown.',
    kind: 'short',
  },
  qGamingCommunity: {
    default: 'Community name and link',
    help: 'Partner form (gaming community) question. Max 45 characters shown.',
    kind: 'short',
  },
  qGamingSize: {
    default: 'Approximate member count',
    help: 'Partner form (gaming community) question. Max 45 characters shown.',
    kind: 'short',
  },
  qGamingGames: {
    default: 'Games your community plays',
    help: 'Partner form (gaming community) question. Max 45 characters shown.',
    kind: 'short',
  },
  qGamingProposal: {
    default: 'How would you like to partner with us?',
    help: 'Partner form (gaming community) question. Max 45 characters shown.',
    kind: 'short',
  },
  qCommunityOrganisation: {
    default: 'Organisation name and website',
    help: 'Partner form (community partner) question. Max 45 characters shown.',
    kind: 'short',
  },
  qCommunityAbout: {
    default: 'Tell us about your organisation',
    help: 'Partner form (community partner) question. Max 45 characters shown.',
    kind: 'short',
  },
  qCommunityProposal: {
    default: 'What partnership do you propose?',
    help: 'Partner form (community partner) question. Max 45 characters shown.',
    kind: 'short',
  },
  qOtherAbout: {
    default: 'Who are you / what do you represent?',
    help: 'Partner form (other) question. Max 45 characters shown.',
    kind: 'short',
  },
  qOtherProposal: {
    default: 'What partnership do you propose?',
    help: 'Partner form (other) question. Max 45 characters shown.',
    kind: 'short',
  },
  qOtherLinks: {
    default: 'Relevant links (optional)',
    help: 'Partner form (other) question. Max 45 characters shown.',
    kind: 'short',
  },
  applySelectPlaceholder: {
    default: 'What kind of partner are you?',
    help: 'Placeholder of the category menu in /partners apply.',
    kind: 'short',
  },
  applyIntro: {
    default:
      'Choose the category that fits you best. Never include passwords or private account details in your answers.',
    help: 'Message above the category menu in /partners apply.',
  },
  applyModalTitle: {
    default: 'Partner application · {category}',
    help: 'Title of the partner application form (max 45 characters shown).',
    vars: ['category'],
    kind: 'short',
  },
  unknownCategory: { default: 'Unknown category.', help: 'Error for an unknown partner category.' },
  applicationReceivedTitle: {
    default: 'Application {ref} received',
    help: 'Title after submitting a partner application.',
    vars: ['ref'],
    kind: 'title',
  },
  applicationReceivedBody: {
    default:
      'Thanks for applying! Our team will review it and you will get a DM with the outcome. Check progress with `/partners status`.',
    help: 'Text after submitting a partner application.',
  },
  statusTitle: {
    default: 'Your partner applications',
    help: 'Title of /partners status.',
    kind: 'title',
  },
  statusEmpty: {
    default: 'You have not applied yet. Use `/partners apply`.',
    help: '/partners status when the member has no applications.',
  },
  queueTitle: { default: 'Partner review queue', help: 'Title of /partners review-queue.', kind: 'title' },
  queueEmpty: { default: 'No open applications.', help: '/partners review-queue when empty.' },
  queueInReviewBy: {
    default: 'in review by {reviewer}',
    help: 'Review queue: status of an application being reviewed.',
    vars: ['reviewer'],
    kind: 'short',
  },
  queuePending: { default: 'pending', help: 'Review queue: status of a pending application.', kind: 'short' },
  reviewStarted: {
    default: 'You are now reviewing **{ref}**.',
    help: 'Reply after clicking "Start review".',
    vars: ['ref'],
  },
  approveModalTitle: {
    default: 'Approve application',
    help: 'Title of the approve form (max 45 characters shown).',
    kind: 'short',
  },
  rejectModalTitle: {
    default: 'Reject application',
    help: 'Title of the reject form (max 45 characters shown).',
    kind: 'short',
  },
  decisionNoteLabel: {
    default: 'Message to the applicant',
    help: 'Approve/reject form: message field label.',
    kind: 'short',
  },
  internalNotesLabel: {
    default: 'Internal notes (staff only)',
    help: 'Approve/reject form: internal notes field label.',
    kind: 'short',
  },
  campaignNameLabel: {
    default: 'Campaign name (optional)',
    help: 'Approve form: campaign name field label.',
    kind: 'short',
  },
  decidedApprovedTitle: {
    default: '{ref} approved',
    help: 'Title after staff approve an application.',
    vars: ['ref'],
    kind: 'title',
  },
  decidedRejectedTitle: {
    default: '{ref} rejected',
    help: 'Title after staff reject an application.',
    vars: ['ref'],
    kind: 'title',
  },
  decidedApprovedBody: {
    default:
      'Campaign “{campaign}” created (announcing disabled). The applicant will be DMed and given the partner role if it is configured and safe.',
    help: 'Text after staff approve an application.',
    vars: ['campaign'],
  },
  decidedRejectedBody: {
    default: 'The applicant will be notified by DM.',
    help: 'Text after staff reject an application.',
  },
  defaultCampaignName: {
    default: '{ref} partnership',
    help: 'Name given to a partner campaign when staff leave it empty.',
    vars: ['ref'],
    kind: 'short',
  },
  reviewEmbedTitle: {
    default: 'Partner application {ref} · {category}',
    help: 'Title of the staff review-channel post for a new application.',
    vars: ['ref', 'category'],
    kind: 'title',
  },
  reviewApplicant: { default: 'Applicant', help: 'Review post field name.', kind: 'title' },
  reviewSubmitted: { default: 'Submitted', help: 'Review post field name.', kind: 'title' },
  reviewFooter: {
    default: 'Review with /partners review-queue or the dashboard.',
    help: 'Footer of the staff review-channel post.',
    kind: 'short',
  },
  btnStartReview: { default: 'Start review', help: 'Review post button.', kind: 'label' },
  btnApprove: { default: 'Approve', help: 'Review post button.', kind: 'label' },
  btnReject: { default: 'Reject', help: 'Review post button.', kind: 'label' },
  btnOpenDashboard: { default: 'Open in dashboard', help: 'Review post link button.', kind: 'label' },
  decisionApprovedTitle: {
    default: 'Your partner application {ref} was approved',
    help: 'Title of the approval DM.',
    vars: ['ref'],
    kind: 'title',
  },
  decisionUpdateTitle: {
    default: 'Update on your partner application {ref}',
    help: 'Title of the rejection DM.',
    vars: ['ref'],
    kind: 'title',
  },
  decisionApprovedBody: {
    default: 'Welcome aboard! The GYNX.GG team will be in touch about next steps.',
    help: 'First paragraph of the approval DM.',
  },
  decisionRejectedBody: {
    default:
      'Thank you for your interest in partnering with GYNX.GG. We are unable to approve your application at this time.',
    help: 'First paragraph of the rejection DM.',
  },
  decisionNote: {
    default: '**Note from the team:** {note}',
    help: 'Decision DM: the note staff wrote for the applicant.',
    vars: ['note'],
  },
  decisionContactUrl: {
    default: 'Questions? Contact the support team: {url}',
    help: 'Decision DM: last line when a support URL is configured.',
    vars: ['url'],
  },
  decisionContact: {
    default: 'Questions? Contact the support team.',
    help: 'Decision DM: last line when no support URL is configured.',
  },
  unexpectedAnswers: {
    default: 'Unexpected answers were submitted.',
    help: 'Error when a partner form contains unknown fields.',
  },
  answerRequired: {
    default: 'Please answer: {question}',
    help: 'Error when a required partner question is empty.',
    vars: ['question'],
  },
  answerTooLong: {
    default: '"{question}" is too long (max {max} characters).',
    help: 'Error when a partner answer is too long.',
    vars: ['question', 'max'],
  },
  alreadyOpenApplication: {
    default: 'You already have an open application ({ref}). Please wait for the team to review it.',
    help: 'Error when applying while an application is open.',
    vars: ['ref'],
  },
  cannotReviewOwnApplication: {
    default: 'You cannot review your own application.',
    help: 'Error when staff review their own application.',
  },
  alreadyReviewing: {
    default: 'Someone is already reviewing this application.',
    help: 'Error when starting a review that someone else has started.',
  },
  alreadyDecided: {
    default: 'This application was already decided.',
    help: 'Error when acting on a decided application.',
  },
  reviewStartRace: {
    default: 'Someone else just started reviewing this application.',
    help: 'Error when two reviewers click "Start review" at once.',
  },
  anotherReviewer: {
    default: 'Another reviewer is handling this application.',
    help: 'Error when deciding an application someone else is reviewing.',
  },
  applicationChanged: {
    default: 'This application changed in the meantime.',
    help: 'Error when a decision races with another change.',
  },
});
