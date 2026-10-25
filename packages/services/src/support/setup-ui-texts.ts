import { defineTexts } from '../core/text';

/** /setup command wording (administrators only). */
export const SetupUiText = defineTexts('setup-ui', {
  // ── Preview ──
  previewTitleStart: {
    default: 'Server setup preview',
    help: '/setup start and preview: title.',
    kind: 'title',
  },
  previewTitleRepair: { default: 'Setup repair preview', help: '/setup repair: title.', kind: 'title' },
  previewTitleUpdate: { default: 'Setup update preview', help: '/setup update: title.', kind: 'title' },
  previewTitleRollback: { default: 'Setup rollback preview', help: '/setup rollback: title.', kind: 'title' },
  summaryLine: {
    default:
      '**{create}** to create · **{adopt}** to adopt · **{update}** to update · **{permissions}** permission changes · **{messages}** messages and panels · **{inPlace}** already in place',
    help: 'Counts at the top of a setup preview.',
    vars: ['create', 'adopt', 'update', 'permissions', 'messages', 'inPlace'],
  },
  nothingToDo: {
    default: 'Everything already matches the blueprint. Nothing would change.',
    help: 'Preview when the plan has no changes.',
  },
  blockedNotice: {
    default: '⛔ **Setup cannot run yet.** Fix the blocking problems listed below, then preview again.',
    help: 'Preview when a blocking finding prevents applying.',
  },
  disruptiveNotice: {
    default:
      '⚠️ **{count}** of these changes affect things members already use. You will be asked to confirm them.',
    help: 'Preview when some changes are disruptive.',
    vars: ['count'],
  },
  readOnlyNotice: {
    default: 'This is a preview only. Nothing has been changed. Use `/setup start` to apply.',
    help: 'Footer line of /setup preview.',
  },
  rolesField: { default: 'Roles', help: 'Preview field: role changes.', kind: 'title' },
  channelsTitle: {
    default: 'Channels by category',
    help: 'Preview embed title: channel changes.',
    kind: 'title',
  },
  otherCategory: {
    default: 'Other',
    help: 'Category label for channel changes outside the blueprint.',
    kind: 'short',
  },
  permissionsField: { default: 'Permissions', help: 'Preview field: permission changes.', kind: 'title' },
  permissionsValue: {
    default: '{overwrites} channel permission changes · {grants} staff dashboard grants',
    help: 'Preview: permission change counts.',
    vars: ['overwrites', 'grants'],
  },
  messagesField: {
    default: 'Messages and panels',
    help: 'Preview field: messages and panels.',
    kind: 'title',
  },
  configField: {
    default: 'Bot configuration',
    help: 'Preview field: channel/role routing and templates.',
    kind: 'title',
  },
  configValue: {
    default: '{bindings} channel and role routings · {templates} templates',
    help: 'Preview: configuration change counts.',
    vars: ['bindings', 'templates'],
  },
  findingsTitle: { default: 'Conflicts and findings', help: 'Preview embed title: findings.', kind: 'title' },
  missingPermsField: {
    default: 'Missing bot permissions',
    help: 'Preview field: missing bot permissions.',
    kind: 'title',
  },
  moreItems: {
    default: '+{count} more',
    help: 'Shown when a list is cut short.',
    vars: ['count'],
    kind: 'short',
  },
  noneValue: { default: 'None', help: 'Empty list value.', kind: 'short' },
  disruptiveTag: { default: '(affects members)', help: 'Tag after a disruptive change.', kind: 'short' },

  // ── Controls ──
  selectPlaceholder: {
    default: 'Choose what to set up',
    help: 'Placeholder of the component picker.',
    kind: 'short',
  },
  confirmButton: {
    default: 'Confirm',
    help: 'Button that applies a previewed setup operation.',
    kind: 'label',
  },
  confirmDisruptiveButton: {
    default: 'Yes, apply these changes',
    help: 'Button on the second confirmation for disruptive changes.',
    kind: 'label',
  },
  cancelButton: { default: 'Cancel', help: 'Button that discards a setup preview.', kind: 'label' },
  disruptivePrompt: {
    default:
      '⚠️ This changes **{count}** things members already use (for example channel names or permissions). Continue?',
    help: 'Second confirmation before disruptive setup changes.',
    vars: ['count'],
  },
  staleNotice: {
    default: 'The server changed since the preview. Review the updated plan below and confirm again.',
    help: 'Shown when a confirmation found the server changed.',
  },
  started: {
    default: 'Setup started (operation `{id}`). Use `/setup status` to follow progress.',
    help: 'Reply after confirming a setup operation.',
    vars: ['id'],
  },
  cancelled: { default: 'Setup cancelled. Nothing was changed.', help: 'Reply after cancelling a preview.' },
  notYourPreview: {
    default: 'Only the administrator who opened this preview can use its controls. Run the command yourself.',
    help: 'Error when someone else presses setup preview buttons.',
  },
  blockedConfirm: {
    default: 'This plan is blocked. Fix the problems listed in the preview first.',
    help: 'Error when confirming a blocked plan.',
  },

  // ── Status ──
  statusTitle: { default: 'Server setup status', help: '/setup status: title.', kind: 'title' },
  statusLine: {
    default: '**{percent}%** complete · status **{status}** · blueprint v{deployed} (latest v{latest})',
    help: '/setup status: first line.',
    vars: ['percent', 'status', 'deployed', 'latest'],
  },
  notDeployed: { default: 'none', help: 'Deployed blueprint version when setup never ran.', kind: 'short' },
  rolesAttention: { default: 'Roles needing attention', help: '/setup status field.', kind: 'title' },
  channelsAttention: { default: 'Channels needing attention', help: '/setup status field.', kind: 'title' },
  panelsField: { default: 'Panels', help: '/setup status field.', kind: 'title' },
  permissionFindingsField: {
    default: 'Permission verification',
    help: '/setup status field.',
    kind: 'title',
  },
  outstandingField: { default: 'Outstanding problems', help: '/setup status field.', kind: 'title' },
  lastOperationField: { default: 'Last operation', help: '/setup status field.', kind: 'title' },
  lastOperationValue: {
    default: '{type} · {status} · started {started}',
    help: '/setup status: last operation.',
    vars: ['type', 'status', 'started'],
  },
  allGood: { default: 'All good', help: '/setup status: nothing needs attention.', kind: 'short' },
  stateMissing: { default: 'missing', help: 'Resource state label.', kind: 'short' },
  stateRenamed: { default: 'renamed', help: 'Resource state label.', kind: 'short' },
  stateDeployed: { default: 'deployed', help: 'Panel state label.', kind: 'short' },
  stateNotConfigured: { default: 'not configured', help: 'Panel state label.', kind: 'short' },
  lastVerified: {
    default: 'Last verified {time}',
    help: '/setup status: last verification.',
    vars: ['time'],
    kind: 'short',
  },
});
