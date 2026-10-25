import { defineTexts } from '../core/text';

/** Member- and staff-facing wording for events, polls, suggestions and giveaways. */
export const EngagementText = defineTexts('engagement', {
  // ── Shared ──────────────────────────────────────────────────────────────────
  durationFormat: {
    default: 'Use a duration like 30m, 2h, 1d or 1d12h.',
    help: 'Error when a duration option (polls, giveaways, events) cannot be read.',
  },
  unknownSubcommand: {
    default: 'Unknown subcommand.',
    help: 'Error for an engagement subcommand that no longer exists.',
  },
  statusWordScheduled: {
    default: 'scheduled',
    help: 'Status word for a scheduled event (lists, autocomplete).',
    kind: 'short',
  },
  statusWordCompleted: {
    default: 'completed',
    help: 'Status word for a completed event (lists, autocomplete).',
    kind: 'short',
  },
  statusWordCancelled: {
    default: 'cancelled',
    help: 'Status word for a cancelled event or giveaway (lists, autocomplete).',
    kind: 'short',
  },
  statusWordActive: {
    default: 'active',
    help: 'Status word for an active giveaway (/giveaway list, autocomplete).',
    kind: 'short',
  },
  statusWordEnded: {
    default: 'ended',
    help: 'Status word for an ended giveaway (/giveaway list, autocomplete).',
    kind: 'short',
  },
  statusWordGoing: {
    default: 'going',
    help: 'RSVP "going" in the "Your RSVP" field of /event info.',
    kind: 'short',
  },
  statusWordWaitlist: {
    default: 'waitlist',
    help: 'RSVP "waitlist" in the "Your RSVP" field of /event info.',
    kind: 'short',
  },
  statusWordNotGoing: {
    default: 'not going',
    help: 'RSVP "not going" in the "Your RSVP" field of /event info.',
    kind: 'short',
  },

  // ── Events: post ──────────────────────────────────────────────────────────────
  eventTitle: { default: '📅 {title}', help: 'Title of the event post.', vars: ['title'], kind: 'title' },
  eventFieldWhen: { default: 'When', help: 'Event post field name: start time.', kind: 'title' },
  eventFieldEnds: { default: 'Ends', help: 'Event post field name: end time.', kind: 'title' },
  eventFieldWhere: { default: 'Where', help: 'Event post field name: location.', kind: 'title' },
  eventFieldGoing: { default: 'Going', help: 'Event post field name: number going.', kind: 'title' },
  eventFieldWaitlist: { default: 'Waitlist', help: 'Event post field name: waitlist size.', kind: 'title' },
  eventFieldStatus: { default: 'Status', help: 'Event post field name: status.', kind: 'title' },
  eventFieldSummary: {
    default: 'Summary',
    help: 'Event post field name: post-event summary.',
    kind: 'title',
  },
  eventStatusCancelled: {
    default: '**Cancelled**',
    help: 'Event post status value: cancelled.',
    kind: 'short',
  },
  eventStatusCompleted: {
    default: '**Completed**',
    help: 'Event post status value: completed.',
    kind: 'short',
  },
  eventStatusStarted: { default: 'Started', help: 'Event post status value: started.', kind: 'short' },
  eventStatusScheduled: { default: 'Scheduled', help: 'Event post status value: scheduled.', kind: 'short' },
  eventFooter: {
    default: 'RSVP with the buttons below · times show in your local zone',
    help: 'Footer of a scheduled event post.',
    kind: 'title',
  },
  eventGoingButton: { default: 'Going', help: 'RSVP button on the event post: going.', kind: 'label' },
  eventNotGoingButton: {
    default: "Can't go",
    help: 'RSVP button on the event post: not going.',
    kind: 'label',
  },

  // ── Events: DMs ───────────────────────────────────────────────────────────────
  eventDmViewLink: {
    default: 'View event',
    help: 'Link text to the event post in event DMs.',
    kind: 'label',
  },
  eventReminderLeadHours: {
    default: '{count} hour(s)',
    help: 'Reminder DM lead time in hours ({lead} in the title).',
    vars: ['count'],
    kind: 'short',
  },
  eventReminderLeadMinutes: {
    default: '{count} minute(s)',
    help: 'Reminder DM lead time in minutes ({lead} in the title).',
    vars: ['count'],
    kind: 'short',
  },
  eventReminderDmTitle: {
    default: '⏰ Starting in {lead}: {title}',
    help: 'Title of the event reminder DM.',
    vars: ['lead', 'title'],
    kind: 'title',
  },
  eventReminderDmWhere: {
    default: 'Where: {location}',
    help: 'Location line in the event reminder DM.',
    vars: ['location'],
  },
  eventCancelledDmTitle: {
    default: 'Event cancelled: {title}',
    help: 'Title of the event cancelled DM.',
    vars: ['title'],
    kind: 'title',
  },
  eventCancelledDmBody: {
    default: 'This event ({when}) has been cancelled by the team. Sorry for the change of plans.',
    help: 'Body of the event cancelled DM.',
    vars: ['when'],
    kind: 'long',
  },
  eventPromotedDmTitle: {
    default: "🎉 You're in: {title}",
    help: 'Title of the DM sent when moved off the waitlist.',
    vars: ['title'],
    kind: 'title',
  },
  eventPromotedDmIntro: {
    default: 'A spot opened up and you have been moved from the waitlist to **Going**.',
    help: 'First line of the DM sent when moved off the waitlist.',
    kind: 'long',
  },
  eventPromotedDmOutro: {
    default: 'Can\'t make it any more? Press "Can\'t go" on the event so someone else can take the spot.',
    help: 'Last line of the DM sent when moved off the waitlist.',
    kind: 'long',
  },

  // ── Events: commands & replies ──────────────────────────────────────────────
  eventRemindersFormat: {
    default: 'Reminders must be up to 3 numbers of minutes, e.g. 60,15.',
    help: 'Error for an invalid reminders option on /event create.',
  },
  eventUnknownTimeZoneShort: {
    default: 'Unknown time zone.',
    help: 'Error for an invalid timezone option on /event create.',
  },
  eventOptionsTooLong: {
    default: 'Those options are too long.',
    help: 'Error when /event create options are too long.',
  },
  eventModalTitle: {
    default: 'New event',
    help: 'Title of the /event create form (max 45 shown).',
    kind: 'short',
  },
  eventModalTitleLabel: {
    default: 'Title',
    help: 'Label of the title box in the /event create form.',
    kind: 'short',
  },
  eventModalDescriptionLabel: {
    default: 'Description',
    help: 'Label of the description box in the /event create form.',
    kind: 'short',
  },
  eventModalStartsLabel: {
    default: 'Starts (YYYY-MM-DD HH:MM, 24h)',
    help: 'Label of the start time box in the /event create form.',
    kind: 'short',
  },
  eventModalStartsPlaceholder: {
    default: '2026-11-05 19:30',
    help: 'Example shown in the start time box of the /event create form.',
    kind: 'short',
  },
  eventModalLocationLabel: {
    default: 'Location (channel, server, link…)',
    help: 'Label of the location box in the /event create form.',
    kind: 'short',
  },
  eventListTitle: { default: 'Upcoming events', help: 'Title of the /event list reply.', kind: 'title' },
  eventListEmpty: {
    default: 'No upcoming events right now.',
    help: '/event list reply when nothing is scheduled.',
  },
  eventFieldYourRsvp: { default: 'Your RSVP', help: 'Field name added to /event info.', kind: 'title' },
  eventRsvpNone: {
    default: 'none',
    help: '"Your RSVP" value in /event info when the member has not answered.',
    kind: 'short',
  },
  eventRescheduledTitle: {
    default: 'Event rescheduled',
    help: 'Title of the /event reschedule reply.',
    kind: 'title',
  },
  eventRescheduledBody: {
    default: '**{title}** now starts {time}. Reminders were rescheduled.',
    help: 'Body of the /event reschedule reply.',
    vars: ['title', 'time'],
  },
  eventCancelReplyTitle: {
    default: 'Event cancelled',
    help: 'Title of the /event cancel reply.',
    kind: 'title',
  },
  eventCancelReplyBody: {
    default: '**{title}** was cancelled. Attendees will be notified by DM.',
    help: 'Body of the /event cancel reply.',
    vars: ['title'],
  },
  eventSummaryModalTitle: {
    default: 'Event summary',
    help: 'Title of the /event summary form (max 45 shown).',
    kind: 'short',
  },
  eventSummaryModalLabel: {
    default: 'Summary (shown on the event post)',
    help: 'Label of the summary box in the /event summary form.',
    kind: 'short',
  },
  eventCreatedTitle: {
    default: 'Event created',
    help: 'Title of the reply after creating an event.',
    kind: 'title',
  },
  eventCreatedBody: {
    default: '**{title}** — {time}. The event post will appear in {channel} shortly.',
    help: 'Body of the reply after creating an event.',
    vars: ['title', 'time', 'channel'],
  },
  eventSummaryPostedTitle: {
    default: 'Summary posted',
    help: 'Title of the reply after posting an event summary.',
    kind: 'title',
  },
  eventSummaryPostedBody: {
    default: 'The post for **{title}** has been updated.',
    help: 'Body of the reply after posting an event summary.',
    vars: ['title'],
  },
  rsvpAlreadyGoing: {
    default: "You're already on the list. See you there!",
    help: 'Reply to "Going" when already going.',
  },
  rsvpGoing: {
    default: "You're going! You'll get a DM reminder before it starts (if your DMs are open).",
    help: 'Reply to "Going" on an event.',
  },
  rsvpWaitlist: {
    default:
      "The event is full, so you're on the waitlist (position {position}). We'll DM you if a spot opens.",
    help: 'Reply to "Going" when the event is full.',
    vars: ['position'],
  },
  rsvpAlreadyNotGoing: {
    default: 'Noted — you are not attending.',
    help: 'Reply to "Can\'t go" when already not attending.',
  },
  rsvpNotGoing: { default: "Got it, you're no longer attending.", help: 'Reply to "Can\'t go" on an event.' },

  // ── Events: errors ──────────────────────────────────────────────────────────
  eventTimeFormat: {
    default: 'Use the format YYYY-MM-DD HH:MM (24-hour), e.g. 2026-11-05 19:30.',
    help: 'Error for an event start time in the wrong format.',
  },
  eventUnknownTimeZone: {
    default: 'Unknown time zone "{timezone}". Use an IANA name like Europe/London.',
    help: 'Error for an unknown event time zone.',
    vars: ['timezone'],
  },
  eventInvalidDateTime: {
    default: 'That date/time is not valid.',
    help: 'Error for an impossible event date/time.',
  },
  eventDateDoesNotExist: {
    default: 'That date does not exist.',
    help: 'Error for a non-existent event date.',
  },
  eventMustBeFuture: {
    default: 'The event must start in the future.',
    help: 'Error when an event start is in the past.',
  },
  eventMaxYearAhead: {
    default: 'Events can be scheduled at most a year ahead.',
    help: 'Error when an event is too far ahead.',
  },
  eventNoChannel: {
    default:
      'No event channel is configured. Set one in the dashboard or run this in the channel to post in.',
    help: 'Error when creating an event with no channel to post in.',
  },
  eventOnlyScheduledEditable: {
    default: 'Only scheduled events can be edited.',
    help: 'Error when editing a past/cancelled event.',
  },
  eventCapacityBelowGoing: {
    default: '{count} members are already going; capacity cannot be lower than that.',
    help: 'Error when lowering capacity below current attendees.',
    vars: ['count'],
  },
  eventNotScheduled: {
    default: 'This event is not scheduled (already cancelled or completed).',
    help: 'Error when cancelling an event that is not scheduled.',
  },
  eventWasCancelled: {
    default: 'This event was cancelled.',
    help: 'Error when posting a summary for a cancelled event.',
  },
  eventSummaryTooEarly: {
    default: 'You can post a summary once the event has started.',
    help: 'Error when posting a summary before the event starts.',
  },
  eventIsStatus: {
    default: 'This event is {status}.',
    help: 'Error when RSVPing to an event that is not scheduled. {status} is e.g. cancelled.',
    vars: ['status'],
  },
  eventRsvpClosed: {
    default: 'RSVPs are closed: the event has already started.',
    help: 'Error when RSVPing after the start.',
  },
  eventFull: {
    default: 'Sorry, this event is full.',
    help: 'Error when RSVPing to a full event without a waitlist.',
  },

  // ── Polls ─────────────────────────────────────────────────────────────────────
  pollTitleOpen: {
    default: '📊 Poll: {question}',
    help: 'Title of an open poll.',
    vars: ['question'],
    kind: 'title',
  },
  pollTitleClosed: {
    default: '📊 Final results: {question}',
    help: 'Title of a closed poll.',
    vars: ['question'],
    kind: 'title',
  },
  pollVotesOne: {
    default: '{count} vote',
    help: 'Vote count under a poll option (1 vote).',
    vars: ['count'],
    kind: 'short',
  },
  pollVotesMany: {
    default: '{count} votes',
    help: 'Vote count under a poll option (0 or 2+ votes).',
    vars: ['count'],
    kind: 'short',
  },
  pollRulePickUpTo: {
    default: 'Pick up to {max}',
    help: 'Poll "Rules" value for multiple-choice polls.',
    vars: ['max'],
    kind: 'short',
  },
  pollRulePickOne: {
    default: 'Pick one',
    help: 'Poll "Rules" value for single-choice polls.',
    kind: 'short',
  },
  pollRuleAnonymous: { default: 'Anonymous', help: 'Poll "Rules" value for anonymous polls.', kind: 'short' },
  pollRuleVisible: {
    default: 'Votes visible to staff',
    help: 'Poll "Rules" value for non-anonymous polls.',
    kind: 'short',
  },
  pollFieldEnds: { default: 'Ends', help: 'Poll field name: closing time (open poll).', kind: 'title' },
  pollFieldClosed: { default: 'Closed', help: 'Poll field name: closing time (closed poll).', kind: 'title' },
  pollFieldVoters: { default: 'Voters', help: 'Poll field name: number of voters.', kind: 'title' },
  pollFieldRules: { default: 'Rules', help: 'Poll field name: voting rules.', kind: 'title' },
  pollFieldResults: {
    default: 'Results',
    help: 'Poll field name: results (hidden-tally polls).',
    kind: 'title',
  },
  pollResultsHidden: {
    default: 'Shown when the poll closes.',
    help: 'Poll "Results" value while the tally is hidden.',
    kind: 'short',
  },
  pollSelectPlaceholder: {
    default: 'Choose an option',
    help: 'Placeholder of the vote menu (single choice).',
    kind: 'short',
  },
  pollSelectPlaceholderMulti: {
    default: 'Choose up to {max} option(s)',
    help: 'Placeholder of the vote menu (multiple choice).',
    vars: ['max'],
    kind: 'short',
  },
  pollCreatedTitle: { default: 'Poll created', help: 'Title of the /poll create reply.', kind: 'title' },
  pollCreatedBody: {
    default: 'It will appear in this channel in a moment and closes {time}.',
    help: 'Body of the /poll create reply.',
    vars: ['time'],
  },
  pollClosedTitle: { default: 'Poll closed', help: 'Title of the /poll close reply.', kind: 'title' },
  pollClosedBody: {
    default: '“{question}” is closed; final results will be posted on the poll message.',
    help: 'Body of the /poll close reply.',
    vars: ['question'],
  },
  pollVoteRecorded: {
    default: 'Vote recorded: {options}. You can change it until the poll closes.',
    help: 'Reply after voting in a poll.',
    vars: ['options'],
  },
  pollVoteUnchanged: {
    default: 'Your vote is unchanged: {options}. You can change it until the poll closes.',
    help: 'Reply after re-submitting the same poll vote.',
    vars: ['options'],
  },
  pollPickAtLeastOne: { default: 'Pick at least one option.', help: 'Error when a poll vote has no option.' },
  pollOptionNotInPoll: {
    default: 'That option is not part of this poll.',
    help: 'Error for an unknown poll option.',
  },
  pollSingleChoiceOnly: {
    default: 'This poll allows only one choice.',
    help: 'Error for several choices in a single-choice poll.',
  },
  pollMaxChoices: {
    default: 'You can pick at most {max} options.',
    help: 'Error for too many choices.',
    vars: ['max'],
  },
  pollIsClosed: { default: 'This poll is closed.', help: 'Error when voting in a closed poll.' },
  pollAlreadyClosed: { default: 'This poll is already closed.', help: 'Error when closing a closed poll.' },
  pollResultsNotYet: {
    default: 'Results will be shown when the poll closes.',
    help: 'Error when requesting hidden results of an open poll.',
  },

  // ── Suggestions ─────────────────────────────────────────────────────────────
  suggestionStatusUnderReview: {
    default: 'Under review',
    help: 'Suggestion status name: under review.',
    kind: 'short',
  },
  suggestionStatusPlanned: { default: 'Planned', help: 'Suggestion status name: planned.', kind: 'short' },
  suggestionStatusImplemented: {
    default: 'Implemented',
    help: 'Suggestion status name: implemented.',
    kind: 'short',
  },
  suggestionStatusDeclined: { default: 'Declined', help: 'Suggestion status name: declined.', kind: 'short' },
  suggestionStatusDuplicate: {
    default: 'Duplicate',
    help: 'Suggestion status name: duplicate.',
    kind: 'short',
  },
  suggestionTitle: {
    default: '💡 {ref} · {title}',
    help: 'Title of a suggestion on the board.',
    vars: ['ref', 'title'],
    kind: 'title',
  },
  suggestionRemovedTitle: {
    default: 'Suggestion {ref}',
    help: 'Title of a suggestion hidden by moderators.',
    vars: ['ref'],
    kind: 'title',
  },
  suggestionRemovedBody: {
    default: '_This suggestion was removed by the moderators._',
    help: 'Body of a suggestion hidden by moderators.',
    kind: 'long',
  },
  suggestionFieldStatus: { default: 'Status', help: 'Suggestion field name: status.', kind: 'title' },
  suggestionDuplicateOf: {
    default: '{status} of {ref}',
    help: 'Suggestion status value when marked duplicate of another.',
    vars: ['status', 'ref'],
    kind: 'short',
  },
  suggestionFieldVotes: { default: 'Votes', help: 'Suggestion field name: votes.', kind: 'title' },
  suggestionVotesValue: {
    default: '👍 {up} · 👎 {down}',
    help: 'Suggestion "Votes" value.',
    vars: ['up', 'down'],
    kind: 'short',
  },
  suggestionFieldAuthor: { default: 'Submitted by', help: 'Suggestion field name: author.', kind: 'title' },
  suggestionFieldResponse: {
    default: 'Team response',
    help: 'Suggestion field name: staff response.',
    kind: 'title',
  },
  suggestionStatusPlaceholder: {
    default: 'Staff: set status',
    help: 'Placeholder of the staff status menu on a suggestion.',
    kind: 'short',
  },
  suggestionStatusDmTitle: {
    default: 'Your suggestion {ref} is now: {status}',
    help: 'Title of the DM sent to the author on a status change.',
    vars: ['ref', 'status'],
    kind: 'title',
  },
  suggestionStatusDmResponse: {
    default: '**Team response:** {response}',
    help: 'Staff response line in the status-change DM.',
    vars: ['response'],
    kind: 'long',
  },
  suggestionDmViewLink: {
    default: 'View on the board',
    help: 'Link text to the suggestion in the status-change DM.',
    kind: 'label',
  },
  suggestModalTitle: {
    default: 'Make a suggestion',
    help: 'Title of the /suggest form (max 45 shown).',
    kind: 'short',
  },
  suggestModalTitleLabel: {
    default: 'Short title',
    help: 'Label of the title box in the /suggest form.',
    kind: 'short',
  },
  suggestModalBodyLabel: {
    default: 'Describe your idea',
    help: 'Label of the description box in the /suggest form.',
    kind: 'short',
  },
  suggestModalBodyPlaceholder: {
    default: 'What should change, and why would it help?',
    help: 'Placeholder of the description box in the /suggest form.',
    kind: 'short',
  },
  suggestionSubmittedTitle: {
    default: 'Suggestion {ref} submitted',
    help: 'Title of the reply after /suggest.',
    vars: ['ref'],
    kind: 'title',
  },
  suggestionSubmittedBody: {
    default: 'Thanks! It will appear on the suggestion board shortly, where members can vote on it.',
    help: 'Body of the reply after /suggest.',
  },
  suggestionVoteRemoved: {
    default: 'Your vote was removed.',
    help: 'Reply when a member removes their suggestion vote.',
  },
  suggestionVoted: {
    default: 'You voted {vote}. (👍 {up} · 👎 {down})',
    help: 'Reply after voting on a suggestion. {vote} is 👍 or 👎.',
    vars: ['vote', 'up', 'down'],
  },
  suggestionStaffOnly: {
    default: 'Only staff can change a suggestion status.',
    help: 'Error when a member uses the status menu.',
  },
  suggestionUnknownStatus: { default: 'Unknown status.', help: 'Error for an unknown suggestion status.' },
  suggestionStatusModalTitle: {
    default: 'Mark as {status}',
    help: 'Title of the staff status form (max 45 shown).',
    vars: ['status'],
    kind: 'short',
  },
  suggestionResponseLabel: {
    default: 'Response to the author (optional)',
    help: 'Label of the response box in the staff status form.',
    kind: 'short',
  },
  suggestionDuplicateLabel: {
    default: 'Duplicate of (e.g. S-0012)',
    help: 'Label of the duplicate box in the staff status form.',
    kind: 'short',
  },
  suggestionUpdatedTitle: {
    default: '{ref} updated',
    help: 'Title of the reply after a staff status change.',
    vars: ['ref'],
    kind: 'title',
  },
  suggestionUpdatedBody: {
    default: 'Status: **{status}**. The author will be notified by DM.',
    help: 'Body of the reply after a staff status change.',
    vars: ['status'],
  },
  suggestionsNotSetUp: {
    default: 'Suggestions are not set up on this server yet.',
    help: 'Error for /suggest with no board channel.',
  },
  suggestionSimilarExists: {
    default: 'A very similar suggestion already exists: **{ref}** — {title}',
    help: 'Error when a near-duplicate suggestion exists (a link follows).',
    vars: ['ref', 'title'],
  },
  suggestionVoteInstead: {
    default: 'Please vote on that one instead.',
    help: 'Last line of the near-duplicate suggestion error.',
  },
  suggestionVotingClosed: {
    default: 'Voting is closed for this suggestion.',
    help: 'Error when voting on a closed suggestion.',
  },
  suggestionNotFoundRef: {
    default: 'Suggestion {ref} was not found.',
    help: 'Error for an unknown "duplicate of" suggestion.',
    vars: ['ref'],
  },
  suggestionCannotDuplicateItself: {
    default: 'A suggestion cannot duplicate itself.',
    help: 'Error when marking a suggestion a duplicate of itself.',
  },
  suggestionAlreadyStatus: {
    default: 'It is already {status}.',
    help: 'Error when setting the status a suggestion already has. {status} is lowercase.',
    vars: ['status'],
  },

  // ── Giveaways: post ───────────────────────────────────────────────────────────
  giveawayTitle: {
    default: '🎁 Giveaway: {prize}',
    help: 'Title of the giveaway post.',
    vars: ['prize'],
    kind: 'title',
  },
  giveawayReqRole: {
    default: 'Role: {roles}',
    help: 'Requirement line on the giveaway post: required role(s).',
    vars: ['roles'],
  },
  giveawayReqAccountAge: {
    default: 'Account age ≥ {days}d',
    help: 'Requirement line: minimum account age.',
    vars: ['days'],
    kind: 'short',
  },
  giveawayReqMemberDays: {
    default: 'Member for ≥ {days}d',
    help: 'Requirement line: minimum days in the server.',
    vars: ['days'],
    kind: 'short',
  },
  giveawayEndsLine: {
    default: 'Ends {relative} ({time})',
    help: 'Status line of an active giveaway post.',
    vars: ['relative', 'time'],
  },
  giveawayCancelledLine: {
    default: '**Cancelled**',
    help: 'Status line of a cancelled giveaway post.',
    kind: 'short',
  },
  giveawayEndedLine: {
    default: 'Ended {relative}',
    help: 'Status line of an ended giveaway post.',
    vars: ['relative'],
  },
  giveawayFieldWinners: {
    default: 'Winners',
    help: 'Giveaway field name: number of winners.',
    kind: 'title',
  },
  giveawayFieldEntries: {
    default: 'Entries',
    help: 'Giveaway field name: number of entries.',
    kind: 'title',
  },
  giveawayFieldRequirements: {
    default: 'Requirements',
    help: 'Giveaway field name: entry requirements.',
    kind: 'title',
  },
  giveawayFieldWinnerList: {
    default: 'Winner(s)',
    help: 'Giveaway field name: drawn winners.',
    kind: 'title',
  },
  giveawayNoValidEntries: {
    default: 'No valid entries',
    help: 'Giveaway "Winner(s)" value when nobody could win.',
    kind: 'short',
  },
  giveawayFooter: {
    default: 'Free community giveaway · winners drawn with a cryptographically secure, audited draw',
    help: 'Footer of the giveaway post.',
    kind: 'title',
  },
  giveawayEnterButton: { default: 'Enter', help: 'Button on the giveaway post: enter.', kind: 'label' },
  giveawayLeaveButton: { default: 'Leave', help: 'Button on the giveaway post: leave.', kind: 'label' },

  // ── Giveaways: announcements ────────────────────────────────────────────────
  winnerAnnouncement: {
    default: '🎉 Congratulations {winners}! You won **{prize}**.',
    help: 'Winner announcement posted when a giveaway ends.',
    vars: ['winners', 'prize'],
  },
  winnerShortPoolOne: {
    default: '_Only {count} eligible entry for {prizes} prize(s), so every entrant wins._',
    help: 'Announcement note when there are fewer entrants than prizes (1 entrant).',
    vars: ['count', 'prizes'],
  },
  winnerShortPoolMany: {
    default: '_Only {count} eligible entries for {prizes} prize(s), so every entrant wins._',
    help: 'Announcement note when there are fewer entrants than prizes.',
    vars: ['count', 'prizes'],
  },
  winnerContactNote: {
    default: 'The team will contact you about your prize.',
    help: 'Last line of the winner announcement.',
  },
  winnerNoEntries: {
    default: 'The giveaway for **{prize}** has ended with no valid entries, so there is no winner.',
    help: 'Announcement when a giveaway ends with no entries.',
    vars: ['prize'],
  },
  winnerReroll: {
    default: '🔁 Reroll for **{prize}**: congratulations {winners}!',
    help: 'Announcement for a reroll.',
    vars: ['prize', 'winners'],
  },
  winnerRerollNone: {
    default: '🔁 Reroll for **{prize}**: no remaining eligible entrants.',
    help: 'Announcement for a reroll with nobody left to draw.',
    vars: ['prize'],
  },

  // ── Giveaways: commands & replies ─────────────────────────────────────────────
  giveawayStartedTitle: {
    default: 'Giveaway started',
    help: 'Title of the /giveaway start reply.',
    kind: 'title',
  },
  giveawayStartedBody: {
    default: '**{prize}** ends {time}.',
    help: 'Body of the /giveaway start reply.',
    vars: ['prize', 'time'],
  },
  giveawayListTitle: { default: 'Giveaways', help: 'Title of the /giveaway list reply.', kind: 'title' },
  giveawayListEmpty: { default: 'No giveaways yet.', help: '/giveaway list reply when there are none.' },
  giveawayListEntriesOne: {
    default: '{count} entry',
    help: 'Entry count in /giveaway list (1 entry).',
    vars: ['count'],
    kind: 'short',
  },
  giveawayListEntriesMany: {
    default: '{count} entries',
    help: 'Entry count in /giveaway list.',
    vars: ['count'],
    kind: 'short',
  },
  giveawayListEnds: {
    default: 'ends {time}',
    help: 'End time in /giveaway list (active).',
    vars: ['time'],
    kind: 'short',
  },
  giveawayListEnded: {
    default: 'ended {time}',
    help: 'End time in /giveaway list (finished).',
    vars: ['time'],
    kind: 'short',
  },
  giveawayEndedTitle: { default: 'Giveaway ended', help: 'Title of the /giveaway end reply.', kind: 'title' },
  giveawayEndedBodyOne: {
    default: '{winners} winner(s) drawn from {count} entry. The announcement is being posted.',
    help: 'Body of the /giveaway end reply (1 entry).',
    vars: ['winners', 'count'],
  },
  giveawayEndedBodyMany: {
    default: '{winners} winner(s) drawn from {count} entries. The announcement is being posted.',
    help: 'Body of the /giveaway end reply.',
    vars: ['winners', 'count'],
  },
  giveawayEndedNoWinner: {
    default: 'There were no valid entries, so no winner was drawn.',
    help: 'Body of the /giveaway end reply when nobody entered.',
  },
  giveawayRerolledTitle: { default: 'Rerolled', help: 'Title of the /giveaway reroll reply.', kind: 'title' },
  giveawayRerolledBody: {
    default: 'Draw #{seq}: {winners} (from {count} remaining entrants). Announcement is being posted.',
    help: 'Body of the /giveaway reroll reply.',
    vars: ['seq', 'winners', 'count'],
  },
  giveawayCancelledTitle: {
    default: 'Giveaway cancelled',
    help: 'Title of the /giveaway cancel reply.',
    kind: 'title',
  },
  giveawayCancelledBody: {
    default: 'No winners will be drawn.',
    help: 'Body of the /giveaway cancel reply.',
  },
  giveawayEnteredTitle: {
    default: "🎉 You're entered!",
    help: 'Title of the reply after entering a giveaway.',
    kind: 'title',
  },
  giveawayEnteredBody: {
    default:
      'Good luck! Winners are drawn automatically when the giveaway ends. You can leave any time before then.',
    help: 'Body of the reply after entering a giveaway.',
    kind: 'long',
  },
  giveawayLeft: { default: 'You have left the giveaway.', help: 'Reply after leaving a giveaway.' },
  giveawayNotEntered: {
    default: "You weren't entered in this giveaway.",
    help: 'Reply to "Leave" when not entered.',
  },

  // ── Giveaways: errors ───────────────────────────────────────────────────────
  giveawayNotEligible: {
    default: 'You are not eligible for this giveaway:\n{reasons}',
    help: 'Error when a member cannot enter; {reasons} is a bulleted list.',
    vars: ['reasons'],
  },
  giveawayEligibilityRole: {
    default: 'You need one of these roles: {roles}.',
    help: 'Eligibility reason: missing required role.',
    vars: ['roles'],
  },
  giveawayEligibilityAccountAge: {
    default: 'Your Discord account must be at least {days} day(s) old.',
    help: 'Eligibility reason: account too new.',
    vars: ['days'],
  },
  giveawayEligibilityMemberDays: {
    default: 'You must have been a member of this server for at least {days} day(s).',
    help: 'Eligibility reason: joined the server too recently.',
    vars: ['days'],
  },
  giveawayAlreadyStatus: {
    default: 'This giveaway is already {status}.',
    help: 'Error when ending a giveaway that is not active. {status} is e.g. ended.',
    vars: ['status'],
  },
  giveawayAlreadyEnded: {
    default: 'This giveaway has already ended.',
    help: 'Error when ending an already-ended giveaway.',
  },
  giveawayOnlyEndedReroll: {
    default: 'Only ended giveaways can be rerolled.',
    help: 'Error when rerolling an active giveaway.',
  },
  giveawayNoRemainingEntrants: {
    default: 'There are no remaining eligible entrants to draw from.',
    help: 'Error when a reroll has nobody left to draw.',
  },
  giveawayOnlyActiveCancel: {
    default: 'Only active giveaways can be cancelled.',
    help: 'Error when cancelling a finished giveaway.',
  },
  giveawayNotAccepting: {
    default: 'This giveaway is no longer accepting entries.',
    help: 'Error when entering a finished giveaway.',
  },
  giveawayAlreadyEntered: {
    default: 'You have already entered this giveaway.',
    help: 'Error when entering twice.',
  },
  giveawayEntriesLocked: {
    default: 'This giveaway has ended; entries can no longer change.',
    help: 'Error when leaving a finished giveaway.',
  },
  // ── Suggestions channel (members type, the bot posts a card) ──
  suggestionThreadName: {
    default: '💬 {ref}: {title}',
    help: 'Name of the discussion thread opened under each suggestion card.',
    vars: ['ref', 'title'],
    kind: 'short',
  },
  suggestionChannelEmpty: {
    default: 'Please describe your suggestion in text. Attachments alone can’t be posted as a suggestion.',
    help: 'Reply in the suggestions channel when a message has no text.',
  },
  suggestionChannelTooLong: {
    default: 'That suggestion is too long (max 2000 characters). Please shorten it and post again.',
    help: 'Reply in the suggestions channel when a message is too long.',
  },
  suggestionChannelRemoved: {
    default: '{user} {reason}\n-# Your message was removed. This note disappears in a few seconds.',
    help: 'Reply in the suggestions channel when a message could not become a suggestion. {reason} is the specific problem.',
    vars: ['user', 'reason'],
  },
  suggestionChannelDmCopy: {
    default:
      "Your message in the suggestions channel couldn't be posted: {reason}\n\nHere's what you wrote, so you can fix it and post again:\n{content}",
    help: 'DM sent to a member when their suggestions-channel message was removed, with a copy of their text.',
    vars: ['reason', 'content'],
  },
});
