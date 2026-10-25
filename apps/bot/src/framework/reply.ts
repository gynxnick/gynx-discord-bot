import { MessageFlags, type InteractionReplyOptions, type RepliableInteraction } from 'discord.js';
import { CoreText, errorEmbed, infoEmbed, successEmbed } from '@gynx/services';
import { DEFAULT_FORBIDDEN_MESSAGE, isAppError } from '@gynx/shared';

const NO_PINGS = { parse: [] as never[] };

/** Reply or follow up depending on interaction state. Ephemeral by default, never pings. */
export async function respond(
  i: RepliableInteraction,
  opts: InteractionReplyOptions & { ephemeral?: boolean },
): Promise<void> {
  const { ephemeral = true, ...rest } = opts;
  const payload = {
    allowedMentions: NO_PINGS,
    ...rest,
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  } as InteractionReplyOptions;
  if (i.deferred && !i.replied) {
    const { flags: _f, ...edit } = payload;
    await i.editReply(edit as never);
  } else if (i.replied) {
    await i.followUp(payload);
  } else {
    await i.reply(payload);
  }
}

export const replySuccess = (
  i: RepliableInteraction,
  title: string,
  description?: string,
  ephemeral = true,
) => respond(i, { embeds: [successEmbed(title, description)], ephemeral });

export const replyInfo = (i: RepliableInteraction, title: string, description?: string, ephemeral = true) =>
  respond(i, { embeds: [infoEmbed(title, description)], ephemeral });

/** The member-facing wording for an error, using the server's custom bot text where one applies. */
export function userFacingError(err: unknown, correlationId: string): string {
  if (!isAppError(err) || err.code === 'INTERNAL') return CoreText.genericError({ reference: correlationId });
  const d = err.details ?? {};
  if (err.code === 'RATE_LIMITED')
    return CoreText.rateLimited({ seconds: String(d.retryAfterSeconds ?? '') });
  if (err.code === 'MODULE_DISABLED' && typeof d.module === 'string') {
    return CoreText.moduleDisabled({ module: d.module });
  }
  if (err.code === 'FORBIDDEN' && err.message === DEFAULT_FORBIDDEN_MESSAGE) return CoreText.forbidden();
  return err.message;
}

/** Safe error reply: AppError messages are user-facing; anything else becomes a generic message + reference. */
export async function replyError(
  i: RepliableInteraction,
  err: unknown,
  correlationId: string,
): Promise<void> {
  const msg = userFacingError(err, correlationId);
  try {
    await respond(i, { embeds: [errorEmbed(msg)], ephemeral: true });
  } catch {
    // interaction expired or channel gone — nothing more we can do
  }
}
