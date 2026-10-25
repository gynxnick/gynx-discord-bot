import type { Metadata } from 'next';
import { setup } from '@gynx/services';
import { toJsonSafe } from '@/components/setup/json-safe';
import { buildBlueprintView } from '@/components/setup/server/blueprint-view';
import { SetupConfigForm } from '@/components/setup/SetupConfigForm';
import { ButtonLink } from '@/components/ui/Button';
import { ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { getLogger } from '@/server/deps';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Setup configuration' };
export const dynamic = 'force-dynamic';

export default async function SetupConfigPage() {
  const page = await requirePagePermission('setup.manage', 'setup.config');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;

  const header = (
    <PageHeader
      title="Setup configuration"
      description="Customise the blueprint for this server: role names and colours, which channels to create, slow mode and who can see restricted staff channels. Changes are audited."
      breadcrumbs={[{ label: 'Server setup', href: '/setup' }, { label: 'Configuration' }]}
    />
  );

  let config: setup.SetupConfig;
  try {
    config = toJsonSafe(await setup.getSetupConfig(page.ctx));
  } catch (err) {
    getLogger().error({ err }, 'setup config load failed');
    return (
      <>
        {header}
        <ErrorState
          title="Configuration could not be loaded"
          description="The setup service did not respond. Try again in a moment."
          action={
            <ButtonLink href="/setup/config" variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <SetupConfigForm initial={config} blueprint={buildBlueprintView()} />
    </>
  );
}
