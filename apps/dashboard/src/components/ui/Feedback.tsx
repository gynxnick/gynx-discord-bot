import type { ReactNode } from 'react';
import { cn } from './cn';
import { ButtonLink } from './Button';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const alertTones: Record<AlertTone, string> = {
  info: 'border-accent/40 bg-accent-soft',
  success: 'border-success/40 bg-success-soft',
  warning: 'border-warning/40 bg-warning-soft',
  danger: 'border-danger/40 bg-danger-soft',
};
const alertTitleTones: Record<AlertTone, string> = {
  info: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Inline, persistent message. Danger/warning alerts are announced to screen readers. */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
  actions,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3', alertTones[tone], className)}
    >
      {title && <p className={cn('text-sm font-semibold', alertTitleTones[tone])}>{title}</p>}
      {children && <div className={cn('text-sm text-fg', title ? 'mt-1' : undefined)}>{children}</div>}
      {actions && <div className="mt-3 flex gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-surface-raised', className)} />;
}

/** Page-level loading placeholder. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-8 w-8', className)}
    >
      <path d={path} />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <Icon
        path="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0 9 4.5m0 0 9-4.5M12 12v9"
        className="text-fg-muted"
      />
      <p className="mt-3 text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  reference,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  reference?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-surface px-6 py-12 text-center"
    >
      <Icon
        path="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        className="text-danger"
      />
      <p className="mt-3 text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>}
      {reference && <p className="mt-2 font-mono text-xs text-fg-muted">Reference: {reference}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PermissionDenied({
  permission,
  description,
}: {
  permission?: string;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-16 text-center">
      <Icon
        path="M16.5 10.5V7a4.5 4.5 0 1 0-9 0v3.5M6 10.5h12a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5V12A1.5 1.5 0 0 1 6 10.5Z"
        className="text-fg-muted"
      />
      <h1 className="mt-3 text-base font-semibold text-fg">You don&apos;t have access to this page</h1>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        {description ??
          'Your staff role does not include the permission this page needs. Ask an administrator if you believe this is a mistake.'}
      </p>
      {permission && (
        <p className="mt-3 text-xs text-fg-muted">
          Required permission:{' '}
          <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-fg">{permission}</code>
        </p>
      )}
      <div className="mt-5">
        <ButtonLink href="/" variant="secondary">
          Back to overview
        </ButtonLink>
      </div>
    </div>
  );
}
