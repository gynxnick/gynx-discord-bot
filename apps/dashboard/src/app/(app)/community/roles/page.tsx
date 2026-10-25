import type { Metadata } from 'next';
import { community } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadChannels, loadRoles } from '@/components/community/server/data';
import { RolePanelsManager } from '@/components/community/RolePanelsManager';
import { SelfRolesManager } from '@/components/community/SelfRolesManager';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Self-roles' };

export default async function SelfRolesPage() {
  const page = await requirePagePermission('community.manage', 'community.roles');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx } = page;

  const list = await load(() => community.listSelfRoles(ctx));
  if (!list.ok) return <ModuleNotice title="Self-roles" message={list.message} />;
  const [roles, channels, panels] = await Promise.all([
    loadRoles(ctx),
    loadChannels(ctx),
    load(() => community.listRolePanels(ctx)),
  ]);

  return (
    <>
      <PageHeader
        title="Self-roles"
        description="The allowlist of roles members can give themselves. Every add and re-enable is checked against the role as it is in Discord right now."
        breadcrumbs={[{ label: 'Community', href: '/community' }, { label: 'Self-roles' }]}
      />
      {roles.error && (
        <Alert tone="warning" title="Role names unavailable" className="mb-4">
          Discord roles could not be loaded, so roles are shown by ID and new roles must be entered by ID.
          Adding a role still requires Discord to be reachable for the safety check.
        </Alert>
      )}
      <SelfRolesManager
        rows={list.data.map((r) => ({
          id: r.id,
          roleId: r.roleId,
          label: r.label,
          description: r.description,
          emoji: r.emoji,
          group: r.group,
          enabled: r.enabled,
          sortOrder: r.sortOrder,
        }))}
        roles={roles.roles}
      />
      <RolePanelsManager
        rows={(panels.ok ? panels.data : []).map((p) => ({
          id: p.id,
          channelId: p.channelId,
          title: p.title,
          description: p.description,
          groups: p.groups,
          messageId: p.messageId,
          syncedAt: p.syncedAt ? p.syncedAt.toISOString() : null,
        }))}
        channels={channels.error ? null : channels.channels}
        enabledRoleCount={list.data.filter((r) => r.enabled).length}
      />
    </>
  );
}
