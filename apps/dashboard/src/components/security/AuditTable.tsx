import type { SecurityAuditEvent } from '@gynx/database';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Feedback';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';

function Metadata({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || Object.keys(value as object).length === 0)
    return <span className="text-fg-muted">—</span>;
  const text = JSON.stringify(value);
  return (
    <code
      className="block max-w-xs truncate font-mono text-xs text-fg-muted"
      title={text.length > 500 ? `${text.slice(0, 500)}…` : text}
    >
      {text}
    </code>
  );
}

export function AuditTable({
  events,
  timezone,
  compact = false,
}: {
  events: SecurityAuditEvent[];
  timezone: string;
  compact?: boolean;
}) {
  const columns: Column<SecurityAuditEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (e) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(e.createdAt, timezone)}</span>
      ),
    },
    { key: 'action', header: 'Action', cell: (e) => <code className="font-mono text-xs">{e.action}</code> },
    { key: 'result', header: 'Result', cell: (e) => <StatusBadge status={e.result} /> },
    {
      key: 'actor',
      header: 'Actor',
      cell: (e) => (
        <span className="font-mono text-xs">
          {e.actorId}
          <span className="ml-1 text-fg-muted">({e.source})</span>
        </span>
      ),
    },
  ];
  if (!compact) {
    columns.push(
      {
        key: 'target',
        header: 'Target',
        hideOnMobile: true,
        cell: (e) =>
          e.targetType ? (
            <span className="text-xs">
              {e.targetType} <span className="font-mono text-fg-muted">{e.targetId}</span>
            </span>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        key: 'metadata',
        header: 'Details',
        hideOnMobile: true,
        cell: (e) => <Metadata value={e.metadata} />,
      },
    );
  }
  return (
    <Table
      columns={columns}
      rows={events}
      rowKey={(e) => e.id}
      caption="Security audit events, newest first"
      empty={<EmptyState title="No audit events" description="Nothing matches these filters." />}
    />
  );
}
