'use client';

import { useState, type FormEvent } from 'react';
import { Badge, StatusBadge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import {
  statusPayload,
  SUGGESTION_STATUSES,
  SUGGESTION_STATUS_LABELS,
  type SuggestionStatus,
} from './suggestion-payload';
import { useApiAction } from './useApiAction';

export interface SuggestionRow {
  id: string;
  ref: string;
  title: string;
  body: string;
  authorId: string;
  status: SuggestionStatus;
  staffResponse: string | null;
  duplicateOfRef: string | null;
  hidden: boolean;
  upvotes: number;
  downvotes: number;
  createdAtLabel: string;
  messageLink: string | null;
}

const TONES: Record<SuggestionStatus, BadgeTone> = {
  UNDER_REVIEW: 'accent',
  PLANNED: 'warning',
  IMPLEMENTED: 'success',
  DECLINED: 'neutral',
  DUPLICATE: 'neutral',
};

export function SuggestionsBoard({ rows, filtered }: { rows: SuggestionRow[]; filtered: boolean }) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [target, setTarget] = useState<SuggestionRow | null>(null);
  const [status, setStatus] = useState<SuggestionStatus>('UNDER_REVIEW');
  const [response, setResponse] = useState('');
  const [duplicateOf, setDuplicateOf] = useState('');
  const [hiding, setHiding] = useState<SuggestionRow | null>(null);
  const [hideReason, setHideReason] = useState('');

  const open = (s: SuggestionRow) => {
    setFieldErrors({});
    setTarget(s);
    setStatus(s.status);
    setResponse('');
    setDuplicateOf(s.duplicateOfRef ?? '');
  };

  const saveStatus = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    if (status === 'DUPLICATE' && !duplicateOf.trim()) {
      setFieldErrors({ duplicateOf: 'Say which suggestion this duplicates (e.g. S-0012).' });
      return;
    }
    const res = await run(
      `/api/engagement/suggestions/${encodeURIComponent(target.id)}/status`,
      'POST',
      statusPayload(status, response, duplicateOf),
      {
        success: 'Suggestion updated',
        successDescription:
          status !== target.status ? 'The author is notified by DM if their DMs are open.' : undefined,
        errorTitle: 'Could not update suggestion',
      },
    );
    if (res) setTarget(null);
  };

  const setHidden = async (s: SuggestionRow, hidden: boolean, reason?: string) => {
    const res = await run(
      `/api/engagement/suggestions/${encodeURIComponent(s.id)}/hidden`,
      'POST',
      { hidden, reason: reason?.trim() || undefined },
      {
        success: hidden ? 'Suggestion hidden' : 'Suggestion restored',
        errorTitle: hidden ? 'Could not hide suggestion' : 'Could not restore suggestion',
      },
    );
    if (res) {
      setHiding(null);
      setHideReason('');
    }
  };

  const columns: Column<SuggestionRow>[] = [
    { key: 'ref', header: 'Ref', cell: (s) => <span className="font-mono text-xs">{s.ref}</span> },
    {
      key: 'title',
      header: 'Suggestion',
      cell: (s) => (
        <div className="min-w-[14rem] max-w-xl">
          <p className="font-medium text-fg">
            {s.title} {s.hidden && <Badge tone="warning">Hidden</Badge>}
          </p>
          <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-fg-muted">
            {s.body}
          </p>
          {s.staffResponse && (
            <p className="mt-1 text-xs text-fg">
              <span className="text-fg-muted">Staff: </span>
              {s.staffResponse}
            </p>
          )}
          {s.duplicateOfRef && <p className="mt-1 text-xs text-fg-muted">Duplicate of {s.duplicateOfRef}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (
        <StatusBadge status={s.status} label={SUGGESTION_STATUS_LABELS[s.status]} tone={TONES[s.status]} />
      ),
    },
    {
      key: 'votes',
      header: 'Votes',
      align: 'right',
      cell: (s) => (
        <span className="whitespace-nowrap tabular-nums" aria-label={`${s.upvotes} up, ${s.downvotes} down`}>
          <span className="text-success">▲ {s.upvotes}</span>{' '}
          <span className="text-fg-muted">▼ {s.downvotes}</span>
        </span>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      hideOnMobile: true,
      cell: (s) => <span className="font-mono text-xs text-fg-muted">{s.authorId}</span>,
    },
    {
      key: 'created',
      header: 'Submitted',
      hideOnMobile: true,
      cell: (s) => <span className="whitespace-nowrap text-fg-muted">{s.createdAtLabel}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (s) => (
        <div className="flex justify-end gap-1">
          {s.messageLink && (
            <a
              href={s.messageLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center px-2 text-xs"
              aria-label={`Open ${s.ref} in Discord`}
            >
              Discord
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={() => open(s)} aria-label={`Set status of ${s.ref}`}>
            Status
          </Button>
          {s.hidden ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void setHidden(s, false)}
              disabled={pending}
              aria-label={`Unhide ${s.ref}`}
            >
              Unhide
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setHiding(s)} aria-label={`Hide ${s.ref}`}>
              Hide
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        caption="Suggestions, newest first"
        empty={
          <EmptyState
            title={filtered ? 'No suggestions match these filters' : 'No suggestions yet'}
            description={
              filtered
                ? 'Try another status or include hidden suggestions.'
                : 'Member suggestions submitted with /suggest appear here.'
            }
          />
        }
      />

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Update ${target.ref}` : 'Update suggestion'}
        description={target?.title}
        size="lg"
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="suggestion-status-form" loading={pending} loadingLabel="Saving…">
              Save
            </Button>
          </>
        }
      >
        {target && (
          <form id="suggestion-status-form" onSubmit={saveStatus} className="space-y-4" noValidate>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-raised p-3 text-sm text-fg">
              {target.body}
            </p>
            <Field id="s-status" label="Status" error={fieldErrors.status}>
              {(p) => (
                <Select
                  {...p}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SuggestionStatus)}
                  options={SUGGESTION_STATUSES.map((s) => ({ value: s, label: SUGGESTION_STATUS_LABELS[s] }))}
                />
              )}
            </Field>
            {status === 'DUPLICATE' && (
              <Field
                id="s-dup"
                label="Duplicate of"
                required
                help="Reference (S-0012) or ID of the original suggestion."
                error={fieldErrors.duplicateOf}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={duplicateOf}
                    onChange={(e) => setDuplicateOf(e.target.value)}
                    maxLength={64}
                    placeholder="S-0012"
                  />
                )}
              </Field>
            )}
            <Field
              id="s-response"
              label="Staff response"
              help={
                target.staffResponse
                  ? 'Leave empty to keep the current response.'
                  : 'Shown on the suggestion and in the DM to the author.'
              }
              error={fieldErrors.response}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  maxLength={1000}
                  placeholder={target.staffResponse ?? ''}
                />
              )}
            </Field>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={hiding !== null}
        onCancel={() => setHiding(null)}
        onConfirm={() => (hiding ? setHidden(hiding, true, hideReason) : undefined)}
        loading={pending}
        title={hiding ? `Hide ${hiding.ref}?` : 'Hide suggestion?'}
        description="Hidden suggestions disappear from the board and member listings. You can restore them later."
        confirmLabel="Hide suggestion"
      >
        <Field id="s-hide-reason" label="Reason (optional, audit log only)">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={hideReason}
              onChange={(e) => setHideReason(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
