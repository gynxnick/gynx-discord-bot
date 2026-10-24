import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { CommunityEvent, Giveaway, GiveawayDraw, Suggestion } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, formatInZone, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { displayText as u } from './common';
import type { EventCounts } from './events';
import type { PollResults } from './polls';
import { SUGGESTION_STATUS_LABELS } from './suggestions';

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
    ev.status === 'CANCELLED' ? '**Cancelled**' : ev.status === 'COMPLETED' ? '**Completed**' : ev.startsAt.getTime() <= Date.now() ? 'Started' : 'Scheduled';
  const capacity = ev.capacity ? `${counts.going}/${ev.capacity}` : `${counts.going}`;
  const fields = [
    { name: 'When', value: `${discordTimestamp(ev.startsAt, 'F')} (${discordTimestamp(ev.startsAt, 'R')})\n${formatInZone(ev.startsAt, ev.timezone)} ${ev.timezone}`, inline: false },
    ...(ev.endsAt ? [{ name: 'Ends', value: discordTimestamp(ev.endsAt, 'f'), inline: true }] : []),
    ...(ev.location ? [{ name: 'Where', value: u(truncate(ev.location, 100)), inline: true }] : []),
    { name: 'Going', value: capacity, inline: true },
    ...(ev.capacity && ev.waitlistEnabled ? [{ name: 'Waitlist', value: `${counts.waitlist}`, inline: true }] : []),
    { name: 'Status', value: status, inline: true },
    ...(ev.summary ? [{ name: 'Summary', value: u(truncate(ev.summary, 1024)), inline: false }] : []),
  ];
  return brandEmbed({
    title: `📅 ${u(ev.title)}`,
    description: u(truncate(ev.description, 2000)),
    color: ev.status === 'CANCELLED' ? EMBED_COLORS.neutral : EMBED_COLORS.primary,
    fields,
    footer: ev.status === 'SCHEDULED' ? 'RSVP with the buttons below · times show in your local zone' : undefined,
  });
}

export function eventComponents(ev: CommunityEvent): Row[] {
  if (ev.status !== 'SCHEDULED') return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Going', custom_id: CID.rsvp(ev.id, 'go') },
        { type: 2, style: 2, label: "Can't go", custom_id: CID.rsvp(ev.id, 'no') },
      ],
    },
  ];
}

export function eventDmEmbed(ev: CommunityEvent, kind: 'event.reminder' | 'event.cancelled' | 'event.promoted', link: string | null, minutes?: number): APIEmbed {
  const when = `${discordTimestamp(ev.startsAt, 'F')} (${discordTimestamp(ev.startsAt, 'R')})`;
  const jump = link ? `\n\n[View event](${link})` : '';
  if (kind === 'event.reminder') {
    const lead = minutes && minutes >= 60 ? `${Math.round(minutes / 60)} hour(s)` : `${minutes ?? 0} minute(s)`;
    return brandEmbed({ title: `⏰ Starting in ${lead}: ${u(ev.title)}`, description: `${when}${ev.location ? `\nWhere: ${u(ev.location)}` : ''}${jump}` });
  }
  if (kind === 'event.cancelled') {
    return brandEmbed({ title: `Event cancelled: ${u(ev.title)}`, color: EMBED_COLORS.neutral, description: `This event (${when}) has been cancelled by the team. Sorry for the change of plans.${jump}` });
  }
  return brandEmbed({ title: `🎉 You're in: ${u(ev.title)}`, color: EMBED_COLORS.success, description: `A spot opened up and you have been moved from the waitlist to **Going**.\n${when}${jump}\n\nCan't make it any more? Press "Can't go" on the event so someone else can take the spot.` });
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
    return `**${i + 1}.** ${u(o.label)}\n\`${bar(pct)}\` ${pct}% · ${o.votes} vote${o.votes === 1 ? '' : 's'}`;
  });
  const rules = [r.multipleChoice ? `Pick up to ${r.maxChoices}` : 'Pick one', r.anonymous ? 'Anonymous' : 'Votes visible to staff'].join(' · ');
  return brandEmbed({
    title: `${closed ? '📊 Final results' : '📊 Poll'}: ${u(truncate(r.question, 200))}`,
    description: lines.join('\n\n'),
    color: closed ? EMBED_COLORS.neutral : EMBED_COLORS.primary,
    fields: [
      { name: closed ? 'Closed' : 'Ends', value: discordTimestamp(r.endsAt, 'R'), inline: true },
      { name: 'Voters', value: String(r.totalBallots), inline: true },
      { name: 'Rules', value: rules, inline: true },
      ...(!showTally && !closed ? [{ name: 'Results', value: 'Shown when the poll closes.', inline: false }] : []),
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
          placeholder: r.multipleChoice ? `Choose up to ${r.maxChoices} option(s)` : 'Choose an option',
          min_values: 1,
          max_values: r.multipleChoice ? r.maxChoices : 1,
          options: r.options.map((o, i) => ({ label: truncate(`${i + 1}. ${u(o.label)}`, 100), value: o.optionId })),
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
    return brandEmbed({ title: `Suggestion ${s.ref}`, description: '_This suggestion was removed by the moderators._', color: EMBED_COLORS.neutral });
  }
  return brandEmbed({
    title: `💡 ${s.ref} · ${u(truncate(s.title, 200))}`,
    description: u(truncate(s.body, 2000)),
    color: SUGGESTION_COLORS[s.status],
    fields: [
      { name: 'Status', value: SUGGESTION_STATUS_LABELS[s.status] + (s.status === 'DUPLICATE' && duplicateOfRef ? ` of ${duplicateOfRef}` : ''), inline: true },
      { name: 'Votes', value: `👍 ${s.upvotes} · 👎 ${s.downvotes}`, inline: true },
      { name: 'Submitted by', value: `<@${s.authorId}>`, inline: true },
      ...(s.staffResponse ? [{ name: 'Team response', value: u(truncate(s.staffResponse, 1024)), inline: false }] : []),
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
        { type: 2, style: 2, emoji: { name: '👍' }, label: String(s.upvotes), custom_id: CID.suggestionVote(s.id, 'up') },
        { type: 2, style: 2, emoji: { name: '👎' }, label: String(s.downvotes), custom_id: CID.suggestionVote(s.id, 'down') },
      ],
    });
  }
  rows.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: CID.suggestionStatus(s.id),
        placeholder: 'Staff: set status',
        min_values: 1,
        max_values: 1,
        options: (Object.keys(SUGGESTION_STATUS_LABELS) as Suggestion['status'][]).map((k) => ({ label: SUGGESTION_STATUS_LABELS[k], value: k, default: k === s.status })),
      },
    ],
  });
  return rows;
}

export function suggestionStatusDmEmbed(s: Suggestion, link: string | null): APIEmbed {
  return brandEmbed({
    title: `Your suggestion ${s.ref} is now: ${SUGGESTION_STATUS_LABELS[s.status]}`,
    color: SUGGESTION_COLORS[s.status],
    description: `**${u(truncate(s.title, 200))}**${s.staffResponse ? `\n\n**Team response:** ${u(truncate(s.staffResponse, 1500))}` : ''}${link ? `\n\n[View on the board](${link})` : ''}`,
  });
}

// ─── Giveaways ──────────────────────────────────────────────────────────────

export function giveawayEmbed(g: Giveaway, entrantCount: number, latestWinners: string[] | null): APIEmbed {
  const req: string[] = [];
  if (g.requiredRoleIds.length) req.push(`Role: ${g.requiredRoleIds.map((r) => `<@&${r}>`).join(' or ')}`);
  if (g.minAccountAgeDays) req.push(`Account age ≥ ${g.minAccountAgeDays}d`);
  if (g.minMemberDays) req.push(`Member for ≥ ${g.minMemberDays}d`);
  const statusLine =
    g.status === 'ACTIVE'
      ? `Ends ${discordTimestamp(g.endsAt, 'R')} (${discordTimestamp(g.endsAt, 'f')})`
      : g.status === 'CANCELLED'
        ? '**Cancelled**'
        : `Ended ${discordTimestamp(g.endedAt ?? g.endsAt, 'R')}`;
  return brandEmbed({
    title: `🎁 Giveaway: ${u(truncate(g.prize, 200))}`,
    description: [g.description ? u(truncate(g.description, 1000)) : null, statusLine].filter(Boolean).join('\n\n'),
    color: g.status === 'ACTIVE' ? EMBED_COLORS.accent : EMBED_COLORS.neutral,
    fields: [
      { name: 'Winners', value: String(g.winnerCount), inline: true },
      { name: 'Entries', value: String(entrantCount), inline: true },
      ...(req.length ? [{ name: 'Requirements', value: req.join('\n'), inline: false }] : []),
      ...(latestWinners ? [{ name: 'Winner(s)', value: latestWinners.length ? latestWinners.map((w) => `<@${w}>`).join(', ') : 'No valid entries', inline: false }] : []),
    ],
    footer: 'Free community giveaway · winners drawn with a cryptographically secure, audited draw',
  });
}

export function giveawayComponents(g: Giveaway): Row[] {
  if (g.status !== 'ACTIVE') return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Enter', emoji: { name: '🎉' }, custom_id: CID.giveawayEnter(g.id) },
        { type: 2, style: 2, label: 'Leave', custom_id: CID.giveawayLeave(g.id) },
      ],
    },
  ];
}

/** Winner announcement text. Honest about short pools; mentions only the winners. */
export function winnerAnnouncementContent(g: Giveaway, draw: GiveawayDraw): string {
  const prize = u(truncate(g.prize, 200));
  const mentions = draw.winnerIds.map((w) => `<@${w}>`).join(', ');
  if (draw.kind === 'REROLL') {
    if (draw.winnerIds.length === 0) return `🔁 Reroll for **${prize}**: no remaining eligible entrants.`;
    return `🔁 Reroll for **${prize}**: congratulations ${mentions}!`;
  }
  if (draw.winnerIds.length === 0) return `The giveaway for **${prize}** has ended with no valid entries, so there is no winner.`;
  const short = draw.entrantCount < g.winnerCount ? `\n_Only ${draw.entrantCount} eligible entr${draw.entrantCount === 1 ? 'y' : 'ies'} for ${g.winnerCount} prize(s), so every entrant wins._` : '';
  return `🎉 Congratulations ${mentions}! You won **${prize}**.${short}\nThe team will contact you about your prize.`;
}
