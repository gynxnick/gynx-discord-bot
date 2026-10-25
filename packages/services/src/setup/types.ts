import { z } from 'zod';
import {
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_ROLES,
  COMPONENT_KEYS,
  type ComponentKey,
  type RoleKey,
} from './blueprint';

// ── Admin customisation (GuildSetup.configuration) ───────────────────────────

const ROLE_KEYS = BLUEPRINT_ROLES.map((r) => r.key) as [RoleKey, ...RoleKey[]];
const CHANNEL_KEYS = BLUEPRINT_CATEGORIES.flatMap((c) => c.channels.map((ch) => ch.key)) as [
  string,
  ...string[],
];
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be a hex value like #22D3EE');

export const setupConfigSchema = z
  .object({
    /** Rename/recolour blueprint roles. */
    roles: z
      .record(
        z.enum(ROLE_KEYS),
        z.object({ name: z.string().trim().min(1).max(100).optional(), color: hexColor.optional() }).strict(),
      )
      .default({}),
    /** Rename blueprint channels/categories (emoji names allowed). Key = channel or category key. */
    names: z.record(z.string(), z.string().trim().min(1).max(100)).default({}),
    /** Components to manage; empty = all. */
    components: z.array(z.enum(COMPONENT_KEYS as [ComponentKey, ...ComponentKey[]])).default([]),
    /** Individual channels to leave out (by channel key). */
    excludedChannels: z.array(z.enum(CHANNEL_KEYS)).default([]),
    /** Slow mode per channel key, seconds (0–21600). */
    slowmode: z.record(z.enum(CHANNEL_KEYS), z.number().int().min(0).max(21600)).default({}),
    /** Which staff roles may see each restricted channel (overrides BlueprintChannel.restrictedTo). */
    restrictedAccess: z.record(z.enum(CHANNEL_KEYS), z.array(z.enum(ROLE_KEYS)).min(1)).default({}),
    /** Show approved staff names on the public support panel. */
    showStaffNames: z.boolean().default(true),
  })
  .strict();
export type SetupConfig = z.output<typeof setupConfigSchema>;
export type SetupConfigInput = z.input<typeof setupConfigSchema>;
export const DEFAULT_SETUP_CONFIG: SetupConfig = setupConfigSchema.parse({});

// ── Live server snapshot (read through DiscordAdminPort) ─────────────────────

export interface SnapshotRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: bigint;
  managed: boolean;
  hoist: boolean;
  mentionable: boolean;
}

export interface SnapshotOverwrite {
  id: string;
  /** 0 = role, 1 = member */
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

export interface SnapshotChannel {
  id: string;
  name: string;
  /** Discord channel types: 0 text, 2 voice, 4 category, 5 announcement, 15 forum … */
  type: number;
  parentId: string | null;
  position: number;
  topic: string | null;
  rateLimitPerUser: number;
  overwrites: SnapshotOverwrite[];
}

export interface GuildSnapshot {
  guildId: string;
  ownerId: string;
  botUserId: string;
  /** Effective guild-level permissions of the bot (Administrator expanded to all). */
  botPermissions: bigint;
  /** Position of the bot's highest role (it can only manage roles strictly below it). */
  botHighestPosition: number;
  roles: SnapshotRole[];
  channels: SnapshotChannel[];
}

// ── Plans ────────────────────────────────────────────────────────────────────

/** `safe`: creates or touches only bot-managed things. `disruptive`: changes something members already use. */
export type ChangeRisk = 'safe' | 'disruptive';

export type PlannedChange =
  | {
      kind: 'role.create';
      key: string;
      name: string;
      color: string;
      permissions: string;
      risk: ChangeRisk;
      description: string;
    }
  | { kind: 'role.adopt'; key: string; discordId: string; risk: ChangeRisk; description: string }
  | {
      kind: 'role.update';
      key: string;
      discordId: string;
      patch: { name?: string; color?: string; permissions?: string };
      risk: ChangeRisk;
      description: string;
    }
  | {
      kind: 'role.position';
      key: string;
      discordId: string;
      position: number;
      risk: ChangeRisk;
      description: string;
    }
  | {
      kind: 'channel.create';
      key: string;
      name: string;
      channelType: 'category' | 'text' | 'voice';
      parentKey: string | null;
      risk: ChangeRisk;
      description: string;
    }
  | { kind: 'channel.adopt'; key: string; discordId: string; risk: ChangeRisk; description: string }
  | {
      kind: 'channel.update';
      key: string;
      discordId: string;
      patch: { name?: string; parentKey?: string; topic?: string; slowmode?: number };
      risk: ChangeRisk;
      description: string;
    }
  | {
      kind: 'overwrite.set';
      key: string;
      channelKey: string;
      target: string;
      allow: string;
      deny: string;
      risk: ChangeRisk;
      description: string;
    }
  | {
      kind: 'binding.set';
      key: string;
      binding: string;
      resourceKey: string;
      risk: ChangeRisk;
      description: string;
    }
  | { kind: 'grant.set'; key: string; roleKey: string; preset: string; risk: ChangeRisk; description: string }
  | {
      kind: 'message.deploy';
      key: string;
      channelKey: string;
      panel: string;
      risk: ChangeRisk;
      description: string;
    }
  | { kind: 'template.create'; key: string; name: string; risk: ChangeRisk; description: string };

export type FindingLevel = 'info' | 'warning' | 'blocking';

export interface Finding {
  level: FindingLevel;
  /** e.g. 'missing-bot-permission', 'ambiguous-match', 'renamed', 'deleted', 'hierarchy', 'manual-step', 'cannot-grant' */
  code: string;
  key?: string;
  message: string;
}

export interface Plan {
  blueprintVersion: number;
  changes: PlannedChange[];
  findings: Finding[];
  /** Resources already in place and matching the blueprint. */
  inPlace: string[];
  /** Missing bot permissions (names). */
  missingBotPermissions: string[];
  /** True when a blocking finding prevents applying (e.g. bot lacks Manage Channels). */
  blocked: boolean;
}

export interface OperationPreview {
  operationId: string;
  type: 'START' | 'REPAIR' | 'UPDATE' | 'ROLLBACK';
  blueprintVersion: number;
  plan: Plan;
  summary: {
    create: number;
    adopt: number;
    update: number;
    permissions: number;
    messages: number;
    disruptive: number;
  };
  requiresDisruptiveConsent: boolean;
}

export interface ExecutionSummary {
  operationId: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  created: number;
  adopted: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: Array<{ key: string; error: string }>;
  verified: boolean;
  verificationFindings: Finding[];
}

export interface SetupOverview {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PARTIAL' | 'COMPLETE' | 'FAILED';
  blueprintVersion: number;
  deployedBlueprintVersion: number | null;
  completionPercent: number;
  roles: Array<{
    key: string;
    name: string;
    state: 'present' | 'missing' | 'renamed' | 'excluded';
    discordId: string | null;
  }>;
  channels: Array<{
    key: string;
    name: string;
    category: string;
    state: 'present' | 'missing' | 'renamed' | 'excluded';
    discordId: string | null;
  }>;
  panels: Array<{
    key: string;
    state: 'deployed' | 'missing' | 'not-configured';
    channelId: string | null;
    messageId: string | null;
  }>;
  permissionFindings: Finding[];
  outstanding: Finding[];
  lastOperation: {
    id: string;
    type: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  } | null;
  lastVerifiedAt: string | null;
}
