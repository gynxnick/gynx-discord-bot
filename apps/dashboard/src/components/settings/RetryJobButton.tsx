'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';

export function RetryJobButton({ jobId, jobType }: { jobId: string; jobType: string }) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
      toast.success('Job requeued', 'The worker will pick it up on its next poll.');
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error('Could not retry job', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`Retry job ${jobType}`}>
        Retry
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={retry}
        loading={busy}
        destructive={false}
        title="Retry this job?"
        confirmLabel="Requeue job"
        description="The job is reset to pending with a fresh attempt budget. Job handlers are idempotent, so work that already completed is not repeated."
      >
        <p className="font-mono text-xs text-fg">{jobType}</p>
      </ConfirmDialog>
    </>
  );
}
