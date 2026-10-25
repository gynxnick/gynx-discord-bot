import { defineTexts } from '../core/text';

/**
 * Wording of the messages the setup wizard posts (welcome, rules, verify) and
 * of the private setup summary. The rules themselves are WelcomeConfig.rulesText
 * (edited in the welcome settings), so no rule wording lives here.
 */
export const SetupText = defineTexts('setup', {
  welcomeTitle: {
    default: 'Welcome to {server}',
    help: 'Title of the welcome message the setup wizard posts in the welcome channel.',
    vars: ['server'],
    kind: 'title',
  },
  welcomeBody: {
    default:
      'GYNX.GG provides game server hosting. This server is where you can follow announcements, check service status, get help and meet the community.',
    help: 'Introduction in the setup welcome message.',
    kind: 'long',
  },
  welcomeWhereTitle: {
    default: 'Where to find things',
    help: 'Heading of the "where to find things" list in the setup welcome message.',
    kind: 'title',
  },
  welcomeWhereBody: {
    default:
      '• Read the rules and verify to unlock the community channels\n• Announcements and live service status are in START HERE\n• Check whether support is online in SUPPORT CENTER\n• Ask the community and share your projects in COMMUNITY',
    help: 'List of where things are, in the setup welcome message.',
    kind: 'long',
  },
  rulesTitle: {
    default: 'Server rules',
    help: 'Title of the rules message (the rules themselves are edited in the welcome settings).',
    kind: 'title',
  },
  verifyTitle: {
    default: 'Verify to join the community',
    help: 'Title of the verification message.',
    kind: 'title',
  },
  verifyBody: {
    default:
      'Read the rules, then press **Verify** below to unlock the community channels. Verification only confirms you have read the rules; it does not share any personal data.',
    help: 'Instructions in the verification message.',
    kind: 'long',
  },
  summaryTitle: {
    default: 'Server setup: {type} {status}',
    help: 'Title of the private setup summary posted to the setup log channel.',
    vars: ['type', 'status'],
    kind: 'title',
  },
  summaryBody: {
    default:
      'Created {created} · adopted {adopted} · updated {updated} · skipped {skipped} · failed {failed}\nVerification: {verified}\nOperation `{operationId}` by <@{userId}>',
    help: 'Body of the private setup summary. Contains counts only, never server details.',
    vars: ['created', 'adopted', 'updated', 'skipped', 'failed', 'verified', 'operationId', 'userId'],
  },
  summaryVerified: { default: 'passed', help: 'Setup summary: verification passed.', kind: 'short' },
  summaryNotVerified: {
    default: 'needs attention (see the dashboard)',
    help: 'Setup summary: verification found problems.',
    kind: 'short',
  },
  templateTitle: {
    default: 'Announcement title',
    help: 'Title placeholder of the "Official announcement" template the setup wizard creates.',
    kind: 'title',
  },
  templateBody: {
    default: 'Write the announcement here. Keep it short: what changed, who it affects and what to do.',
    help: 'Body placeholder of the "Official announcement" template the setup wizard creates.',
    kind: 'long',
  },
});
