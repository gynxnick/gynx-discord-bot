import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-border-strong bg-surface-raised text-fg-muted',
  accent: 'border-accent/40 bg-accent-soft text-accent',
  success: 'border-success/40 bg-success-soft text-success',
  warning: 'border-warning/40 bg-warning-soft text-warning',
  danger: 'border-danger/40 bg-danger-soft text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Generic mapping for status enums used across modules. Unknown values render neutral. */
const STATUS_TONES: Record<string, BadgeTone> = {
  // jobs
  PENDING: 'neutral',
  RUNNING: 'accent',
  DONE: 'success',
  FAILED: 'warning',
  CANCELLED: 'neutral',
  DEAD: 'danger',
  // reports
  NEW: 'accent',
  TRIAGED: 'warning',
  INVESTIGATING: 'warning',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
  // audit results
  SUCCESS: 'success',
  DENIED: 'danger',
  FAILURE: 'warning',
  // grants
  ALLOW: 'success',
  DENY: 'danger',
};

export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function StatusBadge({ status, label, tone }: { status: string; label?: string; tone?: BadgeTone }) {
  return (
    <Badge tone={tone ?? STATUS_TONES[status] ?? 'neutral'} dot>
      {label ?? humanizeEnum(status)}
    </Badge>
  );
}
