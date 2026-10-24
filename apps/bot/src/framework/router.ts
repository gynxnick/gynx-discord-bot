import { randomUUID } from 'node:crypto';
import type { Interaction } from 'discord.js';
import { COMMAND_POLICIES } from '@gynx/permissions';
import { audit, isModuleEnabled, type Ctx } from '@gynx/services';
import { AppError, forbidden, isAppError, moduleDisabled, rateLimited } from '@gynx/shared';
import { ctxForInteraction } from './actor';
import { replyError } from './reply';
import type { BotModule, BotRuntime, ComponentHandler, HandlerCtx, SlashCommand } from './types';

const GLOBAL_LIMIT: [number, number] = [30, 60]; // per user, across all interactions

export class InteractionRouter {
  private readonly commands = new Map<string, SlashCommand>();
  private readonly components = new Map<string, ComponentHandler>();

  constructor(
    private readonly rt: BotRuntime,
    modules: BotModule[],
  ) {
    for (const m of modules) {
      for (const c of m.commands ?? []) {
        if (this.commands.has(c.data.name)) throw new Error(`Duplicate command: ${c.data.name}`);
        if (!COMMAND_POLICIES[c.data.name])
          throw new Error(`Command /${c.data.name} has no COMMAND_POLICIES entry`);
        this.commands.set(c.data.name, c);
      }
      for (const h of m.components ?? []) {
        if (this.components.has(h.prefix)) throw new Error(`Duplicate component prefix: ${h.prefix}`);
        this.components.set(h.prefix, h);
      }
    }
  }

  get commandList(): SlashCommand[] {
    return [...this.commands.values()];
  }

  async handle(i: Interaction): Promise<void> {
    const correlationId = randomUUID().slice(0, 8);
    const log = this.rt.log.child({ correlationId, userId: i.user.id, interaction: i.type });

    // Only the configured guild; no DMs. Keeps dev/prod isolated and prevents use elsewhere.
    if (!i.inCachedGuild() || i.guildId !== this.rt.env.DISCORD_GUILD_ID) {
      if (i.isRepliable())
        await replyError(
          i,
          new AppError('FORBIDDEN', 'This bot only works inside the GYNX.GG server.'),
          correlationId,
        );
      return;
    }

    let ctx: Ctx | null = null;
    try {
      ctx = await ctxForInteraction(this.rt, i, correlationId);
      if (!ctx) return;
      const h: HandlerCtx = { rt: this.rt, ctx, correlationId };

      const global = await this.rt.deps.rateLimiter.consume(`${i.guildId}:${i.user.id}:*`, ...GLOBAL_LIMIT);
      if (!global.allowed) throw rateLimited(global.retryAfterSeconds);

      if (i.isChatInputCommand() || i.isAutocomplete()) {
        const cmd = this.commands.get(i.commandName);
        if (!cmd) throw new AppError('NOT_FOUND', 'Unknown command.');
        if (i.isAutocomplete()) {
          if (cmd.autocomplete) await cmd.autocomplete(i, h);
          return;
        }
        await this.enforcePolicy(ctx, i.commandName, cmd.module);
        log.info({ command: i.commandName, sub: i.options.getSubcommand(false) }, 'command');
        await cmd.execute(i, h);
        return;
      }

      if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) {
        const [prefix, ...args] = i.customId.split(':');
        const handler = prefix ? this.components.get(prefix) : undefined;
        if (!handler) throw new AppError('NOT_FOUND', 'This control is no longer active.');
        if (handler.module !== 'core' && !(await isModuleEnabled(ctx.db, ctx.guildId, handler.module))) {
          throw moduleDisabled(handler.module);
        }
        const r = await this.rt.deps.rateLimiter.consume(`${i.guildId}:${i.user.id}:c:${prefix}`, 20, 60);
        if (!r.allowed) throw rateLimited(r.retryAfterSeconds);
        log.debug({ component: prefix, action: args[0] }, 'component');
        await handler.handle(i as never, args, h);
      }
    } catch (err) {
      if (isAppError(err) && err.code !== 'INTERNAL')
        log.info({ code: err.code, msg: err.message }, 'interaction rejected');
      else log.error({ err }, 'interaction failed');
      if (i.isRepliable()) await replyError(i, err, correlationId);
    }
  }

  /** Central gate: module enabled → rate limit → permission. Services re-check permissions. */
  private async enforcePolicy(ctx: Ctx, name: string, module: SlashCommand['module']): Promise<void> {
    const policy = COMMAND_POLICIES[name];
    if (!policy) throw forbidden(); // fail closed
    if (module !== 'core' && !(await isModuleEnabled(ctx.db, ctx.guildId, module)))
      throw moduleDisabled(module);
    if (policy.rateLimit) {
      const [limit, window] = policy.rateLimit;
      const r = await ctx.rateLimiter.consume(
        `${ctx.guildId}:${ctx.actor.userId}:cmd:${name}`,
        limit,
        window,
      );
      if (!r.allowed) throw rateLimited(r.retryAfterSeconds);
    }
    if (policy.permission && !ctx.actor.permissions.has(policy.permission)) {
      await audit(ctx, {
        action: `command.${name}`,
        result: 'DENIED',
        metadata: { required: policy.permission },
      });
      throw forbidden();
    }
  }
}
