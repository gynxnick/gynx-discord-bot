import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('rounded-lg border border-border bg-surface', className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  headingLevel = 2,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <H className="text-sm font-semibold text-fg">{title}</H>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4', className)} {...rest} />;
}

/** Definition list for read-only key/value data. */
export function DescriptionList({
  items,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-fg-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
