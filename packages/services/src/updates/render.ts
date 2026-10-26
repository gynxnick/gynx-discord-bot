import type { APIEmbed } from 'discord-api-types/v10';
import { EMBED_COLORS, neutraliseMentions, truncate } from '@gynx/shared';
import { NO_MENTIONS, type MessageBody } from '../core/discord-port';
import { brandEmbed } from '../core/render';
import { publicLines, safeUrl, scrub, type UpdateEventData } from './github';
import { UpdatesText as T } from './texts';

/**
 * Pure renderers for the update feed.
 *
 * - Staff posts show what changed (short SHAs, first lines, authors, compare link).
 * - Public posts never contain SHAs, author names, branch names or compare links:
 *   only release notes or the `[public]`-tagged lines of commit messages.
 * Every piece of GitHub text is redacted again here (defence in depth) and
 * mention-neutralised; messages are sent with mentions disabled.
 */

export interface RenderRepo {
  displayName: string;
  color: string;
}
export interface RenderEvent {
  kind: string;
  ref: string;
  data: UpdateEventData;
  createdAt?: Date;
}

export const STAFF_MAX_COMMITS = 5;
export const PUBLIC_MAX_LINES = 15;
const COMMIT_LINE_MAX = 100;
const PUBLIC_LINE_MAX = 200;
/** Leaves room under Discord's 4096 description limit and 6000 per-message total. */
const DESCRIPTION_MAX = 3800;

const HEX = /^#?([0-9a-f]{6})$/i;
export function repoColor(hex: string): number {
  const m = HEX.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : EMBED_COLORS.primary;
}

/** Text from GitHub, safe to show: redacted, no pings, single line where needed. */
const clean = (s: string) => neutraliseMentions(scrub(s));
const firstLine = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .find((l) => l.trim())
    ?.trim() ?? '';
/** Inline code can't contain backticks. */
const code = (s: string) => `\`${s.replace(/`/g, '')}\``;

const linkButton = (label: string, url: string) => ({
  type: 1 as const,
  components: [{ type: 2 as const, style: 5 as const, label: truncate(label, 80), url }],
});

const message = (embed: APIEmbed, url: string | null, label: string): MessageBody => ({
  embeds: [embed],
  components: url ? [linkButton(label, url)] : [],
  allowed_mentions: NO_MENTIONS,
});

function releaseDescription(body: string): string {
  const notes = clean(body).trim();
  return truncate(notes || T.noReleaseNotes(), DESCRIPTION_MAX);
}

export function renderStaffUpdate(repo: RenderRepo, event: RenderEvent): MessageBody {
  const color = repoColor(repo.color);
  const d = event.data;
  const repoName = clean(repo.displayName);

  if (event.kind === 'release' && d.release) {
    const r = d.release;
    const title = (r.prerelease ? T.staffPrereleaseTitle : T.staffReleaseTitle)({
      repo: repoName,
      name: clean(r.name),
    });
    const url = safeUrl(r.url);
    const fields = [{ name: T.tagField(), value: code(truncate(clean(r.tag), 100)), inline: true }];
    if (d.pusher) fields.push({ name: T.pusherField(), value: truncate(clean(d.pusher), 100), inline: true });
    const embed = brandEmbed({
      title,
      url: url ?? undefined,
      description: releaseDescription(r.body),
      color,
      fields,
      timestamp: event.createdAt,
    });
    return message(embed, url, T.releaseButton());
  }

  const shown = d.commits.slice(-STAFF_MAX_COMMITS).reverse(); // newest first
  const lines = shown.map((c) => {
    const short = code(c.sha.slice(0, 7));
    const url = safeUrl(c.url);
    return T.staffCommitLine({
      sha: url ? `[${short}](${url})` : short,
      message: truncate(clean(firstLine(c.message)) || '(no message)', COMMIT_LINE_MAX),
      author: truncate(clean(c.author), 40),
    });
  });
  const total = Math.max(d.totalCommits, d.commits.length);
  if (total > shown.length) lines.push(T.staffMoreCommits({ count: total - shown.length }));

  const compare = safeUrl(d.compareUrl);
  const fields = [
    { name: T.branchField(), value: code(truncate(clean(event.ref), 100)), inline: true },
    { name: T.commitsField(), value: String(total), inline: true },
  ];
  if (d.pusher) fields.push({ name: T.pusherField(), value: truncate(clean(d.pusher), 100), inline: true });
  const embed = brandEmbed({
    title: T.staffPushTitle({ repo: repoName }),
    url: compare ?? undefined,
    description: truncate(lines.join('\n'), DESCRIPTION_MAX),
    color,
    fields,
    timestamp: event.createdAt,
  });
  return message(embed, compare, T.compareButton());
}

/** Whether an event has anything for the public channel (before repo/channel settings). */
export function hasPublicContent(event: RenderEvent): boolean {
  if (event.kind === 'release') return !!event.data.release && !event.data.release.prerelease;
  return publicLines(event.data.commits).length > 0;
}

/**
 * Public post, or null when nothing is public: a pre-release, or a push with
 * no `[public]`-tagged commits.
 */
export function renderPublicUpdate(repo: RenderRepo, event: RenderEvent): MessageBody | null {
  const color = repoColor(repo.color);
  const repoName = clean(repo.displayName);
  const d = event.data;

  if (event.kind === 'release') {
    const r = d.release;
    if (!r || r.prerelease) return null;
    const url = safeUrl(r.url);
    const embed = brandEmbed({
      title: T.publicReleaseTitle({ repo: repoName, name: clean(r.name) }),
      url: url ?? undefined,
      description: releaseDescription(r.body),
      color,
      timestamp: event.createdAt,
    });
    return message(embed, url, T.releaseButton());
  }

  const changes = publicLines(d.commits);
  if (!changes.length) return null;
  const listed = changes
    .slice(0, PUBLIC_MAX_LINES)
    .map((c) => T.publicChangeLine({ change: truncate(clean(c), PUBLIC_LINE_MAX) }));
  const embed = brandEmbed({
    title: T.publicPushTitle({ repo: repoName }),
    description: truncate(`${T.publicPushIntro()}\n${listed.join('\n')}`, DESCRIPTION_MAX),
    color,
    timestamp: event.createdAt,
  });
  return message(embed, null, '');
}
