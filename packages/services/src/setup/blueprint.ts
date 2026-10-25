import { PermissionFlagsBits as P } from 'discord-api-types/v10';

/**
 * The official GYNX Discord server blueprint, as data.
 *
 * Everything the setup wizard creates, adopts, verifies, repairs or rolls back
 * is derived from this file plus the guild's SetupConfig customisation (role
 * names/colours, selected components, slow mode, restricted-channel access).
 * Bump BLUEPRINT_VERSION whenever the blueprint changes; `/setup update`
 * previews the difference against what is deployed.
 */
export const BLUEPRINT_VERSION = 1;

export type RoleKey =
  | 'founder'
  | 'executive'
  | 'management'
  | 'senior-support'
  | 'support'
  | 'moderator'
  | 'partner'
  | 'customer'
  | 'community'
  | 'verified'
  | 'bot';

/** Overwrite target: @everyone, a blueprint role, or the bot itself (member overwrite). */
export type OverwriteTarget = '@everyone' | 'self' | RoleKey;

export interface OverwriteSpec {
  target: OverwriteTarget;
  allow?: bigint;
  deny?: bigint;
}

/** The permission preset (packages/permissions) a role's StaffPermission grant maps to. */
export type GrantPreset = 'OWNER' | 'ADMINISTRATOR' | 'SENIOR_STAFF' | 'SUPPORT_STAFF' | 'MODERATOR';

export interface BlueprintRole {
  key: RoleKey;
  name: string;
  color: string;
  /** Guild-level permissions; deliberately minimal (channel overwrites do the rest). */
  permissions: bigint;
  hoist: boolean;
  mentionable: boolean;
  staff: boolean;
  /** Bot dashboard permissions granted to this role (only if the operator may grant them). */
  grant?: GrantPreset;
  purpose: string;
  /** Permissions the blueprint would like but the bot can never grant (reported as a manual step). */
  manualPermissions?: string[];
}

/** GuildConfig / WelcomeConfig fields a channel or role is wired into after setup. */
export type ChannelBinding =
  | 'welcome.channelId'
  | 'announcementChannelId'
  | 'incidentChannelId'
  | 'statusBoardChannelId'
  | 'statusChannelId'
  | 'supportStatusChannelId'
  | 'suggestionChannelId'
  | 'eventChannelId'
  | 'dutyPanelChannelId'
  | 'reportChannelId'
  | 'partnerReviewChannelId'
  | 'modLogChannelId'
  | 'securityChannelId'
  | 'logChannelId'
  | 'setupLogChannelId';

export type RoleBinding = 'welcome.verifiedRoleId' | 'partnerRoleId' | 'staffPingRoleId' | 'escalationRoleId';

export type PanelKey = 'welcome' | 'rules' | 'verify' | 'support-status' | 'duty-control';

export interface BlueprintChannel {
  key: string;
  name: string;
  type: 'text' | 'voice';
  topic?: string;
  /** Default slow mode in seconds (overridable in SetupConfig). */
  slowmode?: number;
  /** Channel-specific overwrites on top of the category's (only where they differ). */
  overwrites?: OverwriteSpec[];
  bindings?: ChannelBinding[];
  panel?: PanelKey;
  /** Channel is restricted to these staff roles (SetupConfig.restrictedAccess may change it). */
  restrictedTo?: RoleKey[];
}

export interface BlueprintCategory {
  key: string;
  name: string;
  private: boolean;
  overwrites: OverwriteSpec[];
  channels: BlueprintChannel[];
}

// ── Permission building blocks ───────────────────────────────────────────────

const VIEW = P.ViewChannel;
const READ = P.ReadMessageHistory;
const SEND = P.SendMessages | P.SendMessagesInThreads;
const CHAT = SEND | P.AddReactions | P.EmbedLinks | P.AttachFiles | P.UseExternalEmojis;
const MOD = P.ManageMessages;
const VOICE = P.Connect | P.Speak;

/** Guild-level moderation set for senior roles (the bot holds all of these, so it can grant them). */
const MOD_SET = P.KickMembers | P.BanMembers | P.ModerateMembers | P.ManageMessages;

const STAFF: RoleKey[] = ['founder', 'executive', 'management', 'senior-support', 'support', 'moderator'];
const LEADERSHIP: RoleKey[] = ['founder', 'executive', 'management'];
const MEMBERS: RoleKey[] = ['verified', 'customer'];

const allow = (targets: readonly OverwriteTarget[], a: bigint): OverwriteSpec[] =>
  targets.map((t) => ({ target: t, allow: a }));

/** The bot can always see and post where it manages panels and logs. */
const SELF_TEXT: OverwriteSpec = {
  target: 'self',
  allow: VIEW | READ | SEND | P.EmbedLinks | P.AttachFiles | MOD,
};
const SELF_VOICE: OverwriteSpec = { target: 'self', allow: VIEW | P.Connect };

// ── Roles (highest first) ────────────────────────────────────────────────────

export const BLUEPRINT_ROLES: readonly BlueprintRole[] = [
  {
    key: 'founder',
    name: 'Founder',
    color: '#22D3EE',
    permissions: MOD_SET,
    hoist: true,
    mentionable: false,
    staff: true,
    grant: 'OWNER',
    purpose: 'Server owner and full administration',
    manualPermissions: ['Administrator (the bot never holds Administrator, so it cannot grant it)'],
  },
  {
    key: 'executive',
    name: 'Executive',
    color: '#7C3AED',
    permissions: MOD_SET,
    hoist: true,
    mentionable: false,
    staff: true,
    grant: 'ADMINISTRATOR',
    purpose: 'Executive leadership',
  },
  {
    key: 'management',
    name: 'Management',
    color: '#5865F2',
    permissions: MOD_SET,
    hoist: true,
    mentionable: true,
    staff: true,
    grant: 'SENIOR_STAFF',
    purpose: 'Staff management',
  },
  {
    key: 'senior-support',
    name: 'Senior Support',
    color: '#22D3EE',
    permissions: P.ModerateMembers | P.ManageMessages,
    hoist: true,
    mentionable: true,
    staff: true,
    grant: 'SENIOR_STAFF',
    purpose: 'Advanced support',
  },
  {
    key: 'support',
    name: 'Support',
    color: '#3498DB',
    permissions: 0n,
    hoist: true,
    mentionable: true,
    staff: true,
    grant: 'SUPPORT_STAFF',
    purpose: 'Customer assistance',
  },
  {
    key: 'moderator',
    name: 'Moderator',
    color: '#2ECC71',
    permissions: P.KickMembers | P.ModerateMembers | P.ManageMessages,
    hoist: true,
    mentionable: true,
    staff: true,
    grant: 'MODERATOR',
    purpose: 'Community moderation',
  },
  {
    key: 'partner',
    name: 'Partner',
    color: '#F1C40F',
    permissions: 0n,
    hoist: true,
    mentionable: false,
    staff: false,
    purpose: 'Approved partners',
  },
  {
    key: 'customer',
    name: 'Customer',
    color: '#9B59B6',
    permissions: 0n,
    hoist: false,
    mentionable: false,
    staff: false,
    purpose: 'Verified GYNX customers',
  },
  {
    key: 'community',
    name: 'Community',
    color: '#9CA3AF',
    permissions: 0n,
    hoist: false,
    mentionable: false,
    staff: false,
    purpose: 'Community members',
  },
  {
    key: 'verified',
    name: 'Verified',
    color: '#D1D5DB',
    permissions: 0n,
    hoist: false,
    mentionable: false,
    staff: false,
    purpose: 'Verified members',
  },
  {
    key: 'bot',
    name: 'Bot',
    color: '#5865F2',
    permissions: 0n,
    hoist: false,
    mentionable: false,
    staff: false,
    purpose: 'Bot identity and integrations',
  },
];

export const ROLE_BINDINGS: Partial<Record<RoleKey, RoleBinding[]>> = {
  verified: ['welcome.verifiedRoleId'],
  partner: ['partnerRoleId'],
  support: ['staffPingRoleId'],
  management: ['escalationRoleId'],
};

// ── Categories & channels (in display order) ─────────────────────────────────

/** Read-only public information: everyone reads, leadership publishes. */
const INFO: OverwriteSpec[] = [
  { target: '@everyone', allow: VIEW | READ, deny: SEND | P.AddReactions },
  ...allow(LEADERSHIP, SEND | P.EmbedLinks | P.AttachFiles | MOD),
  SELF_TEXT,
];

/** Discussion for verified members; unverified members cannot see it until they verify. */
const DISCUSSION: OverwriteSpec[] = [
  { target: '@everyone', deny: VIEW },
  ...allow(MEMBERS, VIEW | READ | CHAT),
  ...allow(
    ['moderator', 'support', 'senior-support', 'management', 'executive', 'founder'],
    VIEW | READ | CHAT | MOD,
  ),
  SELF_TEXT,
];

/** Channel override: members may talk here even though the category is read-only. */
const MEMBERS_CAN_TALK: OverwriteSpec[] = [
  ...allow(MEMBERS, CHAT),
  ...allow(['moderator', 'support', 'senior-support'], CHAT | MOD),
];

/** Channel override: members read but don't post (bot/staff post). */
const MEMBERS_READ_ONLY: OverwriteSpec[] = MEMBERS.map((t) => ({ target: t, deny: SEND }));

const PRIVATE_STAFF: OverwriteSpec[] = [
  { target: '@everyone', deny: VIEW },
  ...allow(STAFF, VIEW | READ | CHAT),
  SELF_TEXT,
];

const PRIVATE_ADMIN: OverwriteSpec[] = [
  { target: '@everyone', deny: VIEW },
  ...allow(LEADERSHIP, VIEW | READ | CHAT),
  SELF_TEXT,
];

export const BLUEPRINT_CATEGORIES: readonly BlueprintCategory[] = [
  {
    key: 'start-here',
    name: 'START HERE',
    private: false,
    overwrites: INFO,
    channels: [
      {
        key: 'welcome',
        name: '👋・welcome',
        type: 'text',
        topic: 'Welcome to GYNX.GG',
        panel: 'welcome',
        bindings: ['welcome.channelId'],
      },
      { key: 'rules', name: '📜・rules', type: 'text', topic: 'Server rules', panel: 'rules' },
      {
        key: 'announcements',
        name: '📢・announcements',
        type: 'text',
        topic: 'Official GYNX announcements',
        bindings: ['announcementChannelId', 'incidentChannelId'],
      },
      {
        key: 'service-status',
        name: '📡・service-status',
        type: 'text',
        topic: 'Live GYNX service status',
        bindings: ['statusBoardChannelId'],
      },
      {
        key: 'verify',
        name: '🔐・verify',
        type: 'text',
        topic: 'Verify to unlock the community',
        panel: 'verify',
      },
    ],
  },
  {
    key: 'gynx-hosting',
    name: 'GYNX HOSTING',
    private: false,
    overwrites: INFO,
    channels: [
      { key: 'game-hosting', name: '🎮・game-hosting', type: 'text' },
      { key: 'supported-games', name: '🕹️・supported-games', type: 'text' },
      { key: 'locations-and-network', name: '🌎・locations-and-network', type: 'text' },
      { key: 'ddos-protection', name: '🛡️・ddos-protection', type: 'text' },
      { key: 'website-and-resources', name: '🔗・website-and-resources', type: 'text' },
    ],
  },
  {
    key: 'support-center',
    name: 'SUPPORT CENTER',
    private: false,
    overwrites: INFO,
    channels: [
      {
        key: 'support-status',
        name: '🟢・support-status',
        type: 'text',
        topic: 'Is GYNX support online right now?',
        panel: 'support-status',
        bindings: ['supportStatusChannelId'],
      },
      { key: 'knowledge-base', name: '📚・knowledge-base', type: 'text' },
      {
        key: 'troubleshooting',
        name: '🔧・troubleshooting',
        type: 'text',
        slowmode: 10,
        overwrites: MEMBERS_CAN_TALK,
      },
      {
        key: 'community-help',
        name: '💬・community-help',
        type: 'text',
        slowmode: 10,
        overwrites: MEMBERS_CAN_TALK,
      },
    ],
  },
  {
    key: 'community',
    name: 'COMMUNITY',
    private: false,
    overwrites: DISCUSSION,
    channels: [
      { key: 'general', name: '💬・general', type: 'text', slowmode: 3 },
      { key: 'gaming', name: '🎮・gaming', type: 'text', slowmode: 3 },
      { key: 'showcase', name: '🖼️・showcase', type: 'text', slowmode: 30 },
      {
        key: 'suggestions',
        name: '💡・suggestions',
        type: 'text',
        slowmode: 30,
        bindings: ['suggestionChannelId'],
      },
      {
        key: 'events',
        name: '🎉・events',
        type: 'text',
        overwrites: MEMBERS_READ_ONLY,
        bindings: ['eventChannelId'],
      },
    ],
  },
  {
    key: 'partners-creators',
    name: 'PARTNERS & CREATORS',
    private: false,
    overwrites: [
      { target: '@everyone', deny: VIEW },
      ...allow(MEMBERS, VIEW | READ),
      ...allow(['partner'], VIEW | READ | CHAT),
      ...allow(STAFF, VIEW | READ | CHAT | MOD),
      SELF_TEXT,
    ],
    channels: [
      { key: 'partnerships', name: '🤝・partnerships', type: 'text', overwrites: MEMBERS_READ_ONLY },
      { key: 'creator-program', name: '🎥・creator-program', type: 'text', overwrites: MEMBERS_READ_ONLY },
    ],
  },
  {
    key: 'staff-hq',
    name: 'STAFF HQ — PRIVATE',
    private: true,
    overwrites: PRIVATE_STAFF,
    channels: [
      { key: 'staff-announcements', name: '📢・staff-announcements', type: 'text' },
      { key: 'staff-chat', name: '💬・staff-chat', type: 'text' },
      {
        key: 'staff-duty',
        name: '⏱️・staff-duty',
        type: 'text',
        panel: 'duty-control',
        bindings: ['dutyPanelChannelId'],
        restrictedTo: ['founder', 'executive', 'management', 'senior-support', 'support'],
      },
      {
        key: 'support-operations',
        name: '🎧・support-operations',
        type: 'text',
        restrictedTo: ['founder', 'executive', 'management', 'senior-support', 'support'],
      },
      {
        key: 'staff-reports',
        name: '📋・staff-reports',
        type: 'text',
        bindings: ['reportChannelId', 'partnerReviewChannelId'],
        restrictedTo: ['founder', 'executive', 'management'],
      },
      {
        key: 'mod-logs',
        name: '🛡️・mod-logs',
        type: 'text',
        bindings: ['modLogChannelId'],
        restrictedTo: ['founder', 'executive', 'management', 'senior-support', 'moderator'],
      },
      {
        key: 'abuse-reports',
        name: '🚨・abuse-reports',
        type: 'text',
        bindings: ['securityChannelId'],
        restrictedTo: ['founder', 'executive', 'management', 'senior-support'],
      },
    ],
  },
  {
    key: 'bot-admin',
    name: 'BOT & ADMINISTRATION — PRIVATE',
    private: true,
    overwrites: PRIVATE_ADMIN,
    channels: [
      { key: 'bot-commands', name: '🤖・bot-commands', type: 'text' },
      { key: 'bot-logs', name: '📊・bot-logs', type: 'text', bindings: ['logChannelId'] },
      { key: 'alerts', name: '🔔・alerts', type: 'text', bindings: ['statusChannelId'] },
      { key: 'audit-logs', name: '🧾・audit-logs', type: 'text', bindings: ['setupLogChannelId'] },
    ],
  },
  {
    key: 'voice',
    name: 'VOICE CHANNELS',
    private: false,
    overwrites: [
      { target: '@everyone', deny: VIEW },
      ...allow(MEMBERS, VIEW | VOICE),
      ...allow(STAFF, VIEW | VOICE | P.MuteMembers | P.MoveMembers),
      SELF_VOICE,
    ],
    channels: [
      { key: 'community-lounge', name: '🛋️・community-lounge', type: 'voice' },
      { key: 'gaming-room-01', name: '🎮・gaming-room-01', type: 'voice' },
      { key: 'gaming-room-02', name: '🎮・gaming-room-02', type: 'voice' },
    ],
  },
  {
    key: 'staff-voice',
    name: 'STAFF VOICE — PRIVATE',
    private: true,
    overwrites: [{ target: '@everyone', deny: VIEW }, ...allow(STAFF, VIEW | VOICE), SELF_VOICE],
    channels: [
      { key: 'staff-voice', name: '🎙️・staff-voice', type: 'voice' },
      { key: 'staff-meeting-room', name: '🗣️・staff-meeting-room', type: 'voice' },
    ],
  },
];

// ── Selectable components ────────────────────────────────────────────────────

/**
 * What an administrator can pick in /setup start and the dashboard.
 * Empty selection = everything.
 */
export const COMPONENTS = [
  { key: 'roles', label: 'Roles and role order' },
  ...BLUEPRINT_CATEGORIES.map((c) => ({ key: `category:${c.key}`, label: `${c.name} channels` })),
  { key: 'permissions', label: 'Category and channel permissions' },
  { key: 'staff-grants', label: 'Bot dashboard permissions for staff roles' },
  { key: 'embeds', label: 'Welcome, rules and verification messages' },
  { key: 'panel:support-status', label: 'Customer support status panel' },
  { key: 'panel:duty-control', label: 'Staff duty control panel' },
  { key: 'logging', label: 'Log, alert and feature channel routing' },
] as const;
export type ComponentKey = (typeof COMPONENTS)[number]['key'];
export const COMPONENT_KEYS = COMPONENTS.map((c) => c.key) as ComponentKey[];

/** Blueprint keys of the manifest (stable identifiers stored in SetupResource.blueprintKey). */
export const roleKey = (k: RoleKey) => `role:${k}`;
export const categoryKey = (k: string) => `category:${k}`;
export const channelKey = (k: string) => `channel:${k}`;
export const messageKey = (k: PanelKey) => `message:${k}`;

/** Every bot permission any part of the blueprint uses (preflight compares against the bot's actual permissions). */
export const REQUIRED_BOT_PERMISSIONS =
  P.ManageRoles |
  P.ManageChannels |
  VIEW |
  READ |
  SEND |
  P.EmbedLinks |
  P.AttachFiles |
  P.AddReactions |
  P.UseExternalEmojis |
  MOD |
  P.KickMembers |
  P.BanMembers |
  P.ModerateMembers |
  VOICE |
  P.MuteMembers |
  P.MoveMembers |
  P.CreatePublicThreads;

/** Human names for permission bits (previews, diffs, missing-permission findings). */
export function permissionNames(bits: bigint): string[] {
  return Object.entries(P)
    .filter(([, v]) => v !== 0n && (bits & v) === v)
    .map(([k]) => k);
}
