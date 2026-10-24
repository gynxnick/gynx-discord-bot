import Link from 'next/link';
import { cn } from '@/components/ui/cn';

/** Server-driven tab strip (links, works without JavaScript). Also used by the partners pages. */
export function LinkTabs({
  items,
  label,
  className,
}: {
  items: Array<{ href: string; label: string; active: boolean; count?: number }>;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('flex flex-wrap gap-1 border-b border-border px-2', className)}>
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm no-underline hover:no-underline',
            t.active ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="rounded bg-surface-raised px-1.5 text-xs tabular-nums text-fg-muted">
              {t.count.toLocaleString('en-US')}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
