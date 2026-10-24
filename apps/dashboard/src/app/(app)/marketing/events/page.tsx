import type { Metadata } from 'next';
import Link from 'next/link';
import { engagement } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadChannels } from '@/components/community/server/data';
import { eventToDraft } from '@/components/marketing/events/event-draft';
import { parseEventView, type EventView } from '@/components/marketing/events/event-form';
import { EventsTable, type EventRow } from '@/components/marketing/events/EventsTable';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { cn } from '@/components/ui/cn';
import { formatDateTime } from '@/lib/format';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Events' };

const STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'] as const;
type Status = (typeof STATUSES)[number];
const VIEWS: Array<{ id: EventView; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('events.manage', 'marketing.events');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const view = parseEventView(firstParam(sp, 'view'));
  const statusRaw = firstParam(sp, 'status');
  const status = STATUSES.includes(statusRaw as Status) ? (statusRaw as Status) : undefined;
  const q = firstParam(sp, 'q')?.slice(0, 100);

  // "Past" has no service filter: list newest-first and keep events that have started.
  const list = await load(() =>
    engagement.listEvents(ctx, {
      status,
      q,
      upcoming: view === 'upcoming',
      cursor: readCursor(sp).cursor,
      limit: view === 'past' ? 50 : 25,
    }),
  );
  if (!list.ok) return <ModuleNotice title="Events" message={list.message} />;

  const now = ctx.now().getTime();
  const events =
    view === 'past' ? list.data.items.filter((e) => e.startsAt.getTime() <= now) : list.data.items;
  const [counts, channels] = await Promise.all([
    Promise.all(events.map((e) => engagement.eventCounts(ctx.db, e.id))),
    loadChannels(ctx),
  ]);

  const rows: EventRow[] = events.map((e, i) => ({
    id: e.id,
    title: e.title,
    location: e.location,
    status: e.status,
    startLabel: formatDateTime(e.startsAt, timezone),
    endLabel: e.endsAt ? formatDateTime(e.endsAt, timezone) : null,
    going: counts[i]!.going,
    waitlist: counts[i]!.waitlist,
    capacity: e.capacity,
    timezone: e.timezone,
    draft: e.status === 'SCHEDULED' ? eventToDraft(e) : null,
  }));
  const links = pageLinks('/marketing/events', sp, list.data.nextCursor);
  const filtered = Boolean(status || q || view !== 'upcoming');

  return (
    <>
      <PageHeader
        title="Events"
        description="Community events with RSVPs, capacity and waitlists, reminder DMs and post-event summaries."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Events' }]}
      />

      <nav aria-label="Event views" className="mb-4 flex gap-1 border-b border-border">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={hrefWith('/marketing/events', sp, { view: v.id === 'upcoming' ? undefined : v.id })}
            aria-current={v.id === view ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              v.id === view ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <div className="space-y-6">
        <Card>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 p-4"
            role="search"
            aria-label="Filter events"
          >
            {view !== 'upcoming' && <input type="hidden" name="view" value={view} />}
            <div className="w-full sm:w-64">
              <label htmlFor="f-q" className="mb-1 block text-xs text-fg-muted">
                Search titles
              </label>
              <Input id="f-q" name="q" defaultValue={q ?? ''} maxLength={100} placeholder="Title contains…" />
            </div>
            <div className="w-full sm:w-44">
              <label htmlFor="f-status" className="mb-1 block text-xs text-fg-muted">
                Status
              </label>
              <Select
                id="f-status"
                name="status"
                defaultValue={status ?? ''}
                placeholder="Any status"
                options={STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              {(status || q) && (
                <ButtonLink
                  href={hrefWith('/marketing/events', sp, { status: undefined, q: undefined })}
                  variant="ghost"
                >
                  Clear
                </ButtonLink>
              )}
            </div>
          </form>
        </Card>

        <EventsTable
          rows={rows}
          timezone={timezone}
          channels={channels.error ? null : channels.channels}
          filtered={filtered}
        />
        <Pagination
          prevHref={links.prev}
          nextHref={links.next}
          label="Event pages"
          className="rounded-lg border border-border bg-surface"
        />
      </div>
    </>
  );
}
