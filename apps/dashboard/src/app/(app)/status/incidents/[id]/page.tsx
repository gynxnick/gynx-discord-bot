import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { status } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import { EditIncidentButton, IncidentUpdateForm } from '@/components/status/IncidentDialogs';
import { IncidentStatusBadge, SeverityBadge } from '@/components/status/labels';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Incident' };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission(['incidents.view', 'incidents.manage'], 'status.incident');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const { ctx, timezone: tz } = page;

  let incident;
  try {
    incident = await status.getIncident(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const canManage = page.session.permissions.has('incidents.manage');
  const resolved = incident.status === 'RESOLVED';
  const services = canManage && !resolved ? await status.listServices(ctx) : [];
  const updates = [...incident.updates].reverse();

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{incident.ref}</span>
            <span>{incident.title}</span>
          </span>
        }
        breadcrumbs={[
          { label: 'Status & incidents', href: '/status' },
          { label: 'Incidents', href: '/status/incidents' },
          { label: incident.ref },
        ]}
        actions={
          canManage && !resolved ? (
            <EditIncidentButton
              incidentId={incident.id}
              initial={{
                title: incident.title,
                serviceSlugs: incident.services.map((s) => s.slug),
                regions: incident.regions,
              }}
              services={services.map((s) => ({ slug: s.slug, name: s.name }))}
            />
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <IncidentStatusBadge status={incident.status} />
                <SeverityBadge severity={incident.severity} />
                {incident.autoCreated && <Badge>Auto-created by monitor</Badge>}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-fg">{incident.description}</p>
              <DescriptionList
                items={[
                  { label: 'Started', value: formatDateTime(incident.startedAt, tz) },
                  { label: 'Resolved', value: formatDateTime(incident.resolvedAt, tz) },
                  {
                    label: 'Affected services',
                    value: incident.services.length
                      ? incident.services.map((s) => s.name + (s.public ? '' : ' (private)')).join(', ')
                      : 'None listed',
                  },
                  {
                    label: 'Regions',
                    value: incident.regions.length ? incident.regions.join(', ') : 'None listed',
                  },
                  {
                    label: 'Created by',
                    value: <span className="font-mono text-xs">{incident.createdById}</span>,
                  },
                ]}
              />
              {incident.resolutionSummary && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-fg-muted">Resolution</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
                    {incident.resolutionSummary}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Timeline" description="Newest first." />
            <ol className="divide-y divide-border">
              {updates.map((u) => (
                <li key={u.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <IncidentStatusBadge status={u.status} />
                    <time dateTime={u.createdAt.toISOString()}>{formatDateTime(u.createdAt, tz)}</time>
                    <span>
                      by <span className="font-mono">{u.authorId}</span>
                    </span>
                    <span>{u.notifiedAt ? '· notified' : '· notification pending'}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-fg">{u.message}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          {canManage && !resolved ? (
            <IncidentUpdateForm
              incidentId={incident.id}
              currentStatus={incident.status}
              currentSeverity={incident.severity}
            />
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-fg-muted">
                  {resolved
                    ? 'This incident is resolved. Resolved incidents cannot be updated.'
                    : 'Posting updates requires the incident management permission.'}
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
