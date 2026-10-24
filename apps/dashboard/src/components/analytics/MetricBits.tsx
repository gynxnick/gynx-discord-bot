import type { ReactNode } from 'react';
import { BarChart } from '@/components/ui/Chart';
import { StatCard } from '@/components/ui/PageHeader';
import { breakdownEntries, displayMetric, fmtNum, unavailableText, type MetricLike } from './format';

/** KPI tile: value + change vs previous period ("n/a" without a baseline; "Not available — reason" when unavailable). */
export function KpiCard({
  label,
  metric,
  suffix,
  href,
  noteOverride,
}: {
  label: string;
  metric: MetricLike<number> | undefined;
  suffix?: string;
  href?: string;
  noteOverride?: string;
}) {
  const d = displayMetric(metric, suffix);
  if (!d.available) {
    return (
      <StatCard
        label={label}
        href={href}
        value={<span className="block text-sm font-normal leading-snug text-fg-muted">{d.value}</span>}
      />
    );
  }
  const note = noteOverride ?? d.note;
  return (
    <StatCard
      label={label}
      href={href}
      value={d.value}
      hint={
        <>
          <span>
            vs previous: <span className="tabular-nums text-fg">{d.delta}</span>
          </span>
          {note && <span className="mt-0.5 block">{note}</span>}
        </>
      }
    />
  );
}

export interface MetricRowDef {
  label: string;
  metric: MetricLike<number> | undefined;
  suffix?: string;
  /** Custom value renderer (e.g. durations) for available metrics. */
  format?: (v: number) => string;
}

/** Compact table of scalar metrics with previous-period comparison. */
export function MetricTable({ rows, caption }: { rows: MetricRowDef[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
            <th scope="col" className="px-4 py-2 font-medium">
              Metric
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              This period
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              vs previous
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = displayMetric(r.metric, r.suffix);
            const m = r.metric;
            return (
              <tr key={r.label} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal text-fg">
                  {r.label}
                  {d.note && <span className="block text-xs text-fg-muted">{d.note}</span>}
                </th>
                {d.available ? (
                  <>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-fg">
                      {r.format && m?.available ? r.format(m.value) : d.value}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-fg-muted">
                      {d.delta}
                    </td>
                  </>
                ) : (
                  <td colSpan={2} className="px-4 py-2 text-right text-xs text-fg-muted">
                    {d.value}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Bars for a breakdown record (by type / rule / severity …) plus the exact values. */
export function BreakdownChart({
  title,
  metric,
  emptyText = 'None in this period.',
}: {
  title: string;
  metric: MetricLike<Record<string, number>> | undefined;
  emptyText?: string;
}) {
  const entries = breakdownEntries(metric);
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">{title}</h3>
      {entries === null ? (
        <p className="mt-2 text-sm text-fg-muted">
          {metric && !metric.available
            ? unavailableText(metric.reason)
            : unavailableText('not reported for this period')}
        </p>
      ) : entries.every((e) => e.value === 0) ? (
        <p className="mt-2 text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <>
          <BarChart
            className="mt-2"
            title={title}
            height={160}
            data={entries.filter((e) => e.value > 0).map((e) => ({ label: e.label, value: e.value }))}
          />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            {entries.map((e) => (
              <li key={e.key}>
                {e.label}: <span className="tabular-nums text-fg">{fmtNum(e.value)}</span>
                {e.previous !== null && <span> (prev {fmtNum(e.previous)})</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-fg-muted">{children}</p>;
}
