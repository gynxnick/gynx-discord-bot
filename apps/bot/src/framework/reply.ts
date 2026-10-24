import { MessageFlags, type InteractionReplyOptions, type RepliableInteraction } from 'discord.js';
import { errorEmbed, infoEmbed, successEmbed } from '@gynx/services';
import { isAppError, toSafeMessage } from '@gynx/shared';

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

/** Safe error reply: AppError messages are user-facing; anything else becomes a generic message + reference. */
export async function replyError(
  i: RepliableInteraction,
  err: unknown,
  correlationId: string,
): Promise<void> {
  const msg = isAppError(err) ? err.message : `${toSafeMessage(err)}\nReference: \`${correlationId}\``;
  try {
    await respond(i, { embeds: [errorEmbed(msg)], ephemeral: true });
  } catch {
    // interaction expired or channel gone — nothing more we can do
  }
}
