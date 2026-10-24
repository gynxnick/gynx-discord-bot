import type { Metadata } from 'next';
import { engagement } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { EventDetailActions, EventSummaryForm } from '@/components/marketing/events/EventDetailActions';
import { eventToDraft } from '@/components/marketing/events/event-draft';
import { EVENT_STATUS_TONE, formatMinutes, groupAttendees } from '@/components/marketing/events/event-form';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { formatDateTime, formatNumber } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Event' };

function AttendeeList({
  title,
  rows,
  timezone,
  ordered,
}: {
  title: string;
  rows: Array<{ userId: string; updatedAt: Date }>;
  timezone: string;
  ordered?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={`${title} (${formatNumber(rows.length)})`} headingLevel={3} />
      {rows.length === 0 ? (
        <EmptyState title={`No one ${title === 'Going' ? 'is going' : 'is on the waitlist'} yet`} />
      ) : (
        <ol className="max-h-96 divide-y divide-border overflow-y-auto">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="min-w-0 truncate font-mono text-xs">
                {ordered && <span className="mr-2 text-fg-muted">{i + 1}.</span>}
                {`<@${r.userId}>`}
              </span>
              <span className="shrink-0 text-xs text-fg-muted">{formatDateTime(r.updatedAt, timezone)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('events.manage', 'marketing.events.detail');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const { ctx, timezone } = page;

  const res = await load(async () => {
    const [detail, attendees] = await Promise.all([
      engagement.getEvent(ctx, id),
      engagement.listEventAttendees(ctx, id),
    ]);
    return { ...detail, attendees };
  });
  if (!res.ok) return <ModuleNotice title="Event" message={res.message} />;
  const { event: ev, counts, attendees } = res.data;
  const { going, waitlist } = groupAttendees(attendees);
  const started = ev.startsAt.getTime() <= ctx.now().getTime();
  const link = engagement.messageLink(ctx.guildId, ev.channelId, ev.messageId);

  return (
    <>
      <PageHeader
        title={ev.title}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={ev.status} tone={EVENT_STATUS_TONE[ev.status]} />
            {formatDateTime(ev.startsAt, timezone)}
          </span>
        }
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Events', href: '/marketing/events' },
          { label: ev.title },
        ]}
        actions={
          ev.status === 'SCHEDULED' ? (
            <EventDetailActions
              event={{ id: ev.id, title: ev.title }}
              draft={eventToDraft(ev)}
              timezone={ev.timezone}
            />
          ) : undefined
        }
      />

      {ev.status === 'CANCELLED' && (
        <Alert tone="warning" title="This event was cancelled" className="mb-6">
          Reminders were stopped and attendees were notified. Cancelled events cannot be edited.
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Going"
          value={formatNumber(counts.going)}
          hint={ev.capacity !== null ? `of ${formatNumber(ev.capacity)} places` : 'Unlimited capacity'}
        />
        <StatCard
          label="Waitlist"
          value={formatNumber(counts.waitlist)}
          hint={ev.waitlistEnabled ? 'Promoted in order when places free up' : 'Waitlist disabled'}
        />
        <StatCard
          label="Reminders"
          value={ev.reminderMinutesBefore.length}
          hint={ev.reminderMinutesBefore.map((m) => `${formatMinutes(m)} before`).join(', ') || 'None'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <DescriptionList
              items={[
                { label: 'Starts', value: formatDateTime(ev.startsAt, timezone) },
                { label: 'Ends', value: ev.endsAt ? formatDateTime(ev.endsAt, timezone) : 'No end time' },
                { label: 'Event time zone', value: ev.timezone },
                { label: 'Location', value: ev.location ?? '—' },
                {
                  label: 'Channel',
                  value: ev.channelId ? (
                    <span className="font-mono text-xs">{`<#${ev.channelId}>`}</span>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: 'Message',
                  value: link ? (
                    <a href={link} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      Open in Discord
                    </a>
                  ) : (
                    'Not posted yet'
                  ),
                },
                {
                  label: 'Description',
                  value: <span className="whitespace-pre-wrap">{ev.description}</span>,
                },
              ]}
            />
          </Card>

          {ev.status !== 'CANCELLED' &&
            (started ? (
              <EventSummaryForm eventId={ev.id} existing={ev.summary} />
            ) : (
              <Card>
                <CardHeader title="Summary" />
                <p className="px-4 pb-4 text-sm text-fg-muted">
                  You can post a summary once the event has started.
                </p>
              </Card>
            ))}
        </div>
        <div className="space-y-6">
          <AttendeeList title="Going" rows={going} timezone={timezone} />
          <AttendeeList title="Waitlist" rows={waitlist} timezone={timezone} ordered />
        </div>
      </div>
    </>
  );
}
