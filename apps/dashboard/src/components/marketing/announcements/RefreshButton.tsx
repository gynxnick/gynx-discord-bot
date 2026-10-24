'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';

/** Re-render the server data (e.g. to see a delivery the worker just finished). */
export function RefreshButton({ label = 'Refresh status' }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      loadingLabel="Refreshing…"
      onClick={() => start(() => router.refresh())}
    >
      {label}
    </Button>
  );
}
