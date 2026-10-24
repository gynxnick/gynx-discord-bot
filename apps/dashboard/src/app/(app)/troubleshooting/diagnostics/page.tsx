import type { Metadata } from 'next';
import Link from 'next/link';
import { games, getGuildConfig, troubleshooting } from '@gynx/services';
import { formatBytes, parseFindings } from '@/components/troubleshooting/diagnostics';
import { RetentionNote } from '@/components/troubleshooting/RetentionNote';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, truncateText } from '@/lib/format';
import { pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Diagnostics' };

type Rec = Awaited<ReturnType<typeof troubleshooting.listDiagnostics>>['items'][number];

export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('troubleshooting.manage', 'troubleshooting.diagnostics');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const tz = page.timezone;
  const now = new Date();

  const [result, cfg] = await Promise.all([
    troubleshooting.listDiagnostics(page.ctx, { cursor: readCursor(sp).cursor, limit: 25 }),
    getGuildConfig(page.ctx.db, page.ctx.guildId),
  ]);
  const links = pageLinks('/troubleshooting/diagnostics', sp, result.nextCursor);
  const gameName = (g: string) => games.findGame(g)?.name ?? g;

  const columns: Column<Rec>[] = [
    {
      key: 'file',
      header: 'File',
      cell: (r) => (
        <Link href={`/troubleshooting/diagnostics/${r.id}`} className="font-mono text-xs font-medium">
          {r.fileName}
        </Link>
      ),
    },
    { key: 'game', header: 'Game', cell: (r) => gameName(r.game) },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap">{formatBytes(r.fileSize)}</span>,
    },
    {
      key: 'findings',
      header: 'Findings',
      cell: (r) => {
        const f = parseFindings(r.findings);
        if (f.length === 0) return <span className="text-fg-muted">None</span>;
        return (
          <span className="block min-w-[12rem]">
            <span className="font-medium">{f.length}</span>
            <span className="text-fg-muted"> · {truncateText(f.map((x) => x.title).join(', '), 90)}</span>
          </span>
        );
      },
    },
    {
      key: 'escalated',
      header: 'Escalated',
      cell: (r) =>
        r.escalated ? <Badge tone="warning">Still stuck</Badge> : <span className="text-fg-muted">No</span>,
    },
    {
      key: 'created',
      header: 'Created',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.createdAt, tz)}</span>,
    },
    {
      key: 'expires',
      header: 'Excerpt',
      cell: (r) =>
        r.purgedAt ? (
          <Badge>Purged {formatDateTime(r.purgedAt, tz)}</Badge>
        ) : r.expiresAt <= now ? (
          <Badge>Expired</Badge>
        ) : (
          <span className="whitespace-nowrap text-fg-muted">Expires {formatDateTime(r.expiresAt, tz)}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Diagnostics"
        description="Results of /diagnose log analysis. Findings are likely causes from deterministic checks, not confirmed diagnoses."
        breadcrumbs={[{ label: 'Troubleshooting', href: '/troubleshooting' }, { label: 'Diagnostics' }]}
      />
      <RetentionNote hours={cfg.diagnosticRetentionHours} />
      <Card className="mt-6">
        <Table
          columns={columns}
          rows={result.items}
          rowKey={(r) => r.id}
          caption="Diagnosis records, newest first"
          empty={
            <EmptyState
              title="No diagnoses yet"
              description="When members run /diagnose with a log file, the findings appear here."
            />
          }
        />
        <Pagination prevHref={links.prev} nextHref={links.next} label="Diagnostics pages" />
      </Card>
    </>
  );
}
