import channels from '@/channels.json';

// Pipeline state: repo-root `channels.json` records the released version each
// channel's docs describe. It stays `null` until the release-sync pipeline
// writes the first version, so every read must be null-safe.
export type ChannelId = 'stable' | 'beta';

export function getChannelVersion(channel: ChannelId): string | null {
  return channels[channel]?.version ?? null;
}

// Derive the channel from a docs page's slug segments (`['beta', ...]`).
export function channelFromSlug(slug: string[] | undefined): ChannelId | null {
  const head = slug?.[0];
  return head === 'stable' || head === 'beta' ? head : null;
}
