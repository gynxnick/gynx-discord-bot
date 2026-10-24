import type { BotModule } from '../../framework/types';
import { announceCommand, announceComponents, scheduleCommand } from './announce';
import { inviteTrackerEvents } from './invite-tracker';
import { partnerComponents, partnersCommand } from './partners';
import { referralCommand } from './referrals';

/** Announcements (module `announcements`) and referrals & partners (module `referrals`). */
export const marketingModule: BotModule = {
  name: 'marketing',
  commands: [announceCommand, scheduleCommand, referralCommand, partnersCommand],
  components: [announceComponents, partnerComponents],
  events: inviteTrackerEvents,
};
