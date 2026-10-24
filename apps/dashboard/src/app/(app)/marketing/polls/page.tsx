import type { Metadata } from 'next';
import { engagement, requireModule } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadChannels } from '@/components/community/server/data';
import { PollsTable, type PollRow } from '@/components/marketing/polls/PollsTable';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime } from '@/lib/format';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Polls' };

export default async function PollsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('polls.manage', 'marketing.polls');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const statusRaw = firstParam(sp, 'status');
  const status = statusRaw === 'OPEN' || statusRaw === 'CLOSED' ? statusRaw : undefined;
  const q = firstParam(sp, 'q')?.slice(0, 100);

  // listPolls does not check the module itself; gate on it so a disabled module shows a notice.
  const list = await load(async () => {
    await requireModule(ctx, 'engagement');
    return engagement.listPolls(ctx, { status, q, cursor: readCursor(sp).cursor, limit: 25 });
  });
  if (!list.ok) return <ModuleNotice title="Polls" message={list.message} />;
  const channels = await loadChannels(ctx);

  const rows: PollRow[] = list.data.items.map((p) => ({
    id: p.id,
    question: p.question,
    status: p.status,
    multipleChoice: p.multipleChoice,
    maxChoices: p.maxChoices,
    anonymous: p.anonymous,
    liveResults: p.liveResults,
    optionCount: p.optionCount,
    ballotCount: p.ballotCount,
    endsLabel: formatDateTime(p.closedAt ?? p.endsAt, timezone),
    createdLabel: formatDateTime(p.createdAt, timezone),
  }));
  const links = pageLinks('/marketing/polls', sp, list.data.nextCursor);
  const filtered = Boolean(status || q);

  return (
    <>
      <PageHeader
        title="Polls"
        description="Single or multiple-choice polls with optional anonymity and live results. Members vote in Discord."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Polls' }]}
      />
      <div className="space-y-6">
        <Card>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 p-4"
            role="search"
            aria-label="Filter polls"
          >
            <div className="w-full sm:w-64">
              <label htmlFor="f-q" className="mb-1 block text-xs text-fg-muted">
                Search questions
              </label>
              <Input
                id="f-q"
                name="q"
                defaultValue={q ?? ''}
                maxLength={100}
                placeholder="Question contains…"
              />
            </div>
            <div className="w-full sm:w-40">
              <label htmlFor="f-status" className="mb-1 block text-xs text-fg-muted">
                Status
              </label>
              <Select
                id="f-status"
                name="status"
                defaultValue={status ?? ''}
                placeholder="Any status"
                options={[
                  { value: 'OPEN', label: 'Open' },
                  { value: 'CLOSED', label: 'Closed' },
                ]}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              {filtered && (
                <ButtonLink href="/marketing/polls" variant="ghost">
                  Clear
                </ButtonLink>
              )}
            </div>
          </form>
        </Card>
        <PollsTable rows={rows} channels={channels.error ? null : channels.channels} filtered={filtered} />
        <Pagination
          prevHref={links.prev}
          nextHref={links.next}
          label="Poll pages"
          className="rounded-lg border border-border bg-surface"
        />
      </div>
    </>
  );
}
