'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ChannelOption } from '@/components/community/pickers';
import { useApiAction } from '@/components/community/useApiAction';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Table, type Column } from '@/components/ui/Table';
import { PollCreateDialog } from './PollCreateDialog';

export interface PollRow {
  id: string;
  question: string;
  status: 'OPEN' | 'CLOSED';
  multipleChoice: boolean;
  maxChoices: number;
  anonymous: boolean;
  liveResults: boolean;
  optionCount: number;
  ballotCount: number;
  endsLabel: string;
  createdLabel: string;
}

export function PollStatusBadge({ status }: { status: 'OPEN' | 'CLOSED' }) {
  return <StatusBadge status={status} tone={status === 'OPEN' ? 'accent' : 'neutral'} />;
}

/** Confirm + close an OPEN poll early; the final results are posted by the worker. */
export function ClosePollDialog({
  poll,
  onClose,
}: {
  poll: { id: string; question: string } | null;
  onClose: () => void;
}) {
  const { run, pending } = useApiAction();
  const confirm = async () => {
    if (!poll) return;
    const res = await run(`/api/engagement/polls/${encodeURIComponent(poll.id)}/close`, 'POST', undefined, {
      success: 'Poll closed',
      successDescription: 'Final results will be posted in Discord.',
      errorTitle: 'Could not close poll',
    });
    if (res) onClose();
  };
  return (
    <ConfirmDialog
      open={poll !== null}
      onCancel={onClose}
      onConfirm={confirm}
      loading={pending}
      title="Close poll now?"
      description={
        poll
          ? `Voting on "${poll.question}" ends immediately and the final results are posted. A closed poll cannot be reopened.`
          : undefined
      }
      confirmLabel="Close poll"
      cancelLabel="Keep open"
    />
  );
}

export function ClosePollButton({ poll }: { poll: { id: string; question: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Close poll
      </Button>
      <ClosePollDialog poll={open ? poll : null} onClose={() => setOpen(false)} />
    </>
  );
}

export function PollsTable({
  rows,
  channels,
  filtered,
}: {
  rows: PollRow[];
  channels: ChannelOption[] | null;
  filtered: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<PollRow | null>(null);

  const columns: Column<PollRow>[] = [
    {
      key: 'question',
      header: 'Question',
      cell: (r) => (
        <div className="min-w-[14rem]">
          <Link
            href={`/marketing/polls/${encodeURIComponent(r.id)}`}
            className="font-medium text-fg hover:text-accent"
          >
            {r.question}
          </Link>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge>{r.multipleChoice ? `Up to ${r.maxChoices} choices` : 'Single choice'}</Badge>
            {r.anonymous && <Badge tone="warning">Anonymous</Badge>}
            {!r.liveResults && <Badge>Results hidden until close</Badge>}
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <PollStatusBadge status={r.status} /> },
    {
      key: 'options',
      header: 'Options',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums">{r.optionCount}</span>,
    },
    {
      key: 'ballots',
      header: 'Ballots',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{r.ballotCount.toLocaleString('en-US')}</span>,
    },
    {
      key: 'ends',
      header: 'Ends',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.endsLabel}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Link
            href={`/marketing/polls/${encodeURIComponent(r.id)}`}
            className="inline-flex h-8 items-center rounded px-3 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            Results
          </Link>
          {r.status === 'OPEN' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setClosing(r)}
              aria-label={`Close poll "${r.question}"`}
            >
              Close
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Polls"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New poll
          </Button>
        }
      />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Polls"
        empty={
          <EmptyState
            title={filtered ? 'No polls match these filters' : 'No polls yet'}
            description={
              filtered
                ? 'Try another status or search.'
                : 'Create a poll; members vote with the menu on its message.'
            }
          />
        }
      />
      <PollCreateDialog open={creating} onClose={() => setCreating(false)} channels={channels} />
      <ClosePollDialog poll={closing} onClose={() => setClosing(null)} />
    </Card>
  );
}
