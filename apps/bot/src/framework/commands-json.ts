import { PermissionFlagsBits } from 'discord.js';
import { COMMAND_POLICIES } from '@gynx/permissions';
import type { SlashCommand } from './types';

/**
 * Build the registration payload. Staff commands get Discord-native
 * `default_member_permissions` so they are hidden from regular members, and
 * every command is guild-only (contexts: [0] = GUILD). Server-side checks in
 * the router and services remain authoritative.
 */
export function buildCommandPayload(commands: SlashCommand[]) {
  return commands.map((c) => {
    const policy = COMMAND_POLICIES[c.data.name];
    const flag = policy?.discordDefault ? PermissionFlagsBits[policy.discordDefault] : undefined;
    return {
      ...c.data,
      default_member_permissions: flag !== undefined ? flag.toString() : c.data.default_member_permissions ?? null,
      contexts: [0],
    };
  });
}
