'use client';

import { useRouter } from 'next/navigation';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import type { OperationPreviewView } from './types';

/** Creates a rollback preview for an applied operation and opens it (nothing changes until confirmed). */
export function RollbackButton({ operationId, label }: { operationId: string; label: string }) {
  const router = useRouter();
  const { run, pending } = useApiAction();
  const preview = async () => {
    const res = await run<OperationPreviewView>(
      '/api/setup/rollback/preview',
      'POST',
      { operationId },
      { errorTitle: 'Rollback preview could not be created', refresh: false },
    );
    if (res) router.push(`/setup/operations/${encodeURIComponent(res.operationId)}`);
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => void preview()}
      loading={pending}
      loadingLabel="Planning rollback…"
      aria-label={`Preview rollback of ${label}`}
    >
      Preview rollback
    </Button>
  );
}
