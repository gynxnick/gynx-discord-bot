import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { community } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadChannels, loadRoles } from '@/components/community/server/data';
import { WelcomeForm } from '@/components/community/WelcomeForm';
import { welcomeToDraft } from '@/components/community/welcome-payload';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { formatNumber } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Welcome & onboarding' };

const DAY = 86_400_000;

export default async function WelcomePage() {
  const page = await requirePagePermission(['community.manage', 'suggestions.manage'], 'community.welcome');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  // Suggestion moderators without community.manage land on the page they can use.
  if (!page.session.permissions.has('community.manage')) redirect('/community/suggestions');
  const { ctx } = page;

  const cfg = await load(() => community.getWelcomeConfig(ctx));
  if (!cfg.ok) return <ModuleNotice title="Welcome & onboarding" message={cfg.message} />;

  const now = ctx.now().getTime();
  const [channels, roles, guild, flagged24h, flagged7d] = await Promise.all([
    loadChannels(ctx),
    loadRoles(ctx),
    ctx.db.guild.findUnique({ where: { id: ctx.guildId }, select: { name: true } }),
    community.countRaidFlaggedSince(ctx.db, ctx.guildId, new Date(now - DAY)),
    community.countRaidFlaggedSince(ctx.db, ctx.guildId, new Date(now - 7 * DAY)),
  ]);

  return (
    <>
      <PageHeader
        title="Welcome & onboarding"
        description="Welcome post, rules acknowledgement, verification and raid protection for new members."
        breadcrumbs={[{ label: 'Community' }, { label: 'Welcome & onboarding' }]}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Raid-flagged joins (24h)"
          value={formatNumber(flagged24h)}
          tone={flagged24h > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Raid-flagged joins (7d)"
          value={formatNumber(flagged7d)}
          tone={flagged7d > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Verification"
          value={cfg.data.verificationEnabled ? 'On' : 'Off'}
          hint={
            cfg.data.minAccountAgeDays > 0
              ? `Accounts younger than ${cfg.data.minAccountAgeDays}d must verify`
              : undefined
          }
        />
        <StatCard
          label="Raid rule"
          value={`${cfg.data.raidJoinThreshold} joins / ${cfg.data.raidWindowSeconds}s`}
          hint={cfg.data.raidAction === 'ALERT' ? 'Alert staff' : 'Alert + require verification'}
        />
      </div>
      {(channels.error || roles.error) && (
        <Alert tone="warning" title="Discord data unavailable" className="mb-4">
          Channels or roles could not be loaded from Discord, so you can enter IDs directly. Role safety is
          still checked by the server when you save.
        </Alert>
      )}
      <WelcomeForm
        initial={welcomeToDraft(cfg.data)}
        channels={channels.error ? null : channels.channels}
        roles={roles.roles}
        serverName={guild?.name ?? 'GYNX.GG'}
      />
    </>
  );
}
