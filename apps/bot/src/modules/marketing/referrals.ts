import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed, marketing } from '@gynx/services';
import { AppError, discordTimestamp, truncate } from '@gynx/shared';
import { replySuccess, respond } from '../../framework/reply';
import type { SlashCommand } from '../../framework/types';

const T = marketing.MarketingText;

const data = new SlashCommandBuilder()
  .setName('referral')
  .setDescription('Invite friends to the community and see your referrals')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Get your personal invite link (staff: create a campaign invite)')
      .addStringOption((o) =>
        o.setName('campaign').setDescription('Campaign name (staff only)').setMaxLength(64),
      ),
  )
  .addSubcommand((s) => s.setName('stats').setDescription('Your referral counts'))
  .addSubcommand((s) =>
    s
      .setName('leaderboard')
      .setDescription('Top referrers (confirmed, valid referrals only)')
      .addStringOption((o) =>
        o
          .setName('period')
          .setDescription('Time period')
          .addChoices(
            { name: 'Last 7 days', value: '7' },
            { name: 'Last 30 days', value: '30' },
            { name: 'All time', value: 'all' },
          ),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('review')
      .setDescription('Staff: review flagged referrals')
      .addStringOption((o) =>
        o
          .setName('id')
          .setDescription('Referral id (leave empty to list flagged referrals)')
          .setMaxLength(64),
      )
      .addStringOption((o) =>
        o
          .setName('decision')
          .setDescription('Outcome')
          .addChoices(
            { name: 'Valid', value: 'VALID' },
            { name: 'Invalid', value: 'INVALID' },
            { name: 'Disputed', value: 'DISPUTED' },
          ),
      )
      .addStringOption((o) =>
        o.setName('note').setDescription('Review note (required with a decision)').setMaxLength(500),
      ),
  );

export const referralCommand: SlashCommand = {
  module: 'referrals',
  data: data.toJSON(),
  async execute(i, h) {
    const sub = i.options.getSubcommand(true);

    if (sub === 'create') {
      await i.deferReply({ flags: 64 });
      const channelId = i.guild?.rulesChannelId ?? i.guild?.systemChannelId ?? i.channelId;
      const { invite, created } = await marketing.createReferralInvite(h.ctx, {
        channelId,
        campaign: i.options.getString('campaign') ?? undefined,
      });
      await respond(i, {
        embeds: [
          brandEmbed({
            title: invite.campaign
              ? T.inviteCampaignTitle({ campaign: truncate(invite.campaign, 80) })
              : created
                ? T.inviteTitleNew()
                : T.inviteTitleExisting(),
            description: `https://discord.gg/${invite.code}\n\n${T.inviteExplainer()}`,
            footer: T.inviteFooter(),
          }),
        ],
      });
      return;
    }

    if (sub === 'stats') {
      const s = await marketing.myReferralStats(h.ctx);
      await respond(i, {
        embeds: [
          brandEmbed({
            title: T.statsTitle(),
            fields: [
              { name: T.statsConfirmed(), value: String(s.valid), inline: true },
              { name: T.statsLast30Days(), value: String(s.validLast30Days), inline: true },
              { name: T.statsUnderReview(), value: String(s.underReview), inline: true },
              { name: T.statsNotCounted(), value: String(s.invalid), inline: true },
              {
                name: T.statsInvites(),
                value: s.invites.length
                  ? s.invites
                      .map((inv) => `discord.gg/${inv.code}${inv.campaign ? ` (${inv.campaign})` : ''}`)
                      .join('\n')
                  : T.statsNoInvites(),
              },
            ],
            footer: T.statsFooter(),
          }),
        ],
      });
      return;
    }

    if (sub === 'leaderboard') {
      const period = (i.options.getString('period') ?? '30') as marketing.LeaderboardPeriod;
      const rows = await marketing.referralLeaderboard(h.ctx, period);
      const label = period === 'all' ? T.leaderboardAllTime() : T.leaderboardLastDays({ days: period });
      await respond(i, {
        ephemeral: false,
        embeds: [
          brandEmbed({
            title: T.leaderboardTitle({ period: label }),
            description: rows.length
              ? rows
                  .map((r) =>
                    T.leaderboardLine({ rank: r.rank, user: `<@${r.referrerId}>`, count: r.referrals }),
                  )
                  .join('\n')
              : T.leaderboardEmpty(),
            footer: T.leaderboardFooter(),
          }),
        ],
      });
      return;
    }

    if (sub === 'review') {
      const id = i.options.getString('id');
      if (!id) {
        const page = await marketing.listAttributions(h.ctx, { status: 'FLAGGED', limit: 15 });
        const lines = page.items.map((r) =>
          T.flaggedLine({
            id: r.id,
            member: `<@${r.joinedUserId}>`,
            referrer: `<@${r.referrerId ?? '0'}>`,
            time: discordTimestamp(r.joinedAt, 'R'),
            reason: truncate(r.flagReason ?? T.flaggedDefaultReason(), 150),
          }),
        );
        await respond(i, {
          embeds: [
            brandEmbed({ title: T.flaggedTitle(), description: lines.join('\n') || T.flaggedEmpty() }),
          ],
        });
        return;
      }
      const decision = i.options.getString('decision') as 'VALID' | 'INVALID' | 'DISPUTED' | null;
      const note = i.options.getString('note');
      if (!decision || !note) throw new AppError('VALIDATION', T.reviewNeedsDecisionAndNote());
      const r = await marketing.reviewAttribution(h.ctx, id, { status: decision, note });
      await replySuccess(i, T.reviewedTitle(), T.reviewedBody({ status: r.status.toLowerCase() }));
    }
  },
};
