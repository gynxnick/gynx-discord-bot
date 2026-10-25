import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { CommunityEvent, Giveaway, GiveawayDraw, Suggestion } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, formatInZone, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { displayText as u } from './common';
import type { EventCounts } from './events';
import type { PollResults } from './polls';
import { SUGGESTION_STATUSES, suggestionStatusLabel } from './suggestions';
import { EngagementText as T } from './texts';

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

// customId prefixes owned by this module (handled in apps/bot/src/modules/engagement)
export const CID = {
  rsvp: (eventId: string, choice: 'go' | 'no') => `evt:rsvp:${eventId}:${choice}`,
  pollVote: (pollId: string) => `poll:vote:${pollId}`,
  suggestionVote: (id: string, dir: 'up' | 'down') => `sugg:vote:${id}:${dir}`,
  suggestionStatus: (id: string) => `sugg:status:${id}`,
  giveawayEnter: (id: string) => `gaw:enter:${id}`,
  giveawayLeave: (id: string) => `gaw:leave:${id}`,
} as const;

// ─── Events ─────────────────────────────────────────────────────────────────

export function eventEmbed(ev: CommunityEvent, counts: EventCounts): APIEmbed {
  const status =
    ev.status === 'CANCELLED'
      ? T.eventStatusCancelled()
      : ev.status === 'COMPLETED'
        ? T.eventStatusCompleted()
        : ev.startsAt.getTime() <= Date.now()
          ? T.eventStatusStarted()
          : T.eventStatusScheduled();
  const capacity = ev.capacity ? `${counts.going}/${ev.capacity}` : `${counts.going}`;
  const fields = [
    {
      name: T.eventFieldWhen(),
      value: `${discordTimestamp(ev.startsAt, 'F')} (${discordTimestamp(ev.startsAt, 'R')})\n${formatInZone(ev.startsAt, ev.timezone)} ${ev.timezone}`,
      inline: false,
    },
    ...(ev.endsAt
      ? [{ name: T.eventFieldEnds(), value: discordTimestamp(ev.endsAt, 'f'), inline: true }]
      : []),
    ...(ev.location
      ? [{ name: T.eventFieldWhere(), value: u(truncate(ev.location, 100)), inline: true }]
      : []),
    { name: T.eventFieldGoing(), value: capacity, inline: true },
    ...(ev.capacity && ev.waitlistEnabled
      ? [{ name: T.eventFieldWaitlist(), value: `${counts.waitlist}`, inline: true }]
      : []),
    { name: T.eventFieldStatus(), value: status, inline: true },
    ...(ev.summary
      ? [{ name: T.eventFieldSummary(), value: u(truncate(ev.summary, 1024)), inline: false }]
      : []),
  ];
  return brandEmbed({
    title: T.eventTitle({ title: u(ev.title) }),
    description: u(truncate(ev.description, 2000)),
    color: ev.status === 'CANCELLED' ? EMBED_COLORS.neutral : EMBED_COLORS.primary,
    fields,
    footer: ev.status === 'SCHEDULED' ? T.eventFooter() : undefined,
  });
}

export function eventComponents(ev: CommunityEvent): Row[] {
  if (ev.status !== 'SCHEDULED') return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: T.eventGoingButton(), custom_id: CID.rsvp(ev.id, 'go') },
        { type: 2, style: 2, label: T.eventNotGoingButton(), custom_id: CID.rsvp(ev.id, 'no') },
      ],
    },
  ];
}

export function eventDmEmbed(
  ev: CommunityEvent,
  kind: 'event.reminder' | 'event.cancelled' | 'event.promoted',
  link: string | null,
  minutes?: number,
): APIEmbed {
  const when = `${discordTimestamp(ev.startsAt, 'F')} (${discordTimestamp(ev.startsAt, 'R')})`;
  const jump = link ? `\n\n[${T.eventDmViewLink()}](${link})` : '';
  if (kind === 'event.reminder') {
    const lead =
      minutes && minutes >= 60
        ? T.eventReminderLeadHours({ count: Math.round(minutes / 60) })
        : T.eventReminderLeadMinutes({ count: minutes ?? 0 });
    return brandEmbed({
      title: T.eventReminderDmTitle({ lead, title: u(ev.title) }),
      description: `${when}${ev.location ? `\n${T.eventReminderDmWhere({ location: u(ev.location) })}` : ''}${jump}`,
    });
  }
  if (kind === 'event.cancelled') {
    return brandEmbed({
      title: T.eventCancelledDmTitle({ title: u(ev.title) }),
      color: EMBED_COLORS.neutral,
      description: `${T.eventCancelledDmBody({ when })}${jump}`,
    });
  }
  return brandEmbed({
    title: T.eventPromotedDmTitle({ title: u(ev.title) }),
    color: EMBED_COLORS.success,
    description: `${T.eventPromotedDmIntro()}\n${when}${jump}\n\n${T.eventPromotedDmOutro()}`,
  });
}

// ─── Polls ──────────────────────────────────────────────────────────────────

const bar = (pct: number) => {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

/** Poll message. `showTally` false hides counts (non-live polls while open). Never includes voters. */
export function pollEmbed(r: PollResults, showTally: boolean): APIEmbed {
  const closed = r.status === 'CLOSED';
  const totalVotes = r.options.reduce((a, o) => a + o.votes, 0);
  const lines = r.options.map((o, i) => {
    if (!showTally) return `**${i + 1}.** ${u(o.label)}`;
    const pct = totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0;
    const votes = o.votes === 1 ? T.pollVotesOne({ count: o.votes }) : T.pollVotesMany({ count: o.votes });
    return `**${i + 1}.** ${u(o.label)}\n\`${bar(pct)}\` ${pct}% · ${votes}`;
  });
  const rules = [
    r.multipleChoice ? T.pollRulePickUpTo({ max: r.maxChoices }) : T.pollRulePickOne(),
    r.anonymous ? T.pollRuleAnonymous() : T.pollRuleVisible(),
  ].join(' · ');
  return brandEmbed({
    title: (closed ? T.pollTitleClosed : T.pollTitleOpen)({ question: u(truncate(r.question, 200)) }),
    description: lines.join('\n\n'),
    color: closed ? EMBED_COLORS.neutral : EMBED_COLORS.primary,
    fields: [
      {
        name: closed ? T.pollFieldClosed() : T.pollFieldEnds(),
        value: discordTimestamp(r.endsAt, 'R'),
        inline: true,
      },
      { name: T.pollFieldVoters(), value: String(r.totalBallots), inline: true },
      { name: T.pollFieldRules(), value: rules, inline: true },
      ...(!showTally && !closed
        ? [{ name: T.pollFieldResults(), value: T.pollResultsHidden(), inline: false }]
        : []),
    ],
  });
}

export function pollComponents(r: PollResults): Row[] {
  if (r.status !== 'OPEN') return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: CID.pollVote(r.pollId),
          placeholder: truncate(
            r.multipleChoice
              ? T.pollSelectPlaceholderMulti({ max: r.maxChoices })
              : T.pollSelectPlaceholder(),
            150,
          ),
          min_values: 1,
          max_values: r.multipleChoice ? r.maxChoices : 1,
          options: r.options.map((o, i) => ({
            label: truncate(`${i + 1}. ${u(o.label)}`, 100),
            value: o.optionId,
          })),
        },
      ],
    },
  ];
}

// ─── Suggestions ────────────────────────────────────────────────────────────

const SUGGESTION_COLORS: Record<Suggestion['status'], number> = {
  UNDER_REVIEW: EMBED_COLORS.primary,
  PLANNED: EMBED_COLORS.accent,
  IMPLEMENTED: EMBED_COLORS.success,
  DECLINED: EMBED_COLORS.danger,
  DUPLICATE: EMBED_COLORS.neutral,
};

export function suggestionEmbed(s: Suggestion, duplicateOfRef?: string | null): APIEmbed {
  if (s.hidden) {
    return brandEmbed({
      title: T.suggestionRemovedTitle({ ref: s.ref }),
      description: T.suggestionRemovedBody(),
      color: EMBED_COLORS.neutral,
    });
  }
  return brandEmbed({
    title: T.suggestionTitle({ ref: s.ref, title: u(truncate(s.title, 200)) }),
    description: u(truncate(s.body, 2000)),
    color: SUGGESTION_COLORS[s.status],
    fields: [
      {
        name: T.suggestionFieldStatus(),
        value:
          s.status === 'DUPLICATE' && duplicateOfRef
            ? T.suggestionDuplicateOf({ status: suggestionStatusLabel(s.status), ref: duplicateOfRef })
            : suggestionStatusLabel(s.status),
        inline: true,
      },
      {
        name: T.suggestionFieldVotes(),
        value: T.suggestionVotesValue({ up: s.upvotes, down: s.downvotes }),
        inline: true,
      },
      { name: T.suggestionFieldAuthor(), value: `<@${s.authorId}>`, inline: true },
      ...(s.staffResponse
        ? [{ name: T.suggestionFieldResponse(), value: u(truncate(s.staffResponse, 1024)), inline: false }]
        : []),
    ],
  });
}

export function suggestionComponents(s: Suggestion): Row[] {
  if (s.hidden) return [];
  const open = s.status === 'UNDER_REVIEW' || s.status === 'PLANNED';
  const rows: Row[] = [];
  if (open) {
    rows.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          emoji: { name: '👍' },
          label: String(s.upvotes),
          custom_id: CID.suggestionVote(s.id, 'up'),
        },
        {
          type: 2,
          style: 2,
          emoji: { name: '👎' },
          label: String(s.downvotes),
          custom_id: CID.suggestionVote(s.id, 'down'),
        },
      ],
    });
  }
  rows.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: CID.suggestionStatus(s.id),
        placeholder: truncate(T.suggestionStatusPlaceholder(), 150),
        min_values: 1,
        max_values: 1,
        options: SUGGESTION_STATUSES.map((k) => ({
          label: truncate(suggestionStatusLabel(k), 100),
          value: k,
          default: k === s.status,
        })),
      },
    ],
  });
  return rows;
}

export function suggestionStatusDmEmbed(s: Suggestion, link: string | null): APIEmbed {
  return brandEmbed({
    title: T.suggestionStatusDmTitle({ ref: s.ref, status: suggestionStatusLabel(s.status) }),
    color: SUGGESTION_COLORS[s.status],
    description: `**${u(truncate(s.title, 200))}**${s.staffResponse ? `\n\n${T.suggestionStatusDmResponse({ response: u(truncate(s.staffResponse, 1500)) })}` : ''}${link ? `\n\n[${T.suggestionDmViewLink()}](${link})` : ''}`,
  });
}

// ─── Giveaways ──────────────────────────────────────────────────────────────

export function giveawayEmbed(g: Giveaway, entrantCount: number, latestWinners: string[] | null): APIEmbed {
  const req: string[] = [];
  if (g.requiredRoleIds.length)
    req.push(T.giveawayReqRole({ roles: g.requiredRoleIds.map((r) => `<@&${r}>`).join(' or ') }));
  if (g.minAccountAgeDays) req.push(T.giveawayReqAccountAge({ days: g.minAccountAgeDays }));
  if (g.minMemberDays) req.push(T.giveawayReqMemberDays({ days: g.minMemberDays }));
  const statusLine =
    g.status === 'ACTIVE'
      ? T.giveawayEndsLine({
          relative: discordTimestamp(g.endsAt, 'R'),
          time: discordTimestamp(g.endsAt, 'f'),
        })
      : g.status === 'CANCELLED'
        ? T.giveawayCancelledLine()
        : T.giveawayEndedLine({ relative: discordTimestamp(g.endedAt ?? g.endsAt, 'R') });
  return brandEmbed({
    title: T.giveawayTitle({ prize: u(truncate(g.prize, 200)) }),
    description: [g.description ? u(truncate(g.description, 1000)) : null, statusLine]
      .filter(Boolean)
      .join('\n\n'),
    color: g.status === 'ACTIVE' ? EMBED_COLORS.accent : EMBED_COLORS.neutral,
    fields: [
      { name: T.giveawayFieldWinners(), value: String(g.winnerCount), inline: true },
      { name: T.giveawayFieldEntries(), value: String(entrantCount), inline: true },
      ...(req.length ? [{ name: T.giveawayFieldRequirements(), value: req.join('\n'), inline: false }] : []),
      ...(latestWinners
        ? [
            {
              name: T.giveawayFieldWinnerList(),
              value: latestWinners.length
                ? latestWinners.map((w) => `<@${w}>`).join(', ')
                : T.giveawayNoValidEntries(),
              inline: false,
            },
          ]
        : []),
    ],
    footer: T.giveawayFooter(),
  });
}

export function giveawayComponents(g: Giveaway): Row[] {
  if (g.status !== 'ACTIVE') return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: T.giveawayEnterButton(),
          emoji: { name: '🎉' },
          custom_id: CID.giveawayEnter(g.id),
        },
        { type: 2, style: 2, label: T.giveawayLeaveButton(), custom_id: CID.giveawayLeave(g.id) },
      ],
    },
  ];
}

/** Winner announcement text. Honest about short pools; mentions only the winners. */
export function winnerAnnouncementContent(g: Giveaway, draw: GiveawayDraw): string {
  const prize = u(truncate(g.prize, 200));
  const mentions = draw.winnerIds.map((w) => `<@${w}>`).join(', ');
  if (draw.kind === 'REROLL') {
    if (draw.winnerIds.length === 0) return T.winnerRerollNone({ prize });
    return T.winnerReroll({ prize, winners: mentions });
  }
  if (draw.winnerIds.length === 0) return T.winnerNoEntries({ prize });
  const shortVars = { count: draw.entrantCount, prizes: g.winnerCount };
  const short =
    draw.entrantCount < g.winnerCount
      ? `\n${draw.entrantCount === 1 ? T.winnerShortPoolOne(shortVars) : T.winnerShortPoolMany(shortVars)}`
      : '';
  return `${T.winnerAnnouncement({ winners: mentions, prize })}${short}\n${T.winnerContactNote()}`;
}
