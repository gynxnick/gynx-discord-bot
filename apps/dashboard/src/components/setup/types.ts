/**
 * Client-safe view models for the setup wizard pages. The blueprint itself
 * (with bigint permissions) stays on the server; pages convert it with
 * `buildBlueprintView` (server/blueprint-view.ts) before handing it to client
 * components, so no bigint ever crosses into client props or JSON.
 */
import type { setup } from '@gynx/services';

export interface BlueprintRoleView {
  key: string;
  name: string;
  color: string;
  purpose: string;
  /** Guild-level permission names (e.g. KickMembers). */
  permissions: string[];
  staff: boolean;
  hoist: boolean;
  /** Bot dashboard preset granted to this role, if any. */
  grant: string | null;
  /** Permissions the bot cannot grant (manual steps). */
  manualPermissions: string[];
}

export interface BlueprintChannelView {
  key: string;
  name: string;
  type: 'text' | 'voice';
  categoryKey: string;
  /** Blueprint default slow mode (seconds). */
  slowmode: number;
  /** Default staff roles allowed in a restricted channel, or null when not restricted. */
  restrictedTo: string[] | null;
  bindings: string[];
  panel: string | null;
}

export interface BlueprintCategoryView {
  key: string;
  name: string;
  private: boolean;
  channels: BlueprintChannelView[];
}

export interface ComponentView {
  key: string;
  label: string;
}

export interface RoutingRow {
  /** Blueprint channel or role key. */
  resourceKey: string;
  resourceName: string;
  resourceType: 'channel' | 'role';
  binding: string;
  feature: string;
  private: boolean;
}

export interface BlueprintView {
  version: number;
  roles: BlueprintRoleView[];
  categories: BlueprintCategoryView[];
  components: ComponentView[];
  routing: RoutingRow[];
}

/** JSON shapes of the service API as the client receives them. */
export type SetupConfigView = setup.SetupConfig;
export type OperationPreviewView = setup.OperationPreview;
export type OperationDetailView = setup.OperationDetail;
export type OperationListItemView = setup.OperationListItem;
export type ExecutionSummaryView = setup.ExecutionSummary;
export type SetupOverviewView = setup.SetupOverview;
export type PlannedChangeView = setup.PlannedChange;
export type FindingView = setup.Finding;
