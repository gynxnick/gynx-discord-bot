import type { Metadata } from 'next';
import Link from 'next/link';
import { security } from '@gynx/services';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, truncateText } from '@/lib/format';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Abuse reports' };

const STATUSES = ['NEW', 'TRIAGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const;
type ReportRow = Awaited<ReturnType<typeof security.listReports>>['items'][number];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('security.reports.view', 'security.reports');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;

  const filters = {
    status: firstParam(sp, 'status'),
    category: firstParam(sp, 'category'),
    q: firstParam(sp, 'q'),
  };
  const parsed = security.listReportsSchema.safeParse({
    ...filters,
    cursor: readCursor(sp).cursor,
    limit: 25,
  });
  const result = parsed.success ? await security.listReports(page.ctx, parsed.data) : null;
  const links = pageLinks('/security/reports', sp, result?.nextCursor ?? null);

  const columns: Column<ReportRow>[] = [
    {
      key: 'ref',
      header: 'Ref',
      cell: (r) => (
        <Link href={`/security/reports/${r.id}`} className="font-mono font-medium">
          {r.ref}
        </Link>
      ),
    },
    { key: 'category', header: 'Category', cell: (r) => security.CATEGORY_LABELS[r.category] },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'summary',
      header: 'Summary',
      hideOnMobile: true,
      cell: (r) => <span className="text-fg-muted">{truncateText(r.description, 90)}</span>,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      hideOnMobile: true,
      cell: (r) =>
        r.assigneeId ? (
          <span className="font-mono text-xs">{r.assigneeId}</span>
        ) : (
          <span className="text-fg-muted">Unassigned</span>
        ),
    },
    {
      key: 'created',
      header: 'Submitted',
      cell: (r) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.createdAt, page.timezone)}</span>
      ),
    },
  ];

  const hasFilters = Boolean(filters.status || filters.category || filters.q);

  return (
    <>
      <PageHeader
        title="Abuse reports"
        description="Private reports submitted with /report-abuse. Reports never trigger automatic punishment; staff review each one."
        breadcrumbs={[{ label: 'Security' }, { label: 'Abuse reports' }]}
      />

      <Card>
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 border-b border-border p-4"
          role="search"
          aria-label="Filter reports"
        >
          <div className="w-full sm:w-40">
            <label htmlFor="f-status" className="mb-1 block text-xs text-fg-muted">
              Status
            </label>
            <Select
              id="f-status"
              name="status"
              defaultValue={filters.status ?? ''}
              placeholder="Any status"
              options={STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
            />
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor="f-category" className="mb-1 block text-xs text-fg-muted">
              Category
            </label>
            <Select
              id="f-category"
              name="category"
              defaultValue={filters.category ?? ''}
              placeholder="Any category"
              options={security.REPORT_CATEGORIES.map((c) => ({
                value: c,
                label: security.CATEGORY_LABELS[c],
              }))}
            />
          </div>
          <div className="w-full sm:w-56">
            <label htmlFor="f-q" className="mb-1 block text-xs text-fg-muted">
              Reference or reported user ID
            </label>
            <Input id="f-q" name="q" defaultValue={filters.q ?? ''} placeholder="R-0042" maxLength={100} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {hasFilters && (
              <ButtonLink href="/security/reports" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>

        {!parsed.success ? (
          <div className="p-4">
            <Alert tone="warning" title="Invalid filter">
              One of the filters is not valid. Clear the filters and try again.
            </Alert>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              rows={result?.items ?? []}
              rowKey={(r) => r.id}
              caption="Abuse reports, newest first"
              empty={
                <EmptyState
                  title={hasFilters ? 'No reports match these filters' : 'No reports yet'}
                  description={
                    hasFilters
                      ? 'Try a different status or category.'
                      : 'When members submit /report-abuse, reports appear here.'
                  }
                />
              }
            />
            <Pagination prevHref={links.prev} nextHref={links.next} label="Reports pages" />
          </>
        )}
      </Card>
    </>
  );
}
