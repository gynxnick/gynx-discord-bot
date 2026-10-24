'use client';

import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/Feedback';

/** Route-level error boundary. Never shows error details — only Next's opaque digest. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page could not be loaded"
      description="Something went wrong on our side. Try again; if it keeps happening, share the reference below with the team."
      reference={error.digest}
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
