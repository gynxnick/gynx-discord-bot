import type { Metadata } from 'next';
import { RetryJobButton } from '@/components/settings/RetryJobButton';
import { StatusBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column, type SortDir } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { jobListSchema, listProblemJobs, type JobView } from '@/server/queries/jobs';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Jobs' };

const TABS = [
  { value: undefined, label: 'All problems' },
  { value: 'DEAD', label: 'Dead-lettered' },
  { value: 'FAILED', label: 'Retrying' },
] as const;

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('settings.manage', 'settings.jobs');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const parsed = jobListSchema.safeParse({
    status: firstParam(sp, 'status'),
    sort: firstParam(sp, 'sort'),
    dir: firstParam(sp, 'dir'),
    cursor: readCursor(sp).cursor,
    limit: 50,
  });
  const result = parsed.success ? await listProblemJobs(page.ctx, parsed.data) : null;
  const links = pageLinks('/settings/jobs', sp, result?.nextCursor ?? null);
  const tz = page.timezone;
  const status = parsed.success ? parsed.data.status : undefined;

  const columns: Column<JobView>[] = [
    {
      key: 'type',
      header: 'Job',
      cell: (j) => (
        <div>
          <code className="font-mono text-xs text-fg">{j.type}</code>
          <p className="font-mono text-[11px] text-fg-muted">{j.id}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (j) => (
        <StatusBadge status={j.status} label={j.status === 'DEAD' ? 'Dead-lettered' : 'Retrying'} />
      ),
    },
    {
      key: 'attempts',
      header: 'Attempts',
      sortable: true,
      align: 'right',
      cell: (j) => (
        <span className="tabular-nums">
          {j.attempts}/{j.maxAttempts}
        </span>
      ),
    },
    {
      key: 'lastError',
      header: 'Last error',
      hideOnMobile: true,
      cell: (j) =>
        j.lastError ? (
          <code className="block max-w-md whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
            {j.lastError}
          </code>
        ) : (
          '—'
        ),
    },
    {
      key: 'runAt',
      header: 'Next run',
      sortable: true,
      hideOnMobile: true,
      cell: (j) => (
        <span className="whitespace-nowrap text-xs text-fg-muted">
          {j.status === 'DEAD' ? '—' : formatDateTime(j.runAt, tz)}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      cell: (j) => (
        <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(j.updatedAt, tz)}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (j) => (j.status === 'DEAD' ? <RetryJobButton jobId={j.id} jobType={j.type} /> : null),
    },
  ];

  return (
    <>
      <PageHeader
        title="Background jobs"
        description="Jobs that failed and are retrying with backoff, or exhausted their attempts (dead-lettered). Dead jobs need a manual retry once the cause is fixed."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Jobs' }]}
      />
      <Card>
        <nav aria-label="Job status filter" className="flex flex-wrap gap-2 border-b border-border p-4">
          {TABS.map((t) => (
            <ButtonLink
              key={t.label}
              href={hrefWith('/settings/jobs', sp, { status: t.value })}
              variant={status === t.value ? 'primary' : 'ghost'}
              size="sm"
              aria-current={status === t.value ? 'page' : undefined}
            >
              {t.label}
            </ButtonLink>
          ))}
        </nav>
        {!parsed.success ? (
          <div className="p-4">
            <Alert tone="warning" title="Invalid filter">
              Reset the filters and try again.
            </Alert>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              rows={result?.items ?? []}
              rowKey={(j) => j.id}
              caption="Failed and dead-lettered jobs"
              sort={{ key: parsed.data.sort, dir: parsed.data.dir }}
              sortHref={(key: string, dir: SortDir) => hrefWith('/settings/jobs', sp, { sort: key, dir })}
              empty={
                <EmptyState
                  title="No problem jobs"
                  description="Every background job is either pending, running or completed successfully."
                />
              }
            />
            <Pagination prevHref={links.prev} nextHref={links.next} label="Job pages" />
          </>
        )}
      </Card>
    </>
  );
}
