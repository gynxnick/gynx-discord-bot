'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Accessible toggle: a button with role="switch" and aria-checked. */
export function Switch({ id, checked, onChange, label, description, disabled, className }: SwitchProps) {
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div>
        <span id={labelId} className="block text-sm font-medium text-fg">
          {label}
        </span>
        {description && (
          <span id={descId} className="block text-xs text-fg-muted">
            {description}
          </span>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
          checked ? 'border-accent bg-accent' : 'border-border-strong bg-surface-raised',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full transition-transform',
            checked ? 'translate-x-[18px] bg-void' : 'translate-x-[2px] bg-fg-muted',
          )}
        />
      </button>
    </div>
  );
}
