import type { Metadata } from 'next';
import Link from 'next/link';
import { status } from '@gynx/services';
import { toLocalInput } from '@/app/api/status/views';
import {
  MaintenanceTable,
  NewMaintenanceButton,
  type MaintenanceRow,
} from '@/components/status/MaintenanceManager';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { cn } from '@/components/ui/cn';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Maintenance' };

type Window = Awaited<ReturnType<typeof status.listMaintenance>>['items'][number];

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(['incidents.view', 'incidents.manage'], 'status.maintenance');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone: tz } = page;
  const sp = await searchParams;
  const canManage = page.session.permissions.has('incidents.manage');
  const past = firstParam(sp, 'past') === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';

  const [inProgress, scheduled, history, services] = await Promise.all([
    status.listMaintenance(ctx, { status: 'IN_PROGRESS', limit: 50 }),
    status.listMaintenance(ctx, { status: 'SCHEDULED', limit: 100 }),
    status.listMaintenance(ctx, { status: past, cursor: readCursor(sp).cursor, limit: 25 }),
    canManage ? status.listServices(ctx) : Promise.resolve([]),
  ]);
  const links = pageLinks('/status/maintenance', sp, history.nextCursor);

  const toRow = (w: Window): MaintenanceRow => ({
    id: w.id,
    title: w.title,
    description: w.description,
    status: w.status,
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    startsLocal: toLocalInput(w.startsAt, tz),
    endsLocal: toLocalInput(w.endsAt, tz),
    services: w.services.map((s) => ({ slug: s.slug, name: s.name })),
  });
  const refs = services.map((s) => ({ slug: s.slug, name: s.name }));
  // Upcoming soonest first (the service lists newest start first).
  const upcoming = [...scheduled.items]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(toRow);

  const tab = (value: 'COMPLETED' | 'CANCELLED', label: string) => (
    <Link
      href={hrefWith('/status/maintenance', sp, { past: value === 'COMPLETED' ? undefined : value })}
      aria-current={past === value ? 'page' : undefined}
      className={cn(
        'rounded px-2 py-1 text-xs no-underline hover:no-underline',
        past === value ? 'bg-surface-raised text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Planned maintenance windows. Covered services show “Under maintenance” and their alerts are suppressed while a window is in progress."
        breadcrumbs={[{ label: 'Status & incidents', href: '/status' }, { label: 'Maintenance' }]}
        actions={canManage ? <NewMaintenanceButton services={refs} timezone={tz} /> : undefined}
      />
      <div className="space-y-6">
        <MaintenanceTable
          title="In progress"
          rows={inProgress.items.map(toRow)}
          timezone={tz}
          canManage={canManage}
          services={refs}
          emptyTitle="No maintenance in progress"
        />
        <MaintenanceTable
          title="Upcoming"
          description="Soonest first."
          rows={upcoming}
          timezone={tz}
          canManage={canManage}
          services={refs}
          emptyTitle="No maintenance scheduled"
        />
        <MaintenanceTable
          title="Past"
          rows={history.items.map(toRow)}
          timezone={tz}
          canManage={false}
          services={refs}
          emptyTitle={past === 'COMPLETED' ? 'No completed maintenance yet' : 'No cancelled maintenance'}
          footer={
            <>
              <nav
                aria-label="Past maintenance filter"
                className="flex gap-1 border-t border-border px-4 py-2"
              >
                {tab('COMPLETED', 'Completed')}
                {tab('CANCELLED', 'Cancelled')}
              </nav>
              <Pagination prevHref={links.prev} nextHref={links.next} label="Past maintenance pages" />
            </>
          }
        />
      </div>
    </>
  );
}
