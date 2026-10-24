import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { brandEmbed, getGuildConfig, marketing, type Ctx } from '@gynx/services';
import { AppError, discordTimestamp, truncate } from '@gynx/shared';
import { replySuccess, respond } from '../../framework/reply';
import type { ComponentHandler, ComponentInteraction, HandlerCtx, SlashCommand } from '../../framework/types';

type MentionMode = (typeof marketing.MENTION_MODES)[number];
type AnnouncementType = (typeof marketing.ANNOUNCEMENT_TYPES)[number];

const MENTION_CODES: Record<MentionMode, string> = { NONE: 'N', HERE: 'H', EVERYONE: 'E', ROLE: 'R' };
const MENTION_FROM_CODE = Object.fromEntries(Object.entries(MENTION_CODES).map(([k, v]) => [v, k])) as Record<string, MentionMode>;

const typeChoices = marketing.ANNOUNCEMENT_TYPES.map((t) => ({ name: marketing.ANNOUNCEMENT_TYPE_LABELS[t], value: t }));
const mentionChoices = [
  { name: 'No ping', value: 'NONE' },
  { name: '@here', value: 'HERE' },
  { name: '@everyone', value: 'EVERYONE' },
  { name: 'A role', value: 'ROLE' },
];
const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const announceData = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Draft, preview and publish announcements')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Draft a new announcement')
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post (defaults to the announcement channel)').addChannelTypes(...CHANNEL_TYPES))
      .addStringOption((o) => o.setName('mention').setDescription('Who to ping (default: nobody)').addChoices(...mentionChoices))
      .addRoleOption((o) => o.setName('role').setDescription('Role to ping when mention is "A role"'))
      .addStringOption((o) => o.setName('type').setDescription('Announcement type').addChoices(...typeChoices))
      .addStringOption((o) => o.setName('template').setDescription('Start from a template').setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('preview')
      .setDescription('Preview an announcement exactly as it will be posted')
      .addStringOption((o) => o.setName('id').setDescription('Announcement').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('publish')
      .setDescription('Publish an announcement now (asks for confirmation)')
      .addStringOption((o) => o.setName('id').setDescription('Announcement').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('Cancel a scheduled announcement')
      .addStringOption((o) => o.setName('id').setDescription('Announcement').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Recent announcements'))
  .addSubcommand((s) => s.setName('templates').setDescription('List announcement templates'));

const scheduleData = new SlashCommandBuilder()
  .setName('schedule-announcement')
  .setDescription('Schedule an announcement (time in the server time zone unless you pick one)')
  .addStringOption((o) => o.setName('when').setDescription('YYYY-MM-DD HH:MM').setRequired(true).setMaxLength(20))
  .addStringOption((o) => o.setName('id').setDescription('Existing announcement (leave empty to write a new one)').setAutocomplete(true))
  .addStringOption((o) => o.setName('timezone').setDescription('IANA time zone, e.g. Europe/London').setMaxLength(64))
  .addChannelOption((o) => o.setName('channel').setDescription('Channel for a new announcement').addChannelTypes(...CHANNEL_TYPES));

// ─── helpers ────────────────────────────────────────────────────────────────

function contentModal(customId: string, title: string, prefill?: { title?: string; body?: string }) {
  const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true);
  const bodyInput = new TextInputBuilder().setCustomId('body').setLabel('Body').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true);
  if (prefill?.title) titleInput.setValue(truncate(prefill.title, 256));
  if (prefill?.body) bodyInput.setValue(truncate(prefill.body, 4000));
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('image').setLabel('Image URL (https, optional)').setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(false),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('color').setLabel('Colour (hex, optional)').setStyle(TextInputStyle.Short).setMaxLength(7).setRequired(false).setPlaceholder('#22D3EE'),
      ),
    );
}

const optional = (i: ModalSubmitInteraction, id: string) => i.fields.getTextInputValue(id).trim() || null;

const confirmId = (id: string, version: number, epoch: number, stage: 1 | 2) => `ann:confirm:${id}:${version}:${epoch}:${stage}`;

/** Render a preview + confirmation controls. `epoch` 0 = publish now. */
async function showPreview(i: ChatInputCommandInteraction | ButtonInteraction, h: HandlerCtx, id: string, epoch: number, withControls: boolean) {
  const a = await h.ctx.db.announcement.findFirst({ where: { id, guildId: h.ctx.guildId }, select: { mentionRoleId: true } });
  const roleMemberCount = a?.mentionRoleId && i.inCachedGuild() ? (i.guild.roles.cache.get(a.mentionRoleId)?.members.size ?? null) : null;
  const p = await marketing.previewAnnouncement(h.ctx, id, { roleMemberCount });
  const when = epoch ? `scheduled for ${discordTimestamp(new Date(epoch * 1000), 'F')}` : 'published now';
  const header = `**Preview** · <#${p.channelId}> · will be ${when}${p.warning ? `\n⚠️ ${p.warning}` : ''}\n\n${p.payload.content ? `Message text: \`${p.payload.content}\`` : ''}`;
  const components = withControls
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(confirmId(p.id, p.version, epoch, 1)).setLabel(epoch ? 'Schedule' : 'Publish now').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('ann:dismiss').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        ),
      ]
    : [];
  await respond(i, { content: header, embeds: p.payload.embeds ?? [], components });
}

async function queue(ctx: Ctx, id: string, version: number, epoch: number, confirmMentions: boolean) {
  const opts = { expectedVersion: version, confirmMentions };
  return epoch ? marketing.scheduleAnnouncementAt(ctx, id, new Date(epoch * 1000), opts) : marketing.publishAnnouncement(ctx, id, opts);
}

// ─── commands ───────────────────────────────────────────────────────────────

async function idAutocomplete(i: Parameters<NonNullable<SlashCommand['autocomplete']>>[0], h: HandlerCtx) {
  const focused = i.options.getFocused(true);
  try {
    if (focused.name === 'template') {
      const templates = await marketing.listTemplates(h.ctx);
      const q = focused.value.toLowerCase();
      await i.respond(templates.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 25).map((t) => ({ name: truncate(`${t.name} (${marketing.ANNOUNCEMENT_TYPE_LABELS[t.type]})`, 100), value: t.id })));
      return;
    }
    const page = await marketing.listAnnouncements(h.ctx, { limit: 50 });
    const q = focused.value.toLowerCase();
    await i.respond(
      page.items
        .filter((a) => ['DRAFT', 'SCHEDULED', 'FAILED', 'CANCELLED'].includes(a.status) && (a.title.toLowerCase().includes(q) || a.id.startsWith(q)))
        .slice(0, 25)
        .map((a) => ({ name: truncate(`[${a.status.toLowerCase()}] ${a.title}`, 100), value: a.id })),
    );
  } catch {
    await i.respond([]);
  }
}

export const announceCommand: SlashCommand = {
  module: 'announcements',
  data: announceData.toJSON(),
  autocomplete: idAutocomplete,
  async execute(i, h) {
    const sub = i.options.getSubcommand(true);
    if (sub === 'create') {
      const channel = i.options.getChannel('channel');
      const mention = (i.options.getString('mention') ?? 'NONE') as MentionMode;
      const role = i.options.getRole('role');
      const type = i.options.getString('type') as AnnouncementType | null;
      const templateId = i.options.getString('template');
      if (mention === 'ROLE' && !role) throw new AppError('VALIDATION', 'Pick the role to ping with the `role` option.');
      let prefill: { title?: string; body?: string } | undefined;
      let tplType: AnnouncementType | undefined;
      if (templateId) {
        const tpl = (await marketing.listTemplates(h.ctx)).find((t) => t.id === templateId);
        if (!tpl) throw new AppError('NOT_FOUND', 'Template was not found.');
        prefill = { title: tpl.title, body: tpl.body };
        tplType = tpl.type;
      }
      const typeIdx = marketing.ANNOUNCEMENT_TYPES.indexOf(type ?? tplType ?? 'GENERAL');
      const customId = `ann:create:${channel?.id ?? '-'}:${MENTION_CODES[mention]}:${mention === 'ROLE' ? role!.id : '-'}:${typeIdx}`;
      await i.showModal(contentModal(customId, 'New announcement', prefill));
      return;
    }
    if (sub === 'preview' || sub === 'publish') {
      await showPreview(i, h, i.options.getString('id', true), 0, sub === 'publish' || h.ctx.actor.permissions.has('announcements.publish'));
      return;
    }
    if (sub === 'cancel') {
      const a = await marketing.cancelAnnouncement(h.ctx, i.options.getString('id', true));
      await replySuccess(i, 'Announcement cancelled', `“${truncate(a.title, 200)}” will not be posted.`);
      return;
    }
    if (sub === 'list') {
      const page = await marketing.listAnnouncements(h.ctx, { limit: 15 });
      const lines = page.items.map(
        (a) =>
          `\`${a.id}\` · **${truncate(a.title, 60)}** · ${a.status.toLowerCase()}${a.scheduledFor && a.status === 'SCHEDULED' ? ` · ${discordTimestamp(a.scheduledFor, 'f')}` : ''}${a.publishedAt ? ` · ${discordTimestamp(a.publishedAt, 'R')}` : ''}`,
      );
      await respond(i, { embeds: [brandEmbed({ title: 'Announcements', description: lines.join('\n') || 'No announcements yet.' })] });
      return;
    }
    if (sub === 'templates') {
      const templates = await marketing.listTemplates(h.ctx);
      const lines = templates.map((t) => `**${t.name}** · ${marketing.ANNOUNCEMENT_TYPE_LABELS[t.type]}`);
      await respond(i, { embeds: [brandEmbed({ title: 'Announcement templates', description: `${lines.join('\n')}\n\nUse \`/announce create template:\` to start from one.` })] });
    }
  },
};

export const scheduleCommand: SlashCommand = {
  module: 'announcements',
  data: scheduleData.toJSON(),
  autocomplete: idAutocomplete,
  async execute(i, h) {
    const cfg = await getGuildConfig(h.ctx.db, h.ctx.guildId);
    const tz = i.options.getString('timezone') ?? cfg.timezone;
    const runAt = marketing.parseScheduleInput(i.options.getString('when', true), tz);
    marketing.assertSchedulable(runAt, h.ctx.now());
    const epoch = Math.floor(runAt.getTime() / 1000);
    const id = i.options.getString('id');
    if (id) {
      await showPreview(i, h, id, epoch, true);
      return;
    }
    const channel = i.options.getChannel('channel');
    await i.showModal(contentModal(`ann:createsched:${channel?.id ?? '-'}:${epoch}`, 'Schedule an announcement'));
  },
};

// ─── components ─────────────────────────────────────────────────────────────

export const announceComponents: ComponentHandler = {
  prefix: 'ann',
  module: 'announcements',
  async handle(i: ComponentInteraction, args, h) {
    const [action, ...rest] = args;

    if (action === 'create' && i.isModalSubmit()) {
      const [channelId, mentionCode, roleId, typeIdx] = rest;
      const a = await marketing.createAnnouncement(h.ctx, {
        title: i.fields.getTextInputValue('title'),
        body: i.fields.getTextInputValue('body'),
        imageUrl: optional(i, 'image'),
        color: optional(i, 'color'),
        channelId: channelId && channelId !== '-' ? channelId : undefined,
        mention: MENTION_FROM_CODE[mentionCode ?? 'N'] ?? 'NONE',
        mentionRoleId: roleId && roleId !== '-' ? roleId : null,
        type: marketing.ANNOUNCEMENT_TYPES[Number(typeIdx)] ?? 'GENERAL',
      });
      await respond(i, {
        content: `Draft saved: \`${a.id}\`. Preview it before publishing.`,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`ann:preview:${a.id}`).setLabel('Preview').setStyle(ButtonStyle.Primary))],
      });
      return;
    }

    if (action === 'createsched' && i.isModalSubmit()) {
      const [channelId, epochStr] = rest;
      const a = await marketing.createAnnouncement(h.ctx, {
        title: i.fields.getTextInputValue('title'),
        body: i.fields.getTextInputValue('body'),
        imageUrl: optional(i, 'image'),
        color: optional(i, 'color'),
        channelId: channelId && channelId !== '-' ? channelId : undefined,
      });
      // New announcements created here never ping; show the normal confirmation step.
      const runAt = new Date(Number(epochStr) * 1000);
      await respond(i, {
        content: `Draft saved: \`${a.id}\`. Confirm to schedule it for ${discordTimestamp(runAt, 'F')}.`,
        embeds: (await marketing.previewAnnouncement(h.ctx, a.id)).payload.embeds ?? [],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(confirmId(a.id, a.version, Number(epochStr), 1)).setLabel('Schedule').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('ann:dismiss').setLabel('Keep as draft').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
      return;
    }

    if (action === 'preview' && i.isButton()) {
      await showPreview(i, h, rest[0] ?? '', 0, h.ctx.actor.permissions.has('announcements.publish'));
      return;
    }

    if (action === 'confirm' && i.isButton()) {
      const [id = '', versionStr, epochStr, stage] = rest;
      const version = Number(versionStr);
      const epoch = Number(epochStr);
      // Re-validated server-side: permission, version unchanged, mention rights.
      const p = await marketing.previewAnnouncement(h.ctx, id);
      if (p.version !== version) throw new AppError('CONFLICT', 'This announcement was edited after this preview. Preview it again.');
      if (p.requiresMentionConfirmation && stage !== '2') {
        if (!p.canMassMention) throw new AppError('FORBIDDEN', 'You need the mass-mention permission to ping @everyone, @here or roles.');
        await i.update({
          content: `⚠️ **Second confirmation required**\n${p.warning}\n\nAre you sure?`,
          allowedMentions: { parse: [] },
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(confirmId(id, version, epoch, 2)).setLabel('Yes, notify members').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('ann:dismiss').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
            ),
          ],
        });
        return;
      }
      const a = await queue(h.ctx, id, version, epoch, stage === '2');
      await i.update({
        content: epoch
          ? `✅ Scheduled for ${discordTimestamp(a.scheduledFor ?? new Date(epoch * 1000), 'F')}. Use \`/announce cancel\` to stop it.`
          : '✅ Queued — it will be posted within a few seconds.',
        allowedMentions: { parse: [] },
        components: [],
      });
      return;
    }

    if (action === 'dismiss' && i.isButton()) {
      await i.update({ content: 'Cancelled. Nothing was posted.', embeds: [], components: [], allowedMentions: { parse: [] } });
      return;
    }

    if (i.isRepliable()) await respond(i, { content: 'This control is no longer active.' });
  },
};
