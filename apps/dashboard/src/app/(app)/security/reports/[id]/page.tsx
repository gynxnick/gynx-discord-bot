import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { security } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import { ReportActions } from '@/components/security/ReportActions';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Report' };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('security.reports.view', 'security.report');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();

  let data;
  try {
    data = await security.getReport(page.ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const { report, notes } = data;
  const canManage = page.session.permissions.has('security.reports.manage');
  const tz = page.timezone;
  const closed = report.status === 'RESOLVED' || report.status === 'DISMISSED';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{report.ref}</span>
            <StatusBadge status={report.status} />
          </span>
        }
        description={security.CATEGORY_LABELS[report.category]}
        breadcrumbs={[
          { label: 'Security' },
          { label: 'Abuse reports', href: '/security/reports' },
          { label: report.ref },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Report" />
            <CardBody className="space-y-5">
              <div>
                <h3 className="text-xs uppercase tracking-wide text-fg-muted">Description</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{report.description}</p>
              </div>
              <DescriptionList
                items={[
                  {
                    label: 'Reported user',
                    value: report.reportedUserId ? (
                      <span className="font-mono">{report.reportedUserId}</span>
                    ) : (
                      'Not specified'
                    ),
                  },
                  {
                    label: 'Reporter',
                    value: report.reporterId ? (
                      <span className="font-mono">{report.reporterId}</span>
                    ) : (
                      <span className="text-fg-muted">Hidden (requires report management)</span>
                    ),
                  },
                  { label: 'Submitted', value: formatDateTime(report.createdAt, tz) },
                  {
                    label: 'Assignee',
                    value: report.assigneeId ? (
                      <span className="font-mono">{report.assigneeId}</span>
                    ) : (
                      'Unassigned'
                    ),
                  },
                  {
                    label: 'Message link',
                    value: report.messageLink ? (
                      <a href={report.messageLink} target="_blank" rel="noopener noreferrer nofollow">
                        Open in Discord
                      </a>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Closed', value: report.resolvedAt ? formatDateTime(report.resolvedAt, tz) : '—' },
                ]}
              />
              <div>
                <h3 className="text-xs uppercase tracking-wide text-fg-muted">Evidence links</h3>
                {report.evidenceUrls.length === 0 ? (
                  <p className="mt-1 text-sm text-fg-muted">None provided.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {report.evidenceUrls.map((u) => (
                      <li key={u} className="break-all text-sm">
                        <a href={u} target="_blank" rel="noopener noreferrer nofollow">
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {report.evidenceUrls.length > 0 && (
                  <p className="mt-1 text-xs text-fg-muted">
                    External links are user-supplied. Open with care.
                  </p>
                )}
              </div>
              {report.resolution && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-fg-muted">Resolution</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{report.resolution}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {canManage && (
            <Card>
              <CardHeader title="Staff notes" description="Visible only to staff who can manage reports." />
              {notes.length === 0 ? (
                <EmptyState title="No notes yet" />
              ) : (
                <ol className="divide-y divide-border">
                  {notes.map((n) => (
                    <li key={n.id} className="px-4 py-3">
                      <p className="text-xs text-fg-muted">
                        <span className="font-mono">{n.authorId}</span> · {formatDateTime(n.createdAt, tz)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{n.content}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {canManage ? (
            <ReportActions
              reportId={report.id}
              status={report.status}
              assignedToMe={report.assigneeId === page.session.userId}
              closed={closed}
              nextStatuses={(['TRIAGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const).filter((s) =>
                security.canTransitionReport(report.status, s),
              )}
            />
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-fg-muted">
                  You can view this report. Triage, notes and status changes require the report management
                  permission.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
