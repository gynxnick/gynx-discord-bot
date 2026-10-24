import type { Metadata } from 'next';
import Link from 'next/link';
import { status } from '@gynx/services';
import { NewIncidentButton } from '@/components/status/IncidentDialogs';
import { IncidentStatusBadge, SeverityBadge } from '@/components/status/labels';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';
import { pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Incidents' };

type Row = Awaited<ReturnType<typeof status.listIncidents>>['items'][number];

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(['incidents.view', 'incidents.manage'], 'status.incidents');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone: tz } = page;
  const sp = await searchParams;
  const canManage = page.session.permissions.has('incidents.manage');

  const [active, history, services] = await Promise.all([
    status.listIncidents(ctx, { active: true, limit: 100 }),
    status.listIncidents(ctx, { status: 'RESOLVED', cursor: readCursor(sp).cursor, limit: 25 }),
    canManage ? status.listServices(ctx) : Promise.resolve([]),
  ]);
  const links = pageLinks('/status/incidents', sp, history.nextCursor);

  const columns = (resolved: boolean): Column<Row>[] => [
    {
      key: 'ref',
      header: 'Incident',
      cell: (i) => (
        <div className="min-w-[12rem]">
          <Link href={`/status/incidents/${i.id}`} className="font-medium">
            <span className="font-mono">{i.ref}</span> · {i.title}
          </Link>
          {i.autoCreated && (
            <div className="mt-1">
              <Badge>Auto-created by monitor</Badge>
            </div>
          )}
        </div>
      ),
    },
    { key: 'severity', header: 'Severity', cell: (i) => <SeverityBadge severity={i.severity} /> },
    { key: 'status', header: 'Status', cell: (i) => <IncidentStatusBadge status={i.status} /> },
    {
      key: 'services',
      header: 'Services',
      hideOnMobile: true,
      cell: (i) =>
        i.services.length ? (
          <span className="text-fg-muted">{i.services.map((s) => s.name).join(', ')}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: 'started',
      header: 'Started',
      cell: (i) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(i.startedAt, tz)}</span>,
    },
    ...(resolved
      ? [
          {
            key: 'resolved',
            header: 'Resolved',
            hideOnMobile: true,
            cell: (i: Row) => (
              <span className="whitespace-nowrap text-fg-muted">{formatDateTime(i.resolvedAt, tz)}</span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Public incident reports with a timeline of updates. Members subscribed with /status subscribe are notified."
        breadcrumbs={[{ label: 'Status & incidents', href: '/status' }, { label: 'Incidents' }]}
        actions={
          canManage ? (
            <NewIncidentButton services={services.map((s) => ({ slug: s.slug, name: s.name }))} />
          ) : undefined
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Active (${active.items.length})`} />
          <Table
            columns={columns(false)}
            rows={active.items}
            rowKey={(i) => i.id}
            caption="Active incidents"
            empty={<EmptyState title="No active incidents" description="Everything is running normally." />}
          />
        </Card>
        <Card>
          <CardHeader title="History" description="Resolved incidents, newest first." />
          <Table
            columns={columns(true)}
            rows={history.items}
            rowKey={(i) => i.id}
            caption="Resolved incidents"
            empty={<EmptyState title="No resolved incidents yet" />}
          />
          <Pagination prevHref={links.prev} nextHref={links.next} label="Incident history pages" />
        </Card>
      </div>
    </>
  );
}
