import type { Metadata } from 'next';
import { analytics } from '@gynx/services';
import { attempt } from '@/components/analytics/attempt';
import { fmtNum, parseStaffSort, sortStaffRows } from '@/components/analytics/format';
import { periodLabel, periodParams, resolvePeriod } from '@/components/analytics/period';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert, EmptyState, ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Staff stats' };

type Row = analytics.StaffStatsRow;

const num = (key: Exclude<keyof Row, 'userId'>) => (r: Row) => (
  <span className="tabular-nums">{fmtNum(r[key])}</span>
);

export default async function StaffStatsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('analytics.view', 'analytics.staff');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const selection = resolvePeriod(
    { range: firstParam(sp, 'range'), start: firstParam(sp, 'start'), end: firstParam(sp, 'end') },
    page.timezone,
  );
  const sort = parseStaffSort(firstParam(sp, 'sort'), firstParam(sp, 'dir'));
  const result = await attempt(() => analytics.staffStats(page.ctx, selection.range));

  const keep = periodParams(selection);
  const sortHref = (key: string, dir: string) =>
    `/analytics/staff?${new URLSearchParams({ ...keep, sort: key, dir }).toString()}`;
  const sortExtra: Record<string, string> = firstParam(sp, 'sort') ? { sort: sort.key, dir: sort.dir } : {};

  const columns: Column<Row>[] = [
    {
      key: 'userId',
      header: 'Staff member',
      sortable: true,
      cell: (r) => <span className="font-mono text-xs text-fg">{`<@${r.userId}>`}</span>,
    },
    {
      key: 'moderationActions',
      header: 'Moderation actions',
      sortable: true,
      align: 'right',
      cell: num('moderationActions'),
    },
    {
      key: 'reportsClaimed',
      header: 'Reports claimed',
      sortable: true,
      align: 'right',
      cell: num('reportsClaimed'),
    },
    {
      key: 'reportsResolved',
      header: 'Reports resolved',
      sortable: true,
      align: 'right',
      cell: num('reportsResolved'),
    },
    {
      key: 'incidentUpdates',
      header: 'Incident updates',
      sortable: true,
      align: 'right',
      cell: num('incidentUpdates'),
    },
    {
      key: 'partnerReviews',
      header: 'Partner reviews',
      sortable: true,
      align: 'right',
      cell: num('partnerReviews'),
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      cell: (r) => <span className="font-medium tabular-nums text-fg">{fmtNum(r.total)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Staff stats"
        description="Activity counts per staff member for the selected period. Counts only — no message content. Automod and system actions are excluded."
        breadcrumbs={[{ label: 'Analytics', href: '/analytics' }, { label: 'Staff' }]}
      />
      <Card className="mb-6">
        <CardBody>
          <PeriodSelector
            pathname="/analytics/staff"
            selection={selection}
            timezone={page.timezone}
            extra={sortExtra}
          />
        </CardBody>
      </Card>
      {selection.error && (
        <Alert tone="warning" title="Invalid date range" className="mb-6">
          {selection.error}
        </Alert>
      )}
      {!result.ok ? (
        <ErrorState title="Staff stats could not be loaded" description={result.message} />
      ) : (
        <Card>
          <CardHeader
            title={periodLabel(selection)}
            description={`${formatDateTime(result.data.period.start, page.timezone)} – ${formatDateTime(result.data.period.end, page.timezone)} · ${result.data.rows.length} staff member${result.data.rows.length === 1 ? '' : 's'}`}
          />
          <Table
            columns={columns}
            rows={sortStaffRows(result.data.rows, sort.key, sort.dir)}
            rowKey={(r) => r.userId}
            caption="Staff activity counts"
            sort={sort}
            sortHref={sortHref}
            empty={
              <EmptyState
                title="No staff activity in this period"
                description="Moderation actions, report triage, incident updates and partner reviews appear here."
              />
            }
          />
        </Card>
      )}
    </>
  );
}
