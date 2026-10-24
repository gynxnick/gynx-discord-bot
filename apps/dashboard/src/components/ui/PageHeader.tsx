import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
            {breadcrumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.href ? (
                  <Link href={c.href} className="text-fg-muted hover:text-fg">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const valueTone = {
    neutral: 'text-fg',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', valueTone)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </>
  );
  const cls = 'block rounded-lg border border-border bg-surface p-4';
  return href ? (
    <Link
      href={href}
      className={cn(
        cls,
        'text-inherit no-underline transition-colors hover:border-border-strong hover:bg-surface-raised hover:no-underline',
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
