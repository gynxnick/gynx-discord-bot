import type { Metadata } from 'next';
import Link from 'next/link';
import type { Warning } from '@gynx/database';
import { moderation } from '@gynx/services';
import { ModeratorName } from '@/components/moderation/labels';
import { RevokeWarningButton } from '@/components/moderation/RevokeWarningButton';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Form';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, truncateText } from '@/lib/format';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Warnings' };

const SNOWFLAKE = /^\d{17,20}$/;

export default async function WarningsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('moderation.audit.view', 'moderation.warnings');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone: tz } = page;
  const sp = await searchParams;
  const user = firstParam(sp, 'user')?.trim();
  const showAll = firstParam(sp, 'all') === '1';
  const canRevoke = page.session.permissions.has('moderation.execute');
  const valid = user ? SNOWFLAKE.test(user) : false;

  const [summary, all] = valid
    ? await Promise.all([
        moderation.getWarningSummary(ctx, user!),
        showAll ? moderation.listWarnings(ctx, user!, { includeInactive: true }) : Promise.resolve(null),
      ])
    : [null, null];

  type Row = Warning & { ref?: string };
  const refs = new Map(summary?.warnings.map((w) => [w.id, w.ref]) ?? []);
  const rows: Row[] = all ?? summary?.warnings ?? [];
  const now = ctx.now().getTime();
  const isActive = (w: Row) => w.active && (!w.expiresAt || w.expiresAt.getTime() > now);

  const columns: Column<Row>[] = [
    {
      key: 'ref',
      header: 'Record',
      cell: (w) => (
        <Link href={`/moderation/records/${w.actionId}`} className="font-mono">
          {refs.get(w.id) ?? 'View'}
        </Link>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (w) => <span className="text-fg">{truncateText(w.reason, 120)}</span>,
    },
    {
      key: 'moderator',
      header: 'Moderator',
      hideOnMobile: true,
      cell: (w) => <ModeratorName id={w.moderatorId} />,
    },
    {
      key: 'created',
      header: 'Issued',
      cell: (w) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(w.createdAt, tz)}</span>,
    },
    {
      key: 'expires',
      header: 'Stops counting',
      hideOnMobile: true,
      cell: (w) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(w.expiresAt, tz)}</span>,
    },
    {
      key: 'state',
      header: 'State',
      cell: (w) => (isActive(w) ? <Badge tone="warning">Active</Badge> : <Badge>Inactive</Badge>),
    },
    ...(canRevoke
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (w: Row) =>
              isActive(w) ? (
                <RevokeWarningButton warningId={w.id} refLabel={refs.get(w.id) ?? 'this warning'} />
              ) : null,
          } satisfies Column<Row>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Warnings"
        description="Active warnings per member and the advisory next step. Warnings stop counting after 90 days. Suggestions are never applied automatically."
        breadcrumbs={[{ label: 'Moderation', href: '/moderation' }, { label: 'Warnings' }]}
      />
      <Card className="mb-6">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 p-4"
          role="search"
          aria-label="Look up warnings"
        >
          <div className="w-full sm:w-64">
            <label htmlFor="w-user" className="mb-1 block text-xs text-fg-muted">
              Discord user ID
            </label>
            <Input
              id="w-user"
              name="user"
              inputMode="numeric"
              defaultValue={user ?? ''}
              maxLength={20}
              placeholder="123456789012345678"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              name="all"
              value="1"
              defaultChecked={showAll}
              className="h-4 w-4 accent-[#22D3EE]"
            />
            Include revoked and expired
          </label>
          <Button type="submit" variant="secondary">
            Look up
          </Button>
        </form>
      </Card>

      {!user ? (
        <Card>
          <EmptyState
            title="Enter a user ID"
            description="Paste a member's Discord ID to see their warnings. You can also open a user from the records table."
          />
        </Card>
      ) : !valid ? (
        <Alert tone="warning" title="Invalid user ID">
          Discord IDs are 17–20 digits.
        </Alert>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Active warnings"
              value={summary!.activeCount}
              tone={summary!.activeCount > 0 ? 'warning' : 'neutral'}
            />
            <StatCard
              label="Suggested next step"
              value={<span className="text-base">{summary!.suggestion.summary}</span>}
              hint="Advisory only"
            />
          </div>
          <Card>
            <CardHeader
              title={
                <span>
                  Warnings for <span className="font-mono">{user}</span>
                </span>
              }
              actions={
                <ButtonLink href={`/moderation?target=${user}`} variant="ghost" size="sm">
                  All records
                </ButtonLink>
              }
            />
            <Table
              columns={columns}
              rows={rows}
              rowKey={(w) => w.id}
              caption="Warnings"
              empty={<EmptyState title={showAll ? 'No warnings on record' : 'No active warnings'} />}
            />
          </Card>
          {!canRevoke && rows.some(isActive) && (
            <Card>
              <CardBody>
                <p className="text-sm text-fg-muted">
                  Revoking warnings requires the moderation execute permission.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
