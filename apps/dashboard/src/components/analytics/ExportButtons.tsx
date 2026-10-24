import { buttonClasses } from '@/components/ui/Button';

const FORMATS = [
  { format: 'markdown', label: 'Markdown' },
  { format: 'json', label: 'JSON' },
  { format: 'csv', label: 'CSV' },
] as const;

/** Download links for a generated report. Render only for analytics.export; the route enforces it too. */
export function ExportButtons({ reportId }: { reportId: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Export report">
      {FORMATS.map((f) => (
        <a
          key={f.format}
          href={`/api/analytics/reports/${encodeURIComponent(reportId)}/export?format=${f.format}`}
          download
          className={buttonClasses('secondary', 'sm', 'no-underline hover:no-underline')}
        >
          Export {f.label}
        </a>
      ))}
    </div>
  );
}
