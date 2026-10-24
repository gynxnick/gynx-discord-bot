import type { APIEmbed, APIEmbedField } from 'discord-api-types/v10';
import { BRAND, EMBED_COLORS, truncate } from '@gynx/shared';

/**
 * Branded embed builder producing plain Discord API JSON, usable from the bot
 * (discord.js accepts APIEmbed) and from REST-only processes (worker, dashboard).
 * Discord limits: title 256, description 4096, 25 fields, field value 1024.
 */
export interface BrandEmbedInput {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  url?: string;
  timestamp?: Date;
  imageUrl?: string;
  thumbnailUrl?: string;
}

export function brandEmbed(input: BrandEmbedInput): APIEmbed {
  const fields: APIEmbedField[] = (input.fields ?? []).slice(0, 25).map((f) => ({
    name: truncate(f.name || '​', 256),
    value: truncate(f.value || '​', 1024),
    inline: f.inline ?? false,
  }));
  return {
    title: input.title ? truncate(input.title, 256) : undefined,
    description: input.description ? truncate(input.description, 4096) : undefined,
    color: input.color ?? EMBED_COLORS.primary,
    url: input.url,
    fields: fields.length ? fields : undefined,
    footer: { text: truncate(input.footer ?? BRAND.name, 2048) },
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    image: input.imageUrl ? { url: input.imageUrl } : undefined,
    thumbnail: input.thumbnailUrl ? { url: input.thumbnailUrl } : undefined,
  };
}

export const errorEmbed = (message: string): APIEmbed =>
  brandEmbed({ title: 'Something went wrong', description: message, color: EMBED_COLORS.danger });

export const successEmbed = (title: string, description?: string): APIEmbed =>
  brandEmbed({ title, description, color: EMBED_COLORS.success });

export const infoEmbed = (title: string, description?: string): APIEmbed => brandEmbed({ title, description });
