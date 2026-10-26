'use client';

import { useState, type FormEvent } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { CopyButton } from '@/components/marketing/links/CopyButton';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';

export interface UpdateRepoRow {
  id: string;
  fullName: string;
  displayName: string;
  color: string;
  branch: string | null;
  enabled: boolean;
  publicEnabled: boolean;
}
export interface UpdateEventRow {
  id: string;
  repo: string;
  fullName: string;
  kind: string;
  ref: string;
  status: string;
  commits: number;
  postedStaff: boolean;
  postedPublic: boolean;
  createdAt: string;
}
type ChannelRef = { id: string; name: string | null } | null;

interface Draft {
  fullName: string;
  displayName: string;
  color: string;
  branch: string;
  enabled: boolean;
  publicEnabled: boolean;
}
const EMPTY: Draft = {
  fullName: '',
  displayName: '',
  color: '#22D3EE',
  branch: '',
  enabled: true,
  publicEnabled: true,
};

const STATUS_TONE: Record<string, BadgeTone> = {
  POSTED: 'success',
  PENDING: 'accent',
  SKIPPED: 'neutral',
  NO_ACCESS: 'danger',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED: 'Posted',
  PENDING: 'Queued',
  SKIPPED: 'Skipped (no channel)',
  NO_ACCESS: 'Bot cannot post',
};

function ChannelValue({ channel }: { channel: ChannelRef }) {
  if (!channel) return <span className="text-fg-muted">Not set</span>;
  return (
    <span>
      {channel.name ? <span className="text-fg">#{channel.name}</span> : null}{' '}
      <span className="font-mono text-xs text-fg-muted">{channel.id}</span>
    </span>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="break-all rounded bg-surface-raised px-2 py-1 font-mono text-xs text-fg">{value}</code>
      <CopyButton text={value} description={`Copy ${label}`} />
    </div>
  );
}

export function UpdateFeedManager({
  payloadUrl,
  secretConfigured,
  moduleEnabled,
  publicChannel,
  staffChannel,
  repos,
  events,
  timeZone,
}: {
  payloadUrl: string;
  secretConfigured: boolean;
  moduleEnabled: boolean;
  publicChannel: ChannelRef;
  staffChannel: ChannelRef;
  repos: UpdateRepoRow[];
  events: UpdateEventRow[];
  timeZone: string;
}) {
  const { run, pending, fieldErrors, error } = useApiAction();
  const [editing, setEditing] = useState<UpdateRepoRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<UpdateRepoRow | null>(null);
  const [d, setD] = useState<Draft>(EMPTY);

  const open = (r: UpdateRepoRow | 'new') => {
    setEditing(r);
    setD(r === 'new' ? EMPTY : { ...r, branch: r.branch ?? '' });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...d, fullName: d.fullName.trim(), branch: d.branch.trim() || null };
    const res =
      editing === 'new'
        ? await run('/api/updates/repos', 'POST', body, {
            success: 'Repository added',
            errorTitle: 'Not saved',
          })
        : await run(
            `/api/updates/repos/${encodeURIComponent((editing as UpdateRepoRow).id)}`,
            'PATCH',
            body,
            {
              success: 'Repository saved',
              errorTitle: 'Not saved',
            },
          );
    if (res) setEditing(null);
  };

  const repoCols: Column<UpdateRepoRow>[] = [
    {
      key: 'name',
      header: 'Shown as',
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium text-fg">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: r.color }}
            aria-hidden="true"
          />
          {r.displayName}
        </span>
      ),
    },
    {
      key: 'repo',
      header: 'Repository',
      cell: (r) => <span className="font-mono text-xs">{r.fullName}</span>,
    },
    {
      key: 'branch',
      header: 'Branch',
      hideOnMobile: true,
      cell: (r) =>
        r.branch ? (
          <span className="font-mono text-xs">{r.branch}</span>
        ) : (
          <span className="text-fg-muted">Default branch</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
          {r.publicEnabled ? <Badge tone="accent">Public posts</Badge> : <Badge>Staff only</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.displayName}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRemoving(r)}
            aria-label={`Remove ${r.displayName}`}
          >
            Remove
          </Button>
        </div>
      ),
    },
  ];

  const eventCols: Column<UpdateEventRow>[] = [
    { key: 'when', header: 'Received', cell: (r) => formatDateTime(r.createdAt, timeZone) },
    { key: 'repo', header: 'Repository', cell: (r) => <span className="font-medium text-fg">{r.repo}</span> },
    {
      key: 'kind',
      header: 'Event',
      cell: (r) =>
        r.kind === 'release' ? (
          <span>
            Release <span className="font-mono text-xs">{r.ref}</span>
          </span>
        ) : (
          <span>
            Push to <span className="font-mono text-xs">{r.ref}</span> ({r.commits} commit
            {r.commits === 1 ? '' : 's'})
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} dot>
          {STATUS_LABEL[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: 'where',
      header: 'Posted in',
      hideOnMobile: true,
      cell: (r) =>
        [r.postedStaff ? 'Staff' : null, r.postedPublic ? 'Public' : null].filter(Boolean).join(' + ') || '—',
    },
  ];

  return (
    <div className="space-y-6">
      {!moduleEnabled && (
        <Alert tone="warning" title="The update feed module is off">
          Deliveries are ignored until you enable “Update feed (GitHub)” in Settings → General → Modules.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="GitHub webhook"
          description="Add this webhook to each repository: GitHub → repository → Settings → Webhooks → Add webhook."
        />
        <CardBody className="space-y-4">
          {!secretConfigured && (
            <Alert tone="warning" title="Webhook secret not configured">
              The endpoint answers 503 until the server has a secret. On the server, generate one with{' '}
              <code className="font-mono">openssl rand -hex 32</code>, then run{' '}
              <code className="font-mono">sudo gynx set GITHUB_WEBHOOK_SECRET</code> and paste it (or run{' '}
              <code className="font-mono">sudo gynx github-webhook</code>, which creates one and prints the
              webhook settings). Paste the same value into GitHub’s Secret field.
            </Alert>
          )}
          <DescriptionList
            items={[
              { label: 'Payload URL', value: <CopyRow label="payload URL" value={payloadUrl} /> },
              { label: 'Content type', value: <CopyRow label="content type" value="application/json" /> },
              {
                label: 'Secret',
                value: (
                  <span>
                    The value of <code className="font-mono">GITHUB_WEBHOOK_SECRET</code> on the server{' '}
                    {secretConfigured ? (
                      <Badge tone="success">Configured</Badge>
                    ) : (
                      <Badge tone="warning">Not set</Badge>
                    )}
                  </span>
                ),
              },
              {
                label: 'Events',
                value:
                  'Let me select individual events → tick “Pushes” and “Releases” (untick everything else).',
              },
            ]}
          />
          <p className="text-xs text-fg-muted">
            The secret itself is never shown here. Deliveries without a valid signature are rejected.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Channels"
          description="Set them in Settings → General → Channels (“Update feed” and “Update feed (staff, private)”). A channel that isn’t set is skipped."
          actions={
            <ButtonLink href="/settings" size="sm">
              Open settings
            </ButtonLink>
          }
        />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Public updates channel', value: <ChannelValue channel={publicChannel} /> },
              { label: 'Staff updates channel (private)', value: <ChannelValue channel={staffChannel} /> },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Tracked repositories"
          description="Webhooks from repositories not listed here, or switched off, are ignored."
          actions={
            <Button size="sm" onClick={() => open('new')}>
              Add repository
            </Button>
          }
        />
        <Table
          columns={repoCols}
          rows={repos}
          rowKey={(r) => r.id}
          caption="Tracked repositories"
          empty={
            <EmptyState
              title="No repositories yet"
              description="Add a repository, then add the webhook in GitHub."
            />
          }
        />
      </Card>

      <Card>
        <CardHeader title="Public updates and the [public] tag" />
        <CardBody className="space-y-2 text-sm text-fg">
          <p>
            Commit messages stay private. To announce a change publicly, put{' '}
            <code className="font-mono">[public]</code> (any case) on the line that should be shown, for
            example a squash-merge title{' '}
            <code className="font-mono">Faster server start-up [public] (#12)</code> or a pull request title
            (the body line of its merge commit).
          </p>
          <p>
            The public post lists only those lines, with the tag removed: no commit hashes, author names,
            branch names or compare links. Published releases are posted publicly with their notes;
            pre-releases go to staff only. Pushes without a tagged commit are posted to staff only. Secrets
            that look like tokens or keys are redacted everywhere.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent deliveries" description="The last 20 accepted pushes and releases." />
        <Table
          columns={eventCols}
          rows={events}
          rowKey={(r) => r.id}
          caption="Recent deliveries"
          empty={
            <EmptyState
              title="Nothing received yet"
              description="GitHub’s webhook page has a “Recent Deliveries” tab with any errors."
            />
          }
        />
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add repository' : 'Edit repository'}
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="update-repo-form" loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="update-repo-form" onSubmit={save} className="space-y-4" noValidate>
          {error && !Object.keys(fieldErrors).length && (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          )}
          <Field
            id="repo-full-name"
            label="GitHub repository"
            required
            help="owner/repo, e.g. gynx-gg/website"
            error={fieldErrors.fullName}
          >
            {(p) => (
              <Input
                {...p}
                value={d.fullName}
                placeholder="owner/repo"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setD((x) => ({ ...x, fullName: e.target.value }))}
              />
            )}
          </Field>
          <Field
            id="repo-display-name"
            label="Display name"
            required
            help="Shown in posts, e.g. “Website” or “Game panel”."
            error={fieldErrors.displayName}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={60}
                value={d.displayName}
                onChange={(e) => setD((x) => ({ ...x, displayName: e.target.value }))}
              />
            )}
          </Field>
          <Field id="repo-color" label="Colour" help="Embed colour (hex)." error={fieldErrors.color}>
            {(p) => (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick a colour"
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                  value={/^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : '#22D3EE'}
                  onChange={(e) => setD((x) => ({ ...x, color: e.target.value.toUpperCase() }))}
                />
                <Input
                  {...p}
                  maxLength={7}
                  value={d.color}
                  onChange={(e) => setD((x) => ({ ...x, color: e.target.value }))}
                />
              </div>
            )}
          </Field>
          <Field
            id="repo-branch"
            label="Tracked branch"
            help="Leave empty to use the repository’s default branch."
            error={fieldErrors.branch}
          >
            {(p) => (
              <Input
                {...p}
                value={d.branch}
                placeholder="main"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setD((x) => ({ ...x, branch: e.target.value }))}
              />
            )}
          </Field>
          <Switch
            id="repo-enabled"
            checked={d.enabled}
            onChange={(v) => setD((x) => ({ ...x, enabled: v }))}
            label="Enabled"
            description="When off, webhooks from this repository are ignored."
          />
          <Switch
            id="repo-public"
            checked={d.publicEnabled}
            onChange={(v) => setD((x) => ({ ...x, publicEnabled: v }))}
            label="Post tagged updates publicly"
            description="Releases and [public]-tagged commits also go to the public updates channel."
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const ok = await run(`/api/updates/repos/${encodeURIComponent(removing.id)}`, 'DELETE', undefined, {
            success: 'Repository removed',
            errorTitle: 'Could not remove',
          });
          if (ok) setRemoving(null);
        }}
        loading={pending}
        title="Stop tracking this repository?"
        description="Its webhooks will be ignored and its delivery history is deleted. Messages already posted in Discord stay."
        confirmLabel="Remove"
      />
    </div>
  );
}
