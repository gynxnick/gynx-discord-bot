/** Pure helpers shared by the pickers (no React; unit tested). */

export interface ChannelOption {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

export interface RoleOption {
  id: string;
  name: string;
  position: number;
  managed: boolean;
}

const CATEGORY = 4;
const POSTABLE = new Set([0, 5]);

export interface ChannelGroup {
  key: string;
  /** Category name, or null for channels without a category. */
  label: string | null;
  channels: ChannelOption[];
}

/**
 * Group postable channels (text + announcement) under their category, keeping
 * Discord's order as received; uncategorised channels come first.
 */
export function groupChannels(all: readonly ChannelOption[]): ChannelGroup[] {
  const categories = all.filter((c) => c.type === CATEGORY);
  const postable = all.filter((c) => POSTABLE.has(c.type));
  const groups: ChannelGroup[] = [];
  const loose = postable.filter((c) => !c.parentId || !categories.some((k) => k.id === c.parentId));
  if (loose.length) groups.push({ key: 'none', label: null, channels: loose });
  for (const cat of categories) {
    const inCat = postable.filter((c) => c.parentId === cat.id);
    if (inCat.length) groups.push({ key: cat.id, label: cat.name, channels: inCat });
  }
  return groups;
}

export function channelName(
  channels: readonly ChannelOption[] | null | undefined,
  id: string | null | undefined,
): string {
  if (!id) return '—';
  const c = channels?.find((x) => x.id === id);
  return c ? `#${c.name}` : id;
}

export function roleName(
  roles: readonly RoleOption[] | null | undefined,
  id: string | null | undefined,
): string {
  if (!id) return '—';
  const r = roles?.find((x) => x.id === id);
  return r ? `@${r.name}` : id;
}
