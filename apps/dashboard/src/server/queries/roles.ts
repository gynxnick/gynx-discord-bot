import 'server-only';
import type { DiscordPort } from '@gynx/services';
import { AppError } from '@gynx/shared';

export interface RoleOption {
  id: string;
  name: string;
  position: number;
  managed: boolean;
}

/** Guild roles (highest first) without @everyone. Throws INTEGRATION if Discord is unavailable. */
export async function listGuildRoles(
  discord: DiscordPort | undefined,
  guildId: string,
): Promise<RoleOption[]> {
  if (!discord) throw new AppError('INTEGRATION', 'Discord is not configured for the dashboard.');
  let roles;
  try {
    roles = await discord.listRoles(guildId);
  } catch (err) {
    throw new AppError('INTEGRATION', 'Could not load roles from Discord. Try again shortly.', undefined, {
      cause: err,
    });
  }
  return roles
    .filter((r) => r.id !== guildId)
    .map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed }))
    .sort((a, b) => b.position - a.position);
}
