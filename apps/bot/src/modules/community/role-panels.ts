import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { brandEmbed, community } from '@gynx/services';
import { discordTimestamp, truncate } from '@gynx/shared';
import { respond, replySuccess } from '../../framework/reply';
import type { SlashCommand } from '../../framework/types';

const GROUP_CHOICES = [
  { name: 'All roles', value: 'all' },
  ...community.SELF_ROLE_GROUPS.map((g) => ({ name: community.GROUP_LABELS[g] ?? g, value: g })),
];

const panelOption = (o: import('discord.js').SlashCommandStringOption) =>
  o.setName('panel').setDescription('Which panel').setRequired(true).setAutocomplete(true);

/** /role-panel: staff manage the public self-role button panels. */
export const rolePanelCommand: SlashCommand = {
  module: 'community',
  data: new SlashCommandBuilder()
    .setName('role-panel')
    .setDescription('Post and manage self-role button panels')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Post a panel with one button per self-assignable role')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post it (members should be able to see it)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('group')
            .setDescription('Which roles to show (default: all)')
            .addChoices(...GROUP_CHOICES),
        )
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(100))
        .addStringOption((o) =>
          o.setName('description').setDescription('Text above the buttons').setMaxLength(1000),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List role panels'))
    .addSubcommand((s) =>
      s
        .setName('refresh')
        .setDescription('Re-post or update panels now')
        .addStringOption((o) =>
          o.setName('panel').setDescription('One panel (default: all)').setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('delete').setDescription('Delete a panel and its message').addStringOption(panelOption),
    )
    .toJSON(),

  async autocomplete(i, h) {
    const panels = await community.listRolePanels(h.ctx);
    const q = i.options.getFocused().toLowerCase();
    await i.respond(
      panels
        .filter((p) => p.title.toLowerCase().includes(q) || p.channelId.includes(q))
        .slice(0, 25)
        .map((p) => ({
          name: truncate(
            `${p.title} · #${i.guild?.channels.cache.get(p.channelId)?.name ?? p.channelId}`,
            100,
          ),
          value: p.id,
        })),
    );
  },

  async execute(i, h) {
    const sub = i.options.getSubcommand();

    if (sub === 'create') {
      const channel = i.options.getChannel('channel', true);
      const group = i.options.getString('group') ?? 'all';
      const panel = await community.createRolePanel(h.ctx, {
        channelId: channel.id,
        title: i.options.getString('title') ?? undefined,
        description: i.options.getString('description') ?? undefined,
        groups: group === 'all' ? [] : [group as community.SelfRoleGroup],
      });
      await replySuccess(
        i,
        'Role panel created',
        `It will appear in <#${panel.channelId}> within a few seconds and update itself when roles change.\n` +
          'Make sure the bot can **View Channel**, **Send Messages** and **Embed Links** there.',
      );
      return;
    }

    if (sub === 'list') {
      const panels = await community.listRolePanels(h.ctx);
      const lines = panels.map(
        (p) =>
          `**${truncate(p.title, 60)}** · <#${p.channelId}> · ${p.groups.length ? p.groups.join(', ') : 'all roles'} · ${
            p.messageId ? `synced ${p.syncedAt ? discordTimestamp(p.syncedAt, 'R') : ''}` : 'not posted yet'
          }`,
      );
      await respond(i, {
        embeds: [
          brandEmbed({
            title: 'Role panels',
            description: lines.join('\n') || 'No panels yet. Create one with `/role-panel create`.',
          }),
        ],
      });
      return;
    }

    if (sub === 'refresh') {
      const n = await community.refreshRolePanels(h.ctx, i.options.getString('panel') ?? undefined);
      await replySuccess(
        i,
        'Refreshing',
        `${n} panel${n === 1 ? '' : 's'} will update within a few seconds.`,
      );
      return;
    }

    if (sub === 'delete') {
      await community.deleteRolePanel(h.ctx, i.options.getString('panel', true));
      await replySuccess(i, 'Role panel deleted', 'Its message will be removed within a few seconds.');
    }
  },
};
