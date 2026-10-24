import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import { brandEmbed, can, engagement } from '@gynx/services';
import { AppError, discordTimestamp, forbidden, parseDuration, truncate, validation } from '@gynx/shared';
import { replyInfo, replySuccess, respond } from '../../framework/reply';
import type { BotModule, HandlerCtx } from '../../framework/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const textInput = (
  id: string,
  label: string,
  style: TextInputStyle,
  opts: { min?: number; max: number; required?: boolean; placeholder?: string; value?: string },
) => {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setMaxLength(opts.max)
    .setRequired(opts.required ?? true);
  if (opts.min) t.setMinLength(opts.min);
  if (opts.placeholder) t.setPlaceholder(opts.placeholder);
  if (opts.value) t.setValue(opts.value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
};

function durationMs(input: string): number {
  const ms = parseDuration(input);
  if (!ms) throw validation('Use a duration like 30m, 2h, 1d or 1d12h.');
  return ms;
}

const choiceName = (s: string) => truncate(s, 100);
const u = engagement.displayText;

async function safeAutocomplete(
  i: AutocompleteInteraction,
  load: () => Promise<Array<{ name: string; value: string }>>,
) {
  try {
    await i.respond((await load()).slice(0, 25));
  } catch {
    await i.respond([]).catch(() => undefined);
  }
}

const statusWord = (s: string) => s.toLowerCase().replace('_', ' ');

// ─── /event ─────────────────────────────────────────────────────────────────

const eventOpt = (o: SlashCommandStringOption) =>
  o.setName('event').setDescription('The event').setRequired(true).setAutocomplete(true);

const eventCommand = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Community events')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Create an event (staff)')
      .addIntegerOption((o) =>
        o
          .setName('capacity')
          .setDescription('Max attendees (empty = unlimited)')
          .setMinValue(1)
          .setMaxValue(10_000),
      )
      .addBooleanOption((o) => o.setName('waitlist').setDescription('Waitlist when full (default yes)'))
      .addStringOption((o) =>
        o
          .setName('reminders')
          .setDescription('Minutes before start, comma separated, max 3 (default 60)')
          .setMaxLength(20),
      )
      .addStringOption((o) =>
        o.setName('duration').setDescription('How long it lasts, e.g. 2h').setMaxLength(10),
      )
      .addStringOption((o) =>
        o
          .setName('timezone')
          .setDescription('IANA time zone for the start time (default: server time zone)')
          .setMaxLength(40),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Upcoming events'))
  .addSubcommand((s) =>
    s.setName('info').setDescription('Event details and your RSVP').addStringOption(eventOpt),
  )
  .addSubcommand((s) =>
    s
      .setName('reschedule')
      .setDescription('Move an event to a new time (staff)')
      .addStringOption(eventOpt)
      .addStringOption((o) =>
        o.setName('starts').setDescription('New start: YYYY-MM-DD HH:MM').setRequired(true).setMaxLength(20),
      )
      .addStringOption((o) =>
        o
          .setName('timezone')
          .setDescription('IANA time zone (default: the event time zone)')
          .setMaxLength(40),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('Cancel an event (staff)')
      .addStringOption(eventOpt)
      .addStringOption((o) =>
        o.setName('reason').setDescription('Internal reason (audit log)').setMaxLength(500),
      ),
  )
  .addSubcommand((s) =>
    s.setName('summary').setDescription('Post a summary after the event (staff)').addStringOption(eventOpt),
  );

function requireEventsManage(h: HandlerCtx) {
  if (!can(h.ctx, 'events.manage')) throw forbidden();
}

async function eventCommandExecute(i: ChatInputCommandInteraction, h: HandlerCtx) {
  const sub = i.options.getSubcommand();
  if (sub === 'create') {
    requireEventsManage(h); // UX pre-check; the service re-checks on submit
    const cap = i.options.getInteger('capacity');
    const wl = i.options.getBoolean('waitlist');
    const rem = (i.options.getString('reminders') ?? '').replace(/\s/g, '');
    if (rem && !/^\d{1,5}(,\d{1,5}){0,2}$/.test(rem))
      throw validation('Reminders must be up to 3 numbers of minutes, e.g. 60,15.');
    const dur = i.options.getString('duration');
    const durMin = dur ? Math.round(durationMs(dur) / 60_000) : null;
    const tz = i.options.getString('timezone')?.trim() ?? '';
    if (tz && !/^[A-Za-z0-9_+\-/]{1,40}$/.test(tz)) throw validation('Unknown time zone.');
    const customId = [
      'evt',
      'create',
      cap ?? '-',
      wl === null ? '-' : wl ? '1' : '0',
      rem || '-',
      durMin ?? '-',
      tz || '-',
    ].join(':');
    if (customId.length > 100) throw validation('Those options are too long.');
    const modal = new ModalBuilder()
      .setCustomId(customId)
      .setTitle('New event')
      .addComponents(
        textInput('title', 'Title', TextInputStyle.Short, { min: 3, max: 100 }),
        textInput('description', 'Description', TextInputStyle.Paragraph, { max: 2000 }),
        textInput('starts', 'Starts (YYYY-MM-DD HH:MM, 24h)', TextInputStyle.Short, {
          min: 16,
          max: 16,
          placeholder: '2026-11-05 19:30',
        }),
        textInput('location', 'Location (channel, server, link…)', TextInputStyle.Short, {
          max: 100,
          required: false,
        }),
      );
    await i.showModal(modal);
    return;
  }
  if (sub === 'list') {
    const page = await engagement.listEvents(h.ctx, { status: 'SCHEDULED', upcoming: true, limit: 10 });
    const lines = page.items.map((e) => {
      const link = engagement.messageLink(e.guildId, e.channelId, e.messageId);
      return `• ${link ? `[${u(truncate(e.title, 80))}](${link})` : `**${u(truncate(e.title, 80))}**`} — ${discordTimestamp(e.startsAt, 'f')} (${discordTimestamp(e.startsAt, 'R')})`;
    });
    await replyInfo(i, 'Upcoming events', lines.join('\n') || 'No upcoming events right now.');
    return;
  }
  const eventId = i.options.getString('event', true);
  if (sub === 'info') {
    const { event, counts, myStatus } = await engagement.getEvent(h.ctx, eventId);
    const embed = engagement.eventEmbed(event, counts);
    embed.fields = [
      ...(embed.fields ?? []),
      { name: 'Your RSVP', value: myStatus ? statusWord(myStatus) : 'none', inline: true },
    ];
    await respond(i, { embeds: [embed] });
    return;
  }
  if (sub === 'reschedule') {
    const ev = await engagement.updateEvent(h.ctx, eventId, {
      startsAt: i.options.getString('starts', true),
      timezone: i.options.getString('timezone') ?? undefined,
    });
    await replySuccess(
      i,
      'Event rescheduled',
      `**${u(ev.title)}** now starts ${discordTimestamp(ev.startsAt, 'F')}. Reminders were rescheduled.`,
    );
    return;
  }
  if (sub === 'cancel') {
    const ev = await engagement.cancelEvent(h.ctx, eventId, i.options.getString('reason') ?? undefined);
    await replySuccess(
      i,
      'Event cancelled',
      `**${u(ev.title)}** was cancelled. Attendees will be notified by DM.`,
    );
    return;
  }
  if (sub === 'summary') {
    requireEventsManage(h);
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`evt:summary:${eventId}`)
        .setTitle('Event summary')
        .addComponents(
          textInput('summary', 'Summary (shown on the event post)', TextInputStyle.Paragraph, {
            min: 10,
            max: 2000,
          }),
        ),
    );
    return;
  }
  throw new AppError('NOT_FOUND', 'Unknown subcommand.');
}

// ─── /poll ──────────────────────────────────────────────────────────────────

const pollCommand = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create and manage polls (staff)')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Create a poll in this channel')
      .addStringOption((o) =>
        o
          .setName('question')
          .setDescription('The question')
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(300),
      )
      .addStringOption((o) =>
        o
          .setName('options')
          .setDescription('2–10 options separated by ;')
          .setRequired(true)
          .setMaxLength(900),
      )
      .addStringOption((o) =>
        o
          .setName('duration')
          .setDescription('How long it runs: 1m to 14d (e.g. 1d)')
          .setRequired(true)
          .setMaxLength(10),
      )
      .addBooleanOption((o) => o.setName('multiple').setDescription('Allow several choices'))
      .addIntegerOption((o) =>
        o
          .setName('max_choices')
          .setDescription('Max choices for multiple-choice polls')
          .setMinValue(1)
          .setMaxValue(10),
      )
      .addBooleanOption((o) =>
        o.setName('anonymous').setDescription('Hide who voted for what, from everyone (default no)'),
      )
      .addBooleanOption((o) =>
        o.setName('live_results').setDescription('Show the tally while voting is open (default yes)'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('close')
      .setDescription('Close a poll now and publish results')
      .addStringOption((o) =>
        o.setName('poll').setDescription('The poll').setRequired(true).setAutocomplete(true),
      ),
  );

// ─── /giveaway ──────────────────────────────────────────────────────────────

const giveawayOpt = (o: SlashCommandStringOption) =>
  o.setName('giveaway').setDescription('The giveaway').setRequired(true).setAutocomplete(true);

const giveawayCommand = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Free community giveaways (staff)')
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Start a giveaway')
      .addStringOption((o) =>
        o.setName('prize').setDescription('What is being given away').setRequired(true).setMaxLength(200),
      )
      .addStringOption((o) =>
        o.setName('duration').setDescription('1m to 30d, e.g. 3d').setRequired(true).setMaxLength(10),
      )
      .addIntegerOption((o) =>
        o.setName('winners').setDescription('Number of winners (1–20)').setMinValue(1).setMaxValue(20),
      )
      .addStringOption((o) => o.setName('description').setDescription('Details / rules').setMaxLength(1000))
      .addRoleOption((o) =>
        o.setName('required_role').setDescription('Only members with this role can enter'),
      )
      .addIntegerOption((o) =>
        o
          .setName('min_account_age')
          .setDescription('Minimum Discord account age (days)')
          .setMinValue(0)
          .setMaxValue(3650),
      )
      .addIntegerOption((o) =>
        o
          .setName('min_member_days')
          .setDescription('Minimum days in this server')
          .setMinValue(0)
          .setMaxValue(3650),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post (default: here)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((s) =>
    s.setName('end').setDescription('End now and draw winners').addStringOption(giveawayOpt),
  )
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Draw replacement winner(s), excluding previous winners')
      .addStringOption(giveawayOpt)
      .addStringOption((o) =>
        o
          .setName('reason')
          .setDescription('Why (recorded in the audit log)')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(500),
      )
      .addIntegerOption((o) =>
        o
          .setName('count')
          .setDescription('How many replacement winners (default 1)')
          .setMinValue(1)
          .setMaxValue(20),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('Cancel without drawing')
      .addStringOption(giveawayOpt)
      .addStringOption((o) => o.setName('reason').setDescription('Internal reason').setMaxLength(500)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Recent giveaways'));

// ─── /suggest ───────────────────────────────────────────────────────────────

const suggestCommand = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Suggest an idea to the GYNX.GG team');

// ─── Module ─────────────────────────────────────────────────────────────────

export const engagementModule: BotModule = {
  name: 'engagement',
  commands: [
    {
      module: 'engagement',
      data: eventCommand.toJSON(),
      execute: eventCommandExecute,
      async autocomplete(i, h) {
        const sub = i.options.getSubcommand(false);
        const q = String(i.options.getFocused() ?? '').slice(0, 100);
        await safeAutocomplete(i, async () => {
          const page = await engagement.listEvents(h.ctx, {
            q: q || undefined,
            status: sub === 'summary' ? undefined : 'SCHEDULED',
            limit: 25,
          });
          return page.items.map((e) => ({
            name: choiceName(
              `${e.title} · ${e.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${statusWord(e.status)}`,
            ),
            value: e.id,
          }));
        });
      },
    },
    {
      module: 'engagement',
      data: pollCommand.toJSON(),
      async execute(i, h) {
        const sub = i.options.getSubcommand();
        if (sub === 'create') {
          const multiple = i.options.getBoolean('multiple') ?? false;
          const poll = await engagement.createPoll(h.ctx, {
            question: i.options.getString('question', true),
            options: engagement.splitPollOptions(i.options.getString('options', true)),
            multipleChoice: multiple,
            maxChoices: multiple ? (i.options.getInteger('max_choices') ?? undefined) : undefined,
            durationMs: durationMs(i.options.getString('duration', true)),
            anonymous: i.options.getBoolean('anonymous') ?? false,
            liveResults: i.options.getBoolean('live_results') ?? true,
            channelId: i.channelId,
          });
          await replySuccess(
            i,
            'Poll created',
            `It will appear in this channel in a moment and closes ${discordTimestamp(poll.endsAt, 'R')}.`,
          );
          return;
        }
        if (sub === 'close') {
          const poll = await engagement.closePoll(h.ctx, i.options.getString('poll', true));
          await replySuccess(
            i,
            'Poll closed',
            `“${u(truncate(poll.question, 200))}” is closed; final results will be posted on the poll message.`,
          );
        }
      },
      async autocomplete(i, h) {
        const q = String(i.options.getFocused() ?? '').slice(0, 100);
        await safeAutocomplete(i, async () => {
          const page = await engagement.listPolls(h.ctx, { status: 'OPEN', q: q || undefined, limit: 25 });
          return page.items.map((p) => ({ name: choiceName(p.question), value: p.id }));
        });
      },
    },
    {
      module: 'engagement',
      data: suggestCommand.toJSON(),
      async execute(i) {
        await i.showModal(
          new ModalBuilder()
            .setCustomId('sugg:submit')
            .setTitle('Make a suggestion')
            .addComponents(
              textInput('title', 'Short title', TextInputStyle.Short, { min: 5, max: 100 }),
              textInput('body', 'Describe your idea', TextInputStyle.Paragraph, {
                min: 20,
                max: 2000,
                placeholder: 'What should change, and why would it help?',
              }),
            ),
        );
      },
    },
    {
      module: 'engagement',
      data: giveawayCommand.toJSON(),
      async execute(i, h) {
        const sub = i.options.getSubcommand();
        if (sub === 'start') {
          const role = i.options.getRole('required_role');
          const g = await engagement.createGiveaway(h.ctx, {
            prize: i.options.getString('prize', true),
            description: i.options.getString('description') ?? undefined,
            winnerCount: i.options.getInteger('winners') ?? 1,
            durationMs: durationMs(i.options.getString('duration', true)),
            requiredRoleIds: role ? [role.id] : [],
            minAccountAgeDays: i.options.getInteger('min_account_age') ?? 0,
            minMemberDays: i.options.getInteger('min_member_days') ?? 0,
            channelId: i.options.getChannel('channel')?.id ?? i.channelId,
          });
          await replySuccess(
            i,
            'Giveaway started',
            `**${u(truncate(g.prize, 200))}** ends ${discordTimestamp(g.endsAt, 'R')}.`,
          );
          return;
        }
        if (sub === 'list') {
          const page = await engagement.listGiveaways(h.ctx, { limit: 10 });
          const lines = page.items.map(
            (g) =>
              `• **${u(truncate(g.prize, 80))}** — ${statusWord(g.status)} · ${g.entrantCount} entr${g.entrantCount === 1 ? 'y' : 'ies'} · ${g.status === 'ACTIVE' ? `ends ${discordTimestamp(g.endsAt, 'R')}` : `ended ${discordTimestamp(g.endedAt ?? g.endsAt, 'R')}`}`,
          );
          await replyInfo(i, 'Giveaways', lines.join('\n') || 'No giveaways yet.');
          return;
        }
        const id = i.options.getString('giveaway', true);
        if (sub === 'end') {
          const r = await engagement.endGiveaway(h.ctx, id);
          const n = r.draw?.winnerIds.length ?? 0;
          await replySuccess(
            i,
            'Giveaway ended',
            n
              ? `${n} winner(s) drawn from ${r.draw?.entrantCount} entr${r.draw?.entrantCount === 1 ? 'y' : 'ies'}. The announcement is being posted.`
              : 'There were no valid entries, so no winner was drawn.',
          );
          return;
        }
        if (sub === 'reroll') {
          const d = await engagement.rerollGiveaway(h.ctx, id, {
            reason: i.options.getString('reason', true),
            count: i.options.getInteger('count') ?? undefined,
          });
          await replySuccess(
            i,
            'Rerolled',
            `Draw #${d.seq}: ${d.winnerIds.map((w) => `<@${w}>`).join(', ')} (from ${d.entrantCount} remaining entrants). Announcement is being posted.`,
          );
          return;
        }
        if (sub === 'cancel') {
          await engagement.cancelGiveaway(h.ctx, id, i.options.getString('reason') ?? undefined);
          await replySuccess(i, 'Giveaway cancelled', 'No winners will be drawn.');
        }
      },
      async autocomplete(i, h) {
        const sub = i.options.getSubcommand(false);
        await safeAutocomplete(i, async () => {
          const page = await engagement.listGiveaways(h.ctx, {
            status: sub === 'reroll' ? 'ENDED' : 'ACTIVE',
            limit: 25,
          });
          const q = String(i.options.getFocused() ?? '').toLowerCase();
          return page.items
            .filter((g) => !q || g.prize.toLowerCase().includes(q))
            .map((g) => ({ name: choiceName(`${g.prize} · ${statusWord(g.status)}`), value: g.id }));
        });
      },
    },
  ],
  components: [
    {
      prefix: 'evt',
      module: 'engagement',
      async handle(i, args, h) {
        const [action, ...rest] = args;
        if (action === 'rsvp' && i.isButton()) {
          const [eventId = '', choice] = rest;
          const r = await engagement.rsvpEvent(h.ctx, eventId, choice === 'go' ? 'GOING' : 'NOT_GOING');
          const msg =
            r.status === 'GOING'
              ? r.unchanged
                ? "You're already on the list. See you there!"
                : "You're going! You'll get a DM reminder before it starts (if your DMs are open)."
              : r.status === 'WAITLIST'
                ? `The event is full, so you're on the waitlist (position ${r.waitlistPosition}). We'll DM you if a spot opens.`
                : r.unchanged
                  ? 'Noted — you are not attending.'
                  : "Got it, you're no longer attending.";
          await respond(i, { content: msg });
          return;
        }
        if (action === 'create' && i.isModalSubmit()) {
          const [cap, wl, rem, dur, tz] = rest;
          const ev = await engagement.createEvent(h.ctx, {
            title: i.fields.getTextInputValue('title'),
            description: i.fields.getTextInputValue('description'),
            startsAt: i.fields.getTextInputValue('starts'),
            location: i.fields.getTextInputValue('location') || undefined,
            capacity: cap && cap !== '-' ? Number(cap) : undefined,
            waitlistEnabled: wl === '-' || wl === undefined ? undefined : wl === '1',
            reminderMinutesBefore: rem && rem !== '-' ? rem.split(',').map(Number) : undefined,
            durationMinutes: dur && dur !== '-' ? Number(dur) : undefined,
            timezone: tz && tz !== '-' ? tz : undefined,
            fallbackChannelId: i.channelId ?? undefined,
          });
          await replySuccess(
            i,
            'Event created',
            `**${u(ev.title)}** — ${discordTimestamp(ev.startsAt, 'F')}. The event post will appear in <#${ev.channelId}> shortly.`,
          );
          return;
        }
        if (action === 'summary' && i.isModalSubmit()) {
          const ev = await engagement.postEventSummary(
            h.ctx,
            rest[0] ?? '',
            i.fields.getTextInputValue('summary'),
          );
          await replySuccess(i, 'Summary posted', `The post for **${u(ev.title)}** has been updated.`);
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
    {
      prefix: 'poll',
      module: 'engagement',
      async handle(i, args, h) {
        const [action, pollId = ''] = args;
        if (action === 'vote' && i.isStringSelectMenu()) {
          const r = await engagement.votePoll(h.ctx, pollId, i.values);
          const results = await engagement.tallyPoll(h.ctx.db, pollId);
          const labels = results.options
            .filter((o) => r.optionIds.includes(o.optionId))
            .map((o) => `**${u(o.label)}**`);
          await respond(i, {
            content: `${r.changed ? 'Vote recorded' : 'Your vote is unchanged'}: ${labels.join(', ')}. You can change it until the poll closes.`,
          });
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
    {
      prefix: 'sugg',
      module: 'engagement',
      async handle(i, args, h) {
        const [action, id = '', extra] = args;
        if (action === 'submit' && i.isModalSubmit()) {
          const s = await engagement.submitSuggestion(h.ctx, {
            title: i.fields.getTextInputValue('title'),
            body: i.fields.getTextInputValue('body'),
          });
          await replySuccess(
            i,
            `Suggestion ${s.ref} submitted`,
            'Thanks! It will appear on the suggestion board shortly, where members can vote on it.',
          );
          return;
        }
        if (action === 'vote' && i.isButton()) {
          const r = await engagement.voteSuggestion(h.ctx, id, extra === 'up' ? 1 : -1);
          await respond(i, {
            content:
              r.vote === 0
                ? 'Your vote was removed.'
                : `You voted ${r.vote === 1 ? '👍' : '👎'}. (👍 ${r.upvotes} · 👎 ${r.downvotes})`,
          });
          return;
        }
        if (action === 'status' && i.isStringSelectMenu()) {
          if (!can(h.ctx, 'suggestions.manage'))
            throw forbidden('Only staff can change a suggestion status.');
          const status = i.values[0] ?? '';
          if (!(status in engagement.SUGGESTION_STATUS_LABELS)) throw validation('Unknown status.');
          const modal = new ModalBuilder()
            .setCustomId(`sugg:respond:${id}:${status}`)
            .setTitle(
              `Mark as ${engagement.SUGGESTION_STATUS_LABELS[status as keyof typeof engagement.SUGGESTION_STATUS_LABELS]}`,
            )
            .addComponents(
              textInput('response', 'Response to the author (optional)', TextInputStyle.Paragraph, {
                max: 1000,
                required: false,
              }),
            );
          if (status === 'DUPLICATE')
            modal.addComponents(
              textInput('duplicate', 'Duplicate of (e.g. S-0012)', TextInputStyle.Short, { min: 1, max: 30 }),
            );
          await i.showModal(modal);
          return;
        }
        if (action === 'respond' && i.isModalSubmit()) {
          const status = (extra ?? '') as engagement.SetSuggestionStatusInput['status'];
          const s = await engagement.setSuggestionStatus(h.ctx, id, {
            status,
            response: i.fields.getTextInputValue('response') || undefined,
            duplicateOf: status === 'DUPLICATE' ? i.fields.getTextInputValue('duplicate') : undefined,
          });
          await replySuccess(
            i,
            `${s.ref} updated`,
            `Status: **${engagement.SUGGESTION_STATUS_LABELS[s.status]}**. The author will be notified by DM.`,
          );
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
    {
      prefix: 'gaw',
      module: 'engagement',
      async handle(i, args, h) {
        const [action, id = ''] = args;
        if (action === 'enter' && i.isButton() && i.inCachedGuild()) {
          const m = i.member;
          await engagement.enterGiveaway(h.ctx, id, {
            roleIds: [...m.roles.cache.keys()],
            accountCreatedAt: m.user.createdAt,
            joinedAt: m.joinedAt,
          });
          await respond(i, {
            embeds: [
              brandEmbed({
                title: "🎉 You're entered!",
                description:
                  'Good luck! Winners are drawn automatically when the giveaway ends. You can leave any time before then.',
              }),
            ],
          });
          return;
        }
        if (action === 'leave' && i.isButton()) {
          const r = await engagement.leaveGiveaway(h.ctx, id);
          await respond(i, {
            content: r.left ? 'You have left the giveaway.' : "You weren't entered in this giveaway.",
          });
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
  ],
  events: [],
};
