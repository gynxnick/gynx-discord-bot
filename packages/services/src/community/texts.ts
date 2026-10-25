import { defineTexts } from '../core/text';

/**
 * Member-facing wording of the community module (/help, /about, /faq, /guides,
 * /rules, /roles, onboarding, role panels, raid alerts). The welcome message
 * itself is edited in the welcome settings; these are the fixed texts around it.
 */
export const CommunityText = defineTexts('community', {
  // ── Shared ────────────────────────────────────────────────────────────────
  groupGames: { default: 'Games', help: 'Name of the "games" self-role group.', kind: 'title' },
  groupCommunity: {
    default: 'Community',
    help: 'Name of the "community" self-role group.',
    kind: 'title',
  },
  groupNotifications: {
    default: 'Notifications',
    help: 'Name of the "notifications" self-role group.',
    kind: 'title',
  },
  supportLineWithUrl: {
    default: 'Still stuck? Reach the support team: {url}',
    help: 'Support hint under FAQ answers and /help when a support link is configured.',
    vars: ['url'],
  },
  supportLine: {
    default: 'Still stuck? Contact the support team.',
    help: 'Support hint under FAQ answers and /help when no support link is configured.',
  },
  fieldDocs: { default: 'Docs', help: 'Field name for the docs link in welcome messages.', kind: 'title' },
  fieldSupport: {
    default: 'Support',
    help: 'Field name for the support link in welcome messages, /help and /about.',
    kind: 'title',
  },
  serverOnly: {
    default: 'This only works inside the server.',
    help: 'Shown when a community control is used outside the server.',
  },
  warningLine: {
    default: '⚠️ {message}',
    help: 'Format of a warning line in role-change results. {message} is the reason.',
    vars: ['message'],
  },

  // ── /help ─────────────────────────────────────────────────────────────────
  helpTitle: { default: 'GYNX.GG bot commands', help: 'Title of the /help embed.', kind: 'title' },
  helpDescription: {
    default:
      'Some commands are only available to staff. Commands may be unavailable if a module is turned off on this server.',
    help: 'Description of the /help embed.',
    kind: 'long',
  },
  helpGeneralName: { default: 'General', help: '/help section name: general.', kind: 'title' },
  helpGeneralBody: {
    default:
      '`/help` · this overview\n`/about` · about the GYNX.GG bot\n`/faq` · search frequently asked questions\n`/guides` · browse setup and how-to guides\n`/rules` · read and accept the server rules\n`/roles` · pick game and notification roles',
    help: '/help section contents: general commands.',
  },
  helpStatusName: { default: 'Status', help: '/help section name: status.', kind: 'title' },
  helpStatusBody: {
    default:
      '`/status` · current service status\n`/uptime` · recent uptime\n`/incidents` · recent incidents\n`/subscribe-status` · status alerts',
    help: '/help section contents: status commands.',
  },
  helpModerationName: {
    default: 'Moderation (staff)',
    help: '/help section name: moderation.',
    kind: 'title',
  },
  helpModerationBody: {
    default:
      '`/warn` · `/warnings` · `/timeout` · `/kick` · `/ban`\n`/appeal` · appeal a moderation action (members)',
    help: '/help section contents: moderation commands.',
  },
  helpTroubleshootingName: {
    default: 'Troubleshooting',
    help: '/help section name: troubleshooting.',
    kind: 'title',
  },
  helpTroubleshootingBody: {
    default:
      '`/troubleshoot` · guided troubleshooting\n`/diagnose` · run safe diagnostics\n`/knowledge-search` · search the knowledge base',
    help: '/help section contents: troubleshooting commands.',
  },
  helpGamesName: { default: 'Game utilities', help: '/help section name: game utilities.', kind: 'title' },
  helpGamesBody: {
    default: '`/gameinfo` · `/version` · `/playercount`\n`/minecraft` · `/steam` · `/portcheck`',
    help: '/help section contents: game utility commands.',
  },
  helpSecurityName: { default: 'Security', help: '/help section name: security.', kind: 'title' },
  helpSecurityBody: {
    default:
      '`/report-abuse` · privately report spam, scams or abuse\n`/audit-log` · security audit log (staff)',
    help: '/help section contents: security commands.',
  },
  helpCommunityName: { default: 'Community', help: '/help section name: community.', kind: 'title' },
  helpCommunityBody: {
    default: '`/event` · community events\n`/suggest` · share a suggestion\n`/poll` · `/giveaway` (staff)',
    help: '/help section contents: community commands.',
  },
  helpMarketingName: { default: 'Marketing', help: '/help section name: marketing.', kind: 'title' },
  helpMarketingBody: {
    default:
      '`/referral` · referral links\n`/partners` · partner programme\n`/announce` · `/schedule-announcement` (staff)',
    help: '/help section contents: marketing commands.',
  },
  helpAnalyticsName: { default: 'Analytics', help: '/help section name: analytics.', kind: 'title' },
  helpAnalyticsBody: {
    default: '`/analytics` · `/staff-stats` (staff)',
    help: '/help section contents: analytics commands.',
  },

  // ── /about ────────────────────────────────────────────────────────────────
  aboutTitle: {
    default: '{brand} Community Bot',
    help: 'Title of the /about embed. {brand} is the brand name.',
    vars: ['brand'],
    kind: 'title',
  },
  aboutDescription: {
    default:
      'Status updates, onboarding, FAQs, troubleshooting help, game utilities, events and more for the GYNX.GG community.\n\nThe bot never touches game servers, panels or billing.',
    help: 'Description of the /about embed.',
    kind: 'long',
  },
  aboutWebsiteField: {
    default: 'Website',
    help: 'Field name for the website link in /about.',
    kind: 'title',
  },
  aboutCommandsField: {
    default: 'Commands',
    help: 'Field name for the commands hint in /about.',
    kind: 'title',
  },
  aboutCommandsValue: {
    default: 'Use `/help` to see everything you can do.',
    help: 'Commands hint in /about.',
  },

  // ── Welcome (fixed text around the staff-edited welcome message) ──────────
  welcomeStepRules: {
    default: '• Read the rules with `/rules`',
    help: 'Welcome post step shown when rules or verification are required.',
  },
  welcomeStepVerify: {
    default: '• Press **Verify** below to unlock the server',
    help: 'Welcome post step shown when verification is required.',
  },
  welcomeStepRoles: {
    default: '• Pick your games and notifications with `/roles`',
    help: 'Welcome post step about roles.',
  },
  welcomeStepFaq: { default: '• Find quick answers with `/faq`', help: 'Welcome post step about the FAQ.' },
  welcomeDmTitle: {
    default: 'Welcome to {server}',
    help: 'Title of the welcome DM. {server} is the server name.',
    vars: ['server'],
    kind: 'title',
  },
  welcomeDmIntro: { default: 'Here is how to get started:', help: 'First line of the welcome DM.' },
  welcomeDmStepVerify: {
    default: '1. Open the server and press **Verify** in the welcome channel (or run `/rules`).',
    help: 'Welcome DM step 1 when verification is required.',
  },
  welcomeDmStepRules: {
    default: '1. Read the rules with `/rules`.',
    help: 'Welcome DM step 1 when verification is not required.',
  },
  welcomeDmStepRoles: {
    default: '2. Choose your games and notification roles with `/roles`.',
    help: 'Welcome DM step 2.',
  },
  welcomeDmStepFaq: {
    default: '3. Browse quick answers with `/faq` and guides with `/guides`.',
    help: 'Welcome DM step 3.',
  },
  welcomeDmSafety: {
    default: 'GYNX staff will never ask for your password or payment details in DMs.',
    help: 'Safety note at the end of the welcome DM.',
  },
  welcomeDmSupportFallback: {
    default: 'Contact the support team in the server.',
    help: 'Support field of the welcome DM when no support link is configured.',
    kind: 'short',
  },

  // ── Rules & verification ──────────────────────────────────────────────────
  rulesTitle: { default: 'Server rules', help: 'Title of the /rules embed.', kind: 'title' },
  rulesAcceptedNote: {
    default: '✅ You have accepted the rules.',
    help: 'Note under the rules once the member accepted them.',
  },
  rulesAckNote: {
    default: 'Please press **I accept** to confirm you have read the rules.',
    help: 'Note under the rules when accepting them is required.',
  },
  rulesVerifyNote: {
    default: 'Press **Verify** to finish onboarding.',
    help: 'Note under the rules when the member still needs to verify.',
  },
  acceptButton: { default: 'I accept', help: 'Button to accept the rules.', kind: 'label' },
  verifyButton: { default: 'Verify', help: 'Button to verify (welcome post and /rules).', kind: 'label' },
  rulesAcceptedTitle: {
    default: 'Thanks for accepting the rules',
    help: 'Reply title after pressing "I accept".',
    kind: 'title',
  },
  rulesAlreadyAcceptedTitle: {
    default: 'Rules already accepted',
    help: 'Reply title after pressing "I accept" a second time.',
    kind: 'title',
  },
  rulesNextVerify: {
    default: 'One more step: press **Verify** to finish onboarding.',
    help: 'Reply after accepting the rules when verification is still needed.',
  },
  pickGamesHint: {
    default: 'Pick the games you play below, or use `/roles` any time.',
    help: 'Hint after accepting the rules or verifying, above the games picker.',
  },
  verifiedTitle: { default: 'You are verified', help: 'Reply title after verifying.', kind: 'title' },
  alreadyVerifiedTitle: {
    default: 'You are already verified',
    help: 'Reply title when pressing Verify again.',
    kind: 'title',
  },
  verifiedRoleMisconfigured: {
    default: '⚠️ The verified role is misconfigured. Please let the staff team know.',
    help: 'Shown on verify when the configured verified role is unsafe to hand out.',
  },
  interestsPlaceholder: {
    default: 'Which games do you play?',
    help: 'Placeholder of the games picker during onboarding.',
    kind: 'short',
  },
  interestsSavedTitle: {
    default: 'Interests saved',
    help: 'Reply title after picking games.',
    kind: 'title',
  },
  noChangesNeeded: { default: 'No changes needed.', help: 'Reply after picking games when nothing changed.' },

  // ── Self roles (/roles and role panels) ───────────────────────────────────
  selfRolesTitle: { default: 'Self-assignable roles', help: 'Title of the /roles embed.', kind: 'title' },
  selfRolesDescription: {
    default: 'Select a role to toggle it: roles you have are removed, others are added.',
    help: 'Description of the /roles embed.',
  },
  selfRolesEmpty: {
    default: 'No self-assignable roles are configured yet.',
    help: 'Description of the /roles embed when no roles exist.',
  },
  selfRolePlaceholder: {
    default: '{group}: pick roles to add or remove',
    help: 'Placeholder of each /roles picker. {group} is the group name.',
    vars: ['group'],
    kind: 'short',
  },
  roleAdded: {
    default: '➕ Added **{role}**',
    help: 'Result line when a role was added.',
    vars: ['role'],
  },
  roleRemoved: {
    default: '➖ Removed **{role}**',
    help: 'Result line when a role was removed.',
    vars: ['role'],
  },
  yourRolesTitle: { default: 'Your roles', help: 'Reply title after toggling roles.', kind: 'title' },
  noChanges: { default: 'No changes.', help: 'Reply after toggling roles when nothing changed.' },
  roleGone: { default: 'That role no longer exists.', help: 'Shown when a selected role was deleted.' },
  roleGoneTellStaff: {
    default: 'That role no longer exists. Please let the staff team know.',
    help: 'Shown when a role panel button points to a deleted role.',
  },
  roleAboveBot: {
    default: "I can't manage **{role}** because it is above my highest role. Please let the staff team know.",
    help: 'Shown when the bot cannot give a role because of the role order.',
    vars: ['role'],
  },
  roleNoPermission: {
    default: "I don't have permission to change **{role}** right now. Please let the staff team know.",
    help: 'Shown when Discord refuses a role change for missing permissions.',
    vars: ['role'],
  },
  roleChangeFailed: {
    default: 'Something went wrong changing **{role}**. Please try again later.',
    help: 'Shown when a role change fails unexpectedly.',
    vars: ['role'],
  },
  roleNotSelfAssignable: {
    default: 'That role is not self-assignable.',
    help: 'Shown when a member picks a role that is not on the self-role list.',
  },
  roleMismatch: {
    default: 'Role details do not match the selected role.',
    help: 'Shown when the role details do not match the picked role.',
  },
  interestsInvalid: {
    default: 'One or more of those roles is not a selectable game role.',
    help: 'Shown when the games picker contains a role that is not allowed.',
  },
  safetyInvalid: { default: 'Role information is invalid.', help: 'Role safety: unreadable role data.' },
  safetyEveryone: {
    default: 'The @everyone role cannot be self-assigned.',
    help: 'Role safety: the @everyone role was picked.',
  },
  safetyManaged: {
    default: 'Integration/bot-managed roles cannot be self-assigned.',
    help: 'Role safety: the role belongs to an integration or bot.',
  },
  safetyHierarchy: {
    default: "That role is at or above the bot's highest role, so the bot cannot assign it.",
    help: "Role safety: the role is above the bot's highest role.",
  },
  safetyDangerous: {
    default: 'Roles with privileged permissions ({permissions}) can never be self-assigned.',
    help: 'Role safety: the role has privileged permissions. {permissions} lists them.',
    vars: ['permissions'],
  },
  safetyProtected: {
    default: 'Staff, partner and escalation roles cannot be self-assigned.',
    help: 'Role safety: the role is a protected staff/partner/escalation role.',
  },

  // ── Role panels ───────────────────────────────────────────────────────────
  panelIntro: {
    default: 'Click a button to add a role. Click it again to remove it.',
    help: 'Role panel description when the panel has no custom description.',
  },
  panelMoreRoles: {
    default: '{count} more roles are available with `/roles`.',
    help: 'Role panel note when there are more roles than buttons.',
    vars: ['count'],
  },
  panelEmpty: {
    default: 'No roles are available here yet.',
    help: 'Role panel description when it has no roles.',
  },
  panelFooter: {
    default: 'Only you see the confirmation · Roles update instantly',
    help: 'Footer of role panels.',
    kind: 'short',
  },
  panelCreatedTitle: {
    default: 'Role panel created',
    help: 'Reply title after /role-panel create.',
    kind: 'title',
  },
  panelCreatedBody: {
    default:
      'It will appear in {channel} within a few seconds and update itself when roles change.\nMake sure the bot can **View Channel**, **Send Messages** and **Embed Links** there.',
    help: 'Reply after /role-panel create. {channel} is the channel mention.',
    vars: ['channel'],
  },
  panelListTitle: { default: 'Role panels', help: 'Title of /role-panel list.', kind: 'title' },
  panelListEmpty: {
    default: 'No panels yet. Create one with `/role-panel create`.',
    help: '/role-panel list when there are no panels.',
  },
  panelListAllRoles: {
    default: 'all roles',
    help: '/role-panel list: shown for a panel that includes every group.',
    kind: 'short',
  },
  panelListSynced: {
    default: 'synced {time}',
    help: '/role-panel list: panel is posted. {time} is a relative timestamp.',
    vars: ['time'],
    kind: 'short',
  },
  panelListNotPosted: {
    default: 'not posted yet',
    help: '/role-panel list: panel has not been posted.',
    kind: 'short',
  },
  panelRefreshTitle: { default: 'Refreshing', help: 'Reply title after /role-panel refresh.', kind: 'title' },
  panelRefreshOne: {
    default: '{count} panel will update within a few seconds.',
    help: 'Reply after /role-panel refresh for one panel.',
    vars: ['count'],
  },
  panelRefreshMany: {
    default: '{count} panels will update within a few seconds.',
    help: 'Reply after /role-panel refresh for several (or zero) panels.',
    vars: ['count'],
  },
  panelDeletedTitle: {
    default: 'Role panel deleted',
    help: 'Reply title after /role-panel delete.',
    kind: 'title',
  },
  panelDeletedBody: {
    default: 'Its message will be removed within a few seconds.',
    help: 'Reply after /role-panel delete.',
  },

  // ── FAQ ───────────────────────────────────────────────────────────────────
  faqLinksField: { default: 'Links', help: 'Field name for links under an FAQ answer.', kind: 'title' },
  faqMoreHelpField: {
    default: 'Need more help?',
    help: 'Field name for the support hint under an FAQ answer.',
    kind: 'title',
  },
  faqFooter: { default: 'FAQ', help: 'Footer of an FAQ answer without a category.', kind: 'short' },
  faqFooterCategory: {
    default: 'FAQ · {category}',
    help: 'Footer of an FAQ answer. {category} is the category name.',
    vars: ['category'],
    kind: 'short',
  },
  faqHelpfulButton: { default: 'Helpful', help: 'FAQ feedback button (positive).', kind: 'label' },
  faqNotHelpfulButton: { default: 'Not helpful', help: 'FAQ feedback button (negative).', kind: 'label' },
  faqContactSupportButton: {
    default: 'Contact support',
    help: 'Link button to support under an FAQ answer.',
    kind: 'label',
  },
  faqOverviewTitle: {
    default: 'Frequently asked questions',
    help: 'Title of /faq without a query.',
    kind: 'title',
  },
  faqOverviewDescription: {
    default: 'Use `/faq query:<words>` to search, or pick a popular question below.',
    help: 'Description of /faq without a query.',
  },
  faqCategoriesField: {
    default: 'Categories',
    help: 'Field name for FAQ categories in /faq.',
    kind: 'title',
  },
  faqNoCategories: { default: 'No categories yet.', help: '/faq when there are no categories.' },
  faqMostViewedField: { default: 'Most viewed', help: 'Field name for popular FAQs in /faq.', kind: 'title' },
  faqNoEntries: { default: 'No published FAQs yet.', help: '/faq when there are no published FAQs.' },
  faqPickPlaceholder: {
    default: 'Open a question',
    help: 'Placeholder of the FAQ question picker.',
    kind: 'short',
  },
  faqNoMatchTitle: { default: 'No matching FAQ', help: 'Title when /faq finds nothing.', kind: 'title' },
  faqNoMatchBody: {
    default:
      "I couldn't find an answer for that.\nTry different words, browse `/guides`, or use `/troubleshoot`.\n\n{support}",
    help: 'Reply when /faq finds nothing. {support} is the support hint.',
    vars: ['support'],
  },
  faqFeedbackDuplicateTitle: {
    default: 'Already recorded',
    help: 'Title when a member rates the same FAQ answer twice.',
    kind: 'title',
  },
  faqFeedbackDuplicate: {
    default: 'You already gave feedback on this answer. Thanks!',
    help: 'Reply when a member rates the same FAQ answer twice.',
  },
  faqFeedbackThanks: {
    default: 'Thanks for the feedback!',
    help: 'Reply after pressing "Helpful".',
    kind: 'title',
  },
  faqNotHelpfulTitle: {
    default: 'Sorry that didn’t help',
    help: 'Title after pressing "Not helpful".',
    kind: 'title',
  },
  faqNotHelpfulBody: {
    default: 'Try `/troubleshoot` or `/guides`.\n{support}',
    help: 'Reply after pressing "Not helpful". {support} is the support hint.',
    vars: ['support'],
  },

  // ── Guides ────────────────────────────────────────────────────────────────
  guidesTitle: { default: 'Guides', help: 'Title of /guides.', kind: 'title' },
  guidesFilterCategory: {
    default: 'category **{category}**',
    help: '/guides filter description for a category.',
    vars: ['category'],
    kind: 'short',
  },
  guidesFilterGame: {
    default: 'game **{game}**',
    help: '/guides filter description for a game.',
    vars: ['game'],
    kind: 'short',
  },
  guidesFilteredBy: {
    default: 'Filtered by {filters}.',
    help: '/guides: active filters. {filters} lists them.',
    vars: ['filters'],
  },
  guidesShowing: {
    default: 'Showing {shown} of {total}.',
    help: '/guides: how many guides are shown.',
    vars: ['shown', 'total'],
  },
  guidesNoneMatch: {
    default: 'No published guides match {filters}.',
    help: '/guides when no guide matches the filters.',
    vars: ['filters'],
  },
  guidesNoneYet: { default: 'No published guides yet.', help: '/guides when there are no guides.' },
  guidesFooter: {
    default: 'Page {page} of {pageCount}',
    help: 'Footer of /guides.',
    vars: ['page', 'pageCount'],
    kind: 'short',
  },
  guidesPrevButton: { default: 'Previous', help: '/guides previous page button.', kind: 'label' },
  guidesNextButton: { default: 'Next', help: '/guides next page button.', kind: 'label' },

  // ── Raid alert (staff) ────────────────────────────────────────────────────
  raidAlertTitle: {
    default: 'Possible raid detected',
    help: 'Title of the staff raid alert.',
    kind: 'title',
  },
  raidAlertDescription: {
    default: '**{joins}** members joined within {seconds}s (threshold {threshold}).',
    help: 'Description of the staff raid alert.',
    vars: ['joins', 'seconds', 'threshold'],
  },
  raidDetectedField: { default: 'Detected', help: 'Raid alert field: when it was detected.', kind: 'title' },
  raidFlaggedField: {
    default: 'Flagged joiners',
    help: 'Raid alert field: number of flagged joiners.',
    kind: 'title',
  },
  raidActionField: {
    default: 'Automatic action',
    help: 'Raid alert field: what the bot did automatically.',
    kind: 'title',
  },
  raidActionVerify: {
    default: 'New joiners in this window must pass verification. Nobody was kicked or banned.',
    help: 'Raid alert action when verification is enforced.',
  },
  raidActionAlert: {
    default: 'Alert only. Nobody was kicked or banned.',
    help: 'Raid alert action when only alerting.',
  },
  raidAlertFooter: {
    default: 'Review recent joins in the dashboard before taking action.',
    help: 'Footer of the staff raid alert.',
    kind: 'short',
  },
});

/** Display name of a self-role group, resolved at call time. */
export function groupLabel(group: string): string {
  switch (group) {
    case 'games':
      return CommunityText.groupGames();
    case 'community':
      return CommunityText.groupCommunity();
    case 'notifications':
      return CommunityText.groupNotifications();
    default:
      return group;
  }
}
