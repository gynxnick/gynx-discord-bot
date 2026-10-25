'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import type { OperationPreviewView } from './types';

type PreviewType = 'START' | 'REPAIR' | 'UPDATE';

const ACTIONS: Array<{ type: PreviewType; label: string; help: string }> = [
  {
    type: 'START',
    label: 'Preview setup',
    help: 'Plan provisioning (or resume it) from the blueprint and your configuration.',
  },
  { type: 'REPAIR', label: 'Repair', help: 'Plan restoring missing or renamed roles, channels and panels.' },
  { type: 'UPDATE', label: 'Update', help: 'Plan applying the current blueprint version to this server.' },
];

/**
 * Starts a preview (nothing changes in Discord yet) and opens it on the
 * operation page, where it can be reviewed and confirmed.
 */
export function SetupActions({ primary = 'START' }: { primary?: PreviewType }) {
  const router = useRouter();
  const { run, pending } = useApiAction();
  const [running, setRunning] = useState<PreviewType | null>(null);

  const preview = async (type: PreviewType) => {
    setRunning(type);
    const res = await run<OperationPreviewView>(
      '/api/setup/preview',
      'POST',
      { type },
      { errorTitle: 'Preview could not be created', refresh: false },
    );
    setRunning(null);
    if (res) router.push(`/setup/operations/${encodeURIComponent(res.operationId)}`);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map((a) => (
        <Button
          key={a.type}
          variant={a.type === primary ? 'primary' : 'secondary'}
          onClick={() => void preview(a.type)}
          loading={running === a.type}
          loadingLabel="Reading the server…"
          disabled={pending && running !== a.type}
          title={a.help}
          aria-describedby="setup-actions-help"
        >
          {a.label}
        </Button>
      ))}
      <p id="setup-actions-help" className="sr-only">
        Each button creates a preview first. Nothing changes in Discord until you confirm it.
      </p>
    </div>
  );
}
