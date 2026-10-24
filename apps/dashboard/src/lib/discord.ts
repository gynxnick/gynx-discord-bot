/** Discord avatar CDN URL, only for well-formed ids and hashes (never user-controlled URLs). */
export function avatarUrl(userId: string, avatar: string | null | undefined, size = 64): string | null {
  if (!avatar || !/^(a_)?[a-f0-9]{32}$/.test(avatar) || !/^\d{17,20}$/.test(userId)) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=${size}`;
}

export const isSnowflake = (v: unknown): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v);
