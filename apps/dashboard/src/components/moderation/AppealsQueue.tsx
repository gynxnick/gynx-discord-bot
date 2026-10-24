'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { DescriptionList } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Textarea } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, truncateText } from '@/lib/format';
import { ACTION_LABEL, ActionTypeBadge, AppealStatusBadge, ModeratorName } from './labels';

export interface AppealRow {
  id: string;
  userId: string;
  statement: string;
  status: 'PENDING' | 'ACCEPTED' | 'DENIED';
  reviewerId: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  actionId: string | null;
  action: { ref: string; type: string; reason: string } | null;
}

export function AppealsQueue({
  rows,
  timezone,
  canExecute,
  canBan,
  myUserId,
  hasFilters,
}: {
  rows: AppealRow[];
  timezone: string;
  canExecute: boolean;
  canBan: boolean;
  myUserId: string;
  hasFilters: boolean;
}) {
  const [selected, setSelected] = useState<AppealRow | null>(null);
  const [reversal, setReversal] = useState<{ ref: string; type: string; userId: string } | null>(null);

  const columns: Column<AppealRow>[] = [
    {
      key: 'user',
      header: 'Member',
      cell: (a) => (
        <button
          type="button"
          className="text-left font-mono text-xs text-accent hover:underline"
          onClick={() => setSelected(a)}
        >
          {a.userId}
        </button>
      ),
    },
    {
      key: 'action',
      header: 'Appealed action',
      cell: (a) =>
        a.action ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{a.action.ref}</span>
            <ActionTypeBadge type={a.action.type} />
          </span>
        ) : (
          <span className="text-fg-muted">General</span>
        ),
    },
    {
      key: 'statement',
      header: 'Statement',
      hideOnMobile: true,
      cell: (a) => <span className="text-fg-muted">{truncateText(a.statement, 90)}</span>,
    },
    { key: 'status', header: 'Status', cell: (a) => <AppealStatusBadge status={a.status} /> },
    {
      key: 'created',
      header: 'Submitted',
      cell: (a) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(a.createdAt, timezone)}</span>
      ),
    },
    {
      key: 'open',
      header: <span className="sr-only">Open</span>,
      align: 'right',
      cell: (a) => (
        <Button size="sm" variant="ghost" onClick={() => setSelected(a)}>
          {a.status === 'PENDING' ? 'Review' : 'View'}
        </Button>
      ),
    },
  ];

  return (
    <>
      {reversal && (
        <div className="p-4">
          <Alert tone="warning" title="Manual step required in Discord">
            Appeal for {reversal.ref} was accepted. The dashboard cannot change Discord directly —{' '}
            {reversal.type === 'BAN' ? 'unban' : 'remove the timeout for'} member{' '}
            <span className="font-mono">{reversal.userId}</span> in Discord yourself (
            {reversal.type === 'BAN' ? 'Server Settings → Bans' : "the member's Remove Timeout option"}).
          </Alert>
        </div>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        caption="Moderation appeals"
        empty={
          <EmptyState
            title={hasFilters ? 'No appeals match this filter' : 'No appeals'}
            description="Members appeal warnings, timeouts and kicks with /appeal. Ban appeals arrive through the external support system."
          />
        }
      />
      {selected && (
        <AppealDialog
          appeal={selected}
          timezone={timezone}
          canReview={selected.action?.type === 'BAN' ? canBan : canExecute}
          isOwn={selected.userId === myUserId}
          onClose={() => setSelected(null)}
          onReviewed={(manual) => {
            if (manual && selected.action)
              setReversal({ ref: selected.action.ref, type: selected.action.type, userId: selected.userId });
            setSelected(null);
          }}
        />
      )}
    </>
  );
}

function AppealDialog({
  appeal,
  timezone,
  canReview,
  isOwn,
  onClose,
  onReviewed,
}: {
  appeal: AppealRow;
  timezone: string;
  canReview: boolean;
  isOwn: boolean;
  onClose: () => void;
  onReviewed: (requiresManualReversal: boolean) => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'ACCEPTED' | 'DENIED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = appeal.status === 'PENDING';
  const isBan = appeal.action?.type === 'BAN';

  const decide = async (decision: 'ACCEPTED' | 'DENIED') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await api<{ requiresManualReversal: boolean }>(
        `/api/moderation/appeals/${encodeURIComponent(appeal.id)}/review`,
        {
          method: 'POST',
          body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
        },
      );
      toast.success(
        decision === 'ACCEPTED' ? 'Appeal accepted' : 'Appeal denied',
        'The member is notified by DM.',
      );
      onReviewed(res.requiresManualReversal);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.issues[0] ? err.issues[0].message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={busy === null}
      size="lg"
      title={appeal.action ? `Appeal for ${appeal.action.ref}` : 'General appeal'}
      footer={
        pending && canReview && !isOwn ? (
          <>
            <Button
              variant="secondary"
              onClick={() => decide('DENIED')}
              loading={busy === 'DENIED'}
              disabled={busy !== null}
            >
              Deny
            </Button>
            <Button onClick={() => decide('ACCEPTED')} loading={busy === 'ACCEPTED'} disabled={busy !== null}>
              Accept
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <DescriptionList
          items={[
            { label: 'Member', value: <span className="font-mono">{appeal.userId}</span> },
            { label: 'Submitted', value: formatDateTime(appeal.createdAt, timezone) },
            {
              label: 'Action',
              value: appeal.action ? (
                <Link href={`/moderation/records/${appeal.actionId}`}>
                  {appeal.action.ref} · {ACTION_LABEL[appeal.action.type] ?? appeal.action.type}
                </Link>
              ) : (
                'None (general appeal)'
              ),
            },
            { label: 'Status', value: <AppealStatusBadge status={appeal.status} /> },
          ]}
        />
        {appeal.action && (
          <div>
            <h3 className="text-xs uppercase tracking-wide text-fg-muted">Original reason</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{appeal.action.reason}</p>
          </div>
        )}
        <div>
          <h3 className="text-xs uppercase tracking-wide text-fg-muted">Member statement</h3>
          <p className="mt-1 whitespace-pre-wrap break-words rounded border border-border bg-surface-raised p-3 text-sm text-fg">
            {appeal.statement}
          </p>
        </div>
        {!pending && (
          <DescriptionList
            items={[
              {
                label: 'Reviewed by',
                value: appeal.reviewerId ? <ModeratorName id={appeal.reviewerId} /> : '—',
              },
              { label: 'Reviewed', value: formatDateTime(appeal.reviewedAt, timezone) },
              { label: 'Review note', value: appeal.reviewNote ?? '—' },
            ]}
          />
        )}
        {pending && isOwn && <Alert tone="info">You cannot review your own appeal.</Alert>}
        {pending && !isOwn && !canReview && (
          <Alert tone="info">
            Reviewing{' '}
            {isBan
              ? 'ban appeals requires the ban permission'
              : 'appeals requires the moderation execute permission'}
            .
          </Alert>
        )}
        {pending && !isOwn && canReview && (
          <>
            {(appeal.action?.type === 'TIMEOUT' || isBan) && (
              <Alert tone="warning">
                Accepting does not change Discord: you must{' '}
                {isBan ? 'unban the member' : 'remove the timeout'} in Discord yourself afterwards. Accepted
                warnings are revoked automatically.
              </Alert>
            )}
            <Field
              id="appeal-note"
              label="Note to the member"
              help="Optional. Included in the decision DM sent to the member. Max 1000 characters."
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
