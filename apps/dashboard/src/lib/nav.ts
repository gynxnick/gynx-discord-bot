import type { PermissionKey } from '@gynx/permissions';

/**
 * Navigation model. An item is visible when the user holds ANY of its
 * `anyOf` permissions. This only hides links — every page and API route
 * enforces its own permission server-side.
 */
export interface NavLink {
  label: string;
  href: string;
  anyOf: readonly PermissionKey[];
}
export interface NavSection extends NavLink {
  icon: NavIcon;
  children?: NavLink[];
}
export type NavIcon =
  | 'home'
  | 'status'
  | 'community'
  | 'moderation'
  | 'security'
  | 'troubleshooting'
  | 'events'
  | 'analytics'
  | 'settings';

export const NAV: readonly NavSection[] = [
  { label: 'Overview', href: '/', icon: 'home', anyOf: ['dashboard.access'] },
  {
    label: 'Status & incidents',
    href: '/status',
    icon: 'status',
    anyOf: ['incidents.view', 'incidents.manage', 'status.manage', 'support.duty.manage'],
    children: [
      { label: 'Services', href: '/status', anyOf: ['incidents.view', 'incidents.manage', 'status.manage'] },
      { label: 'Incidents', href: '/status/incidents', anyOf: ['incidents.view', 'incidents.manage'] },
      { label: 'Maintenance', href: '/status/maintenance', anyOf: ['incidents.view', 'incidents.manage'] },
      { label: 'Support duty', href: '/status/duty', anyOf: ['support.duty.manage'] },
    ],
  },
  {
    label: 'Community',
    href: '/community',
    icon: 'community',
    anyOf: ['community.manage', 'suggestions.manage'],
    children: [
      { label: 'Welcome & onboarding', href: '/community', anyOf: ['community.manage'] },
      { label: 'Self-roles', href: '/community/roles', anyOf: ['community.manage'] },
      { label: 'FAQ', href: '/community/faq', anyOf: ['community.manage'] },
      { label: 'Guides', href: '/community/guides', anyOf: ['community.manage'] },
      { label: 'Suggestions', href: '/community/suggestions', anyOf: ['suggestions.manage'] },
    ],
  },
  {
    label: 'Moderation',
    href: '/moderation',
    icon: 'moderation',
    anyOf: ['moderation.audit.view', 'moderation.execute', 'automod.manage'],
    children: [
      { label: 'Records', href: '/moderation', anyOf: ['moderation.audit.view', 'moderation.execute'] },
      { label: 'Automod', href: '/moderation/automod', anyOf: ['automod.manage', 'moderation.audit.view'] },
      {
        label: 'Appeals',
        href: '/moderation/appeals',
        anyOf: ['moderation.execute', 'moderation.ban', 'moderation.audit.view'],
      },
    ],
  },
  {
    label: 'Security',
    href: '/security/reports',
    icon: 'security',
    anyOf: ['security.reports.view', 'audit.view'],
    children: [
      { label: 'Abuse reports', href: '/security/reports', anyOf: ['security.reports.view'] },
      { label: 'Audit log', href: '/security/audit', anyOf: ['audit.view'] },
    ],
  },
  {
    label: 'Troubleshooting',
    href: '/troubleshooting',
    icon: 'troubleshooting',
    anyOf: ['troubleshooting.manage'],
    children: [
      { label: 'Knowledge base', href: '/troubleshooting', anyOf: ['troubleshooting.manage'] },
      { label: 'Flows', href: '/troubleshooting/flows', anyOf: ['troubleshooting.manage'] },
      { label: 'Diagnostics', href: '/troubleshooting/diagnostics', anyOf: ['troubleshooting.manage'] },
      { label: 'AI provider', href: '/troubleshooting/ai', anyOf: ['settings.manage'] },
    ],
  },
  {
    label: 'Events & marketing',
    href: '/marketing',
    icon: 'events',
    anyOf: [
      'events.manage',
      'polls.manage',
      'giveaways.manage',
      'announcements.create',
      'announcements.publish',
      'referrals.view',
      'partners.review',
    ],
    children: [
      {
        label: 'Announcements',
        href: '/marketing/announcements',
        anyOf: ['announcements.create', 'announcements.publish'],
      },
      { label: 'Events', href: '/marketing/events', anyOf: ['events.manage'] },
      { label: 'Polls', href: '/marketing/polls', anyOf: ['polls.manage'] },
      { label: 'Giveaways', href: '/marketing/giveaways', anyOf: ['giveaways.manage'] },
      {
        label: 'Tracked links',
        href: '/marketing/links',
        anyOf: ['announcements.create', 'referrals.manage', 'partners.review'],
      },
      { label: 'Referrals', href: '/marketing/referrals', anyOf: ['referrals.view', 'referrals.manage'] },
      { label: 'Partners', href: '/marketing/partners', anyOf: ['partners.review'] },
    ],
  },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: 'analytics',
    anyOf: ['analytics.view'],
    children: [
      { label: 'Overview', href: '/analytics', anyOf: ['analytics.view'] },
      { label: 'Staff', href: '/analytics/staff', anyOf: ['analytics.view'] },
      { label: 'Weekly reports', href: '/analytics/reports', anyOf: ['analytics.view'] },
    ],
  },
  {
    // Reuses the settings glyph: AppShell's icon map is keyed by NavIcon.
    label: 'Server setup',
    href: '/setup',
    icon: 'settings',
    anyOf: ['setup.manage'],
    children: [
      { label: 'Overview', href: '/setup', anyOf: ['setup.manage'] },
      { label: 'Configuration', href: '/setup/config', anyOf: ['setup.manage'] },
      { label: 'History', href: '/setup/history', anyOf: ['setup.manage'] },
    ],
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: 'settings',
    anyOf: ['settings.manage', 'permissions.manage'],
    children: [
      { label: 'General', href: '/settings', anyOf: ['settings.manage'] },
      { label: 'Permissions', href: '/settings/permissions', anyOf: ['settings.manage'] },
      { label: 'Bot text', href: '/settings/text', anyOf: ['settings.manage'] },
      { label: 'Jobs', href: '/settings/jobs', anyOf: ['settings.manage'] },
    ],
  },
];

const allowed = (perms: ReadonlySet<string>, link: NavLink) => link.anyOf.some((k) => perms.has(k));

/** Sections (and children) the user may see. Sections with no visible children are dropped. */
export function visibleNav(perms: ReadonlySet<string>, nav: readonly NavSection[] = NAV): NavSection[] {
  const out: NavSection[] = [];
  for (const s of nav) {
    if (!allowed(perms, s)) continue;
    if (s.children) {
      const children = s.children.filter((c) => allowed(perms, c));
      if (children.length === 0) continue;
      out.push({ ...s, href: children[0]!.href, children });
    } else {
      out.push(s);
    }
  }
  return out;
}

/** Whether `pathname` is within `href` (exact for "/"). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The child whose href is the longest prefix match of `pathname` (so /settings does not shadow /settings/jobs). */
export function activeChildHref(pathname: string, children: readonly NavLink[]): string | null {
  let best: string | null = null;
  for (const c of children)
    if (isActivePath(pathname, c.href) && (!best || c.href.length > best.length)) best = c.href;
  return best;
}
