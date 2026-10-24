/** Self-role form state → API payload (pure; unit tested). */

export interface SelfRoleDraft {
  roleId: string;
  label: string;
  description: string;
  emoji: string;
  group: 'games' | 'community' | 'notifications';
  enabled: boolean;
  sortOrder: string;
}

export function selfRoleToPayload(d: SelfRoleDraft, isNew: boolean) {
  const base = {
    label: d.label.trim(),
    description: d.description.trim() || null,
    emoji: d.emoji.trim() || null,
    group: d.group,
    sortOrder: Number.parseInt(d.sortOrder, 10) || 0,
  };
  // `enabled` changes go through the enable/disable action (re-enabling re-checks role safety).
  return isNew ? { ...base, roleId: d.roleId.trim(), enabled: d.enabled } : base;
}
