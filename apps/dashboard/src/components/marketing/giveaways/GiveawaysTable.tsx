'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ChannelOption, RoleOption } from '@/components/community/pickers';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Feedback';
import { Table, type Column } from '@/components/ui/Table';
import { GiveawayCreateDialog } from './GiveawayCreateDialog';
import { GIVEAWAY_STATUS_TONE, type GiveawayStatus } from './giveaway-form';

export interface GiveawayRow {
  id: string;
  prize: string;
  status: GiveawayStatus;
  winnerCount: number;
  entrantCount: number;
  endsLabel: string;
  hasEligibility: boolean;
}

export function GiveawaysTable({
  rows,
  timezone,
  channels,
  roles,
  filtered,
}: {
  rows: GiveawayRow[];
  timezone: string;
  channels: ChannelOption[] | null;
  roles: RoleOption[];
  filtered: boolean;
}) {
  const [creating, setCreating] = useState(false);

  const columns: Column<GiveawayRow>[] = [
    {
      key: 'prize',
      header: 'Prize',
      cell: (r) => (
        <div className="min-w-[12rem]">
          <Link
            href={`/marketing/giveaways/${encodeURIComponent(r.id)}`}
            className="font-medium text-fg hover:text-accent"
          >
            {r.prize}
          </Link>
          {r.hasEligibility && <p className="mt-0.5 text-xs text-fg-muted">Eligibility rules apply</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} tone={GIVEAWAY_STATUS_TONE[r.status]} />,
    },
    {
      key: 'winners',
      header: 'Winners',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums">{r.winnerCount}</span>,
    },
    {
      key: 'entrants',
      header: 'Entrants',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{r.entrantCount.toLocaleString('en-US')}</span>,
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
        <Link
          href={`/marketing/giveaways/${encodeURIComponent(r.id)}`}
          className="inline-flex h-8 items-center rounded px-3 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          Manage
        </Link>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Giveaways"
        description={`Times shown in ${timezone}.`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New giveaway
          </Button>
        }
      />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Giveaways"
        empty={
          <EmptyState
            title={filtered ? 'No giveaways with this status' : 'No giveaways yet'}
            description={
              filtered
                ? 'Try another status.'
                : 'Start a giveaway; members enter with the button on its message.'
            }
          />
        }
      />
      <GiveawayCreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        timezone={timezone}
        channels={channels}
        roles={roles}
      />
    </Card>
  );
}
