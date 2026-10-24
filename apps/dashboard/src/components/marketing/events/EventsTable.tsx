'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ChannelOption } from '@/components/community/pickers';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/Badge';
import { Table, type Column } from '@/components/ui/Table';
import { CancelEventDialog } from './CancelEventDialog';
import { EventFormDialog } from './EventFormDialog';
import { EVENT_STATUS_TONE, type EventDraft } from './event-form';

export interface EventRow {
  id: string;
  title: string;
  location: string | null;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
  startLabel: string;
  endLabel: string | null;
  going: number;
  waitlist: number;
  capacity: number | null;
  timezone: string;
  /** Prefilled edit form (scheduled events only). */
  draft: EventDraft | null;
}

export function EventsTable({
  rows,
  timezone,
  channels,
  filtered,
}: {
  rows: EventRow[];
  timezone: string;
  channels: ChannelOption[] | null;
  filtered: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [cancelling, setCancelling] = useState<EventRow | null>(null);

  const columns: Column<EventRow>[] = [
    {
      key: 'title',
      header: 'Event',
      cell: (r) => (
        <div className="min-w-[12rem]">
          <Link
            href={`/marketing/events/${encodeURIComponent(r.id)}`}
            className="font-medium text-fg hover:text-accent"
          >
            {r.title}
          </Link>
          {r.location && <p className="mt-0.5 text-xs text-fg-muted">{r.location}</p>}
        </div>
      ),
    },
    {
      key: 'start',
      header: 'Starts',
      cell: (r) => (
        <span
          className="whitespace-nowrap text-fg-muted"
          title={r.endLabel ? `Ends ${r.endLabel}` : undefined}
        >
          {r.startLabel}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} tone={EVENT_STATUS_TONE[r.status]} />,
    },
    {
      key: 'rsvp',
      header: 'Going',
      align: 'right',
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {r.going}
          {r.capacity !== null && <span className="text-fg-muted"> / {r.capacity}</span>}
          {r.waitlist > 0 && <span className="ml-1 text-xs text-fg-muted">(+{r.waitlist} waitlist)</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === 'SCHEDULED' && r.draft && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(r)}
                aria-label={`Edit "${r.title}"`}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCancelling(r)}
                aria-label={`Cancel "${r.title}"`}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Events"
        description={`Times shown in ${timezone}.`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New event
          </Button>
        }
      />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Events"
        empty={
          <EmptyState
            title={filtered ? 'No events match these filters' : 'No events yet'}
            description={
              filtered
                ? 'Try another view, status or search.'
                : 'Create an event; members RSVP with the buttons on its announcement.'
            }
          />
        }
      />

      <EventFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        timezone={timezone}
        channels={channels}
      />
      <EventFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        eventId={editing?.id}
        initial={editing?.draft ?? undefined}
        timezone={editing?.timezone ?? timezone}
      />
      <CancelEventDialog event={cancelling} onClose={() => setCancelling(null)} />
    </Card>
  );
}
