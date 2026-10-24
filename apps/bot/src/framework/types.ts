import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
} from 'discord.js';
import type { BotEnv, Logger } from '@gynx/config';
import type { Ctx, ModuleKey, ServiceDeps } from '@gynx/services';

/** Process-wide dependencies available to every handler. */
export interface BotRuntime {
  client: Client;
  env: BotEnv;
  deps: ServiceDeps;
  log: Logger;
}

/** Per-interaction context: service Ctx (with resolved Actor) + runtime. */
export interface HandlerCtx {
  rt: BotRuntime;
  /** Service context for the invoking member — services enforce permissions with it. */
  ctx: Ctx;
  correlationId: string;
}

export interface SlashCommand {
  /** Built with SlashCommandBuilder(...).toJSON(). Name must have a COMMAND_POLICIES entry. */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Module that must be enabled for this guild ('core' = always on). */
  module: ModuleKey | 'core';
  execute(i: ChatInputCommandInteraction, h: HandlerCtx): Promise<void>;
  autocomplete?(i: AutocompleteInteraction, h: HandlerCtx): Promise<void>;
}

export type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ModalSubmitInteraction;

/**
 * Handles buttons/selects/modals whose customId starts with `${prefix}:`.
 * customId format: `<prefix>:<action>[:<arg>...]` (max 100 chars). Never put
 * secrets or trust-relevant data in customIds — always re-validate server-side.
 */
export interface ComponentHandler {
  prefix: string;
  module: ModuleKey | 'core';
  handle(i: ComponentInteraction, args: string[], h: HandlerCtx): Promise<void>;
}

/** Stored with an erased signature; declare listeners with `on()` to get typed event args. */
export interface EventListener {
  event: keyof ClientEvents;
  run(rt: BotRuntime, ...args: unknown[]): Promise<void>;
}

export interface BotModule {
  name: string;
  commands?: SlashCommand[];
  components?: ComponentHandler[];
  events?: EventListener[];
}

/** Helper preserving the event-arg typing when declaring listeners. */
export function on<K extends keyof ClientEvents>(
  event: K,
  run: (rt: BotRuntime, ...args: ClientEvents[K]) => Promise<void>,
): EventListener {
  return { event, run } as unknown as EventListener;
}
