import type { Metadata } from 'next';
import { moderation } from '@gynx/services';
import { dayRange } from '@/app/api/moderation/dates';
import { listGuildChannels, type ChannelOption } from '@/app/api/discord/channels/channels';
import { AutomodConfigForm } from '@/components/moderation/AutomodConfigForm';
import { AutomodEventsTable, type AutomodEventRow } from '@/components/moderation/AutomodEventsTable';
import type { AutomodConfigView } from '@/components/moderation/automod-form';
import { AUTOMOD_RULES, RULE_LABEL } from '@/components/moderation/labels';
import type { PickerRole } from '@/components/settings/DiscordPickers';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { listGuildRoles } from '@/server/queries/roles';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Automod' };

export default async function AutomodPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(['automod.manage', 'moderation.audit.view'], 'moderation.automod');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone: tz } = page;
  const sp = await searchParams;
  const canManage = page.session.permissions.has('automod.manage');

  const filters = {
    rule: firstParam(sp, 'rule'),
    userId: firstParam(sp, 'user'),
    unreviewed: firstParam(sp, 'unreviewed') === '1',
    from: firstParam(sp, 'from'),
    to: firstParam(sp, 'to'),
  };
  const range = dayRange(filters.from, filters.to, tz);
  const parsed = moderation.listAutomodEventsSchema.safeParse({
    rule: filters.rule,
    userId: filters.userId,
    unreviewed: filters.unreviewed || undefined,
    from: range.from,
    to: range.to,
    cursor: readCursor(sp).cursor,
    limit: 25,
  });

  const [config, events, channels, roles] = await Promise.all([
    canManage ? moderation.getAutomodConfig(ctx) : Promise.resolve(null),
    parsed.success ? moderation.listAutomodEvents(ctx, parsed.data) : Promise.resolve(null),
    listGuildChannels(ctx.discord, ctx.guildId).catch((): ChannelOption[] | null => null),
    canManage
      ? listGuildRoles(ctx.discord, ctx.guildId).catch((): PickerRole[] | null => null)
      : Promise.resolve(null),
  ]);
  const channelName = new Map((channels ?? []).map((c) => [c.id, c.name]));
  const rows: AutomodEventRow[] = (events?.items ?? []).map((e) => ({
    id: e.id,
    rule: e.rule,
    userId: e.userId,
    channelId: e.channelId,
    channelName: channelName.get(e.channelId) ?? null,
    excerpt: e.excerpt,
    actionTaken: e.actionTaken,
    falsePositive: e.falsePositive,
    reviewedById: e.reviewedById,
    createdAt: e.createdAt.toISOString(),
  }));
  const links = pageLinks('/moderation/automod', sp, events?.nextCursor ?? null);
  const hasFilters = Boolean(
    filters.rule || filters.userId || filters.unreviewed || filters.from || filters.to,
  );

  let view: AutomodConfigView | null = null;
  if (config) {
    const { guildId: _g, updatedAt: _u, ...rest } = config;
    view = rest;
  }

  return (
    <>
      <PageHeader
        title="Automod"
        description="Automatic spam, link and phrase filtering. Hits escalate by strikes (delete → warn → timeout); automod never bans. Stored excerpts are redacted."
        breadcrumbs={[{ label: 'Moderation', href: '/moderation' }, { label: 'Automod' }]}
      />
      <div className="space-y-8">
        {view ? (
          <AutomodConfigForm initial={view} channels={channels} roles={roles} />
        ) : (
          <Alert tone="info">
            Viewing events only. Changing automod configuration requires the automod management permission.
          </Alert>
        )}

        <Card>
          <CardHeader
            title="Events"
            description={
              canManage
                ? 'Review hits to keep strike counts fair. False positives stop counting and revoke any warning they caused.'
                : undefined
            }
          />
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            role="search"
            aria-label="Filter automod events"
          >
            <div className="w-full sm:w-44">
              <label htmlFor="e-rule" className="mb-1 block text-xs text-fg-muted">
                Rule
              </label>
              <Select
                id="e-rule"
                name="rule"
                defaultValue={filters.rule ?? ''}
                placeholder="Any rule"
                options={AUTOMOD_RULES.map((r) => ({ value: r, label: RULE_LABEL[r]! }))}
              />
            </div>
            <div className="w-full sm:w-52">
              <label htmlFor="e-user" className="mb-1 block text-xs text-fg-muted">
                User ID
              </label>
              <Input
                id="e-user"
                name="user"
                inputMode="numeric"
                defaultValue={filters.userId ?? ''}
                maxLength={20}
              />
            </div>
            <div className="w-full sm:w-40">
              <label htmlFor="e-from" className="mb-1 block text-xs text-fg-muted">
                From ({tz})
              </label>
              <Input id="e-from" name="from" type="date" defaultValue={filters.from ?? ''} />
            </div>
            <div className="w-full sm:w-40">
              <label htmlFor="e-to" className="mb-1 block text-xs text-fg-muted">
                To ({tz})
              </label>
              <Input id="e-to" name="to" type="date" defaultValue={filters.to ?? ''} />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                name="unreviewed"
                value="1"
                defaultChecked={filters.unreviewed}
                className="h-4 w-4 accent-[#22D3EE]"
              />
              Unreviewed only
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              {hasFilters && (
                <ButtonLink href="/moderation/automod" variant="ghost">
                  Clear
                </ButtonLink>
              )}
            </div>
          </form>
          {!events ? (
            <div className="p-4">
              <Alert tone="warning" title="Invalid filter">
                One of the filters is not valid. Clear the filters and try again.
              </Alert>
            </div>
          ) : (
            <>
              <AutomodEventsTable rows={rows} timezone={tz} canReview={canManage} hasFilters={hasFilters} />
              <Pagination prevHref={links.prev} nextHref={links.next} label="Automod event pages" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
