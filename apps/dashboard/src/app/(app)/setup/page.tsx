import type { Metadata } from 'next';
import Link from 'next/link';
import { setup } from '@gynx/services';
import { FindingsList } from '@/components/setup/FindingsList';
import { toJsonSafe } from '@/components/setup/json-safe';
import {
  OPERATION_STATUS_LABELS,
  OPERATION_STATUS_TONES,
  OPERATION_TYPE_LABELS,
  SETUP_STATUS_TONES,
  countFindings,
} from '@/components/setup/preview-utils';
import { SetupActions } from '@/components/setup/SetupActions';
import { Badge, StatusBadge, humanizeEnum } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Alert, ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { getLogger } from '@/server/deps';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Server setup' };
export const dynamic = 'force-dynamic';

const PANEL_LABELS: Record<string, string> = {
  welcome: 'Welcome message',
  rules: 'Rules',
  verify: 'Verification',
  'support-status': 'Customer support status panel',
  'duty-control': 'Staff duty control panel',
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'warning' | 'danger';
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={
          'mt-1 text-2xl font-semibold tabular-nums ' +
          (tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-fg')
        }
      >
        {value}
      </p>
    </div>
  );
}

export default async function SetupOverviewPage() {
  const page = await requirePagePermission('setup.manage', 'setup.overview');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const tz = page.timezone;

  let overview: setup.SetupOverview;
  try {
    overview = toJsonSafe(await setup.getSetupOverview(page.ctx));
  } catch (err) {
    getLogger().error({ err }, 'setup overview failed');
    return (
      <>
        <PageHeader title="Server setup" breadcrumbs={[{ label: 'Server setup' }]} />
        <ErrorState
          title="Setup status could not be loaded"
          description="The setup service did not respond. Try again in a moment; if it keeps happening, check the bot and worker logs."
          action={
            <ButtonLink href="/setup" variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </>
    );
  }

  const count = (items: Array<{ state: string }>, state: string) =>
    items.filter((i) => i.state === state).length;
  const missingRoles = count(overview.roles, 'missing');
  const renamedRoles = count(overview.roles, 'renamed');
  const missingChannels = count(overview.channels, 'missing');
  const renamedChannels = count(overview.channels, 'renamed');
  const outdated =
    overview.deployedBlueprintVersion !== null &&
    overview.deployedBlueprintVersion < overview.blueprintVersion;
  const fc = countFindings(overview.outstanding);
  const notStarted = overview.status === 'NOT_STARTED';
  const needsRepair = missingRoles + renamedRoles + missingChannels + renamedChannels > 0;
  const last = overview.lastOperation;

  return (
    <>
      <PageHeader
        title="Server setup"
        description="Provision and maintain this Discord server from the official GYNX blueprint. Every action starts with a preview; nothing changes in Discord until you confirm."
        breadcrumbs={[{ label: 'Server setup' }]}
        actions={
          <>
            <ButtonLink href="/setup/config" variant="secondary" size="sm">
              Configuration
            </ButtonLink>
            <ButtonLink href="/setup/history" variant="ghost" size="sm">
              History
            </ButtonLink>
          </>
        }
      />

      <div className="space-y-6">
        {outdated && (
          <Alert tone="warning" title="A newer blueprint is available">
            This server runs blueprint version {overview.deployedBlueprintVersion}; the current version is{' '}
            {overview.blueprintVersion}. Run <strong>Update</strong> to preview what changes.
          </Alert>
        )}
        {fc.blocking > 0 && (
          <Alert tone="danger" title={`${fc.blocking} blocking issue${fc.blocking === 1 ? '' : 's'}`}>
            Setup cannot be applied until these are fixed. See outstanding findings below.
          </Alert>
        )}

        <Card>
          <CardHeader
            title="Setup status"
            description={
              overview.lastVerifiedAt
                ? `Last verified ${formatDateTime(overview.lastVerifiedAt, tz)}`
                : 'Not verified yet'
            }
            actions={
              <StatusBadge
                status={overview.status}
                tone={SETUP_STATUS_TONES[overview.status]}
                label={humanizeEnum(overview.status)}
              />
            }
          />
          <CardBody className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span id="setup-completion-label" className="text-fg-muted">
                  Completion
                </span>
                <span className="font-semibold tabular-nums text-fg">{overview.completionPercent}%</span>
              </div>
              <div
                role="progressbar"
                aria-labelledby="setup-completion-label"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overview.completionPercent}
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-raised"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, overview.completionPercent))}%` }}
                />
              </div>
            </div>
            <DescriptionList
              items={[
                { label: 'Current blueprint', value: `Version ${overview.blueprintVersion}` },
                {
                  label: 'Deployed blueprint',
                  value:
                    overview.deployedBlueprintVersion === null ? (
                      'Not deployed yet'
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        Version {overview.deployedBlueprintVersion}
                        {outdated && <Badge tone="warning">Update available</Badge>}
                      </span>
                    ),
                },
              ]}
            />
            <SetupActions
              primary={notStarted ? 'START' : outdated ? 'UPDATE' : needsRepair ? 'REPAIR' : 'START'}
            />
          </CardBody>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Missing roles" value={missingRoles} tone={missingRoles ? 'warning' : undefined} />
          <Stat label="Renamed roles" value={renamedRoles} tone={renamedRoles ? 'warning' : undefined} />
          <Stat
            label="Missing channels"
            value={missingChannels}
            tone={missingChannels ? 'warning' : undefined}
          />
          <Stat
            label="Renamed channels"
            value={renamedChannels}
            tone={renamedChannels ? 'warning' : undefined}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Outstanding findings"
              description={`${fc.blocking} blocking · ${fc.warning} warnings · ${fc.info} info`}
            />
            <CardBody>
              <FindingsList
                findings={[...overview.outstanding, ...overview.permissionFindings]}
                empty="No outstanding findings."
              />
            </CardBody>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Panels" description="Messages the bot keeps up to date in Discord." />
              <CardBody>
                {overview.panels.length === 0 ? (
                  <p className="text-sm text-fg-muted">No panels configured.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {overview.panels.map((p) => (
                      <li key={p.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-fg">{PANEL_LABELS[p.key] ?? p.key}</span>
                        <Badge
                          tone={
                            p.state === 'deployed' ? 'success' : p.state === 'missing' ? 'warning' : 'neutral'
                          }
                          dot
                        >
                          {p.state === 'deployed'
                            ? 'Deployed'
                            : p.state === 'missing'
                              ? 'Missing'
                              : 'Not configured'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Last operation" />
              <CardBody>
                {last ? (
                  <div className="space-y-3">
                    <DescriptionList
                      items={[
                        { label: 'Type', value: OPERATION_TYPE_LABELS[last.type] ?? last.type },
                        {
                          label: 'Status',
                          value: (
                            <StatusBadge
                              status={last.status}
                              tone={OPERATION_STATUS_TONES[last.status]}
                              label={OPERATION_STATUS_LABELS[last.status]}
                            />
                          ),
                        },
                        { label: 'Started', value: formatDateTime(last.startedAt, tz) },
                        { label: 'Completed', value: formatDateTime(last.completedAt, tz) },
                      ]}
                    />
                    <Link href={`/setup/operations/${encodeURIComponent(last.id)}`} className="text-sm">
                      View details
                    </Link>
                  </div>
                ) : (
                  <p className="text-sm text-fg-muted">
                    Setup has not been run on this server yet. Review the{' '}
                    <Link href="/setup/config">configuration</Link>, then choose Preview setup.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
