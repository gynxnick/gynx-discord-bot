import { defineTexts } from './text';

/** Framework-wide wording shared by every module. */
export const CoreText = defineTexts('core', {
  embedFooter: {
    default: 'GYNX.GG',
    help: 'Footer shown under most bot embeds.',
    kind: 'short',
  },
  errorTitle: {
    default: 'Something went wrong',
    help: 'Title of every error message the bot replies with.',
    kind: 'title',
  },
  genericError: {
    default: 'Something went wrong on our side. The team has been notified.\nReference: `{reference}`',
    help: 'Shown when an unexpected error happens. {reference} helps staff find it in the logs.',
    vars: ['reference'],
  },
  forbidden: {
    default: 'You do not have permission to do that.',
    help: 'Shown when a member uses something their roles do not allow.',
  },
  rateLimited: {
    default: "You're doing that too often. Try again in {seconds}s.",
    help: 'Shown when a member hits a rate limit.',
    vars: ['seconds'],
  },
  guildOnly: {
    default: 'This bot only works inside the GYNX.GG server.',
    help: 'Shown when someone uses the bot in DMs or another server.',
  },
  controlExpired: {
    default: 'This control is no longer active.',
    help: 'Shown when someone clicks an old button or menu.',
  },
  unknownCommand: {
    default: 'Unknown command.',
    help: 'Shown for a command the bot no longer has.',
  },
  moduleDisabled: {
    default: 'The {module} module is disabled on this server.',
    help: 'Shown when a feature has been switched off in settings.',
    vars: ['module'],
  },
});
