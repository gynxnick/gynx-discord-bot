'use client';

import { useState, type FormEvent } from 'react';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { useApiAction } from '@/components/community/useApiAction';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  isAttributionStatus,
  isConfidence,
  needsReview,
  reviewOptions,
  reviewProblems,
  type ReviewStatus,
} from './referral-utils';

export interface AttributionRow {
  id: string;
  joinedUserId: string;
  referrerId: string | null;
  inviteCode: string | null;
  campaign: string | null;
  confidence: string;
  status: string;
  flagReason: string | null;
  /** Null for viewers without referrals.manage (service design). */
  reviewNote: string | null;
  reviewedById: string | null;
  joinedAtLabel: string;
}

const REVIEW_HELP: Record<ReviewStatus, string> = {
  VALID: 'Counts towards the referrer’s totals and leaderboards.',
  INVALID: 'Never counts. Use for abuse, self-referrals or alt accounts.',
  DISPUTED: 'Stays excluded from counts while it is being discussed.',
};

function ConfidenceBadge({ value }: { value: string }) {
  return isConfidence(value) ? (
    <Badge tone={CONFIDENCE_TONES[value]}>{CONFIDENCE_LABELS[value]}</Badge>
  ) : (
    <Badge>{value}</Badge>
  );
}
function StatusBadgeFor({ value }: { value: string }) {
  return isAttributionStatus(value) ? (
    <Badge tone={STATUS_TONES[value]} dot>
      {STATUS_LABELS[value]}
    </Badge>
  ) : (
    <Badge>{value}</Badge>
  );
}

const Id = ({ id }: { id: string | null }) =>
  id ? <span className="font-mono text-xs">{id}</span> : <span className="text-fg-muted">—</span>;

export function AttributionsTable({
  rows,
  canManage,
  filtered,
}: {
  rows: AttributionRow[];
  canManage: boolean;
  filtered: boolean;
}) {
  const { run, pending, fieldErrors, setFieldErrors, error } = useApiAction();
  const [reviewing, setReviewing] = useState<AttributionRow | null>(null);
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const [note, setNote] = useState('');

  const open = (r: AttributionRow) => {
    setFieldErrors({});
    setReviewing(r);
    setStatus('');
    setNote('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reviewing) return;
    const problems = reviewProblems(status, note);
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      return;
    }
    const res = await run(
      `/api/marketing/referrals/attributions/${encodeURIComponent(reviewing.id)}/review`,
      'POST',
      { status, note: note.trim() },
      {
        success: 'Review saved',
        errorTitle: 'Could not save review',
      },
    );
    if (res) setReviewing(null);
  };

  const columns: Column<AttributionRow>[] = [
    { key: 'joined', header: 'Joined member', cell: (r) => <Id id={r.joinedUserId} /> },
    { key: 'referrer', header: 'Referrer', cell: (r) => <Id id={r.referrerId} /> },
    {
      key: 'invite',
      header: 'Invite / campaign',
      hideOnMobile: true,
      cell: (r) => (
        <div className="min-w-[8rem]">
          {r.inviteCode ? (
            <span className="font-mono text-xs">{r.inviteCode}</span>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
          {r.campaign && <p className="text-xs text-fg-muted">{r.campaign}</p>}
        </div>
      ),
    },
    { key: 'confidence', header: 'Confidence', cell: (r) => <ConfidenceBadge value={r.confidence} /> },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadgeFor value={r.status} /> },
    {
      key: 'notes',
      header: 'Flag / review',
      hideOnMobile: true,
      cell: (r) =>
        r.flagReason || r.reviewNote ? (
          <div className="min-w-[12rem] max-w-xs space-y-0.5 text-xs">
            {r.flagReason && <p className="text-warning">{r.flagReason}</p>}
            {r.reviewNote && (
              <p className="whitespace-pre-wrap break-words text-fg-muted">Review: {r.reviewNote}</p>
            )}
          </div>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: 'joinedAt',
      header: 'Joined',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.joinedAtLabel}</span>,
    },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        needsReview(r.status) ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => open(r)}
            aria-label={`Review attribution for member ${r.joinedUserId}`}
          >
            Review
          </Button>
        ) : null,
    });
  }

  const options = reviewing ? reviewOptions(reviewing) : [];
  const validBlocked = options.find((o) => o.status === 'VALID' && o.disabled);

  return (
    <>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Join attributions"
        empty={
          <EmptyState
            title={filtered ? 'No attributions match these filters' : 'No joins recorded yet'}
            description={
              filtered
                ? 'Try another confidence or status.'
                : 'The bot records an attribution for every member join while the referrals module is on.'
            }
          />
        }
      />

      <Dialog
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title="Review attribution"
        description={
          reviewing
            ? `Member ${reviewing.joinedUserId}${reviewing.referrerId ? `, referred by ${reviewing.referrerId}` : ', no referrer'}.`
            : undefined
        }
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="attribution-review-form" loading={pending} loadingLabel="Saving…">
              Save review
            </Button>
          </>
        }
      >
        {reviewing && (
          <form id="attribution-review-form" onSubmit={submit} className="space-y-4" noValidate>
            {reviewing.flagReason && (
              <Alert tone="warning" title="Why it was flagged">
                {reviewing.flagReason}
              </Alert>
            )}
            <fieldset
              className="space-y-2"
              aria-describedby={fieldErrors.status ? 'review-status-error' : undefined}
            >
              <legend className="text-sm font-medium text-fg">
                Decision
                <span className="ml-0.5 text-danger" aria-hidden="true">
                  *
                </span>
              </legend>
              {options.map((o) => (
                <label
                  key={o.status}
                  className={`flex items-start gap-2 rounded border border-border p-2 text-sm ${o.disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-hover'}`}
                >
                  <input
                    type="radio"
                    name="review-status"
                    value={o.status}
                    checked={status === o.status}
                    disabled={o.disabled || pending}
                    onChange={() => setStatus(o.status)}
                    className="mt-0.5 accent-[#22D3EE]"
                  />
                  <span>
                    <span className="font-medium text-fg">{STATUS_LABELS[o.status]}</span>
                    <span className="block text-xs text-fg-muted">{REVIEW_HELP[o.status]}</span>
                  </span>
                </label>
              ))}
              {validBlocked?.reason && <p className="text-xs text-fg-muted">{validBlocked.reason}</p>}
              {fieldErrors.status && (
                <p id="review-status-error" className="text-xs text-danger" role="alert">
                  {fieldErrors.status}
                </p>
              )}
            </fieldset>
            <Field
              id="review-note"
              label="Note"
              required
              help="Visible to referral managers only. 3–500 characters."
              error={fieldErrors.note}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
            <p className="text-xs text-fg-muted">
              You cannot review attributions that credit you; the server will refuse.
            </p>
            {error && !Object.keys(fieldErrors).length && (
              <Alert tone="danger" title="Not saved">
                {error}
              </Alert>
            )}
          </form>
        )}
      </Dialog>
    </>
  );
}
