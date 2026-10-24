import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Header becomes a sort link when the table has `sortHref`. */
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide on narrow screens. */
  hideOnMobile?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  /** Visually hide the caption (still read by screen readers). */
  captionHidden?: boolean;
  sort?: { key: string; dir: SortDir };
  /** Builds the URL for sorting by a column (server-driven sorting via search params). */
  sortHref?: (key: string, dir: SortDir) => string;
  empty?: ReactNode;
  className?: string;
}

const alignCls = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function SortIcon({ dir }: { dir: SortDir | null }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="currentColor">
      <path d="M6 2 9 5H3z" opacity={dir === 'asc' ? 1 : 0.35} />
      <path d="M6 10 3 7h6z" opacity={dir === 'desc' ? 1 : 0.35} />
    </svg>
  );
}

/** Accessible data table (server-compatible). Scrolls horizontally on small screens. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = true,
  sort,
  sortHref,
  empty,
  className,
}: TableProps<T>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className={cn('px-4 py-2 text-left text-xs text-fg-muted', captionHidden && 'sr-only')}>
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => {
              const active = sort?.key === c.key ? sort.dir : null;
              const ariaSort =
                active === 'asc'
                  ? 'ascending'
                  : active === 'desc'
                    ? 'descending'
                    : c.sortable && sortHref
                      ? 'none'
                      : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-fg-muted',
                    alignCls[c.align ?? 'left'],
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.className,
                  )}
                >
                  {c.sortable && sortHref ? (
                    <Link
                      href={sortHref(c.key, active === 'desc' ? 'asc' : 'desc')}
                      className="inline-flex items-center gap-1 text-fg-muted no-underline hover:text-fg hover:no-underline"
                    >
                      {c.header}
                      <SortIcon dir={active} />
                    </Link>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty ?? <p className="px-4 py-10 text-center text-sm text-fg-muted">Nothing to show.</p>}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border last:border-0 hover:bg-surface-raised/60"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-2.5 align-top text-fg',
                      alignCls[c.align ?? 'left'],
                      c.hideOnMobile && 'hidden md:table-cell',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
