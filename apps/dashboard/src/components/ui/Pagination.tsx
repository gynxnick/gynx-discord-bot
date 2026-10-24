import { buttonClasses } from './Button';
import { cn } from './cn';
import Link from 'next/link';

/** Cursor-based previous/next navigation (links, so it works without JavaScript). */
export function Pagination({
  prevHref,
  nextHref,
  label = 'Pagination',
  className,
}: {
  prevHref: string | null;
  nextHref: string | null;
  label?: string;
  className?: string;
}) {
  if (!prevHref && !nextHref) return null;
  const disabled = cn(buttonClasses('secondary', 'sm'), 'pointer-events-none opacity-40');
  return (
    <nav
      aria-label={label}
      className={cn('flex items-center justify-between gap-2 border-t border-border px-4 py-3', className)}
    >
      {prevHref ? (
        <Link href={prevHref} className={buttonClasses('secondary', 'sm')} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className={disabled} aria-disabled="true">
          ← Previous
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} className={buttonClasses('secondary', 'sm')} rel="next">
          Next →
        </Link>
      ) : (
        <span className={disabled} aria-disabled="true">
          Next →
        </span>
      )}
    </nav>
  );
}
