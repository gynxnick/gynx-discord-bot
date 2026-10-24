import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed, marketing } from '@gynx/services';
import { AppError, discordTimestamp, truncate } from '@gynx/shared';
import { replySuccess, respond } from '../../framework/reply';
import type { SlashCommand } from '../../framework/types';

const data = new SlashCommandBuilder()
  .setName('referral')
  .setDescription('Invite friends to the community and see your referrals')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Get your personal invite link (staff: create a campaign invite)')
      .addStringOption((o) => o.setName('campaign').setDescription('Campaign name (staff only)').setMaxLength(64)),
  )
  .addSubcommand((s) => s.setName('stats').setDescription('Your referral counts'))
  .addSubcommand((s) =>
    s
      .setName('leaderboard')
      .setDescription('Top referrers (confirmed, valid referrals only)')
      .addStringOption((o) =>
        o.setName('period').setDescription('Time period').addChoices({ name: 'Last 7 days', value: '7' }, { name: 'Last 30 days', value: '30' }, { name: 'All time', value: 'all' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('review')
      .setDescription('Staff: review flagged referrals')
      .addStringOption((o) => o.setName('id').setDescription('Referral id (leave empty to list flagged referrals)').setMaxLength(64))
      .addStringOption((o) => o.setName('decision').setDescription('Outcome').addChoices({ name: 'Valid', value: 'VALID' }, { name: 'Invalid', value: 'INVALID' }, { name: 'Disputed', value: 'DISPUTED' }))
      .addStringOption((o) => o.setName('note').setDescription('Review note (required with a decision)').setMaxLength(500)),
  );

export const referralCommand: SlashCommand = {
  module: 'referrals',
  data: data.toJSON(),
  async execute(i, h) {
    const sub = i.options.getSubcommand(true);

    if (sub === 'create') {
      await i.deferReply({ flags: 64 });
      const channelId = i.guild?.rulesChannelId ?? i.guild?.systemChannelId ?? i.channelId;
      const { invite, created } = await marketing.createReferralInvite(h.ctx, { channelId, campaign: i.options.getString('campaign') ?? undefined });
      await respond(i, {
        embeds: [
          brandEmbed({
            title: invite.campaign ? `Campaign invite · ${truncate(invite.campaign, 80)}` : created ? 'Your personal invite' : 'Your personal invite (existing)',
            description: `https://discord.gg/${invite.code}\n\nWhen someone joins with this link we credit you only if we can confirm it was your invite. Joins from new accounts, rejoins or bursts are reviewed by staff first.`,
            footer: 'Referrals are for community growth only — there are no rewards or payouts.',
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
            title: 'Your referrals',
            fields: [
              { name: 'Confirmed', value: String(s.valid), inline: true },
              { name: 'Last 30 days', value: String(s.validLast30Days), inline: true },
              { name: 'Under review', value: String(s.underReview), inline: true },
              { name: 'Not counted', value: String(s.invalid), inline: true },
              { name: 'Your invites', value: s.invites.length ? s.invites.map((inv) => `discord.gg/${inv.code}${inv.campaign ? ` (${inv.campaign})` : ''}`).join('\n') : 'None yet — use `/referral create`.' },
            ],
            footer: 'Only joins we can attribute with certainty are counted.',
          }),
        ],
      });
      return;
    }

    if (sub === 'leaderboard') {
      const period = (i.options.getString('period') ?? '30') as marketing.LeaderboardPeriod;
      const rows = await marketing.referralLeaderboard(h.ctx, period);
      const label = period === 'all' ? 'All time' : `Last ${period} days`;
      await respond(i, {
        ephemeral: false,
        embeds: [
          brandEmbed({
            title: `Referral leaderboard · ${label}`,
            description: rows.length ? rows.map((r) => `**${r.rank}.** <@${r.referrerId}> — ${r.referrals}`).join('\n') : 'No confirmed referrals in this period yet.',
            footer: 'Confirmed and reviewed referrals only.',
          }),
        ],
      });
      return;
    }

    if (sub === 'review') {
      const id = i.options.getString('id');
      if (!id) {
        const page = await marketing.listAttributions(h.ctx, { status: 'FLAGGED', limit: 15 });
        const lines = page.items.map((r) => `\`${r.id}\` · <@${r.joinedUserId}> via <@${r.referrerId ?? '0'}> · ${discordTimestamp(r.joinedAt, 'R')}\n> ${truncate(r.flagReason ?? 'flagged', 150)}`);
        await respond(i, { embeds: [brandEmbed({ title: 'Flagged referrals', description: lines.join('\n') || 'Nothing to review.' })] });
        return;
      }
      const decision = i.options.getString('decision') as 'VALID' | 'INVALID' | 'DISPUTED' | null;
      const note = i.options.getString('note');
      if (!decision || !note) throw new AppError('VALIDATION', 'Provide both a decision and a note.');
      const r = await marketing.reviewAttribution(h.ctx, id, { status: decision, note });
      await replySuccess(i, 'Referral reviewed', `Marked **${r.status.toLowerCase()}**.`);
    }
  },
};
