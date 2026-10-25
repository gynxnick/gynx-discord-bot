import type { Logger } from '@gynx/config';
import type { Db } from '@gynx/database';
import type { DiscordPort } from '../core/discord-port';

/**
 * Staff-facing duty-control panel (private channel): Go On Duty, Go Off Duty,
 * My Status, View On-Duty Team. Buttons call the existing duty service, which
 * updates the customer-facing support status panel.
 *
 * CONTRACT FILE: signatures are fixed; implemented by the bot/duty-panel work.
 */

/** customId prefix for the panel's buttons (handled in apps/bot/src/modules/support). */
export const DUTY_PANEL_PREFIX = 'dutypanel';

export type DutyPanelResult = 'disabled' | 'posted' | 'edited' | 'unchanged' | 'reposted' | 'no_access';

/** Post or edit the duty-control panel in GuildConfig.dutyPanelChannelId; stores GuildConfig.dutyPanelMessage. */
export async function syncDutyControlPanel(
  _deps: { db: Db; discord: DiscordPort; log: Logger },
  _guildId: string,
  _now: Date,
): Promise<DutyPanelResult> {
  throw new Error('duty control panel not implemented yet');
}
