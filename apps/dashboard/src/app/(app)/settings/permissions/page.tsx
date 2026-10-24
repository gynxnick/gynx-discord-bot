import type { Metadata } from 'next';
import { getGuildConfig, listGrants } from '@gynx/services';
import { GrantsManager, type GrantRow } from '@/components/settings/GrantsManager';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { listGuildRoles, type RoleOption } from '@/server/queries/roles';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Permissions' };

export default async function PermissionsPage() {
  const page = await requirePagePermission('settings.manage', 'settings.permissions');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, session } = page;

  const [grants, cfg] = await Promise.all([listGrants(ctx), getGuildConfig(ctx.db, ctx.guildId)]);
  let roles: RoleOption[] = [];
  let rolesError = false;
  try {
    roles = await listGuildRoles(ctx.discord, ctx.guildId);
  } catch {
    rolesError = true;
  }

  const rows: GrantRow[] = grants.map((g) => ({
    id: g.id,
    subjectType: g.subjectType,
    subjectId: g.subjectId,
    permission: g.permission,
    effect: g.effect,
    createdById: g.createdById,
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Staff permissions"
        description="Map Discord roles or individual users to dashboard and bot permissions. Deny always wins over allow. The server owner always has every permission."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Permissions' }]}
      />
      {rolesError && (
        <Alert tone="warning" title="Role names unavailable" className="mb-4">
          Discord roles could not be loaded, so roles are shown by ID. You can still manage grants.
        </Alert>
      )}
      <GrantsManager
        initialGrants={rows}
        roles={roles}
        canManage={session.permissions.has('permissions.manage')}
        myPermissions={[...session.permissions]}
        partnerRoleId={cfg.partnerRoleId}
      />
    </>
  );
}
