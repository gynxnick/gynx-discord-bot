import type { Metadata } from 'next';
import Link from 'next/link';
import { getGuildConfig, status } from '@gynx/services';
import { toServiceView } from '@/app/api/status/views';
import { ServicesManager, type UptimeCell } from '@/components/status/ServicesManager';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Status services' };

export default async function StatusServicesPage() {
  const page = await requirePagePermission(
    ['incidents.view', 'incidents.manage', 'status.manage'],
    'status.services',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, session } = page;
  const perms = session.permissions;
  const now = ctx.now();

  const [rows, cfg, u1, u7, u30] = await Promise.all([
    status.listServices(ctx),
    getGuildConfig(ctx.db, ctx.guildId),
    status.getUptime(ctx.db, ctx.guildId, { days: 1 }, now),
    status.getUptime(ctx.db, ctx.guildId, { days: 7 }, now),
    status.getUptime(ctx.db, ctx.guildId, { days: 30 }, now),
  ]);

  const canManage = perms.has('status.manage');
  const services = rows.map((s) => toServiceView(s, canManage));
  // Uptime is only computed for public + enabled services; others show "—".
  const uptime: Record<string, UptimeCell> = {};
  for (const r of u1) uptime[r.slug] = { d1: r.label, d7: null, d30: null };
  for (const r of u7) if (uptime[r.slug]) uptime[r.slug]!.d7 = r.label;
  for (const r of u30) if (uptime[r.slug]) uptime[r.slug]!.d30 = r.label;

  return (
    <>
      <PageHeader
        title="Services"
        description="Health-checked and manually-set services shown on the public status board. Internal check targets are visible only with status management."
        breadcrumbs={[{ label: 'Status & incidents' }, { label: 'Services' }]}
      />
      <div className="space-y-6">
        <ServicesManager
          services={services}
          uptime={uptime}
          timezone={page.timezone}
          canManage={canManage}
          canSetState={canManage || perms.has('incidents.manage')}
          canAllowPrivate={perms.has('settings.manage')}
          defaults={{
            failureThreshold: cfg.statusFailureThreshold,
            recoveryThreshold: cfg.statusRecoveryThreshold,
          }}
        />
        <Card>
          <CardHeader
            title="Guild monitoring defaults"
            description="Applied to every service without its own override."
            actions={
              perms.has('settings.manage') ? (
                <Link href="/settings" className="text-xs">
                  Edit in settings
                </Link>
              ) : undefined
            }
          />
          <CardBody>
            <DescriptionList
              className="lg:grid-cols-4"
              items={[
                { label: 'Check interval', value: `${cfg.statusCheckIntervalSeconds}s` },
                { label: 'Failure threshold', value: `${cfg.statusFailureThreshold} consecutive checks` },
                { label: 'Recovery threshold', value: `${cfg.statusRecoveryThreshold} consecutive checks` },
                { label: 'Alert cooldown', value: `${cfg.statusAlertCooldownMinutes} min` },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
