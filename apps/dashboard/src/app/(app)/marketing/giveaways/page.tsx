import type { Metadata } from 'next';
import Link from 'next/link';
import { engagement } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadChannels, loadRoles } from '@/components/community/server/data';
import { GIVEAWAY_STATUSES, type GiveawayStatus } from '@/components/marketing/giveaways/giveaway-form';
import { GiveawaysTable, type GiveawayRow } from '@/components/marketing/giveaways/GiveawaysTable';
import { cn } from '@/components/ui/cn';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime } from '@/lib/format';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Giveaways' };

const LABELS: Record<GiveawayStatus, string> = {
  ACTIVE: 'Active',
  SCHEDULED: 'Scheduled',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
};

export default async function GiveawaysPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('giveaways.manage', 'marketing.giveaways');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const statusRaw = firstParam(sp, 'status');
  const status = GIVEAWAY_STATUSES.includes(statusRaw as GiveawayStatus)
    ? (statusRaw as GiveawayStatus)
    : undefined;

  const list = await load(() =>
    engagement.listGiveaways(ctx, { status, cursor: readCursor(sp).cursor, limit: 25 }),
  );
  if (!list.ok) return <ModuleNotice title="Giveaways" message={list.message} />;
  const [channels, roles] = await Promise.all([loadChannels(ctx), loadRoles(ctx)]);

  const rows: GiveawayRow[] = list.data.items.map((g) => ({
    id: g.id,
    prize: g.prize,
    status: g.status,
    winnerCount: g.winnerCount,
    entrantCount: g.entrantCount,
    endsLabel: formatDateTime(g.endedAt ?? g.endsAt, timezone),
    hasEligibility: g.requiredRoleIds.length > 0 || g.minAccountAgeDays > 0 || g.minMemberDays > 0,
  }));
  const links = pageLinks('/marketing/giveaways', sp, list.data.nextCursor);
  const filters: Array<{ id: GiveawayStatus | undefined; label: string }> = [
    { id: undefined, label: 'All' },
    ...GIVEAWAY_STATUSES.map((s) => ({ id: s, label: LABELS[s] })),
  ];

  return (
    <>
      <PageHeader
        title="Giveaways"
        description="Timed giveaways with eligibility rules, fair cryptographic draws and a verifiable draw audit."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Giveaways' }]}
      />
      <Alert tone="info" title="Free community prizes only" className="mb-4">
        Giveaways must never require a purchase, payment or paid entry. Entering is always free for eligible
        members.
      </Alert>

      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={hrefWith('/marketing/giveaways', sp, { status: f.id })}
            aria-current={f.id === status ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              f.id === status ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <div className="space-y-6">
        <GiveawaysTable
          rows={rows}
          timezone={timezone}
          channels={channels.error ? null : channels.channels}
          roles={roles.roles}
          filtered={Boolean(status)}
        />
        <Pagination
          prevHref={links.prev}
          nextHref={links.next}
          label="Giveaway pages"
          className="rounded-lg border border-border bg-surface"
        />
      </div>
    </>
  );
}
