import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed, community } from '@gynx/services';
import { BRAND } from '@gynx/shared';
import { respond } from '../../framework/reply';
import type { BotModule } from '../../framework/types';

const about: BotModule['commands'] = [
  {
    module: 'core',
    data: new SlashCommandBuilder().setName('about').setDescription('About the GYNX.GG bot').toJSON(),
    async execute(i, h) {
      const cfg = await h.ctx.db.guildConfig.findUnique({ where: { guildId: h.ctx.guildId } });
      const T = community.CommunityText;
      await respond(i, {
        embeds: [
          brandEmbed({
            title: T.aboutTitle({ brand: BRAND.name }),
            description: T.aboutDescription(),
            fields: [
              { name: T.aboutWebsiteField(), value: BRAND.url, inline: true },
              ...(cfg?.supportUrl ? [{ name: T.fieldSupport(), value: cfg.supportUrl, inline: true }] : []),
              { name: T.aboutCommandsField(), value: T.aboutCommandsValue(), inline: false },
            ],
          }),
        ],
      });
    },
  },
];

export const coreModule: BotModule = { name: 'core', commands: about };
