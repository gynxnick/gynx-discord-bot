import { Badge } from '@/components/ui/Badge';
import { cn } from '@/components/ui/cn';
import { FINDING_LABELS, FINDING_TONES, sortFindings } from './preview-utils';
import type { FindingView } from './types';

/** Findings, blocking first. Server- and client-compatible. */
export function FindingsList({
  findings,
  empty = 'Nothing to report.',
  className,
}: {
  findings: readonly FindingView[];
  empty?: string;
  className?: string;
}) {
  if (findings.length === 0) return <p className={cn('text-sm text-fg-muted', className)}>{empty}</p>;
  return (
    <ul className={cn('space-y-2', className)}>
      {sortFindings(findings).map((f, i) => (
        <li
          key={`${f.code}-${f.key ?? ''}-${i}`}
          className={cn(
            'flex flex-col gap-1 rounded border px-3 py-2 sm:flex-row sm:items-start sm:gap-3',
            f.level === 'blocking' ? 'border-danger/40 bg-danger-soft' : 'border-border bg-surface-raised/40',
          )}
        >
          <Badge tone={FINDING_TONES[f.level]} className="self-start">
            {FINDING_LABELS[f.level]}
          </Badge>
          <div className="min-w-0 text-sm">
            <p className="break-words text-fg">{f.message}</p>
            {(f.key || f.code) && (
              <p className="mt-0.5 font-mono text-[11px] text-fg-muted">
                {f.code}
                {f.key ? ` · ${f.key}` : ''}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
