'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';

/** Re-queue delivery of an undelivered report (settings.manage). Never regenerates the report. */
export function RetryDeliveryButton({ reportId, label }: { reportId: string; label: string }) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await api(`/api/analytics/reports/${encodeURIComponent(reportId)}/retry`, { method: 'POST' });
      toast.success('Delivery queued', 'The worker will post the report shortly.');
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error('Could not retry delivery', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`Retry delivery of ${label}`}
      >
        Retry delivery
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={retry}
        loading={busy}
        destructive={false}
        title="Retry report delivery?"
        confirmLabel="Queue delivery"
        description="The existing report is posted again to the schedule's channel. If delivery failed, fix the channel or the bot's permissions first."
      >
        <p className="text-sm text-fg">{label}</p>
      </ConfirmDialog>
    </>
  );
}
