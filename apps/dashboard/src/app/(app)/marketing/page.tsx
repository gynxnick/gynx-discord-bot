import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PermissionDenied } from '@/components/ui/Feedback';
import { requirePagePermission } from '@/server/session';
import { firstAccessibleMarketingHref, marketingPermissionKeys } from './hub';

export const metadata: Metadata = { title: 'Events & marketing' };

/** Hub: sends the user to the first marketing sub-page they can open (nav order). */
export default async function MarketingHubPage() {
  const page = await requirePagePermission(marketingPermissionKeys(), 'marketing');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const href = firstAccessibleMarketingHref(page.session.permissions);
  if (!href) return <PermissionDenied />;
  redirect(href);
}
