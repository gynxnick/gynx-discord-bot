import type { Metadata } from 'next';
import Link from 'next/link';
import { setup } from '@gynx/services';
import { toJsonSafe } from '@/components/setup/json-safe';
import {
  OPERATION_STATUS_LABELS,
  OPERATION_STATUS_TONES,
  OPERATION_TYPE_LABELS,
  isRollbackCandidate,
} from '@/components/setup/preview-utils';
import { RollbackButton } from '@/components/setup/RollbackButton';
import { StatusBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';
import { pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { getLogger } from '@/server/deps';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Setup history' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
type Row = setup.OperationListItem;

export default async function SetupHistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('setup.manage', 'setup.history');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { cursor } = readCursor(sp);
  const tz = page.timezone;

  const header = (
    <PageHeader
      title="Setup history"
      description="Every setup preview and run on this server, newest first. Each run keeps per-change checkpoints for auditing and rollback."
      breadcrumbs={[{ label: 'Server setup', href: '/setup' }, { label: 'History' }]}
    />
  );

  let result: { items: Row[]; nextCursor: string | null };
  try {
    result = toJsonSafe(await setup.listOperations(page.ctx, { cursor, limit: PAGE_SIZE }));
  } catch (err) {
    getLogger().error({ err }, 'setup history load failed');
    return (
      <>
        {header}
        <ErrorState
          title="History could not be loaded"
          description="The setup service did not respond. Try again in a moment."
          action={
            <ButtonLink href="/setup/history" variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </>
    );
  }
  const links = pageLinks('/setup/history', sp, result.nextCursor);
  // Rollback is offered for the most recent applied operation only (first page).
  const rollbackId = cursor ? null : (result.items.find(isRollbackCandidate)?.id ?? null);

  const columns: Column<Row>[] = [
    {
      key: 'type',
      header: 'Operation',
      cell: (o) => (
        <div>
          <Link href={`/setup/operations/${encodeURIComponent(o.id)}`} className="font-medium">
            {OPERATION_TYPE_LABELS[o.type] ?? o.type}
          </Link>
          <p className="font-mono text-[11px] text-fg-muted">{o.id}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (o) => (
        <StatusBadge
          status={o.status}
          tone={OPERATION_STATUS_TONES[o.status]}
          label={OPERATION_STATUS_LABELS[o.status]}
        />
      ),
    },
    {
      key: 'summary',
      header: 'Changes',
      hideOnMobile: true,
      cell: (o) =>
        o.summary ? (
          <span className="text-xs tabular-nums text-fg-muted">
            {o.summary.created} created · {o.summary.updated} updated · {o.summary.skipped} skipped ·{' '}
            <span className={o.summary.failed ? 'text-danger' : undefined}>{o.summary.failed} failed</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'by',
      header: 'Started by',
      hideOnMobile: true,
      cell: (o) => <span className="font-mono text-xs">{o.initiatedByUserId}</span>,
    },
    {
      key: 'started',
      header: 'Started',
      cell: (o) => (
        <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(o.startedAt, tz)}</span>
      ),
    },
    {
      key: 'completed',
      header: 'Completed',
      hideOnMobile: true,
      cell: (o) => (
        <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(o.completedAt, tz)}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (o) =>
        o.id === rollbackId ? (
          <RollbackButton operationId={o.id} label={`${OPERATION_TYPE_LABELS[o.type] ?? o.type} ${o.id}`} />
        ) : null,
    },
  ];

  return (
    <>
      {header}
      <Card>
        <CardHeader
          title="Operations"
          description="Rolling back only reverts what setup itself created or changed; pre-existing resources and content are never deleted."
        />
        <Table
          columns={columns}
          rows={result.items}
          rowKey={(o) => o.id}
          caption="Setup operations"
          empty={
            <EmptyState
              title="No setup operations yet"
              description="Start with a preview from the setup overview."
              action={
                <ButtonLink href="/setup" variant="primary" size="sm">
                  Go to overview
                </ButtonLink>
              }
            />
          }
        />
        <Pagination prevHref={links.prev} nextHref={links.next} label="Setup history pages" />
      </Card>
    </>
  );
}
