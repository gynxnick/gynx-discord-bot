import { setup } from '@gynx/services';
import type { BlueprintView, RoutingRow } from '../types';

/** What each blueprint binding feeds, in admin language. */
export const BINDING_LABELS: Record<setup.ChannelBinding | setup.RoleBinding, string> = {
  'welcome.channelId': 'Welcome messages for new members',
  announcementChannelId: 'Announcements',
  incidentChannelId: 'Incident and maintenance notices',
  statusBoardChannelId: 'Live service status board',
  statusChannelId: 'Service monitoring alerts',
  supportStatusChannelId: 'Customer support status panel',
  suggestionChannelId: 'Suggestions',
  eventChannelId: 'Events',
  dutyPanelChannelId: 'Staff duty control panel',
  reportChannelId: 'Staff reports',
  partnerReviewChannelId: 'Partner application reviews',
  modLogChannelId: 'Moderation log',
  securityChannelId: 'Abuse and security reports',
  logChannelId: 'Bot activity log',
  setupLogChannelId: 'Setup wizard audit log',
  'welcome.verifiedRoleId': 'Role given when a member verifies',
  partnerRoleId: 'Partner role',
  staffPingRoleId: 'Role pinged for staff help',
  escalationRoleId: 'Role pinged for escalations',
};

/**
 * Convert the blueprint (bigint permissions, readonly tuples) into a plain,
 * JSON-safe view for client components. Server-only (imports @gynx/services).
 */
export function buildBlueprintView(): BlueprintView {
  const categories = setup.BLUEPRINT_CATEGORIES.map((c) => ({
    key: c.key,
    name: c.name,
    private: c.private,
    channels: c.channels.map((ch) => ({
      key: ch.key,
      name: ch.name,
      type: ch.type,
      categoryKey: c.key,
      slowmode: ch.slowmode ?? 0,
      restrictedTo: ch.restrictedTo ? [...ch.restrictedTo] : null,
      bindings: [...(ch.bindings ?? [])],
      panel: ch.panel ?? null,
    })),
  }));

  const routing: RoutingRow[] = [];
  for (const c of setup.BLUEPRINT_CATEGORIES)
    for (const ch of c.channels)
      for (const b of ch.bindings ?? [])
        routing.push({
          resourceKey: ch.key,
          resourceName: ch.name,
          resourceType: 'channel',
          binding: b,
          feature: BINDING_LABELS[b],
          private: c.private,
        });
  for (const r of setup.BLUEPRINT_ROLES)
    for (const b of setup.ROLE_BINDINGS[r.key] ?? [])
      routing.push({
        resourceKey: r.key,
        resourceName: r.name,
        resourceType: 'role',
        binding: b,
        feature: BINDING_LABELS[b],
        private: false,
      });

  return {
    version: setup.BLUEPRINT_VERSION,
    roles: setup.BLUEPRINT_ROLES.map((r) => ({
      key: r.key,
      name: r.name,
      color: r.color,
      purpose: r.purpose,
      permissions: setup.permissionNames(r.permissions),
      staff: r.staff,
      hoist: r.hoist,
      grant: r.grant ?? null,
      manualPermissions: [...(r.manualPermissions ?? [])],
    })),
    categories,
    components: setup.COMPONENTS.map((c) => ({ key: c.key, label: c.label })),
    routing,
  };
}
