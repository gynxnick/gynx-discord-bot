import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { redactSecrets } from '@gynx/shared';

/**
 * GitHub webhook handling that does not depend on HTTP or the database:
 * signature verification, payload parsing (only the fields we use) and
 * normalisation into the trimmed shape stored on UpdateFeedEvent.data.
 */

// ── Signature ────────────────────────────────────────────────────────────────

const SIGNATURE = /^sha256=([0-9a-f]{64})$/i;

/**
 * Verify `X-Hub-Signature-256` (HMAC-SHA256 of the raw request body with the
 * webhook secret). Constant-time; malformed, missing or wrong-length headers
 * are rejected before comparing.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: Uint8Array | string,
  header: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  const m = SIGNATURE.exec(header.trim());
  if (!m) return false;
  const given = Buffer.from(m[1]!.toLowerCase(), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/** `sha256=<hex>` for a body (tests, local tooling). */
export function signGithubPayload(secret: string, rawBody: Uint8Array | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

// ── Payloads (only the fields we read) ───────────────────────────────────────

const repository = z.object({
  full_name: z.string().min(3).max(200),
  default_branch: z.string().max(255).optional(),
});

const commit = z.object({
  id: z.string().max(64),
  message: z.string().max(100_000).default(''),
  url: z.string().max(2000).default(''),
  author: z
    .object({ name: z.string().max(200).optional(), username: z.string().max(200).optional() })
    .partial()
    .optional(),
});

export const pushPayloadSchema = z.object({
  ref: z.string().max(500),
  deleted: z.boolean().optional().default(false),
  compare: z.string().max(2000).nullish(),
  repository,
  pusher: z
    .object({ name: z.string().max(200).optional() })
    .partial()
    .nullish(),
  sender: z
    .object({ login: z.string().max(200).optional() })
    .partial()
    .nullish(),
  commits: z.array(commit).max(2000).default([]),
});
export type PushPayload = z.output<typeof pushPayloadSchema>;

export const releasePayloadSchema = z.object({
  action: z.string().max(50),
  repository,
  sender: z
    .object({ login: z.string().max(200).optional() })
    .partial()
    .nullish(),
  release: z.object({
    name: z.string().max(1000).nullish(),
    tag_name: z.string().max(500),
    body: z.string().max(200_000).nullish(),
    html_url: z.string().max(2000).default(''),
    draft: z.boolean().default(false),
    prerelease: z.boolean().default(false),
  }),
});
export type ReleasePayload = z.output<typeof releasePayloadSchema>;

/** Minimal shape used to find the repository config before full parsing. */
export const repoRefSchema = z.object({ repository });

export const normaliseRepoName = (fullName: string) => fullName.trim().toLowerCase();

// ── Normalised event data (stored on UpdateFeedEvent.data) ───────────────────

export interface UpdateCommit {
  sha: string;
  message: string;
  author: string;
  url: string;
}
export interface UpdateRelease {
  name: string;
  tag: string;
  body: string;
  url: string;
  prerelease: boolean;
}
export interface UpdateEventData {
  commits: UpdateCommit[];
  /** Commits in the push (GitHub lists at most 20 in the payload). */
  totalCommits: number;
  compareUrl: string | null;
  pusher: string | null;
  release: UpdateRelease | null;
}

/** Stored limits: enough for rendering, small enough to keep rows light. */
export const MAX_STORED_COMMITS = 20;
const MAX_MESSAGE = 2000;
const MAX_RELEASE_BODY = 6000;

const HTTPS_URL = /^https:\/\/[^\s<>()"'`]+$/i;
/** Only well-formed https URLs reach an embed (anything else is dropped). */
export const safeUrl = (u: string | null | undefined): string | null => (u && HTTPS_URL.test(u) ? u : null);

/** Redact secrets (tokens, keys, credentials, emails, IPs) from free text from GitHub. */
export const scrub = (s: string): string => redactSecrets(s);

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

export type Classified<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Decide whether a push is posted and normalise it. `trackedBranch` is the
 * repo's configured branch (null = the repository's default branch).
 */
export function classifyPush(
  p: PushPayload,
  trackedBranch: string | null,
): Classified<{
  branch: string;
  data: UpdateEventData;
}> {
  if (p.ref.startsWith('refs/tags/')) return { ok: false, reason: 'tag push' };
  if (!p.ref.startsWith('refs/heads/')) return { ok: false, reason: 'not a branch push' };
  const branch = p.ref.slice('refs/heads/'.length);
  if (p.deleted) return { ok: false, reason: 'branch deleted' };
  const tracked = trackedBranch ?? p.repository.default_branch ?? null;
  if (!tracked) return { ok: false, reason: 'no tracked branch' };
  if (branch !== tracked) return { ok: false, reason: `branch ${branch} is not tracked` };
  if (p.commits.length === 0) return { ok: false, reason: 'no commits' };
  const commits = p.commits.slice(-MAX_STORED_COMMITS).map((c) => ({
    sha: c.id,
    message: scrub(clip(c.message, MAX_MESSAGE)),
    author: scrub(clip(c.author?.username || c.author?.name || 'unknown', 100)),
    url: safeUrl(c.url) ?? '',
  }));
  return {
    ok: true,
    value: {
      branch,
      data: {
        commits,
        totalCommits: p.commits.length,
        compareUrl: safeUrl(p.compare),
        pusher:
          p.pusher?.name || p.sender?.login
            ? scrub(clip(p.pusher?.name || p.sender?.login || '', 100))
            : null,
        release: null,
      },
    },
  };
}

/** Only `published`, non-draft releases are posted. */
export function classifyRelease(p: ReleasePayload): Classified<{ tag: string; data: UpdateEventData }> {
  if (p.action !== 'published') return { ok: false, reason: `release ${p.action}` };
  if (p.release.draft) return { ok: false, reason: 'draft release' };
  const tag = p.release.tag_name;
  return {
    ok: true,
    value: {
      tag,
      data: {
        commits: [],
        totalCommits: 0,
        compareUrl: null,
        pusher: p.sender?.login ? scrub(clip(p.sender.login, 100)) : null,
        release: {
          name: scrub(clip((p.release.name || '').trim() || tag, 200)),
          tag: scrub(clip(tag, 200)),
          body: scrub(clip(p.release.body ?? '', MAX_RELEASE_BODY)),
          url: safeUrl(p.release.html_url) ?? '',
          prerelease: p.release.prerelease,
        },
      },
    },
  };
}

/** Read stored event data defensively (it is JSON in the database). */
export function readEventData(raw: unknown): UpdateEventData {
  const d = (raw ?? {}) as Partial<UpdateEventData>;
  return {
    commits: Array.isArray(d.commits) ? d.commits : [],
    totalCommits: typeof d.totalCommits === 'number' ? d.totalCommits : (d.commits?.length ?? 0),
    compareUrl: typeof d.compareUrl === 'string' ? d.compareUrl : null,
    pusher: typeof d.pusher === 'string' ? d.pusher : null,
    release: d.release && typeof d.release === 'object' ? d.release : null,
  };
}

// ── [public] tag ─────────────────────────────────────────────────────────────

const PUBLIC_TAG = /\[public\]/i;
const PUBLIC_TAG_ALL = /\s*\[public\]\s*/gi;
/** Trailing GitHub PR reference added by squash merges, e.g. "(#12)". */
const PR_REF = /\s*\(#\d+\)\s*$/;

/**
 * The public line of a commit message, or null when it isn't tagged.
 *
 * Uses the first line containing `[public]` (case-insensitive) with the tag and
 * any trailing "(#12)" PR reference removed. Works for squash merges
 * ("Title [public] (#12)") and merge commits, whose body line is the PR title.
 * A tag on a line of its own marks the commit's title line instead (never a
 * "Merge pull request …" line, which only names internal branches).
 */
export function publicLineOf(message: string): string | null {
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  const tagged = lines.find((l) => PUBLIC_TAG.test(l));
  if (tagged === undefined) return null;
  const clean = (l: string) => l.replace(PUBLIC_TAG_ALL, ' ').replace(PR_REF, '').replace(/\s+/g, ' ').trim();
  let line = clean(tagged);
  if (!line) {
    const title = clean(lines.find((l) => l.trim()) ?? '');
    line = /^merge\b/i.test(title) ? '' : title;
  }
  return line || null;
}

/** Distinct public lines of a push, in commit order. Redacted. */
export function publicLines(commits: readonly Pick<UpdateCommit, 'message'>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of commits) {
    const line = publicLineOf(c.message);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(scrub(line));
  }
  return out;
}
