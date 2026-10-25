import type { APIEmbed } from 'discord.js';
import { brandEmbed, community } from '@gynx/services';
import { truncate } from '@gynx/shared';

/** Categorised overview of every command the bot offers (editable bot text, resolved per call). */
export function helpSections(): Array<{ name: string; value: string }> {
  const T = community.CommunityText;
  return [
    { name: T.helpGeneralName(), value: T.helpGeneralBody() },
    { name: T.helpStatusName(), value: T.helpStatusBody() },
    { name: T.helpModerationName(), value: T.helpModerationBody() },
    { name: T.helpTroubleshootingName(), value: T.helpTroubleshootingBody() },
    { name: T.helpGamesName(), value: T.helpGamesBody() },
    { name: T.helpSecurityName(), value: T.helpSecurityBody() },
    { name: T.helpCommunityName(), value: T.helpCommunityBody() },
    { name: T.helpMarketingName(), value: T.helpMarketingBody() },
    { name: T.helpAnalyticsName(), value: T.helpAnalyticsBody() },
  ];
}

export function helpEmbed(supportUrl: string | null): APIEmbed {
  const T = community.CommunityText;
  return brandEmbed({
    title: T.helpTitle(),
    description: T.helpDescription(),
    fields: [
      ...helpSections().map((s) => ({ name: truncate(s.name, 256), value: truncate(s.value, 1024) })),
      { name: T.fieldSupport(), value: community.supportLine(supportUrl) },
    ],
  });
}
