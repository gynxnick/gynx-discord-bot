import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { analytics } from '@gynx/services';
import { formatInZone } from '@gynx/shared';
import { attempt } from '@/components/analytics/attempt';
import { ChannelLabel } from '@/components/analytics/ChannelLabel';
import { fmtNum, formatMinutes, uptimeText } from '@/components/analytics/format';
import { BreakdownChart, KpiCard, MetricTable, SectionNote } from '@/components/analytics/MetricBits';
import { periodLabel, resolvePeriod } from '@/components/analytics/period';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { Badge, humanizeEnum } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { BarChart } from '@/components/ui/Chart';
import { Alert, ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Analytics' };

const ACTIVITY_FOOTNOTE =
  'Discord does not provide message views or impressions; activity metrics are observed message counts.';

export default async function AnalyticsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const page = await requirePagePermission('analytics.view', 'analytics');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const selection = resolvePeriod(
    { range: firstParam(sp, 'range'), start: firstParam(sp, 'start'), end: firstParam(sp, 'end') },
    page.timezone,
  );
  const result = await attempt(() => analytics.getOverview(page.ctx, selection.range));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Community growth, moderation, infrastructure and marketing at a glance, compared with the previous period of equal length."
        breadcrumbs={[{ label: 'Analytics' }, { label: 'Overview' }]}
        actions={
          <>
            <ButtonLink href="/analytics/staff" variant="secondary">
              Staff stats
            </ButtonLink>
            <ButtonLink href="/analytics/reports" variant="secondary">
              Weekly reports
            </ButtonLink>
          </>
        }
      />

      <Card className="mb-6">
        <CardBody>
          <PeriodSelector pathname="/analytics" selection={selection} timezone={page.timezone} />
        </CardBody>
      </Card>

      {selection.error && (
        <Alert tone="warning" title="Invalid date range" className="mb-6">
          {selection.error}
        </Alert>
      )}

      {!result.ok ? (
        <ErrorState title="Analytics could not be loaded" description={result.message} />
      ) : (
        <Overview data={result.data} label={periodLabel(selection)} />
      )}
    </>
  );
}

function Section({
  title,
  description,
  children,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={actions} />
      {children}
    </Card>
  );
}

const subheading = 'text-xs font-medium uppercase tracking-wide text-fg-muted';

function Overview({ data, label }: { data: analytics.ReportData; label: string }) {
  const tz = data.timezone;
  const c = data.community;
  const m = data.moderation;
  const i = data.infrastructure;
  const k = data.marketing;
  const r = data.referrals;
  const o = data.outstanding;
  const fmt = (iso: string) => formatInZone(new Date(iso), tz);

  const flow: Array<{ label: string; value: number }> = [];
  if (c.joins.available) {
    flow.push({ label: 'Joins', value: c.joins.value });
    if (c.joins.previous !== undefined) flow.push({ label: 'Joins (prev)', value: c.joins.previous });
  }
  if (c.leaves.available) {
    flow.push({ label: 'Leaves', value: c.leaves.value });
    if (c.leaves.previous !== undefined) flow.push({ label: 'Leaves (prev)', value: c.leaves.previous });
  }

  const issues: Array<{ label: string; count: number; href: string; detail?: ReactNode }> = [
    {
      label: 'Open abuse reports older than 72 hours',
      count: o.staleAbuseReports,
      href: '/security/reports',
    },
    {
      label: 'Active incidents',
      count: o.activeIncidents.length,
      href: '/status/incidents',
      detail:
        o.activeIncidents.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
            {o.activeIncidents.map((a) => (
              <li key={a.ref}>
                <span className="font-mono">{a.ref}</span> {a.title} · {humanizeEnum(a.severity)} · since{' '}
                {fmt(a.startedAt)}
              </li>
            ))}
          </ul>
        ) : undefined,
    },
    { label: 'Dead-letter background jobs', count: o.deadJobs, href: '/settings/jobs' },
    { label: 'Flagged referrals awaiting review', count: o.flaggedReferrals, href: '/marketing/referrals' },
    {
      label: 'Partner applications pending more than 7 days',
      count: o.stalePartnerApplications,
      href: '/marketing/partners',
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">
        <span className="font-medium text-fg">{label}</span>: {fmt(data.period.start)} –{' '}
        {fmt(data.period.end)} ({tz}). Previous period: {fmt(data.previousPeriod.start)} –{' '}
        {fmt(data.previousPeriod.end)}.
      </p>

      <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total members" metric={c.totalMembers} />
        <KpiCard label="Net member growth" metric={c.netGrowth} />
        <KpiCard label="Active members" metric={c.activeMembers} />
        <KpiCard label="Messages" metric={c.messages} />
        <KpiCard label="Moderation actions" metric={m.actions} />
        <KpiCard label="Abuse reports received" metric={m.reportsReceived} href="/security/reports" />
        <KpiCard label="Incidents opened" metric={i.incidentsOpened} href="/status/incidents" />
        <KpiCard label="Tracked link clicks" metric={k.trackedLinkClicks} />
      </section>

      {data.summary.length > 0 && (
        <Section title="Highlights">
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg">
              {data.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </CardBody>
        </Section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          title="Community growth"
          description="Per-day series are not stored, so bars compare this period with the previous one."
        >
          <CardBody>
            {flow.length > 0 ? (
              <BarChart title="Member joins and leaves, this period and previous" data={flow} height={160} />
            ) : (
              <p className="text-sm text-fg-muted">
                Not available — {c.joins.available ? 'no join data' : c.joins.reason}
              </p>
            )}
          </CardBody>
          <MetricTable
            caption="Community metrics"
            rows={[
              { label: 'Joins', metric: c.joins },
              { label: 'Leaves', metric: c.leaves },
              { label: 'Net growth', metric: c.netGrowth },
              { label: 'Active members', metric: c.activeMembers },
              { label: 'Messages', metric: c.messages },
              { label: 'DAU — daily active, average (observed message activity)', metric: c.dau },
              { label: 'WAU — weekly active (observed message activity)', metric: c.wau },
              { label: 'MAU — monthly active (observed message activity)', metric: c.mau },
            ]}
          />
          <CardBody className="border-t border-border">
            <h3 className={subheading}>Top channels by messages</h3>
            {!c.topChannels.available ? (
              <p className="mt-2 text-sm text-fg-muted">Not available — {c.topChannels.reason}</p>
            ) : c.topChannels.value.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">No messages observed in this period.</p>
            ) : (
              <ol className="mt-2 space-y-1 text-sm">
                {c.topChannels.value.map((t) => (
                  <li key={t.channelId} className="flex items-center justify-between gap-3">
                    <ChannelLabel id={t.channelId} />
                    <span className="tabular-nums text-fg">{fmtNum(t.messages)}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-xs text-fg-muted">
              Active members sent at least {c.activeMemberThreshold} message
              {c.activeMemberThreshold === 1 ? '' : 's'} across the period&apos;s {c.activityDays} day
              {c.activityDays === 1 ? '' : 's'}.
            </p>
          </CardBody>
        </Section>

        <Section
          title="Moderation & security"
          actions={
            <ButtonLink href="/security/reports" size="sm" variant="ghost">
              Abuse reports
            </ButtonLink>
          }
        >
          <CardBody className="grid gap-6 sm:grid-cols-2">
            <BreakdownChart title="Actions by type" metric={m.actionsByType} />
            <BreakdownChart title="Automod detections by rule" metric={m.automodByRule} />
            <BreakdownChart title="Abuse reports by category" metric={m.reportsByCategory} />
          </CardBody>
          <MetricTable
            caption="Moderation and security metrics"
            rows={[
              { label: 'Moderation actions', metric: m.actions },
              { label: 'Automod detections', metric: m.automodDetections },
              { label: 'Automod false positives', metric: m.automodFalsePositives },
              { label: 'Abuse reports received', metric: m.reportsReceived },
              { label: 'Abuse reports resolved', metric: m.reportsResolved },
              { label: 'Abuse reports dismissed', metric: m.reportsDismissed },
              { label: 'Open abuse report backlog', metric: m.openReportBacklog },
            ]}
          />
        </Section>

        <Section
          title="Infrastructure"
          actions={
            <ButtonLink href="/status/incidents" size="sm" variant="ghost">
              Incidents
            </ButtonLink>
          }
        >
          <CardBody>
            <BreakdownChart
              title="Incidents by severity"
              metric={i.incidentsBySeverity}
              emptyText="No incidents opened in this period."
            />
          </CardBody>
          <MetricTable
            caption="Infrastructure metrics"
            rows={[
              { label: 'Incidents opened', metric: i.incidentsOpened },
              { label: 'Incidents resolved', metric: i.incidentsResolved },
              { label: 'Total incident time', metric: i.incidentMinutes, format: formatMinutes },
              { label: 'Auto-detected incidents', metric: i.autoIncidents },
              { label: 'Manually declared incidents', metric: i.manualIncidents },
            ]}
          />
          <CardBody className="border-t border-border">
            <h3 className={subheading}>Uptime per public service</h3>
            {i.uptime.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">Not available — no public monitored services.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Uptime per public service</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Service
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Uptime
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Checks
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {i.uptime.map((s) => (
                      <tr key={s.serviceId} className="border-b border-border last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-normal text-fg">
                          {s.name}
                        </th>
                        <td
                          className={`py-2 pr-4 text-right tabular-nums ${s.uptimePct === null ? 'text-fg-muted' : 'text-fg'}`}
                        >
                          {uptimeText(s.uptimePct)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-fg-muted">{fmtNum(s.checks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Section>

        <Section title="Marketing & referrals">
          <MetricTable
            caption="Marketing metrics"
            rows={[
              { label: 'Announcements published', metric: k.announcementsPublished },
              { label: 'Announcement reactions', metric: k.announcementReactions },
              { label: 'Tracked link clicks', metric: k.trackedLinkClicks },
              { label: 'Partner applications', metric: k.partnerApplications },
              { label: 'Event RSVPs (going)', metric: k.eventRsvps },
              { label: 'Giveaway entries', metric: k.giveawayEntries },
              { label: 'Poll ballots', metric: k.pollBallots },
              { label: 'Suggestions created', metric: k.suggestionsCreated },
            ]}
          />
          <CardBody className="grid gap-6 border-t border-border sm:grid-cols-2">
            <BreakdownChart title="Partner applications by status" metric={k.partnerApplicationsByStatus} />
            <div>
              <h3 className={subheading}>Referral confidence</h3>
              {!r.attributedJoins.available ? (
                <p className="mt-2 text-sm text-fg-muted">Not available — {r.attributedJoins.reason}</p>
              ) : r.attributedJoins.value === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">No referral-tracked joins in this period.</p>
              ) : (
                <BarChart
                  className="mt-2"
                  title="Referral-tracked joins by confidence"
                  height={160}
                  data={[
                    { label: 'Confirmed', value: r.confirmed.available ? r.confirmed.value : 0 },
                    { label: 'Ambiguous', value: r.ambiguous.available ? r.ambiguous.value : 0 },
                    { label: 'UNKNOWN', value: r.unknown.available ? r.unknown.value : 0 },
                  ]}
                />
              )}
            </div>
          </CardBody>
          <MetricTable
            caption="Referral metrics"
            rows={[
              { label: 'Referral-tracked joins', metric: r.attributedJoins },
              { label: 'Confirmed', metric: r.confirmed },
              { label: 'Ambiguous', metric: r.ambiguous },
              { label: 'UNKNOWN source', metric: r.unknown },
              { label: 'Flagged for review', metric: r.flagged },
            ]}
          />
          <CardBody className="border-t border-border">
            <h3 className={subheading}>Top referrers (valid, confirmed)</h3>
            {!r.topReferrers.available ? (
              <p className="mt-2 text-sm text-fg-muted">Not available — {r.topReferrers.reason}</p>
            ) : r.topReferrers.value.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">None in this period.</p>
            ) : (
              <ol className="mt-2 space-y-1 text-sm">
                {r.topReferrers.value.map((t) => (
                  <li key={t.userId} className="flex justify-between gap-3">
                    <span className="font-mono text-xs">{`<@${t.userId}>`}</span>
                    <span className="tabular-nums">{fmtNum(t.validConfirmed)}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-xs text-fg-muted">
              Announcement reactions are counted as last synced from Discord. When no click snapshot exists
              before the period, tracked link clicks are the cumulative total (labelled “first period,
              cumulative”).
            </p>
          </CardBody>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Outstanding issues" description={`As of ${fmt(o.asOf)}`} className="lg:col-span-2">
          <ul className="divide-y divide-border">
            {issues.map((it) => (
              <li key={it.label} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link href={it.href} className="text-sm">
                    {it.label}
                  </Link>
                  {it.detail}
                </div>
                <Badge tone={it.count > 0 ? 'warning' : 'neutral'}>{fmtNum(it.count)}</Badge>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Support">
          <CardBody>
            <p className="text-sm text-fg">Support is handled in the external support system.</p>
            <p className="mt-1 text-xs text-fg-muted">
              The bot does not track support tickets, so no support metrics are shown here.
            </p>
          </CardBody>
        </Section>
      </div>

      <SectionNote>{ACTIVITY_FOOTNOTE}</SectionNote>
    </div>
  );
}
