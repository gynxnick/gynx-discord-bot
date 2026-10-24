'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';

export interface GuildChannel {
  id: string;
  name: string;
  type?: string | number;
}

type State = { status: 'loading' | 'ready' | 'unavailable'; channels: GuildChannel[] };

// One request per page load, shared by every consumer.
let pending: Promise<GuildChannel[] | null> | null = null;

function normalise(raw: unknown): GuildChannel[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { channels?: unknown }).channels)
      ? (raw as { channels: unknown[] }).channels
      : null;
  if (!list) return null;
  return list
    .filter((c): c is { id: string; name: string; type?: string | number } => {
      const o = c as Record<string, unknown>;
      return typeof o?.id === 'string' && /^\d{17,20}$/.test(o.id) && typeof o.name === 'string';
    })
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

/**
 * Channel names from GET /api/discord/channels (owned by another section).
 * Resolves to `unavailable` when the route is missing or the viewer lacks access —
 * callers then fall back to showing raw IDs / a manual ID input.
 */
export function useGuildChannels(): State {
  const { api } = useSession();
  const [state, setState] = useState<State>({ status: 'loading', channels: [] });
  useEffect(() => {
    let alive = true;
    pending ??= api<unknown>('/api/discord/channels')
      .then(normalise)
      .catch(() => null);
    void pending.then((channels) => {
      if (!alive) return;
      setState(channels ? { status: 'ready', channels } : { status: 'unavailable', channels: [] });
      if (!channels) pending = null;
    });
    return () => {
      alive = false;
    };
  }, [api]);
  return state;
}
