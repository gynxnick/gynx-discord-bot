import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed, support } from '@gynx/services';
import { discordTimestamp } from '@gynx/shared';
import { respond, replySuccess } from '../../framework/reply';
import { on, type BotModule } from '../../framework/types';

/**
 * /duty: staff availability for the public support status panel.
 * Availability only: this module never creates or manages tickets.
 */
const T = support.SupportText;

const duty = new SlashCommandBuilder()
  .setName('duty')
  .setDescription('Go on or off support duty (shown on the public support status panel)')
  .addSubcommand((s) => s.setName('on').setDescription('Go on duty'))
  .addSubcommand((s) => s.setName('off').setDescription('Go off duty'))
  .addSubcommand((s) => s.setName('status').setDescription('Who is on duty right now'))
  .addSubcommand((s) =>
    s
      .setName('end')
      .setDescription("End another staff member's duty session (support leads)")
      .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('profile')
      .setDescription('Approved public names shown to customers (support leads)')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Approve or rename the public name shown on the panel')
          .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
          .addStringOption((o) =>
            o.setName('name').setDescription('Public name, e.g. Alex').setRequired(true).setMaxLength(32),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Stop a staff member from going on duty')
          .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List approved public names')),
  );

export const supportModule: BotModule = {
  name: 'support',
  commands: [
    {
      module: 'support',
      data: duty.toJSON(),
      async execute(i, h) {
        const group = i.options.getSubcommandGroup(false);
        const sub = i.options.getSubcommand();

        if (group === 'profile') {
          if (sub === 'set') {
            const user = i.options.getUser('user', true);
            const p = await support.setDutyProfile(h.ctx, {
              userId: user.id,
              publicName: i.options.getString('name', true),
            });
            await replySuccess(i, T.profileSaved({ user: `<@${user.id}>`, name: p.publicName }));
            return;
          }
          if (sub === 'remove') {
            const user = i.options.getUser('user', true);
            await support.removeDutyProfile(h.ctx, user.id);
            await replySuccess(i, T.profileRemoved({ user: `<@${user.id}>` }));
            return;
          }
          const profiles = await support.listDutyProfiles(h.ctx);
          await respond(i, {
            embeds: [
              brandEmbed({
                title: T.profilesTitle(),
                description:
                  profiles
                    .map((p) => `${p.enabled ? '✅' : '⛔'} **${p.publicName}** · <@${p.userId}>`)
                    .join('\n') || T.profilesNone(),
              }),
            ],
          });
          return;
        }

        if (sub === 'on') {
          const r = await support.startDuty(h.ctx);
          await replySuccess(i, T.dutyStarted({ name: r.publicName, hours: r.hours }));
          return;
        }
        if (sub === 'off') {
          await support.endDuty(h.ctx);
          await replySuccess(i, T.dutyEnded());
          return;
        }
        if (sub === 'end') {
          const user = i.options.getUser('user', true);
          const name = await support.endDutyFor(h.ctx, user.id);
          await replySuccess(i, T.adminEnded({ name }));
          return;
        }

        // status
        const list = await support.listOnDuty(h.ctx.db, h.ctx.guildId, h.ctx.now());
        await respond(i, {
          embeds: [
            brandEmbed({
              title: T.statusTitle(),
              description:
                list
                  .map((e) =>
                    T.statusLine({
                      name: e.publicName,
                      since: discordTimestamp(e.startedAt, 'R'),
                      ends: discordTimestamp(e.expiresAt, 't'),
                    }),
                  )
                  .join('\n') || T.statusNone(),
            }),
          ],
        });
      },
    },
  ],
  events: [
    // Staff who leave the server go off duty immediately.
    on('guildMemberRemove', async (rt, member) => {
      if (member.guild.id !== rt.env.DISCORD_GUILD_ID) return;
      const ended = await support.endDutyOnLeave(rt.deps.db, member.guild.id, member.id, new Date());
      if (ended) rt.log.info({ userId: member.id }, 'duty session ended: member left the server');
    }),
  ],
};
