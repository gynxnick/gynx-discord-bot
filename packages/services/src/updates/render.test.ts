import { describe, expect, it } from 'vitest';
import type { APIEmbed } from 'discord-api-types/v10';
import { runWithTextOverrides } from '../core/text';
import type { UpdateCommit, UpdateEventData } from './github';
import {
  hasPublicContent,
  renderPublicUpdate,
  renderStaffUpdate,
  repoColor,
  type RenderEvent,
} from './render';

const repo = { displayName: 'Website', color: '#7C3AED' };
/** Built at runtime so no token-shaped literal lives in the repository. */
const fakeGithubToken = () => ['gh', 'p_', 'Qw7'.repeat(12)].join('');

const commit = (i: number, message: string, author = `dev${i}`): UpdateCommit => ({
  sha: `${String(i).padStart(7, '0')}${'f'.repeat(33)}`,
  message,
  author,
  url: `https://github.com/gynx-gg/website/commit/${i}`,
});

const pushEvent = (commits: UpdateCommit[], extra: Partial<UpdateEventData> = {}): RenderEvent => ({
  kind: 'push',
  ref: 'main',
  createdAt: new Date('2026-10-25T12:00:00Z'),
  data: {
    commits,
    totalCommits: commits.length,
    compareUrl: 'https://github.com/gynx-gg/website/compare/a...b',
    pusher: 'nick',
    release: null,
    ...extra,
  },
});

const releaseEvent = (over: Partial<NonNullable<UpdateEventData['release']>> = {}): RenderEvent => ({
  kind: 'release',
  ref: 'v1.2.0',
  data: {
    commits: [],
    totalCommits: 0,
    compareUrl: null,
    pusher: 'nick',
    release: {
      name: 'v1.2.0',
      tag: 'v1.2.0',
      body: 'Faster pages.',
      url: 'https://github.com/gynx-gg/website/releases/tag/v1.2.0',
      prerelease: false,
      ...over,
    },
  },
});

const embedOf = (b: { embeds?: APIEmbed[] } | null) => b!.embeds![0]!;
/** Total characters Discord counts towards the 6000 per-message embed limit. */
const embedSize = (e: APIEmbed) =>
  (e.title ?? '').length +
  (e.description ?? '').length +
  (e.footer?.text ?? '').length +
  (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

describe('renderStaffUpdate', () => {
  it('lists up to 5 commits newest first with linked short SHAs, author and "+N more"', () => {
    const commits = Array.from({ length: 8 }, (_, i) => commit(i, `Change number ${i}\n\nbody ${i}`));
    const body = renderStaffUpdate(repo, pushEvent(commits, { totalCommits: 8 }));
    const e = embedOf(body);
    expect(e.title).toBe('Website updated');
    expect(e.color).toBe(0x7c3aed);
    const lines = e.description!.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('[`0000007`](https://github.com/gynx-gg/website/commit/7) Change number 7 · dev7');
    expect(lines.at(-1)).toBe('+3 more');
    expect(e.description).not.toContain('body 7'); // first line only
    expect(JSON.stringify(e.fields)).toContain('main');
    expect(JSON.stringify(e.fields)).toContain('nick');
    expect(JSON.stringify(body.components)).toContain('compare/a...b');
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('counts commits GitHub did not include in the payload', () => {
    const e = embedOf(renderStaffUpdate(repo, pushEvent([commit(1, 'x')], { totalCommits: 40 })));
    expect(e.description).toContain('+39 more');
  });

  it('stays within Discord limits for huge messages', () => {
    const big = 'x'.repeat(5000);
    const commits = Array.from({ length: 20 }, (_, i) => commit(i, big, 'a'.repeat(300)));
    const body = renderStaffUpdate({ displayName: 'W'.repeat(300), color: 'bad' }, pushEvent(commits));
    const e = embedOf(body);
    expect(e.title!.length).toBeLessThanOrEqual(256);
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    expect(embedSize(e)).toBeLessThanOrEqual(6000);
    for (const f of e.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(repoColor('bad')).toBeTypeOf('number');
  });

  it('redacts secrets and neutralises mass mentions', () => {
    const token = fakeGithubToken();
    const e = embedOf(renderStaffUpdate(repo, pushEvent([commit(1, `Use ${token} @everyone`)])));
    expect(e.description).not.toContain(token);
    expect(e.description).toContain('[REDACTED]');
    expect(e.description).not.toMatch(/@everyone/);
  });

  it('renders releases and pre-releases', () => {
    expect(embedOf(renderStaffUpdate(repo, releaseEvent())).title).toBe('Website: new release v1.2.0');
    expect(embedOf(renderStaffUpdate(repo, releaseEvent({ prerelease: true }))).title).toBe(
      'Website: new pre-release v1.2.0',
    );
  });

  it('uses server text overrides', () => {
    const e = runWithTextOverrides({ 'updates.staffPushTitle': 'Neue Version: {repo}' }, () =>
      embedOf(renderStaffUpdate(repo, pushEvent([commit(1, 'x')]))),
    );
    expect(e.title).toBe('Neue Version: Website');
  });
});

describe('renderPublicUpdate', () => {
  it('returns null for untagged pushes and pre-releases', () => {
    const untagged = pushEvent([commit(1, 'Refactor'), commit(2, 'Bump deps')]);
    expect(renderPublicUpdate(repo, untagged)).toBeNull();
    expect(hasPublicContent(untagged)).toBe(false);
    expect(renderPublicUpdate(repo, releaseEvent({ prerelease: true }))).toBeNull();
  });

  it('lists only tagged lines: no SHAs, authors, branch or compare link', () => {
    const commits = [
      commit(1, 'Internal refactor of billing', 'alice'),
      commit(2, 'Faster server start-up [public] (#12)', 'bob'),
      commit(3, 'Merge pull request #13 from gynx-gg/backups\n\nOne-click backups [PUBLIC]', 'carol'),
    ];
    const body = renderPublicUpdate(repo, pushEvent(commits));
    const e = embedOf(body);
    expect(e.title).toBe('Website update');
    expect(e.description).toContain('• Faster server start-up');
    expect(e.description).toContain('• One-click backups');
    const all = JSON.stringify(body);
    for (const c of commits) {
      expect(all).not.toContain(c.sha.slice(0, 7));
      expect(all).not.toContain(c.author);
      expect(all).not.toContain(c.url);
    }
    expect(all).not.toContain('Internal refactor');
    expect(all).not.toContain('gynx-gg/backups');
    expect(all).not.toContain('compare');
    expect(all).not.toMatch(/\[public\]/i);
    expect(all).not.toContain('(#12)');
    expect(body!.components).toEqual([]);
    expect(e.fields).toBeUndefined();
    expect(body!.allowed_mentions).toEqual({ parse: [] });
  });

  it('redacts secrets in tagged lines', () => {
    const token = fakeGithubToken();
    const e = embedOf(renderPublicUpdate(repo, pushEvent([commit(1, `New API key ${token} [public]`)])));
    expect(e.description).not.toContain(token);
    expect(e.description).toContain('[REDACTED]');
  });

  it('renders releases with notes and a link, within limits', () => {
    const body = renderPublicUpdate(repo, releaseEvent({ body: 'n'.repeat(10_000) }));
    const e = embedOf(body);
    expect(e.title).toBe('Website v1.2.0 released');
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    expect(embedSize(e)).toBeLessThanOrEqual(6000);
    expect(JSON.stringify(body!.components)).toContain('releases/tag/v1.2.0');
  });

  it('caps many tagged lines within limits', () => {
    const commits = Array.from({ length: 20 }, (_, i) =>
      commit(i, `${'Long change '.repeat(40)}${i} [public]`),
    );
    const e = embedOf(renderPublicUpdate(repo, pushEvent(commits)));
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    expect(embedSize(e)).toBeLessThanOrEqual(6000);
  });

  it('empty release notes get a placeholder', () => {
    expect(embedOf(renderPublicUpdate(repo, releaseEvent({ body: '' }))).description).toBe(
      'No release notes.',
    );
  });
});
