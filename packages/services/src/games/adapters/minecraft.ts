import { minecraftPing } from '../minecraft-slp';
import type { GameAdapter } from '../types';

export const minecraftAdapter: GameAdapter = {
  id: 'minecraft',
  name: 'Minecraft: Java Edition',
  aliases: ['mc', 'minecraft java', 'java'],
  developer: 'Mojang Studios',
  officialSite: 'https://www.minecraft.net',
  defaultPort: 25565,
  protocol: 'tcp',
  queryProtocol: 'minecraft-slp',
  typicalPorts: [
    { port: 25565, proto: 'tcp', purpose: 'Game / Server List Ping' },
    { port: 25575, proto: 'tcp', purpose: 'RCON (keep private)' },
  ],
  docsLinks: [
    { label: 'Minecraft Help Center', url: 'https://help.minecraft.net' },
    {
      label: 'Setting up a Java server (wiki)',
      url: 'https://minecraft.wiki/w/Tutorial:Setting_up_a_Java_Edition_server',
    },
    { label: 'server.properties reference', url: 'https://minecraft.wiki/w/Server.properties' },
  ],
  notes: [
    'Client and server versions must match unless the server runs a compatibility plugin.',
    'Modern versions need a recent Java runtime (1.20.5+ requires Java 21).',
    'SRV DNS records are not followed by /minecraft — pass the port if it is not 25565.',
  ],
  queryPorts: (port) => [port ?? 25565],
  async query(address, port, opts) {
    const s = await minecraftPing(address, port, {
      hostname: opts.hostname,
      family: opts.family,
      timeoutMs: opts.timeoutMs,
    });
    return {
      available: true,
      name: null,
      map: null,
      version: s.versionName,
      protocol: s.protocol,
      playersOnline: s.playersOnline,
      playersMax: s.playersMax,
      motd: s.motd,
      latencyMs: s.latencyMs,
      queryPort: port,
    };
  },
};
