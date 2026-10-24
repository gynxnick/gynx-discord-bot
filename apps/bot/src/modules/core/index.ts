import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed } from '@gynx/services';
import { BRAND } from '@gynx/shared';
import { respond } from '../../framework/reply';
import type { BotModule } from '../../framework/types';

const about: BotModule['commands'] = [
  {
    module: 'core',
    data: new SlashCommandBuilder().setName('about').setDescription('About the GYNX.GG bot').toJSON(),
    async execute(i, h) {
      const cfg = await h.ctx.db.guildConfig.findUnique({ where: { guildId: h.ctx.guildId } });
      await respond(i, {
        embeds: [
          brandEmbed({
            title: `${BRAND.name} Community Bot`,
            description:
              'Status updates, onboarding, FAQs, troubleshooting help, game utilities, events and more for the GYNX.GG community.\n\nThe bot never touches game servers, panels or billing.',
            fields: [
              { name: 'Website', value: BRAND.url, inline: true },
              ...(cfg?.supportUrl ? [{ name: 'Support', value: cfg.supportUrl, inline: true }] : []),
              { name: 'Commands', value: 'Use `/help` to see everything you can do.', inline: false },
            ],
          }),
        ],
      });
    },
  },
];

export const coreModule: BotModule = { name: 'core', commands: about };
