import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { brandEmbed, security } from '@gynx/services';
import { discordTimestamp, truncate } from '@gynx/shared';
import { respond, replySuccess } from '../../framework/reply';
import type { BotModule } from '../../framework/types';

const categoryChoices = security.REPORT_CATEGORIES.map((c) => ({
  name: security.CATEGORY_LABELS[c],
  value: c,
}));

const reportAbuse = new SlashCommandBuilder()
  .setName('report-abuse')
  .setDescription('Privately report spam, scams, harassment or other abuse to the GYNX team')
  .addStringOption((o) =>
    o
      .setName('category')
      .setDescription('What are you reporting?')
      .setRequired(true)
      .addChoices(...categoryChoices),
  )
  .addUserOption((o) => o.setName('user').setDescription('The member involved (optional)'));

const auditLog = new SlashCommandBuilder()
  .setName('audit-log')
  .setDescription('Show recent security audit events')
  .addStringOption((o) =>
    o.setName('action').setDescription('Action prefix, e.g. moderation. or permissions.'),
  )
  .addUserOption((o) => o.setName('actor').setDescription('Only events by this user'));

export const securityModule: BotModule = {
  name: 'security',
  commands: [
    {
      module: 'security',
      data: reportAbuse.toJSON(),
      async execute(i) {
        const category = i.options.getString('category', true);
        const user = i.options.getUser('user');
        // customId carries only the user's own choices; everything is re-validated on submit.
        const modal = new ModalBuilder()
          .setCustomId(`secreport:submit:${category}:${user?.id ?? '-'}`)
          .setTitle('Private report')
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('description')
                .setLabel('What happened?')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(20)
                .setMaxLength(2000)
                .setPlaceholder('Never include passwords or account credentials.')
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('evidence')
                .setLabel('Evidence links (https, one per line, max 5)')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1500)
                .setRequired(false),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('message')
                .setLabel('Discord message link (optional)')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(200)
                .setRequired(false),
            ),
          );
        await i.showModal(modal);
      },
    },
    {
      module: 'security',
      data: auditLog.toJSON(),
      async execute(i, h) {
        await i.deferReply({ flags: 64 });
        const page = await security.searchAuditLog(h.ctx, {
          action: i.options.getString('action') ?? undefined,
          actorId: i.options.getUser('actor')?.id,
          limit: 15,
        });
        const lines = page.items.map(
          (e) =>
            `${discordTimestamp(e.createdAt, 'R')} **${e.action}** · ${e.actorId === 'system' ? 'system' : `<@${e.actorId}>`} · ${e.result}${e.targetId ? ` · \`${truncate(e.targetId, 24)}\`` : ''}`,
        );
        await respond(i, {
          embeds: [
            brandEmbed({
              title: 'Security audit log',
              description: lines.join('\n') || 'No matching events.',
            }),
          ],
        });
      },
    },
  ],
  components: [
    {
      prefix: 'secreport',
      module: 'security',
      async handle(i, args, h) {
        const [action, ...rest] = args;
        if (action === 'submit' && i.isModalSubmit()) {
          const [category, userId] = rest;
          const evidence = i.fields
            .getTextInputValue('evidence')
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const message = i.fields.getTextInputValue('message').trim();
          const report = await security.submitReport(h.ctx, {
            category: category as (typeof security.REPORT_CATEGORIES)[number],
            reportedUserId: userId && userId !== '-' ? userId : undefined,
            description: i.fields.getTextInputValue('description'),
            evidenceUrls: evidence,
            messageLink: message || undefined,
          });
          await replySuccess(
            i,
            `Report ${report.ref} received`,
            'Thank you. Your report is private and only visible to authorised GYNX staff. We may contact you if we need more information.',
          );
          return;
        }
        if (action === 'claim' && i.isButton()) {
          const report = await security.claimReport(h.ctx, rest[0] ?? '');
          await i.update({
            content: `🛡️ Claimed by <@${h.ctx.actor.userId}> · status **${report.status.toLowerCase()}**`,
            allowedMentions: { parse: [] },
            components: [],
          });
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
  ],
};
