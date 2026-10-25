import type { Metadata } from 'next';
import { support } from '@gynx/services';
import { DutyManager } from '@/components/status/DutyManager';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Support duty' };

export default async function SupportDutyPage() {
  const page = await requirePagePermission('support.duty.manage', 'support.duty');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone } = page;
  const [profiles, onDuty] = await Promise.all([
    support.listDutyProfiles(ctx),
    support.listOnDuty(ctx.db, ctx.guildId, ctx.now()),
  ]);

  return (
    <>
      <PageHeader
        title="Support duty"
        description="Who customers see as available on the support status panel. Availability only: tickets stay in the GYNX web ticketer."
        breadcrumbs={[{ label: 'Status & incidents', href: '/status' }, { label: 'Support duty' }]}
      />
      <DutyManager
        timeZone={timezone}
        profiles={profiles.map((p) => ({ userId: p.userId, publicName: p.publicName, enabled: p.enabled }))}
        onDuty={onDuty.map((e) => ({
          userId: e.userId,
          publicName: e.publicName,
          startedAt: e.startedAt.toISOString(),
          expiresAt: e.expiresAt.toISOString(),
        }))}
      />
    </>
  );
}
