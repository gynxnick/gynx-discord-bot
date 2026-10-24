'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

/** Copy text to the clipboard with visible + screen-reader feedback. */
export function CopyButton({
  text,
  label = 'Copy',
  description,
}: {
  text: string;
  label?: string;
  description?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void copy()}
        aria-label={description ?? `${label}: ${text}`}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied'
          ? 'Link copied to clipboard'
          : state === 'failed'
            ? 'Could not copy. Select the link and copy it manually.'
            : ''}
      </span>
    </>
  );
}
