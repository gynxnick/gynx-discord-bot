import type { Metadata } from 'next';
import Link from 'next/link';
import { AuditTable } from '@/components/security/AuditTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import { getOverview } from '@/server/queries/overview';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const { ctx, session, timezone } = await requireSession();
  const data = await getOverview(ctx);
  const canSettings = session.permissions.has('settings.manage');

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.username}`}
        description="A live snapshot of the GYNX.GG community platform."
      />

      {!data.database.ok && (
        <Alert tone="danger" title="Database unreachable" className="mb-6">
          The dashboard cannot reach the database right now, so no figures can be shown. Bot and worker may
          also be affected.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.member && (
          <StatCard
            label="Members"
            value={formatNumber(data.member.count)}
            hint={data.member.at ? `Snapshot ${relativeTime(data.member.at)}` : 'No snapshot recorded yet'}
          />
        )}
        {data.openReports !== null && (
          <StatCard
            label="Open abuse reports"
            value={formatNumber(data.openReports)}
            tone={data.openReports > 0 ? 'warning' : 'neutral'}
            href="/security/reports"
          />
        )}
        {data.activeIncidents !== null && (
          <StatCard
            label="Active incidents"
            value={formatNumber(data.activeIncidents)}
            tone={data.activeIncidents > 0 ? 'danger' : 'success'}
            href="/status"
          />
        )}
        {data.scheduledAnnouncements !== null && (
          <StatCard
            label="Scheduled announcements"
            value={formatNumber(data.scheduledAnnouncements)}
            href="/marketing"
          />
        )}
        {data.upcomingEvents !== null && (
          <StatCard label="Upcoming events" value={formatNumber(data.upcomingEvents)} href="/marketing" />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Platform health" description="What the dashboard can observe directly." />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-fg-muted">Database</dt>
                <dd>
                  {data.database.ok ? (
                    <StatusBadge status="SUCCESS" label="Reachable" />
                  ) : (
                    <StatusBadge status="DENIED" label="Unreachable" />
                  )}
                </dd>
              </div>
              {data.jobs && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-fg-muted">Pending jobs</dt>
                    <dd className="tabular-nums">{formatNumber(data.jobs.pending)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-fg-muted">Retrying jobs</dt>
                    <dd className="tabular-nums">{formatNumber(data.jobs.failed)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-fg-muted">Dead-lettered jobs</dt>
                    <dd>
                      {data.jobs.dead > 0 ? (
                        canSettings ? (
                          <Link href="/settings/jobs">
                            <StatusBadge status="DEAD" label={`${data.jobs.dead} need attention`} />
                          </Link>
                        ) : (
                          <StatusBadge status="DEAD" label={`${data.jobs.dead} need attention`} />
                        )
                      ) : (
                        <span className="tabular-nums">0</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-fg-muted">Last job processed</dt>
                    <dd
                      title={
                        data.jobs.lastCompletedAt
                          ? formatDateTime(data.jobs.lastCompletedAt, timezone)
                          : undefined
                      }
                    >
                      {relativeTime(data.jobs.lastCompletedAt)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            <p className="mt-4 text-xs text-fg-muted">
              Bot and worker process health is reported by their own health endpoints and is not visible from
              the dashboard. A recent &ldquo;last job processed&rdquo; time indicates the worker is running.
            </p>
          </CardBody>
        </Card>

        {data.recentAudit && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Recent security events"
              actions={
                <Link href="/security/audit" className="text-xs">
                  View audit log
                </Link>
              }
            />
            <AuditTable events={data.recentAudit} timezone={timezone} compact />
          </Card>
        )}
      </div>
    </>
  );
}
