import type { Metadata } from 'next';
import { getGuildConfig, marketing } from '@gynx/services';
import { toZonedInput } from '@/components/community/datetime';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadChannels, loadRoles } from '@/components/community/server/data';
import { AnnouncementEditor } from '@/components/marketing/announcements/AnnouncementEditor';
import { emptyDraft } from '@/components/marketing/announcements/announcement-utils';
import { announcementTypeColors, announcementTypeOptions } from '@/components/marketing/announcements/server';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'New announcement' };

/** Creating a draft needs announcements.create (publish-only staff can't save one). `?template=<id>` prefills from a template. */
export default async function NewAnnouncementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('announcements.create', 'marketing.announcements.new');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const templates = await load(() => marketing.listTemplates(ctx));
  if (!templates.ok) return <ModuleNotice title="New announcement" message={templates.message} />;
  const [cfg, channels, roles] = await Promise.all([
    getGuildConfig(ctx.db, ctx.guildId),
    loadChannels(ctx),
    loadRoles(ctx),
  ]);

  const draft = emptyDraft(cfg.announcementChannelId ?? '');
  const tpl = templates.data.find((t) => t.id === firstParam(sp, 'template'));
  if (tpl) Object.assign(draft, { type: tpl.type, title: tpl.title, body: tpl.body });

  return (
    <>
      <PageHeader
        title="New announcement"
        description="Write the post, check the preview, then save it as a draft, publish it now or schedule it."
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Announcements', href: '/marketing/announcements' },
          { label: 'New' },
        ]}
      />
      <AnnouncementEditor
        announcement={null}
        initialDraft={draft}
        timezone={timezone}
        channels={channels.error ? null : channels.channels}
        roles={roles.roles}
        templates={templates.data.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          title: t.title,
          body: t.body,
        }))}
        typeOptions={announcementTypeOptions()}
        typeColors={announcementTypeColors()}
        footer={cfg.embedFooter}
        minScheduleInput={toZonedInput(new Date(ctx.now().getTime() + 2 * 60_000), timezone)}
      />
    </>
  );
}
