import type { Metadata } from 'next';
import { engagement } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { votePercent, wantsVoters } from '@/components/marketing/polls/poll-form';
import { ClosePollButton, PollStatusBadge } from '@/components/marketing/polls/PollsTable';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { formatDateTime, formatNumber } from '@/lib/format';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Poll results' };

export default async function PollResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const page = await requirePagePermission('polls.manage', 'marketing.polls.results');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, timezone } = page;
  const showVoters = wantsVoters(firstParam(sp, 'voters'));

  // The service never returns voter ids for anonymous polls, even when asked.
  const res = await load(() => engagement.getPollResults(ctx, id, { includeVoters: showVoters }));
  if (!res.ok) return <ModuleNotice title="Poll" message={res.message} />;
  const r = res.data;
  const href = `/marketing/polls/${encodeURIComponent(r.pollId)}`;
  const maxVotes = Math.max(0, ...r.options.map((o) => o.votes));
  const totalVotes = r.options.reduce((s, o) => s + o.votes, 0);

  return (
    <>
      <PageHeader
        title={r.question}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <PollStatusBadge status={r.status} />
            <span>
              {r.status === 'OPEN' ? 'Ends' : 'Ended'} {formatDateTime(r.endsAt, timezone)}
            </span>
          </span>
        }
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Polls', href: '/marketing/polls' },
          { label: 'Results' },
        ]}
        actions={
          r.status === 'OPEN' ? <ClosePollButton poll={{ id: r.pollId, question: r.question }} /> : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Ballots" value={formatNumber(r.totalBallots)} hint="Members who voted" />
        <StatCard
          label="Votes"
          value={formatNumber(totalVotes)}
          hint={r.multipleChoice ? `Up to ${r.maxChoices} per ballot` : 'One per ballot'}
        />
        <StatCard label="Options" value={formatNumber(r.options.length)} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Results"
          description={
            r.multipleChoice
              ? 'Percent of ballots that picked each option; totals can exceed 100%.'
              : 'Percent of ballots.'
          }
          actions={
            r.anonymous ? (
              <Badge tone="warning">Anonymous</Badge>
            ) : showVoters ? (
              <ButtonLink href={href} size="sm" variant="secondary">
                Hide voters
              </ButtonLink>
            ) : (
              <ButtonLink href={`${href}?voters=1`} size="sm" variant="secondary">
                Show voters
              </ButtonLink>
            )
          }
        />
        {r.options.length === 0 ? (
          <EmptyState title="This poll has no options" />
        ) : (
          <ol className="space-y-4 p-4">
            {r.options.map((o) => {
              const pct = votePercent(o.votes, r.totalBallots);
              const width = maxVotes > 0 ? Math.max(o.votes > 0 ? 1 : 0, Math.min(100, pct)) : 0;
              return (
                <li key={o.optionId}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words font-medium text-fg">{o.label}</span>
                    <span className="shrink-0 tabular-nums text-fg-muted">
                      {formatNumber(o.votes)} · {pct}%
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full overflow-hidden rounded bg-surface-raised"
                    role="meter"
                    aria-label={`${o.label}: ${o.votes} votes, ${pct}% of ballots`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <div
                      className={
                        o.votes === maxVotes && maxVotes > 0
                          ? 'h-full rounded bg-accent'
                          : 'h-full rounded bg-accent/60'
                      }
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  {showVoters && !r.anonymous && o.voterIds && (
                    <details className="mt-2 text-xs" open={o.voterIds.length <= 20}>
                      <summary className="cursor-pointer text-fg-muted">
                        {o.voterIds.length} voter{o.voterIds.length === 1 ? '' : 's'}
                      </summary>
                      {o.voterIds.length === 0 ? (
                        <p className="mt-1 text-fg-muted">No votes.</p>
                      ) : (
                        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Voters for ${o.label}`}>
                          {o.voterIds.map((u) => (
                            <li
                              key={u}
                              className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono"
                            >{`<@${u}>`}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {r.anonymous ? (
        <Alert tone="info" title="Voters are never shown for anonymous polls">
          Members were promised anonymity when they voted, so the dashboard and bot only ever expose totals
          for this poll — to every staff member, regardless of permissions.
        </Alert>
      ) : (
        showVoters && (
          <Alert tone="info" title="Voter identities are visible to staff with polls.manage">
            This poll is not anonymous. Use voter lists for checks like duplicate accounts; avoid sharing them
            publicly.
          </Alert>
        )
      )}
    </>
  );
}
