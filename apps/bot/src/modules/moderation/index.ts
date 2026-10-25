import {
  ActionRowBuilder,
  DiscordAPIError,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type SlashCommandStringOption,
  type SlashCommandUserOption,
  type GuildMember,
  type User,
} from 'discord.js';
import { CoreText, brandEmbed, errorEmbed, getGuildConfig, moderation, successEmbed } from '@gynx/services';
import { AppError, EMBED_COLORS, discordTimestamp, forbidden, truncate } from '@gynx/shared';
import { respond, replySuccess } from '../../framework/reply';
import type { BotModule, HandlerCtx, SlashCommand } from '../../framework/types';
import { automodListener } from './automod';

const T = moderation.ModerationText;
const notMember = () => new AppError('NOT_FOUND', T.notMember());

/** Gateway facts for the service-side hierarchy check. */
export function hierarchySubject(
  guild: Guild,
  actor: GuildMember | null,
  target: GuildMember | null,
  targetUser: User,
): moderation.HierarchySubject {
  const botHighest = guild.members.me?.roles.highest.position ?? 0;
  return {
    actorHighest: actor?.roles.highest.position ?? botHighest,
    targetHighest: target ? target.roles.highest.position : null,
    botHighest,
    guildOwnerId: guild.ownerId,
    targetIsBot: targetUser.bot,
    targetRoleIds: target ? [...target.roles.cache.keys()].filter((id) => id !== guild.id) : [],
  };
}

export function describeDiscordError(e: unknown): string {
  if (e instanceof DiscordAPIError) return truncate(`${e.message} (code ${e.code})`, 300);
  return T.discordRequestFailed();
}

async function sendDm(user: User, embed: ReturnType<typeof moderation.actionDmEmbed>): Promise<boolean> {
  try {
    await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false; // DMs closed — fine
  }
}

const auditReason = (moderatorTag: string, reason: string) =>
  truncate(T.auditLogReason({ reason, moderator: moderatorTag }), 512);

interface RunOptions {
  type: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN';
  duration?: string;
  deleteMessageDays?: number;
}

/** Shared prepare → (DM) → apply → record flow for /warn, /timeout, /kick, /ban. */
async function runAction(
  i: ChatInputCommandInteraction<'cached'>,
  h: HandlerCtx,
  o: RunOptions,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const user = i.options.getUser('user', true);
  const reason = i.options.getString('reason', true);
  const target = await i.guild.members.fetch(user.id).catch(() => null);
  if (!target && o.type !== 'BAN') throw notMember();

  const plan = await moderation.prepareAction(
    h.ctx,
    { type: o.type, targetId: user.id, reason, duration: o.duration, deleteMessageDays: o.deleteMessageDays },
    hierarchySubject(i.guild, i.member, target, user),
  );
  const cfg = await getGuildConfig(h.ctx.db, i.guildId);
  const dm = () =>
    sendDm(
      user,
      moderation.actionDmEmbed({
        type: plan.type,
        reason: plan.reason,
        durationMs: plan.durationMs,
        guildName: i.guild.name,
        supportUrl: cfg.supportUrl,
      }),
    );

  let dmSent = false;
  let applied = false;
  let error: string | undefined;
  const why = auditReason(i.user.tag, plan.reason);
  try {
    // Kick/ban: DM first, the bot can no longer reach them afterwards.
    if (plan.type === 'KICK' || plan.type === 'BAN') dmSent = await dm();
    if (plan.type === 'TIMEOUT') await target!.timeout(plan.durationMs, why);
    else if (plan.type === 'KICK') await target!.kick(why);
    else if (plan.type === 'BAN')
      await i.guild.members.ban(user.id, { reason: why, deleteMessageSeconds: plan.deleteMessageSeconds });
    applied = true;
    if (plan.type === 'WARN' || plan.type === 'TIMEOUT') dmSent = await dm();
  } catch (e) {
    error = describeDiscordError(e);
    h.rt.log.warn({ err: e, type: plan.type, targetId: user.id }, 'moderation action failed on Discord');
  }

  const rec = await moderation.recordAction(h.ctx, plan, { applied, error, dmSent });
  if (!applied) {
    await respond(i, {
      embeds: [
        errorEmbed(
          T.actionFailed({
            action: moderation.actionLabel(plan.type).toLowerCase(),
            error: error ?? '',
            ref: rec.action.ref,
          }),
        ),
      ],
    });
    return;
  }
  const fields = [
    { name: T.replyFieldMember(), value: `<@${user.id}>`, inline: true },
    { name: T.replyFieldDmDelivered(), value: dmSent ? T.replyDmYes() : T.replyDmNo(), inline: true },
  ];
  if (plan.durationMs)
    fields.push({
      name: T.replyFieldExpires(),
      value: discordTimestamp(rec.action.expiresAt ?? new Date(), 'R'),
      inline: true,
    });
  if (rec.suggestion) {
    fields.push({ name: T.replyFieldActiveWarnings(), value: String(rec.activeWarnings ?? 0), inline: true });
    fields.push({ name: T.replyFieldSuggestion(), value: rec.suggestion.summary, inline: false });
  }
  await respond(i, {
    embeds: [
      brandEmbed({
        title: T.actionAppliedTitle({ ref: rec.action.ref, action: moderation.actionLabel(plan.type) }),
        color: EMBED_COLORS.success,
        fields,
      }),
    ],
  });
}

const userOpt = (desc: string) => (o: SlashCommandUserOption) =>
  o.setName('user').setDescription(desc).setRequired(true);
const reasonOpt = (o: SlashCommandStringOption) =>
  o
    .setName('reason')
    .setDescription('Reason (shown to the member and in the modlog)')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(512);

const commands: SlashCommand[] = [
  {
    module: 'moderation',
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addUserOption(userOpt('Member to warn'))
      .addStringOption(reasonOpt)
      .toJSON(),
    execute: (i, h) => runAction(i as ChatInputCommandInteraction<'cached'>, h, { type: 'WARN' }),
  },
  {
    module: 'moderation',
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Time out a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addUserOption(userOpt('Member to time out'))
      .addStringOption((o) =>
        o
          .setName('duration')
          .setDescription('e.g. 10m, 2h, 1d (1 minute – 28 days)')
          .setRequired(true)
          .setMaxLength(32),
      )
      .addStringOption(reasonOpt)
      .toJSON(),
    execute: (i, h) =>
      runAction(i as ChatInputCommandInteraction<'cached'>, h, {
        type: 'TIMEOUT',
        duration: i.options.getString('duration', true),
      }),
  },
  {
    module: 'moderation',
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .setDMPermission(false)
      .addUserOption(userOpt('Member to kick'))
      .addStringOption(reasonOpt)
      .toJSON(),
    execute: (i, h) => runAction(i as ChatInputCommandInteraction<'cached'>, h, { type: 'KICK' }),
  },
  {
    module: 'moderation',
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a user (optionally temporary)')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .setDMPermission(false)
      .addUserOption(userOpt('User to ban'))
      .addStringOption(reasonOpt)
      .addStringOption((o) =>
        o
          .setName('duration')
          .setDescription('Temporary ban length, e.g. 7d (max 365d). Empty = permanent')
          .setMaxLength(32),
      )
      .addIntegerOption((o) =>
        o
          .setName('delete_days')
          .setDescription('Delete their messages from the last N days (0–7)')
          .setMinValue(0)
          .setMaxValue(7),
      )
      .toJSON(),
    execute: (i, h) =>
      runAction(i as ChatInputCommandInteraction<'cached'>, h, {
        type: 'BAN',
        duration: i.options.getString('duration') ?? undefined,
        deleteMessageDays: i.options.getInteger('delete_days') ?? undefined,
      }),
  },
  {
    module: 'moderation',
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription("Show a member's active warnings and the suggested next step")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addUserOption(userOpt('Member'))
      .toJSON(),
    async execute(i, h) {
      const user = i.options.getUser('user', true);
      const s = await moderation.getWarningSummary(h.ctx, user.id);
      const lines = s.warnings.slice(0, 15).map((w) => {
        const vars = {
          ref: w.ref,
          created: discordTimestamp(w.createdAt, 'R'),
          reason: truncate(w.reason, 120),
        };
        return w.expiresAt
          ? T.warningsLineExpires({ ...vars, expires: discordTimestamp(w.expiresAt, 'R') })
          : T.warningsLine(vars);
      });
      await respond(i, {
        embeds: [
          brandEmbed({
            title: T.warningsTitle({ user: truncate(user.username, 80) }),
            description: lines.join('\n') || T.warningsEmpty(),
            fields: [
              { name: T.warningsFieldActive(), value: String(s.activeCount), inline: true },
              { name: T.warningsFieldSuggestion(), value: s.suggestion.summary, inline: false },
            ],
            footer: T.warningsFooter(),
          }),
        ],
      });
    },
  },
  {
    module: 'moderation',
    data: new SlashCommandBuilder()
      .setName('appeal')
      .setDescription('Appeal a moderation action taken on your account')
      .setDMPermission(false)
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('The action to appeal (optional)')
          .setAutocomplete(true)
          .setMaxLength(16),
      )
      .toJSON(),
    async execute(i) {
      const ref = i.options.getString('action')?.trim().toUpperCase();
      const refArg = ref && /^M-\d{1,9}$/.test(ref) ? ref : '-';
      const modal = new ModalBuilder()
        .setCustomId(`modappeal:submit:${refArg}`)
        .setTitle(refArg === '-' ? T.appealModalTitle() : T.appealModalTitleFor({ ref: refArg }))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('statement')
              .setLabel(T.appealStatementLabel())
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(20)
              .setMaxLength(2000)
              .setPlaceholder(T.appealStatementPlaceholder())
              .setRequired(true),
          ),
        );
      await i.showModal(modal);
    },
    async autocomplete(i, h) {
      const own = await moderation.listOwnActions(h.ctx, i.options.getFocused());
      await i.respond(
        own.map((a) => ({
          name: truncate(
            T.appealAutocompleteOption({
              ref: a.ref,
              action: moderation.actionLabel(a.type),
              reason: a.reason,
            }),
            100,
          ),
          value: a.ref,
        })),
      );
    },
  },
];

export const moderationModule: BotModule = {
  name: 'moderation',
  commands,
  components: [
    {
      prefix: 'modappeal',
      module: 'moderation',
      async handle(i, args, h) {
        const [action, ...rest] = args;
        if (action === 'submit' && i.isModalSubmit()) {
          const ref = rest[0] && rest[0] !== '-' ? rest[0] : undefined;
          const appeal = await moderation.submitAppeal(h.ctx, {
            actionRef: ref,
            statement: i.fields.getTextInputValue('statement'),
          });
          const reference = appeal.id.slice(-8);
          await replySuccess(
            i,
            T.appealSubmittedTitle(),
            ref ? T.appealSubmittedFor({ ref, reference }) : T.appealSubmitted({ reference }),
          );
          return;
        }
        if ((action === 'accept' || action === 'deny') && i.isButton()) {
          if (
            !h.ctx.actor.permissions.has('moderation.execute') &&
            !h.ctx.actor.permissions.has('moderation.ban')
          )
            throw forbidden();
          const id = rest[0] ?? '';
          const modal = new ModalBuilder()
            .setCustomId(`modappeal:review:${action}:${id}`)
            .setTitle(action === 'accept' ? T.reviewModalAcceptTitle() : T.reviewModalDenyTitle())
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId('note')
                  .setLabel(T.reviewNoteLabel())
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(1000)
                  .setRequired(false),
              ),
            );
          await i.showModal(modal);
          return;
        }
        if (action === 'review' && i.isModalSubmit()) {
          const [decision, id] = rest;
          const note = i.fields.getTextInputValue('note').trim();
          const r = await moderation.reviewAppeal(h.ctx, id ?? '', {
            decision: decision === 'accept' ? 'ACCEPTED' : 'DENIED',
            note: note || undefined,
          });
          const moderator = `<@${h.ctx.actor.userId}>`;
          const summary =
            r.appeal.status === 'ACCEPTED'
              ? T.reviewSummaryAccepted({ moderator })
              : T.reviewSummaryDenied({ moderator });
          if (i.isFromMessage())
            await i.update({ content: summary, components: [], allowedMentions: { parse: [] } });
          else await respond(i, { content: summary });
          if (r.requiresManualReversal) {
            await respond(i, {
              embeds: [successEmbed(T.manualReversalTitle(), T.manualReversalBody())],
            });
          }
          return;
        }
        await respond(i, { content: CoreText.controlExpired() });
      },
    },
  ],
  events: [automodListener()],
};
