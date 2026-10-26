import { defineTexts } from '../core/text';

/**
 * Update feed wording (GitHub pushes and releases). Editable per server in
 * Dashboard → Settings → Bot text (namespace "updates").
 */
export const UpdatesText = defineTexts('updates', {
  // ── Staff channel (every push to a tracked branch) ──
  staffPushTitle: {
    default: '{repo} updated',
    help: 'Staff update feed: title of a push post. {repo} is the repository display name.',
    vars: ['repo'],
    kind: 'title',
  },
  staffReleaseTitle: {
    default: '{repo}: new release {name}',
    help: 'Staff update feed: title of a published release.',
    vars: ['repo', 'name'],
    kind: 'title',
  },
  staffPrereleaseTitle: {
    default: '{repo}: new pre-release {name}',
    help: 'Staff update feed: title of a published pre-release (pre-releases are never posted publicly).',
    vars: ['repo', 'name'],
    kind: 'title',
  },
  staffCommitLine: {
    default: '{sha} {message} · {author}',
    help: 'Staff update feed: one commit. {sha} is the linked short hash, {message} the first line of the commit message.',
    vars: ['sha', 'message', 'author'],
    kind: 'short',
  },
  staffMoreCommits: {
    default: '+{count} more',
    help: 'Staff update feed: shown when a push has more commits than are listed.',
    vars: ['count'],
    kind: 'short',
  },
  branchField: { default: 'Branch', help: 'Staff update feed: label of the branch field.', kind: 'title' },
  pusherField: { default: 'Pushed by', help: 'Staff update feed: label of the pusher field.', kind: 'title' },
  commitsField: {
    default: 'Commits',
    help: 'Staff update feed: label of the commit count field.',
    kind: 'title',
  },
  tagField: { default: 'Tag', help: 'Update feed: label of the release tag field.', kind: 'title' },
  compareButton: {
    default: 'View changes',
    help: 'Staff update feed: link button to the GitHub compare view.',
    kind: 'label',
  },
  noReleaseNotes: {
    default: 'No release notes.',
    help: 'Update feed: shown when a release has no notes.',
    kind: 'short',
  },

  // ── Public channel (releases and [public]-tagged commits only) ──
  publicPushTitle: {
    default: '{repo} update',
    help: 'Public update feed: title of a post listing [public]-tagged changes.',
    vars: ['repo'],
    kind: 'title',
  },
  publicPushIntro: {
    default: 'Here’s what’s new:',
    help: 'Public update feed: line above the list of changes.',
    kind: 'short',
  },
  publicChangeLine: {
    default: '• {change}',
    help: 'Public update feed: one change. {change} is the tagged line of the commit message, without the tag.',
    vars: ['change'],
    kind: 'short',
  },
  publicReleaseTitle: {
    default: '{repo} {name} released',
    help: 'Public update feed: title of a published release.',
    vars: ['repo', 'name'],
    kind: 'title',
  },
  releaseButton: {
    default: 'Release notes',
    help: 'Update feed: link button to the GitHub release.',
    kind: 'label',
  },
});
