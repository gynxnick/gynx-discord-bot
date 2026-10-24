import { notFound } from '@gynx/shared';
import { gmodAdapter } from './adapters/gmod';
import { minecraftAdapter } from './adapters/minecraft';
import { palworldAdapter } from './adapters/palworld';
import { rustAdapter } from './adapters/rust';
import { valheimAdapter } from './adapters/valheim';
import type { GameAdapter } from './types';

/**
 * Supported games. Adding a game = add an adapter file in ./adapters and list it here.
 * Order is the display order of command choices.
 */
const ADAPTERS: readonly GameAdapter[] = [minecraftAdapter, rustAdapter, palworldAdapter, valheimAdapter, gmodAdapter];

const byKey = new Map<string, GameAdapter>();
for (const a of ADAPTERS) {
  for (const key of [a.id, a.name, ...a.aliases]) byKey.set(key.toLowerCase(), a);
}

export function listGames(): readonly GameAdapter[] {
  return ADAPTERS;
}

export const GAME_IDS = ADAPTERS.map((a) => a.id);

/** Discord option choices built from the registry. */
export function gameChoices(): Array<{ name: string; value: string }> {
  return ADAPTERS.map((a) => ({ name: a.name, value: a.id }));
}

export function findGame(idOrAlias: string): GameAdapter | undefined {
  return byKey.get(idOrAlias.trim().toLowerCase());
}

export function getGame(idOrAlias: string): GameAdapter {
  const g = findGame(idOrAlias);
  if (!g) throw notFound('That game');
  return g;
}
