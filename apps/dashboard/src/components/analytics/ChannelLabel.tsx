'use client';

import { useGuildChannels } from './channels';

/** "#name" when the channel list is available, otherwise the raw channel ID. */
export function ChannelLabel({ id }: { id: string }) {
  const { channels } = useGuildChannels();
  const ch = channels.find((c) => c.id === id);
  return ch ? (
    <span>
      <span className="text-fg">#{ch.name}</span>{' '}
      <span className="font-mono text-xs text-fg-muted">{id}</span>
    </span>
  ) : (
    <span className="font-mono text-xs">{id}</span>
  );
}
