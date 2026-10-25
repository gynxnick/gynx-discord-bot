import type { Metadata } from 'next';
import { listTexts } from '@gynx/services';
import { BotTextEditor } from '@/components/settings/BotTextEditor';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Bot text' };

export default async function BotTextPage() {
  const page = await requirePagePermission('settings.manage', 'settings.text');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const entries = await listTexts(page.ctx);

  return (
    <>
      <PageHeader
        title="Bot text"
        description="Change any message, title or button label the bot shows in Discord. Placeholders like {user} are filled in automatically; Discord's length limits are enforced."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Bot text' }]}
      />
      <BotTextEditor entries={entries.map((e) => ({ ...e, vars: [...e.vars] }))} />
    </>
  );
}
