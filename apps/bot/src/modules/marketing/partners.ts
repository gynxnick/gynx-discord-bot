import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { brandEmbed, CoreText, marketing } from '@gynx/services';
import { AppError, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { replySuccess, respond } from '../../framework/reply';
import type { ComponentHandler, SlashCommand } from '../../framework/types';

type Category = (typeof marketing.PARTNER_CATEGORIES)[number];
const T = marketing.MarketingText;

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
        .setPlaceholder(T.applySelectPlaceholder())
        .addOptions(
          marketing.PARTNER_CATEGORIES.map((c) => ({
            label: marketing.partnerCategoryLabel(c),
            value: c,
          })),
        );
      await respond(i, {
        content: T.applyIntro(),
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
      return;
    }
    if (sub === 'status') {
      const apps = await marketing.myPartnerApplications(h.ctx);
      const lines = apps.map(
        (a) =>
          `**${a.ref}** · ${marketing.partnerCategoryLabel(a.category)} · ${a.status.replace('_', ' ').toLowerCase()} · ${discordTimestamp(a.createdAt, 'R')}${a.decisionNote ? `\n> ${neutraliseMentions(truncate(a.decisionNote, 300))}` : ''}`,
      );
      await respond(i, {
        embeds: [
          brandEmbed({
            title: T.statusTitle(),
            description: lines.join('\n') || T.statusEmpty(),
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
          `**${a.ref}** · ${marketing.partnerCategoryLabel(a.category)} · <@${a.applicantId}> · ${a.status === 'UNDER_REVIEW' ? T.queueInReviewBy({ reviewer: `<@${a.reviewerId}>` }) : T.queuePending()} · ${discordTimestamp(a.createdAt, 'R')}`,
      );
      await respond(i, {
        embeds: [
          brandEmbed({
            title: T.queueTitle(),
            description: lines.join('\n') || T.queueEmpty(),
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
      if (!isCategory(category)) throw new AppError('VALIDATION', T.unknownCategory());
      const modal = new ModalBuilder()
        .setCustomId(`partner:apply:${category}`)
        .setTitle(T.applyModalTitle({ category: marketing.partnerCategoryLabel(category) }).slice(0, 45));
      for (const q of marketing.PARTNER_QUESTIONS[category]) {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(q.id)
              .setLabel(marketing.partnerQuestionLabel(q).slice(0, 45))
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
      if (!isCategory(category)) throw new AppError('VALIDATION', T.unknownCategory());
      const answers = Object.fromEntries(
        marketing.PARTNER_QUESTIONS[category].map((q) => [q.id, i.fields.getTextInputValue(q.id)]),
      );
      const app = await marketing.submitPartnerApplication(h.ctx, { category, answers });
      await replySuccess(i, T.applicationReceivedTitle({ ref: app.ref }), T.applicationReceivedBody());
      return;
    }

    const id = rest[0] ?? '';
    if (action === 'start' && i.isButton()) {
      const app = await marketing.startPartnerReview(h.ctx, id);
      await respond(i, { content: T.reviewStarted({ ref: app.ref }) });
      return;
    }

    if ((action === 'approve' || action === 'reject') && i.isButton()) {
      // Permission re-checked on submit by the service; fail early for clarity.
      if (!h.ctx.actor.permissions.has('partners.review'))
        throw new AppError('FORBIDDEN', CoreText.forbidden());
      const approve = action === 'approve';
      const modal = new ModalBuilder()
        .setCustomId(`partner:decide:${id}:${approve ? 'A' : 'R'}`)
        .setTitle((approve ? T.approveModalTitle() : T.rejectModalTitle()).slice(0, 45))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('note')
              .setLabel(T.decisionNoteLabel().slice(0, 45))
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(3)
              .setMaxLength(1000)
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('internal')
              .setLabel(T.internalNotesLabel().slice(0, 45))
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
              .setLabel(T.campaignNameLabel().slice(0, 45))
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
        approve
          ? T.decidedApprovedTitle({ ref: application.ref })
          : T.decidedRejectedTitle({ ref: application.ref }),
        approve ? T.decidedApprovedBody({ campaign: String(campaign?.name) }) : T.decidedRejectedBody(),
      );
      return;
    }

    if (i.isRepliable()) await respond(i, { content: CoreText.controlExpired() });
  },
};
