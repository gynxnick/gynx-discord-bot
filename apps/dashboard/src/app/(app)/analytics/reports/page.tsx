import type { Metadata } from 'next';
import Link from 'next/link';
import { analytics } from '@gynx/services';
import { attempt } from '@/components/analytics/attempt';
import { deliveryStatus } from '@/components/analytics/format';
import { RetryDeliveryButton } from '@/components/analytics/RetryDeliveryButton';
import { StatusBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, truncateText } from '@/lib/format';
import { pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Weekly reports' };

type Row = analytics.ReportListItem;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('analytics.view', 'analytics.reports');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const tz = page.timezone;
  const canManage = page.session.permissions.has('settings.manage');

  const result = await attempt(async () => {
    const [list, defs] = await Promise.all([
      analytics.listReports(page.ctx, { cursor: readCursor(sp).cursor, limit: 25 }),
      analytics.listReportDefinitions(page.ctx),
    ]);
    return { list, names: new Map(defs.map((d) => [d.id, d.name])) };
  });
  const names = result.ok ? result.data.names : new Map<string, string>();

  const periodText = (r: Row) => `${formatDateTime(r.periodStart, tz)} – ${formatDateTime(r.periodEnd, tz)}`;

  const columns: Column<Row>[] = [
    {
      key: 'period',
      header: 'Period',
      cell: (r) => (
        <Link href={`/analytics/reports/${encodeURIComponent(r.id)}`} className="font-medium">
          {periodText(r)}
        </Link>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      hideOnMobile: true,
      cell: (r) => names.get(r.definitionId) ?? '—',
    },
    {
      key: 'generated',
      header: 'Generated',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.createdAt, tz)}</span>,
    },
    {
      key: 'delivery',
      header: 'Delivery',
      cell: (r) => {
        const s = deliveryStatus(r);
        return (
          <div className="space-y-1">
            <StatusBadge status={s.label} label={s.label} tone={s.tone} />
            {r.deliveredAt && <p className="text-xs text-fg-muted">{formatDateTime(r.deliveredAt, tz)}</p>}
            {!r.deliveredAt && r.deliveryError && (
              <p className="max-w-xs break-words text-xs text-danger" title={r.deliveryError}>
                {truncateText(r.deliveryError, 140)}
              </p>
            )}
          </div>
        );
      },
    },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        r.deliveredAt ? null : <RetryDeliveryButton reportId={r.id} label={`Report for ${periodText(r)}`} />,
    });
  }

  const links = pageLinks('/analytics/reports', sp, result.ok ? result.data.list.nextCursor : null);

  return (
    <>
      <PageHeader
        title="Weekly reports"
        description="Generated CEO reports. Open a report to read it or export it as Markdown, JSON or CSV."
        breadcrumbs={[{ label: 'Analytics', href: '/analytics' }, { label: 'Weekly reports' }]}
        actions={
          canManage ? (
            <ButtonLink href="/analytics/reports/schedules" variant="secondary">
              Manage schedules
            </ButtonLink>
          ) : undefined
        }
      />
      {!result.ok ? (
        <ErrorState title="Reports could not be loaded" description={result.message} />
      ) : (
        <Card>
          <Table
            columns={columns}
            rows={result.data.list.items}
            rowKey={(r) => r.id}
            caption="Generated reports"
            empty={
              <EmptyState
                title="No reports generated yet"
                description="Reports are generated automatically at each schedule's run time."
                action={
                  canManage ? (
                    <ButtonLink href="/analytics/reports/schedules" variant="secondary">
                      Set up a schedule
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
          <Pagination
            prevHref={links.prev}
            nextHref={links.next}
            className="border-t border-border px-4 py-3"
          />
        </Card>
      )}
    </>
  );
}
