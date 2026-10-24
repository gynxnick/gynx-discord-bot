'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';

/** Revoke an active warning with a reason (moderation.execute). */
export function RevokeWarningButton({ warningId, refLabel }: { warningId: string; refLabel: string }) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (reason.trim().length < 3) {
      setError('Give a reason (at least 3 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/moderation/warnings/${encodeURIComponent(warningId)}/revoke`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast.success('Warning revoked', `${refLabel} no longer counts towards escalation.`);
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.issues[0] ? err.issues[0].message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        Revoke
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onConfirm={confirm}
        loading={busy}
        title={`Revoke warning ${refLabel}?`}
        description="The warning stops counting and its record is marked reversed. This is audited and cannot be undone."
        confirmLabel="Revoke warning"
      >
        <Field id={`revoke-${warningId}`} label="Reason" required error={error}>
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={reason}
              maxLength={512}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
