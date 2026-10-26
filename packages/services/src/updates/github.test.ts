import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyPush,
  classifyRelease,
  publicLineOf,
  publicLines,
  pushPayloadSchema,
  releasePayloadSchema,
  signGithubPayload,
  verifyGithubSignature,
} from './github';

const SECRET = 'test-webhook-secret-0123456789';
/** Built at runtime so no token-shaped literal lives in the repository. */
const fakeGithubToken = () => ['gh', 'p_', 'Zx9'.repeat(12)].join('');

const push = (over: Record<string, unknown> = {}) =>
  pushPayloadSchema.parse({
    ref: 'refs/heads/main',
    compare: 'https://github.com/gynx-gg/website/compare/abc...def',
    repository: { full_name: 'GYNX-GG/Website', default_branch: 'main' },
    pusher: { name: 'nick' },
    commits: [
      {
        id: 'a'.repeat(40),
        message: 'Fix login redirect',
        url: 'https://github.com/gynx-gg/website/commit/aaaa',
        author: { name: 'Nick', username: 'nick' },
      },
    ],
    ...over,
  });

describe('verifyGithubSignature', () => {
  const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
  const good = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

  it('accepts a valid signature (string or bytes, any hex case)', () => {
    expect(verifyGithubSignature(SECRET, body, good)).toBe(true);
    expect(verifyGithubSignature(SECRET, Buffer.from(body), good)).toBe(true);
    expect(verifyGithubSignature(SECRET, body, good.toUpperCase().replace('SHA256=', 'sha256='))).toBe(true);
    expect(signGithubPayload(SECRET, body)).toBe(good);
  });

  it('rejects a wrong secret or a modified body', () => {
    expect(verifyGithubSignature('another-secret-value-123', body, good)).toBe(false);
    expect(verifyGithubSignature(SECRET, `${body} `, good)).toBe(false);
  });

  it('rejects a missing or empty header and an empty secret', () => {
    expect(verifyGithubSignature(SECRET, body, null)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, '')).toBe(false);
    expect(verifyGithubSignature('', body, good)).toBe(false);
  });

  it('rejects malformed and wrong-length signatures without throwing', () => {
    expect(verifyGithubSignature(SECRET, body, good.slice(0, -2))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, `${good}00`)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, good.replace('sha256=', 'sha1='))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, good.replace('sha256=', ''))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, `sha256=${'z'.repeat(64)}`)).toBe(false);
  });
});

describe('classifyPush', () => {
  it('normalises a push to the default branch', () => {
    const r = classifyPush(push(), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.branch).toBe('main');
    expect(r.value.data).toMatchObject({
      totalCommits: 1,
      compareUrl: 'https://github.com/gynx-gg/website/compare/abc...def',
      pusher: 'nick',
      release: null,
      commits: [{ sha: 'a'.repeat(40), message: 'Fix login redirect', author: 'nick' }],
    });
  });

  it('uses the configured branch instead of the default branch', () => {
    expect(classifyPush(push(), 'production')).toMatchObject({ ok: false });
    expect(classifyPush(push({ ref: 'refs/heads/production' }), 'production')).toMatchObject({ ok: true });
  });

  it('ignores tag pushes, deletions, empty pushes and other branches', () => {
    expect(classifyPush(push({ ref: 'refs/tags/v1.0.0' }), null)).toEqual({ ok: false, reason: 'tag push' });
    expect(classifyPush(push({ deleted: true }), null)).toEqual({ ok: false, reason: 'branch deleted' });
    expect(classifyPush(push({ commits: [] }), null)).toEqual({ ok: false, reason: 'no commits' });
    expect(classifyPush(push({ ref: 'refs/heads/dev' }), null)).toMatchObject({ ok: false });
  });

  it('keeps at most 20 commits but remembers the total; drops unsafe URLs', () => {
    const commits = Array.from({ length: 25 }, (_, i) => ({
      id: String(i).padStart(40, '0'),
      message: `c${i}`,
      url: i === 24 ? 'javascript:alert(1)' : `https://github.com/x/y/commit/${i}`,
    }));
    const r = classifyPush(push({ commits, compare: 'http://insecure' }), null);
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.data.commits).toHaveLength(20);
    expect(r.value.data.totalCommits).toBe(25);
    expect(r.value.data.commits.at(-1)!.url).toBe('');
    expect(r.value.data.compareUrl).toBeNull();
  });

  it('redacts secrets in commit messages before they are stored', () => {
    const token = fakeGithubToken();
    const r = classifyPush(
      push({ commits: [{ id: 'b'.repeat(40), message: `Rotate key ${token} [public]`, url: '' }] }),
      null,
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.data.commits[0]!.message).not.toContain(token);
    expect(r.value.data.commits[0]!.message).toContain('[REDACTED]');
  });
});

describe('classifyRelease', () => {
  const release = (over: Record<string, unknown> = {}, action = 'published') =>
    releasePayloadSchema.parse({
      action,
      repository: { full_name: 'gynx-gg/website' },
      sender: { login: 'nick' },
      release: {
        name: 'v1.2.0',
        tag_name: 'v1.2.0',
        body: 'Faster pages.',
        html_url: 'https://github.com/gynx-gg/website/releases/tag/v1.2.0',
        draft: false,
        prerelease: false,
        ...over,
      },
    });

  it('accepts published releases', () => {
    const r = classifyRelease(release());
    expect(r).toMatchObject({
      ok: true,
      value: {
        tag: 'v1.2.0',
        data: { release: { name: 'v1.2.0', body: 'Faster pages.', prerelease: false } },
      },
    });
  });

  it('keeps the prerelease flag, falls back to the tag for the name', () => {
    const r = classifyRelease(release({ prerelease: true, name: '' }));
    expect(r).toMatchObject({ ok: true, value: { data: { release: { name: 'v1.2.0', prerelease: true } } } });
  });

  it('ignores drafts and other actions', () => {
    expect(classifyRelease(release({ draft: true }))).toMatchObject({ ok: false });
    expect(classifyRelease(release({}, 'created'))).toMatchObject({ ok: false });
    expect(classifyRelease(release({}, 'edited'))).toMatchObject({ ok: false });
  });

  it('redacts release notes', () => {
    const token = fakeGithubToken();
    const r = classifyRelease(release({ body: `Notes\nGITHUB_TOKEN=${token}` }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.data.release!.body).not.toContain(token);
  });
});

describe('public lines', () => {
  it('squash merge: uses the tagged title, strips the tag and the PR number', () => {
    expect(publicLineOf('Faster server start-up [public] (#12)')).toBe('Faster server start-up');
  });

  it('merge commit: uses the tagged body line (the PR title), never the merge line', () => {
    const msg = 'Merge pull request #12 from gynx-gg/fast-start\n\nNew: one-click backups [public]';
    expect(publicLineOf(msg)).toBe('New: one-click backups');
  });

  it('is case-insensitive', () => {
    expect(publicLineOf('Dark mode [PUBLIC]')).toBe('Dark mode');
    expect(publicLineOf('[Public] Dark mode')).toBe('Dark mode');
  });

  it('untagged commits are not public', () => {
    expect(publicLineOf('Refactor session store')).toBeNull();
    expect(publicLineOf('Mention public in a sentence')).toBeNull();
  });

  it('a tag on its own line marks the title; a merge title is never used', () => {
    expect(publicLineOf('Fix login redirect\n\n[public]')).toBe('Fix login redirect');
    expect(publicLineOf('Merge branch dev into main\n\n[public]')).toBeNull();
  });

  it('only the tagged line is used (other lines stay private)', () => {
    const line = publicLineOf('Internal: bump deps\nSecret plan details\nNew pricing page [public]');
    expect(line).toBe('New pricing page');
  });

  it('dedupes identical lines across a push (PR commit + merge commit)', () => {
    expect(
      publicLines([
        { message: 'New pricing page [public]' },
        { message: 'Merge pull request #3 from x/y\n\nNew pricing page [public]' },
        { message: 'untagged' },
        { message: 'Dark mode [public]' },
      ]),
    ).toEqual(['New pricing page', 'Dark mode']);
  });
});
