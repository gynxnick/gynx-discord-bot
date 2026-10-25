import { defineTexts } from '../core/text';

/** Support status panel (customer-facing) and /duty wording. */
export const SupportText = defineTexts('support', {
  // ── Public panel ──
  panelTitle: {
    default: 'GYNX.GG | LIVE SUPPORT',
    help: 'Title of the public support status panel.',
    kind: 'title',
  },
  onlineHeadline: {
    default: '🟢 **Support is online**',
    help: 'First line of the panel while at least one staff member is on duty.',
    kind: 'short',
  },
  onlineBodyOne: {
    default:
      'Our support team currently has **1 staff member on duty** and available to assist with customer support.',
    help: 'Panel text when exactly one staff member is on duty.',
  },
  onlineBodyMany: {
    default:
      'Our support team currently has **{count} staff members on duty** and available to assist with customer support.',
    help: 'Panel text when several staff members are on duty.',
    vars: ['count'],
  },
  onDutyTeamField: {
    default: 'ON-DUTY TEAM',
    help: 'Heading above the list of on-duty staff names.',
    kind: 'title',
  },
  onDutyMember: {
    default: '🟢 {name}',
    help: 'One line in the on-duty list. {name} is the approved public name.',
    vars: ['name'],
    kind: 'short',
  },
  onDutyMore: {
    default: '…and {count} more',
    help: 'Shown when more staff are on duty than fit in the list.',
    vars: ['count'],
    kind: 'short',
  },
  availabilityField: { default: 'Availability', help: 'Label of the availability field.', kind: 'title' },
  availabilityOnline: {
    default: 'Available',
    help: 'Availability value while staff are on duty.',
    kind: 'short',
  },
  availabilityOffline: {
    default: 'Offline',
    help: 'Availability value while nobody is on duty.',
    kind: 'short',
  },
  staffOnDutyField: { default: 'Staff on duty', help: 'Label of the on-duty count field.', kind: 'title' },
  lastUpdatedField: { default: 'Last updated', help: 'Label of the last-updated field.', kind: 'title' },
  onlineFooterLine: {
    default: 'Submit and manage your support requests through the GYNX website.',
    help: 'Closing line of the panel while support is online.',
  },
  offlineHeadline: {
    default: '⚫ **Support is currently offline**',
    help: 'First line of the panel while nobody is on duty.',
    kind: 'short',
  },
  offlineBody: {
    default:
      'Our support team is not currently on duty. You can still submit a support request through the GYNX website, and our team will respond when available.',
    help: 'Panel text while nobody is on duty.',
  },
  websiteButton: {
    default: 'Visit GYNX Website',
    help: 'Link button on the panel (only shown when a website URL is configured).',
    kind: 'label',
  },

  // ── /duty replies (staff) ──
  dutyStarted: {
    default: 'You are now on duty as **{name}**. Your session ends automatically after {hours} hours.',
    help: 'Reply to /duty on.',
    vars: ['name', 'hours'],
  },
  dutyAlreadyOn: {
    default: 'You are already on duty (since {since}).',
    help: 'Error when going on duty twice.',
    vars: ['since'],
  },
  dutyEnded: { default: 'You are now off duty.', help: 'Reply to /duty off.' },
  dutyNotOn: { default: 'You are not on duty.', help: 'Error for /duty off when not on duty.' },
  dutyNoProfile: {
    default:
      'You need an approved public name before going on duty. Ask a support lead to run `/duty profile set`.',
    help: 'Error when a staff member without an approved name tries to go on duty.',
  },
  profileSaved: {
    default: 'Public duty name for {user} is now **{name}**.',
    help: 'Reply after approving or renaming a public duty name.',
    vars: ['user', 'name'],
  },
  profileRemoved: {
    default: '{user} can no longer go on duty. Any active session was ended.',
    help: 'Reply after removing a public duty name.',
    vars: ['user'],
  },
  profileNotFound: {
    default: 'That staff member has no public duty name.',
    help: 'Error for unknown profiles.',
  },
  publicNameInvalid: {
    default: 'Public names must be 1–32 characters and can’t contain mentions, links or formatting.',
    help: 'Error for an invalid public name.',
  },
  adminEnded: {
    default: 'Ended the duty session of **{name}**.',
    help: 'Reply after a lead ends someone else’s session.',
    vars: ['name'],
  },
  statusTitle: { default: 'On duty now', help: 'Title of /duty status.', kind: 'title' },
  profilesTitle: { default: 'Approved public names', help: 'Title of /duty profile list.', kind: 'title' },
  profilesNone: {
    default: 'No public names approved yet. Use `/duty profile set`.',
    help: '/duty profile list when empty.',
  },
  statusNone: { default: 'Nobody is on duty right now.', help: '/duty status when nobody is on duty.' },
  statusLine: {
    default: '🟢 **{name}** · since {since} · ends {ends}',
    help: 'One line of /duty status.',
    vars: ['name', 'since', 'ends'],
  },

  // ── Staff duty-control panel (private staff channel) ──
  dutyPanelTitle: {
    default: 'Staff duty',
    help: 'Title of the private staff duty-control panel.',
    kind: 'title',
  },
  dutyPanelBody: {
    default:
      'Use the buttons below to go on or off support duty. While you are on duty, your approved public name is shown on the customer support status panel. Sessions end automatically after the maximum duty length.',
    help: 'Explanation at the top of the staff duty-control panel.',
  },
  dutyPanelCountField: {
    default: 'Staff on duty',
    help: 'Label of the on-duty count on the duty-control panel.',
    kind: 'title',
  },
  dutyPanelTeamField: {
    default: 'On-duty team',
    help: 'Heading above the on-duty names on the duty-control panel.',
    kind: 'title',
  },
  dutyPanelMember: {
    default: '🟢 {name} · since {since}',
    help: 'One line of the on-duty list on the duty-control panel.',
    vars: ['name', 'since'],
    kind: 'short',
  },
  dutyPanelNone: {
    default: 'Nobody is on duty right now.',
    help: 'Duty-control panel when nobody is on duty.',
    kind: 'short',
  },
  dutyPanelOnButton: {
    default: 'Go On Duty',
    help: 'Duty-control panel button that starts a duty session.',
    kind: 'label',
  },
  dutyPanelOffButton: {
    default: 'Go Off Duty',
    help: 'Duty-control panel button that ends your duty session.',
    kind: 'label',
  },
  dutyPanelMeButton: {
    default: 'My Status',
    help: 'Duty-control panel button that shows your own duty status.',
    kind: 'label',
  },
  dutyPanelTeamButton: {
    default: 'View On-Duty Team',
    help: 'Duty-control panel button that lists who is on duty.',
    kind: 'label',
  },
  myStatusTitle: { default: 'Your duty status', help: 'Title of the My Status reply.', kind: 'title' },
  myStatusOn: {
    default: 'You are on duty as **{name}** since {since} (ends {ends}).',
    help: 'My Status reply while on duty.',
    vars: ['name', 'since', 'ends'],
  },
  myStatusOff: { default: 'You are off duty.', help: 'My Status reply while off duty.' },
});
