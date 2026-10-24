import type { Metadata } from 'next';
import Link from 'next/link';
import type { ModerationAction } from '@gynx/database';
import { moderation } from '@gynx/services';
import { dayRange } from '@/app/api/moderation/dates';
import {
  ACTION_LABEL,
  ACTION_STATUSES,
  ACTION_TYPES,
  ActionTypeBadge,
  ModeratorName,
  RECORD_STATUS_LABEL,
  RecordStatusBadge,
} from '@/components/moderation/labels';
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

export const metadata: Metadata = { title: 'Moderation records' };

function FilterLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-fg-muted">
      {children}
    </label>
  );
}

export default async function ModerationRecordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const page = await requirePagePermission(
    ['moderation.audit.view', 'moderation.execute'],
    'moderation.records',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone: tz } = page;
  const sp = await searchParams;
  const canAudit = page.session.permissions.has('moderation.audit.view');

  const filters = {
    type: firstParam(sp, 'type'),
    status: firstParam(sp, 'status'),
    targetId: firstParam(sp, 'target'),
    moderatorId: firstParam(sp, 'moderator'),
    ref: firstParam(sp, 'ref'),
    from: firstParam(sp, 'from'),
    to: firstParam(sp, 'to'),
  };
  const range = dayRange(filters.from, filters.to, tz);
  const badDates = Boolean((filters.from && !range.from) || (filters.to && !range.to));
  const parsed = moderation.searchActionsSchema.safeParse({
    type: filters.type,
    status: filters.status,
    targetId: filters.targetId,
    moderatorId: filters.moderatorId,
    ref: filters.ref,
    from: range.from,
    to: range.to,
    cursor: readCursor(sp).cursor,
    limit: 25,
  });
  const result = parsed.success && !badDates ? await moderation.searchActions(ctx, parsed.data) : null;
  const links = pageLinks('/moderation', sp, result?.nextCursor ?? null);
  const hasFilters = Object.values(filters).some(Boolean);

  const columns: Column<ModerationAction>[] = [
    {
      key: 'ref',
      header: 'Ref',
      cell: (a) => (
        <Link href={`/moderation/records/${a.id}`} className="font-mono font-medium">
          {a.ref}
        </Link>
      ),
    },
    { key: 'type', header: 'Type', cell: (a) => <ActionTypeBadge type={a.type} /> },
    { key: 'status', header: 'Status', cell: (a) => <RecordStatusBadge status={a.status} /> },
    {
      key: 'target',
      header: 'Target',
      cell: (a) =>
        canAudit ? (
          <Link
            href={`/moderation/warnings?user=${a.targetId}`}
            className="font-mono text-xs"
            title="View warnings for this user"
          >
            {a.targetId}
          </Link>
        ) : (
          <span className="font-mono text-xs">{a.targetId}</span>
        ),
    },
    {
      key: 'moderator',
      header: 'Moderator',
      hideOnMobile: true,
      cell: (a) => <ModeratorName id={a.moderatorId} />,
    },
    {
      key: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      cell: (a) => <span className="text-fg-muted">{truncateText(a.reason, 80)}</span>,
    },
    {
      key: 'created',
      header: 'Date',
      cell: (a) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(a.createdAt, tz)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Moderation records"
        description="Every warning, timeout, kick, ban and automod deletion with its M-reference. Actions themselves are taken in Discord with the moderation commands."
        breadcrumbs={[{ label: 'Moderation' }, { label: 'Records' }]}
        actions={
          canAudit ? (
            <ButtonLink href="/moderation/warnings" variant="secondary">
              Look up warnings
            </ButtonLink>
          ) : undefined
        }
      />
      <Card>
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 border-b border-border p-4"
          role="search"
          aria-label="Filter moderation records"
        >
          <div className="w-full sm:w-40">
            <FilterLabel htmlFor="f-type">Type</FilterLabel>
            <Select
              id="f-type"
              name="type"
              defaultValue={filters.type ?? ''}
              placeholder="Any type"
              options={ACTION_TYPES.map((t) => ({ value: t, label: ACTION_LABEL[t]! }))}
            />
          </div>
          <div className="w-full sm:w-36">
            <FilterLabel htmlFor="f-status">Status</FilterLabel>
            <Select
              id="f-status"
              name="status"
              defaultValue={filters.status ?? ''}
              placeholder="Any status"
              options={ACTION_STATUSES.map((s) => ({ value: s, label: RECORD_STATUS_LABEL[s]! }))}
            />
          </div>
          <div className="w-full sm:w-52">
            <FilterLabel htmlFor="f-target">Target user ID</FilterLabel>
            <Input
              id="f-target"
              name="target"
              inputMode="numeric"
              defaultValue={filters.targetId ?? ''}
              maxLength={20}
            />
          </div>
          <div className="w-full sm:w-52">
            <FilterLabel htmlFor="f-mod">Moderator ID</FilterLabel>
            <Input
              id="f-mod"
              name="moderator"
              defaultValue={filters.moderatorId ?? ''}
              maxLength={20}
              placeholder="ID, automod or system"
            />
          </div>
          <div className="w-full sm:w-28">
            <FilterLabel htmlFor="f-ref">Reference</FilterLabel>
            <Input
              id="f-ref"
              name="ref"
              defaultValue={filters.ref ?? ''}
              maxLength={16}
              placeholder="M-0042"
            />
          </div>
          <div className="w-full sm:w-40">
            <FilterLabel htmlFor="f-from">{`From (${tz})`}</FilterLabel>
            <Input id="f-from" name="from" type="date" defaultValue={filters.from ?? ''} />
          </div>
          <div className="w-full sm:w-40">
            <FilterLabel htmlFor="f-to">{`To (${tz})`}</FilterLabel>
            <Input id="f-to" name="to" type="date" defaultValue={filters.to ?? ''} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {hasFilters && (
              <ButtonLink href="/moderation" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
        {!result ? (
          <div className="p-4">
            <Alert tone="warning" title="Invalid filter">
              One of the filters is not valid (user IDs are 17–20 digits, references look like M-0042). Clear
              the filters and try again.
            </Alert>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              rows={result.items}
              rowKey={(a) => a.id}
              caption="Moderation records, newest first"
              empty={
                <EmptyState
                  title={hasFilters ? 'No records match these filters' : 'No moderation records yet'}
                  description={hasFilters ? 'Try widening the date range or clearing a filter.' : undefined}
                />
              }
            />
            <Pagination prevHref={links.prev} nextHref={links.next} label="Moderation records pages" />
          </>
        )}
      </Card>
    </>
  );
}
