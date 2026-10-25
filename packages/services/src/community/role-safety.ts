import { PermissionFlagsBits } from 'discord-api-types/v10';
import { CommunityText as T } from './texts';

/**
 * Role-safety rules for anything the bot hands out on request (self-roles,
 * interests, the verified role). Pure and Discord-agnostic: callers pass the
 * live role metadata (from the gateway cache or `DiscordPort.listRoles`).
 */
export interface RoleMeta {
  id: string;
  position: number;
  managed: boolean;
  /** Discord permission bitfield as a decimal string. */
  permissions: string;
}

export interface RoleSafetyInput {
  guildId: string;
  role: RoleMeta;
  /** Position of the bot's highest role (`guild.members.me.roles.highest.position`). */
  botHighestPosition: number;
  /** Role IDs that may never be self-assigned (staff grants, partner/escalation roles …). */
  protectedRoleIds?: ReadonlySet<string> | readonly string[];
}

/** Permissions that make a role privileged; such roles are never self-assignable. */
export const DANGEROUS_PERMISSIONS = {
  Administrator: PermissionFlagsBits.Administrator,
  ManageGuild: PermissionFlagsBits.ManageGuild,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  MentionEveryone: PermissionFlagsBits.MentionEveryone,
  ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
} as const satisfies Record<string, bigint>;

export type RoleSafetyReason =
  'EVERYONE' | 'MANAGED' | 'HIERARCHY' | 'DANGEROUS_PERMISSIONS' | 'PROTECTED' | 'INVALID';

export type RoleSafetyResult =
  { ok: true } | { ok: false; reason: RoleSafetyReason; message: string; permissions?: string[] };

function parseBits(raw: string): bigint | null {
  if (!/^\d{1,40}$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Names of dangerous permissions contained in a bitfield (unparseable bitfields count as dangerous). */
export function dangerousPermissionsIn(bitfield: string): string[] {
  const bits = parseBits(bitfield);
  if (bits === null) return ['UNPARSEABLE'];
  return Object.entries(DANGEROUS_PERMISSIONS)
    .filter(([, flag]) => (bits & flag) === flag)
    .map(([name]) => name);
}

/** Evaluate whether a role may be handed out by the bot on a member's request. Fails closed. */
export function assessRoleSafety(input: RoleSafetyInput): RoleSafetyResult {
  const { role, guildId } = input;
  if (
    !/^\d{17,20}$/.test(role.id) ||
    !Number.isFinite(role.position) ||
    !Number.isFinite(input.botHighestPosition)
  ) {
    return { ok: false, reason: 'INVALID', message: T.safetyInvalid() };
  }
  if (role.id === guildId) {
    return { ok: false, reason: 'EVERYONE', message: T.safetyEveryone() };
  }
  if (role.managed) {
    return {
      ok: false,
      reason: 'MANAGED',
      message: T.safetyManaged(),
    };
  }
  if (role.position >= input.botHighestPosition) {
    return {
      ok: false,
      reason: 'HIERARCHY',
      message: T.safetyHierarchy(),
    };
  }
  const dangerous = dangerousPermissionsIn(role.permissions);
  if (dangerous.length > 0) {
    return {
      ok: false,
      reason: 'DANGEROUS_PERMISSIONS',
      message: T.safetyDangerous({ permissions: dangerous.join(', ') }),
      permissions: dangerous,
    };
  }
  const protectedIds = input.protectedRoleIds;
  const isProtected = protectedIds
    ? Array.isArray(protectedIds)
      ? protectedIds.includes(role.id)
      : (protectedIds as ReadonlySet<string>).has(role.id)
    : false;
  if (isProtected) {
    return {
      ok: false,
      reason: 'PROTECTED',
      message: T.safetyProtected(),
    };
  }
  return { ok: true };
}
