'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/format';
import { RULE_LABEL } from './labels';

export interface AutomodEventRow {
  id: string;
  rule: string;
  userId: string;
  channelId: string;
  channelName: string | null;
  excerpt: string | null;
  actionTaken: string;
  falsePositive: boolean | null;
  reviewedById: string | null;
  createdAt: string;
}

const ACTION_TEXT: Record<string, string> = {
  DELETE: 'Deleted',
  WARN: 'Warned',
  TIMEOUT: 'Timed out',
  ALERT: 'Alerted staff',
};

export function AutomodEventsTable({
  rows,
  timezone,
  canReview,
  hasFilters,
}: {
  rows: AutomodEventRow[];
  timezone: string;
  canReview: boolean;
  hasFilters: boolean;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmFp, setConfirmFp] = useState<AutomodEventRow | null>(null);

  const review = async (row: AutomodEventRow, falsePositive: boolean) => {
    setBusyId(row.id);
    try {
      await api(`/api/moderation/automod/events/${encodeURIComponent(row.id)}/review`, {
        method: 'POST',
        body: { falsePositive },
      });
      toast.success(
        falsePositive ? 'Marked as false positive' : 'Marked as correct',
        falsePositive ? 'It no longer counts as a strike; a warning it caused was revoked.' : undefined,
      );
      setConfirmFp(null);
      router.refresh();
    } catch (e) {
      toast.error('Could not save review', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AutomodEventRow>[] = [
    {
      key: 'rule',
      header: 'Rule',
      cell: (r) => <span className="whitespace-nowrap">{RULE_LABEL[r.rule] ?? r.rule}</span>,
    },
    { key: 'user', header: 'User', cell: (r) => <span className="font-mono text-xs">{r.userId}</span> },
    {
      key: 'channel',
      header: 'Channel',
      hideOnMobile: true,
      cell: (r) =>
        r.channelName ? (
          <span>#{r.channelName}</span>
        ) : (
          <span className="font-mono text-xs">{r.channelId}</span>
        ),
    },
    {
      key: 'excerpt',
      header: 'Excerpt',
      hideOnMobile: true,
      cell: (r) =>
        r.excerpt ? (
          <span className="block max-w-xs break-words text-xs text-fg-muted">{r.excerpt}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (r) => (
        <Badge tone={r.actionTaken === 'DELETE' ? 'neutral' : 'warning'}>
          {ACTION_TEXT[r.actionTaken] ?? r.actionTaken}
        </Badge>
      ),
    },
    {
      key: 'created',
      header: 'When',
      cell: (r) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.createdAt, timezone)}</span>
      ),
    },
    {
      key: 'review',
      header: 'Review',
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          {r.falsePositive === true && <Badge tone="success">False positive</Badge>}
          {r.falsePositive === false && <Badge>Confirmed</Badge>}
          {r.falsePositive === null && !canReview && (
            <span className="text-xs text-fg-muted">Unreviewed</span>
          )}
          {canReview && r.falsePositive !== false && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => review(r, false)}
              loading={busyId === r.id && !confirmFp}
              disabled={busyId !== null}
            >
              {r.falsePositive === true ? 'Undo' : 'Correct'}
            </Button>
          )}
          {canReview && r.falsePositive !== true && (
            <Button
              size="sm"
              variant="ghost"
              className="text-warning"
              onClick={() => setConfirmFp(r)}
              disabled={busyId !== null}
            >
              False positive
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Automod events, newest first"
        empty={
          <EmptyState
            title={hasFilters ? 'No events match these filters' : 'No automod events yet'}
            description={
              hasFilters ? undefined : 'Messages caught by automod appear here with a redacted excerpt.'
            }
          />
        }
      />
      <ConfirmDialog
        open={confirmFp !== null}
        onCancel={() => setConfirmFp(null)}
        onConfirm={() => (confirmFp ? review(confirmFp, true) : undefined)}
        loading={busyId !== null}
        title="Mark as false positive?"
        description="The hit stops counting as a strike. If it produced a warning, that warning is revoked. This is audited."
        confirmLabel="Mark false positive"
      />
    </>
  );
}
