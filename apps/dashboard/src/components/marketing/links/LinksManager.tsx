'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { httpsProblem } from '@/components/community/form-utils';
import { useApiAction } from '@/components/community/useApiAction';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { CopyButton } from './CopyButton';
import { linkDraftToPayload, type LinkDraft } from './link-utils';

export interface LinkRowView {
  id: string;
  url: string;
  targetUrl: string;
  campaign: string | null;
  announcement: { id: string; title: string } | null;
  partnerCampaign: string | null;
  clicks: number;
  active: boolean;
  createdLabel: string;
}

const empty = (): LinkDraft => ({ targetUrl: '', campaign: '', announcementId: '' });

/** Tracked-links table with copy buttons, active toggles and a create dialog. */
export function LinksManager({
  links,
  announcements,
  campaigns,
  canManage,
  filtered,
}: {
  links: LinkRowView[];
  announcements: Array<{ id: string; title: string }>;
  campaigns: string[];
  /** Mutations need announcements.create (see the API note). */
  canManage: boolean;
  filtered: boolean;
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LinkDraft>(empty);
  const [created, setCreated] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const set = <K extends keyof LinkDraft>(k: K, v: LinkDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const start = () => {
    setDraft(empty());
    setFieldErrors({});
    setCreated(null);
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = httpsProblem(draft.targetUrl);
    const errs: Record<string, string> = {};
    if (problem) errs.targetUrl = problem;
    if (draft.campaign.trim().length > 64) errs.campaign = 'At most 64 characters.';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    const res = await run<{ url: string }>('/api/marketing/links', 'POST', linkDraftToPayload(draft), {
      success: 'Tracked link created',
      errorTitle: 'Could not create link',
    });
    if (res) setCreated(res.url);
  };

  const toggle = async (l: LinkRowView) => {
    setToggling(l.id);
    await run(
      `/api/marketing/links/${encodeURIComponent(l.id)}`,
      'PATCH',
      { active: !l.active },
      {
        success: l.active ? 'Link deactivated' : 'Link activated',
        successDescription: l.active ? 'Visitors now get a "link not found" page.' : undefined,
        errorTitle: 'Could not update link',
      },
    );
    setToggling(null);
  };

  const columns: Column<LinkRowView>[] = [
    {
      key: 'url',
      header: 'Short link',
      cell: (l) => (
        <div className="flex min-w-[16rem] items-center gap-1">
          <span className="break-all font-mono text-xs text-fg">{l.url}</span>
          <CopyButton text={l.url} description={`Copy link ${l.url}`} />
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Destination',
      cell: (l) => (
        <span className="block max-w-[20rem] break-all text-xs text-fg-muted" title={l.targetUrl}>
          {l.targetUrl}
        </span>
      ),
    },
    {
      key: 'campaign',
      header: 'Campaign',
      hideOnMobile: true,
      cell: (l) => (
        <div className="text-xs">
          {l.campaign ? <Badge>{l.campaign}</Badge> : <span className="text-fg-muted">—</span>}
          {l.announcement && (
            <p className="mt-1">
              <Link
                href={`/marketing/announcements/${encodeURIComponent(l.announcement.id)}`}
                className="text-accent hover:underline"
              >
                {l.announcement.title}
              </Link>
            </p>
          )}
          {l.partnerCampaign && <p className="mt-1 text-fg-muted">Partner: {l.partnerCampaign}</p>}
        </div>
      ),
    },
    {
      key: 'clicks',
      header: 'Clicks',
      align: 'right',
      cell: (l) => <span className="tabular-nums">{l.clicks.toLocaleString('en-US')}</span>,
    },
    {
      key: 'active',
      header: 'Active',
      cell: (l) =>
        canManage ? (
          <button
            type="button"
            role="switch"
            aria-checked={l.active}
            aria-label={`${l.active ? 'Deactivate' : 'Activate'} ${l.url}`}
            disabled={pending || toggling === l.id}
            onClick={() => void toggle(l)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${l.active ? 'border-accent bg-accent' : 'border-border-strong bg-surface-raised'}`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${l.active ? 'translate-x-[18px] bg-void' : 'translate-x-[2px] bg-fg-muted'}`}
            />
          </button>
        ) : l.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge>Inactive</Badge>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      hideOnMobile: true,
      cell: (l) => <span className="whitespace-nowrap text-xs text-fg-muted">{l.createdLabel}</span>,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Links"
        description="Inactive links stop redirecting. Clicks are counted on every redirect."
        actions={
          canManage ? (
            <Button size="sm" onClick={start}>
              New tracked link
            </Button>
          ) : undefined
        }
      />
      <Table
        columns={columns}
        rows={links}
        rowKey={(l) => l.id}
        caption="Tracked links"
        empty={
          <EmptyState
            title={filtered ? 'No links in this campaign' : 'No tracked links yet'}
            description={
              filtered
                ? 'Try another campaign.'
                : 'Create a short link to count clicks from an announcement, partner post or campaign.'
            }
          />
        }
      />

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={created ? 'Link created' : 'New tracked link'}
        dismissible={!pending}
        footer={
          created ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" form="link-form" loading={pending} loadingLabel="Creating…">
                Create link
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="space-y-2">
            <p className="text-sm text-fg-muted">
              Share this link. Visitors are redirected to the destination and the click counter goes up;
              nothing else is recorded.
            </p>
            <div className="flex items-center gap-2 rounded border border-border bg-void px-3 py-2">
              <span className="min-w-0 flex-1 break-all font-mono text-sm text-fg">{created}</span>
              <CopyButton text={created} description="Copy the new link" />
            </div>
          </div>
        ) : (
          <form id="link-form" onSubmit={save} className="space-y-4" noValidate>
            <Field
              id="link-target"
              label="Destination URL"
              required
              help="Public https:// address. Private or internal addresses are rejected."
              error={fieldErrors.targetUrl}
            >
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  value={draft.targetUrl}
                  onChange={(e) => set('targetUrl', e.target.value)}
                  maxLength={1000}
                  placeholder="https://gynx.gg/…"
                />
              )}
            </Field>
            <Field
              id="link-campaign"
              label="Campaign"
              help="Optional label to group links, e.g. spring-sale."
              error={fieldErrors.campaign}
            >
              {(p) => (
                <>
                  <Input
                    {...p}
                    value={draft.campaign}
                    onChange={(e) => set('campaign', e.target.value)}
                    maxLength={64}
                    list="link-campaigns"
                  />
                  <datalist id="link-campaigns">
                    {campaigns.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field
              id="link-announcement"
              label="Announcement"
              help="Optional. Clicks then show on the announcement's page."
              error={fieldErrors.announcementId}
            >
              {(p) => (
                <Select
                  {...p}
                  value={draft.announcementId}
                  onChange={(e) => set('announcementId', e.target.value)}
                  placeholder="None"
                  options={announcements.map((a) => ({
                    value: a.id,
                    label: a.title.length > 70 ? `${a.title.slice(0, 69)}…` : a.title,
                  }))}
                />
              )}
            </Field>
          </form>
        )}
      </Dialog>
    </Card>
  );
}
