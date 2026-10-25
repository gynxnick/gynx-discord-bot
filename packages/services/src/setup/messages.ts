import type { WelcomeConfig } from '@gynx/database';
import { neutraliseMentions } from '@gynx/shared';
import { onboardingButtons } from '../community/render';
import type { MessageBody } from '../core/discord-port';
import { NO_MENTIONS } from '../core/discord-port';
import { brandEmbed } from '../core/render';
import type { PanelKey } from './blueprint';
import { SetupText as T } from './texts';

/**
 * The static messages the setup wizard posts. Wording is editable (`setup.*`
 * texts); the rules are WelcomeConfig.rulesText (welcome settings). These
 * messages describe the server only: no legal terms, no promised outcomes.
 * The verify button reuses the community onboarding customId (`onboard:verify`),
 * which the community module already handles.
 */
export function renderSetupMessage(
  panel: Extract<PanelKey, 'welcome' | 'rules' | 'verify'>,
  ctx: { serverName: string; welcome: WelcomeConfig },
): MessageBody {
  if (panel === 'welcome') {
    return {
      embeds: [
        brandEmbed({
          title: T.welcomeTitle({ server: ctx.serverName }),
          description: T.welcomeBody(),
          fields: [{ name: T.welcomeWhereTitle(), value: T.welcomeWhereBody() }],
        }),
      ],
      allowed_mentions: NO_MENTIONS,
    };
  }
  if (panel === 'rules') {
    return {
      embeds: [brandEmbed({ title: T.rulesTitle(), description: neutraliseMentions(ctx.welcome.rulesText) })],
      allowed_mentions: NO_MENTIONS,
    };
  }
  return {
    embeds: [brandEmbed({ title: T.verifyTitle(), description: T.verifyBody() })],
    components: onboardingButtons({ showAccept: ctx.welcome.requireRulesAck, showVerify: true }),
    allowed_mentions: NO_MENTIONS,
  };
}
