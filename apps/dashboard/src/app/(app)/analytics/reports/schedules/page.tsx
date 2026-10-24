import type { Metadata } from 'next';
import { analytics } from '@gynx/services';
import { formatInZone, isValidTimeZone } from '@gynx/shared';
import { attempt } from '@/components/analytics/attempt';
import {
  ReportDefinitionsManager,
  type DefinitionView,
} from '@/components/analytics/ReportDefinitionsManager';
import { ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Report schedules' };

export default async function ReportSchedulesPage() {
  const page = await requirePagePermission('settings.manage', 'analytics.reports.schedules');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  // Listing definitions is an analytics read; managing them is settings.manage.
  if (!page.session.permissions.has('analytics.view'))
    return <PermissionDenied permission="analytics.view" />;

  const result = await attempt(() => analytics.listReportDefinitions(page.ctx));
  const header = (
    <PageHeader
      title="Report schedules"
      description="When each CEO report is generated and where it is posted. Times are wall-clock times in each schedule's own time zone."
      breadcrumbs={[
        { label: 'Analytics', href: '/analytics' },
        { label: 'Weekly reports', href: '/analytics/reports' },
        { label: 'Schedules' },
      ]}
    />
  );
  if (!result.ok) {
    return (
      <>
        {header}
        <ErrorState title="Schedules could not be loaded" description={result.message} />
      </>
    );
  }

  const definitions: DefinitionView[] = result.data.map((d) => {
    const tz = isValidTimeZone(d.timezone) ? d.timezone : 'UTC';
    return {
      id: d.id,
      name: d.name,
      enabled: d.enabled,
      day: d.day,
      time: d.time,
      timezone: d.timezone,
      periodDays: d.periodDays,
      channelId: d.channelId,
      nextRunLabel:
        d.enabled && d.nextRunAt
          ? `${formatInZone(d.nextRunAt, tz, { dateStyle: 'full', timeStyle: 'short' })} (${tz})`
          : null,
      lastRunLabel: d.lastRunAt ? `${formatInZone(d.lastRunAt, tz)} (${tz})` : null,
    };
  });

  return (
    <>
      {header}
      <ReportDefinitionsManager definitions={definitions} guildTimezone={page.timezone} />
    </>
  );
}
