/**
 * Register slash commands for the configured guild (instant, guild-scoped).
 * Usage: pnpm commands:register  (reads DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID)
 */
import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { loadEnv } from '@gynx/config';
import { buildCommandPayload } from '../framework/commands-json';
import { modules } from '../modules';

const env = loadEnv(
  z.object({
    DISCORD_BOT_TOKEN: z.string().min(50),
    DISCORD_APPLICATION_ID: z.string().regex(/^\d{17,20}$/),
    DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/),
  }),
);

const commands = modules.flatMap((m) => m.commands ?? []);
const payload = buildCommandPayload(commands);

const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);
await rest.put(Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID), { body: payload });
console.log(`Registered ${payload.length} commands: ${payload.map((c) => `/${c.name}`).join(' ')}`);
