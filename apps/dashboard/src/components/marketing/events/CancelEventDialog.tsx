'use client';

import { useEffect, useState } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/Form';

/** Confirm cancelling a scheduled event, with an optional reason (kept in the audit log). */
export function CancelEventDialog({
  event,
  onClose,
  onDone,
}: {
  event: { id: string; title: string } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { run, pending, fieldErrors } = useApiAction();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (event) setReason('');
  }, [event]);

  const confirm = async () => {
    if (!event) return;
    const res = await run(
      `/api/engagement/events/${encodeURIComponent(event.id)}/cancel`,
      'POST',
      reason.trim() ? { reason: reason.trim() } : {},
      {
        success: 'Event cancelled',
        successDescription: 'Reminders stopped; attendees will be notified.',
        errorTitle: 'Could not cancel event',
      },
    );
    if (res) {
      onClose();
      onDone?.();
    }
  };

  return (
    <ConfirmDialog
      open={event !== null}
      onCancel={onClose}
      onConfirm={confirm}
      loading={pending}
      title="Cancel event?"
      description={
        event
          ? `"${event.title}" will be marked cancelled, its reminders stopped and everyone going or waitlisted will get a DM. This cannot be undone.`
          : undefined
      }
      confirmLabel="Cancel event"
      cancelLabel="Keep event"
    >
      <Field
        id="ev-cancel-reason"
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
  );
}
