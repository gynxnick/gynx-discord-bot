'use client';

import { useId, useState } from 'react';
import { cn } from './cn';

/**
 * Tiny dependency-free single-series SVG charts (line + bar) for analytics.
 * Thin marks, recessive grid, hover tooltip per point/bar, and a screen-reader
 * table with the exact values (identity is never colour-only: one series,
 * named by the chart title).
 */
export interface ChartPoint {
  label: string;
  value: number;
}

interface ChartProps {
  data: readonly ChartPoint[];
  /** Accessible name, e.g. "Daily active members, last 30 days". */
  title: string;
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}

const W = 600;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

function useScales(data: readonly ChartPoint[], height: number) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  return { max, innerW, innerH, y, ticks };
}

function Frame({
  height,
  ticks,
  y,
  fmt,
  labels,
  xAt,
}: {
  height: number;
  ticks: number[];
  y: (v: number) => number;
  fmt: (v: number) => string;
  labels: readonly string[];
  xAt: (i: number) => number;
}) {
  const every = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#23232E" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="#9CA3AF">
            {fmt(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="#9CA3AF">
            {l}
          </text>
        ) : null,
      )}
    </g>
  );
}

function SrTable({
  data,
  title,
  fmt,
}: {
  data: readonly ChartPoint[];
  title: string;
  fmt: (v: number) => string;
}) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}>
            <th scope="row">{d.label}</th>
            <td>{fmt(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({ point, fmt, xPct }: { point: ChartPoint; fmt: (v: number) => string; xPct: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded border border-border-strong bg-surface-raised px-2 py-1 text-xs text-fg shadow"
      style={{ left: `${Math.min(92, Math.max(8, xPct))}%` }}
    >
      <span className="text-fg-muted">{point.label}</span>{' '}
      <span className="font-medium tabular-nums">{fmt(point.value)}</span>
    </div>
  );
}

function NoData({ title, className }: { title: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-32 items-center justify-center rounded border border-dashed border-border text-sm text-fg-muted',
        className,
      )}
    >
      No data for {title.toLowerCase()} yet.
    </div>
  );
}

export function LineChart({
  data,
  title,
  height = 180,
  formatValue = (v) => v.toLocaleString('en-US'),
  className,
}: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { innerW, y, ticks } = useScales(data, height);
  if (data.length === 0) return <NoData title={title} className={className} />;
  const xAt = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(' ');
  const band = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const hp = hover !== null ? data[hover] : undefined;
  return (
    <figure className={cn('relative', className)} aria-labelledby={id}>
      <figcaption id={id} className="sr-only">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={title}
        onMouseLeave={() => setHover(null)}
      >
        <Frame
          height={height}
          ticks={ticks}
          y={y}
          fmt={formatValue}
          labels={data.map((d) => d.label)}
          xAt={xAt}
        />
        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={PAD.top}
            y2={height - PAD.bottom}
            stroke="#33334A"
            strokeWidth={1}
            aria-hidden="true"
          />
        )}
        <path
          d={path}
          fill="none"
          stroke="#22D3EE"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        />
        {hp && hover !== null && (
          <circle
            cx={xAt(hover)}
            cy={y(hp.value)}
            r={4}
            fill="#22D3EE"
            stroke="#111118"
            strokeWidth={2}
            aria-hidden="true"
          />
        )}
        {data.map((_, i) => (
          <rect
            key={i}
            x={xAt(i) - band / 2}
            y={PAD.top}
            width={band}
            height={height - PAD.top - PAD.bottom}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            aria-hidden="true"
          />
        ))}
      </svg>
      {hp && hover !== null && <Tooltip point={hp} fmt={formatValue} xPct={(xAt(hover) / W) * 100} />}
      <SrTable data={data} title={title} fmt={formatValue} />
    </figure>
  );
}

export function BarChart({
  data,
  title,
  height = 180,
  formatValue = (v) => v.toLocaleString('en-US'),
  className,
}: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { innerW, y, ticks } = useScales(data, height);
  if (data.length === 0) return <NoData title={title} className={className} />;
  const slot = innerW / data.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(32, slot - gap));
  const xAt = (i: number) => PAD.left + slot * i + slot / 2;
  const base = y(0);
  const r = Math.min(4, barW / 2);
  const hp = hover !== null ? data[hover] : undefined;
  return (
    <figure className={cn('relative', className)} aria-labelledby={id}>
      <figcaption id={id} className="sr-only">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={title}
        onMouseLeave={() => setHover(null)}
      >
        <Frame
          height={height}
          ticks={ticks}
          y={y}
          fmt={formatValue}
          labels={data.map((d) => d.label)}
          xAt={xAt}
        />
        {data.map((d, i) => {
          const top = y(d.value);
          const h = Math.max(0, base - top);
          const x = xAt(i) - barW / 2;
          const rr = Math.min(r, h);
          // Rounded data-end, square at the baseline.
          const p =
            h <= 0
              ? ''
              : `M${x},${base} L${x},${top + rr} Q${x},${top} ${x + rr},${top} L${x + barW - rr},${top} Q${x + barW},${top} ${x + barW},${top + rr} L${x + barW},${base} Z`;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect
                x={xAt(i) - slot / 2}
                y={PAD.top}
                width={slot}
                height={base - PAD.top}
                fill="transparent"
                aria-hidden="true"
              />
              {p && (
                <path
                  d={p}
                  fill="#22D3EE"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                  aria-hidden="true"
                />
              )}
            </g>
          );
        })}
      </svg>
      {hp && hover !== null && <Tooltip point={hp} fmt={formatValue} xPct={(xAt(hover) / W) * 100} />}
      <SrTable data={data} title={title} fmt={formatValue} />
    </figure>
  );
}
