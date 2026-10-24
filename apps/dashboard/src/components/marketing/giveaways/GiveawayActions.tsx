'use client';

import { useState } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Form';
import {
  MAX_WINNERS,
  rerollPayload,
  validateReroll,
  type GiveawayStatus,
  type RerollDraft,
} from './giveaway-form';

/** End now (ACTIVE), Cancel (ACTIVE/SCHEDULED) and Reroll (ENDED), each behind a confirmation. */
export function GiveawayActions({
  giveaway,
}: {
  giveaway: { id: string; prize: string; status: GiveawayStatus; entrantCount: number };
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [dialog, setDialog] = useState<'end' | 'cancel' | 'reroll' | null>(null);
  const [reason, setReason] = useState('');
  const [reroll, setReroll] = useState<RerollDraft>({ reason: '', count: '' });
  const base = `/api/engagement/giveaways/${encodeURIComponent(giveaway.id)}`;

  const open = (d: 'end' | 'cancel' | 'reroll') => {
    setFieldErrors({});
    setReason('');
    setReroll({ reason: '', count: '' });
    setDialog(d);
  };
  const close = () => setDialog(null);

  const endNow = async () => {
    const res = await run<{ draw: { winnerIds: string[] } | null }>(`${base}/end`, 'POST', undefined, {
      errorTitle: 'Could not end giveaway',
      success: 'Giveaway ended',
      successDescription: 'Winners are being announced.',
    });
    if (res) close();
  };
  const cancel = async () => {
    const res = await run(`${base}/cancel`, 'POST', reason.trim() ? { reason: reason.trim() } : {}, {
      success: 'Giveaway cancelled',
      errorTitle: 'Could not cancel giveaway',
    });
    if (res) close();
  };
  const doReroll = async () => {
    const local = validateReroll(reroll);
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const res = await run(`${base}/reroll`, 'POST', rerollPayload(reroll), {
      success: 'Rerolled',
      successDescription: 'The new winner(s) will be announced.',
      errorTitle: 'Could not reroll',
    });
    if (res) close();
  };

  const { status } = giveaway;
  return (
    <>
      {status === 'ACTIVE' && (
        <Button variant="secondary" onClick={() => open('end')}>
          End now
        </Button>
      )}
      {status === 'ENDED' && (
        <Button variant="secondary" onClick={() => open('reroll')}>
          Reroll
        </Button>
      )}
      {(status === 'ACTIVE' || status === 'SCHEDULED') && (
        <Button variant="danger" onClick={() => open('cancel')}>
          Cancel giveaway
        </Button>
      )}

      <ConfirmDialog
        open={dialog === 'end'}
        onCancel={close}
        onConfirm={endNow}
        loading={pending}
        title="End giveaway now?"
        description={`Entries close immediately and ${giveaway.entrantCount.toLocaleString('en-US')} entrant(s) are drawn from for "${giveaway.prize}". This cannot be undone.`}
        confirmLabel="End and draw"
        cancelLabel="Keep running"
      />

      <ConfirmDialog
        open={dialog === 'cancel'}
        onCancel={close}
        onConfirm={cancel}
        loading={pending}
        title="Cancel giveaway?"
        description={`"${giveaway.prize}" will be cancelled without drawing winners. This cannot be undone.`}
        confirmLabel="Cancel giveaway"
        cancelLabel="Keep giveaway"
      >
        <Field
          id="gw-cancel-reason"
          label="Reason"
          help="Optional. Recorded in the audit log."
          error={fieldErrors.reason}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'reroll'}
        onCancel={close}
        onConfirm={doReroll}
        loading={pending}
        title="Reroll winners?"
        description="Draws replacement winner(s) from the entrants who have not won yet. The reroll and its reason are recorded permanently in the draw audit."
        confirmLabel="Reroll"
        destructive={false}
      >
        <div className="space-y-3">
          <Field
            id="gw-reroll-reason"
            label="Reason"
            required
            help="Required, at least 3 characters (e.g. winner did not respond)."
            error={fieldErrors.reason}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={reroll.reason}
                onChange={(e) => setReroll((d) => ({ ...d, reason: e.target.value }))}
                maxLength={500}
              />
            )}
          </Field>
          <Field
            id="gw-reroll-count"
            label="Number of winners"
            help={`Optional, 1 to ${MAX_WINNERS}. Defaults to 1.`}
            error={fieldErrors.count}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={MAX_WINNERS}
                inputMode="numeric"
                value={reroll.count}
                onChange={(e) => setReroll((d) => ({ ...d, count: e.target.value }))}
                placeholder="1"
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}
