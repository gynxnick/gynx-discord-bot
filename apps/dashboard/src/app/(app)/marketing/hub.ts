import type { PermissionKey } from '@gynx/permissions';
import { NAV, type NavLink } from '../../../lib/nav';

/** Sub-pages of "Events & marketing", in nav order. */
export function marketingChildren(nav = NAV): readonly NavLink[] {
  return nav.find((s) => s.href === '/marketing')?.children ?? [];
}

/** Every permission that unlocks at least one marketing sub-page. */
export function marketingPermissionKeys(children: readonly NavLink[] = marketingChildren()): PermissionKey[] {
  return [...new Set(children.flatMap((c) => c.anyOf))];
}

/** The first marketing sub-page (nav order) the user can open, or null when none. */
export function firstAccessibleMarketingHref(
  perms: ReadonlySet<string>,
  children: readonly NavLink[] = marketingChildren(),
): string | null {
  return children.find((c) => c.href !== '/marketing' && c.anyOf.some((k) => perms.has(k)))?.href ?? null;
}
