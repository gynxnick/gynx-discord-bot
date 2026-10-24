import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/Form';
import { MAX_CUSTOM_DAYS, PERIOD_PRESETS, PRESET_LABELS, type PeriodSelection } from './period';

/**
 * Period picker driven by URL search params (works without JavaScript).
 * `extra` keeps other params (e.g. sort) on the links.
 */
export function PeriodSelector({
  pathname,
  selection,
  timezone,
  extra = {},
}: {
  pathname: string;
  selection: PeriodSelection;
  timezone: string;
  extra?: Record<string, string>;
}) {
  const href = (range: string) => {
    const qs = new URLSearchParams(extra);
    if (range !== '7d') qs.set('range', range);
    const s = qs.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const activePreset = selection.kind !== 'custom' ? selection.kind : selection.error ? '7d' : null;
  return (
    <div className="flex flex-wrap items-end gap-4">
      <nav aria-label="Period presets">
        <ul className="inline-flex overflow-hidden rounded-md border border-border">
          {PERIOD_PRESETS.map((p) => (
            <li key={p} className="border-r border-border last:border-0">
              <Link
                href={href(p)}
                aria-current={activePreset === p ? 'page' : undefined}
                className={cn(
                  'block px-3 py-1.5 text-sm no-underline hover:no-underline',
                  activePreset === p
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'bg-surface text-fg-muted hover:bg-surface-raised hover:text-fg',
                )}
              >
                {PRESET_LABELS[p]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form
        method="get"
        action={pathname}
        className="flex flex-wrap items-end gap-2"
        aria-label="Custom date range"
      >
        {Object.entries(extra).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="range" value="custom" />
        <div>
          <label htmlFor="period-start" className="mb-1 block text-xs text-fg-muted">
            From
          </label>
          <Input
            id="period-start"
            name="start"
            type="date"
            required
            defaultValue={selection.kind === 'custom' ? selection.start : undefined}
            className="w-40"
          />
        </div>
        <div>
          <label htmlFor="period-end" className="mb-1 block text-xs text-fg-muted">
            To (inclusive)
          </label>
          <Input
            id="period-end"
            name="end"
            type="date"
            required
            defaultValue={selection.kind === 'custom' ? selection.end : undefined}
            className="w-40"
          />
        </div>
        <Button
          type="submit"
          variant={selection.kind === 'custom' && !selection.error ? 'primary' : 'secondary'}
        >
          Apply range
        </Button>
      </form>
      <p className="w-full text-xs text-fg-muted">
        Custom dates are calendar days in {timezone}, up to {MAX_CUSTOM_DAYS} days. Every figure is compared
        with the previous period of equal length.
      </p>
    </div>
  );
}
