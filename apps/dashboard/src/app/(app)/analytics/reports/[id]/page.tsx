import type { Metadata } from 'next';
import { analytics } from '@gynx/services';
import { attempt } from '@/components/analytics/attempt';
import { ExportButtons } from '@/components/analytics/ExportButtons';
import { deliveryStatus } from '@/components/analytics/format';
import { SafeMarkdown } from '@/components/analytics/markdown';
import { RetryDeliveryButton } from '@/components/analytics/RetryDeliveryButton';
import { StatusBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { EmptyState, ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Report' };

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('analytics.view', 'analytics.report');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const tz = page.timezone;
  const result = await attempt(() => analytics.getReport(page.ctx, id));
  const crumbs = [
    { label: 'Analytics', href: '/analytics' },
    { label: 'Weekly reports', href: '/analytics/reports' },
  ];

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Report" breadcrumbs={[...crumbs, { label: 'Report' }]} />
        <ErrorState
          title={result.code === 'NOT_FOUND' ? 'Report not found' : 'Report could not be loaded'}
          description={result.message}
          action={
            <ButtonLink href="/analytics/reports" variant="secondary">
              Back to reports
            </ButtonLink>
          }
        />
      </>
    );
  }

  const r = result.data;
  const status = deliveryStatus(r);
  const canExport = page.session.permissions.has('analytics.export');
  const canManage = page.session.permissions.has('settings.manage');
  const period = `${formatDateTime(r.periodStart, tz)} – ${formatDateTime(r.periodEnd, tz)}`;

  return (
    <>
      <PageHeader
        title={r.definitionName}
        description={period}
        breadcrumbs={[...crumbs, { label: formatDateTime(r.periodStart, tz) }]}
        actions={canExport ? <ExportButtons reportId={r.id} /> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader
            title="Report"
            description="Rendered from the stored Markdown. Figures are as of generation time."
          />
          <CardBody>
            {r.markdown.trim() ? (
              <SafeMarkdown source={r.markdown} className="max-w-none" />
            ) : (
              <EmptyState title="This report has no content" />
            )}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-4">
              <DescriptionList
                items={[
                  { label: 'Period', value: period },
                  { label: 'Generated', value: formatDateTime(r.createdAt, tz) },
                  {
                    label: 'Delivery',
                    value: <StatusBadge status={status.label} label={status.label} tone={status.tone} />,
                  },
                  ...(r.deliveredAt
                    ? [{ label: 'Delivered', value: formatDateTime(r.deliveredAt, tz) }]
                    : []),
                  ...(r.messageId
                    ? [
                        {
                          label: 'Message ID',
                          value: <span className="font-mono text-xs">{r.messageId}</span>,
                        },
                      ]
                    : []),
                ]}
              />
              {!r.deliveredAt && r.deliveryError && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-fg-muted">Delivery error</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-danger">
                    {r.deliveryError}
                  </p>
                </div>
              )}
              {!r.deliveredAt && canManage && (
                <RetryDeliveryButton reportId={r.id} label={`${r.definitionName}, ${period}`} />
              )}
              {!canExport && (
                <p className="text-xs text-fg-muted">
                  Exporting reports requires the analytics.export permission.
                </p>
              )}
            </CardBody>
          </Card>
          {r.messageId === null && r.deliveredAt === null && (
            <p className="text-xs text-fg-muted">
              Reports post to the schedule&apos;s channel
              {canManage ? '; check it under Manage schedules.' : '.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
