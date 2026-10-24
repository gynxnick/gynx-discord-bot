import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { brandEmbed, marketing } from '@gynx/services';
import { AppError, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { replySuccess, respond } from '../../framework/reply';
import type { ComponentHandler, SlashCommand } from '../../framework/types';

type Category = (typeof marketing.PARTNER_CATEGORIES)[number];

const data = new SlashCommandBuilder()
  .setName('partners')
  .setDescription('Partner programme')
  .addSubcommand((s) => s.setName('apply').setDescription('Apply to become a GYNX.GG partner'))
  .addSubcommand((s) => s.setName('status').setDescription('The status of your partner applications'))
  .addSubcommand((s) => s.setName('review-queue').setDescription('Staff: open partner applications'));

export const partnersCommand: SlashCommand = {
  module: 'referrals',
  data: data.toJSON(),
  async execute(i, h) {
    const sub = i.options.getSubcommand(true);
    if (sub === 'apply') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('partner:cat')
        .setPlaceholder('What kind of partner are you?')
        .addOptions(
          marketing.PARTNER_CATEGORIES.map((c) => ({
            label: marketing.PARTNER_CATEGORY_LABELS[c],
            value: c,
          })),
        );
      await respond(i, {
        content:
          'Choose the category that fits you best. Never include passwords or private account details in your answers.',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
      return;
    }
    if (sub === 'status') {
      const apps = await marketing.myPartnerApplications(h.ctx);
      const lines = apps.map(
        (a) =>
          `**${a.ref}** · ${marketing.PARTNER_CATEGORY_LABELS[a.category]} · ${a.status.replace('_', ' ').toLowerCase()} · ${discordTimestamp(a.createdAt, 'R')}${a.decisionNote ? `\n> ${neutraliseMentions(truncate(a.decisionNote, 300))}` : ''}`,
      );
      await respond(i, {
        embeds: [
          brandEmbed({
            title: 'Your partner applications',
            description: lines.join('\n') || 'You have not applied yet. Use `/partners apply`.',
          }),
        ],
      });
      return;
    }
    if (sub === 'review-queue') {
      const [pending, review] = await Promise.all([
        marketing.listPartnerApplications(h.ctx, { status: 'PENDING', limit: 5 }),
        marketing.listPartnerApplications(h.ctx, { status: 'UNDER_REVIEW', limit: 5 }),
      ]);
      const items = [...review.items, ...pending.items].slice(0, 5);
      const lines = items.map(
        (a) =>
          `**${a.ref}** · ${marketing.PARTNER_CATEGORY_LABELS[a.category]} · <@${a.applicantId}> · ${a.status === 'UNDER_REVIEW' ? `in review by <@${a.reviewerId}>` : 'pending'} · ${discordTimestamp(a.createdAt, 'R')}`,
      );
      await respond(i, {
        embeds: [
          brandEmbed({
            title: 'Partner review queue',
            description: lines.join('\n') || 'No open applications.',
          }),
        ],
        components: items.map((a) => marketing.partnerStaffButtons(a)[0]!),
      });
    }
  },
};

const isCategory = (v: string | undefined): v is Category =>
  !!v && (marketing.PARTNER_CATEGORIES as readonly string[]).includes(v);

export const partnerComponents: ComponentHandler = {
  prefix: 'partner',
  module: 'referrals',
  async handle(i, args, h) {
    const [action, ...rest] = args;

    if (action === 'cat' && i.isStringSelectMenu()) {
      const category = i.values[0];
      if (!isCategory(category)) throw new AppError('VALIDATION', 'Unknown category.');
      const modal = new ModalBuilder()
        .setCustomId(`partner:apply:${category}`)
        .setTitle(`Partner application · ${marketing.PARTNER_CATEGORY_LABELS[category]}`.slice(0, 45));
      for (const q of marketing.PARTNER_QUESTIONS[category]) {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(q.id)
              .setLabel(q.label)
              .setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
              .setMaxLength(q.maxLength)
              .setRequired(q.required)
              .setPlaceholder(q.placeholder ?? ''),
          ),
        );
      }
      await i.showModal(modal);
      return;
    }

    if (action === 'apply' && i.isModalSubmit()) {
      const category = rest[0];
      if (!isCategory(category)) throw new AppError('VALIDATION', 'Unknown category.');
      const answers = Object.fromEntries(
        marketing.PARTNER_QUESTIONS[category].map((q) => [q.id, i.fields.getTextInputValue(q.id)]),
      );
      const app = await marketing.submitPartnerApplication(h.ctx, { category, answers });
      await replySuccess(
        i,
        `Application ${app.ref} received`,
        'Thanks for applying! Our team will review it and you will get a DM with the outcome. Check progress with `/partners status`.',
      );
      return;
    }

    const id = rest[0] ?? '';
    if (action === 'start' && i.isButton()) {
      const app = await marketing.startPartnerReview(h.ctx, id);
      await respond(i, { content: `You are now reviewing **${app.ref}**.` });
      return;
    }

    if ((action === 'approve' || action === 'reject') && i.isButton()) {
      // Permission re-checked on submit by the service; fail early for clarity.
      if (!h.ctx.actor.permissions.has('partners.review'))
        throw new AppError('FORBIDDEN', 'You do not have permission to do that.');
      const approve = action === 'approve';
      const modal = new ModalBuilder()
        .setCustomId(`partner:decide:${id}:${approve ? 'A' : 'R'}`)
        .setTitle(approve ? 'Approve application' : 'Reject application')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('note')
              .setLabel('Message to the applicant')
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(3)
              .setMaxLength(1000)
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('internal')
              .setLabel('Internal notes (staff only)')
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(2000)
              .setRequired(false),
          ),
        );
      if (approve) {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('campaign')
              .setLabel('Campaign name (optional)')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(80)
              .setRequired(false),
          ),
        );
      }
      await i.showModal(modal);
      return;
    }

    if (action === 'decide' && i.isModalSubmit()) {
      const approve = rest[1] === 'A';
      const campaignName = approve ? i.fields.getTextInputValue('campaign').trim() : '';
      const { application, campaign } = await marketing.decidePartnerApplication(h.ctx, id, {
        decision: approve ? 'APPROVED' : 'REJECTED',
        decisionNote: i.fields.getTextInputValue('note'),
        internalNotes: i.fields.getTextInputValue('internal').trim() || undefined,
        campaignName: campaignName || undefined,
      });
      await replySuccess(
        i,
        `${application.ref} ${approve ? 'approved' : 'rejected'}`,
        approve
          ? `Campaign “${campaign?.name}” created (announcing disabled). The applicant will be DMed and given the partner role if it is configured and safe.`
          : 'The applicant will be notified by DM.',
      );
      return;
    }

    if (i.isRepliable()) await respond(i, { content: 'This control is no longer active.' });
  },
};
