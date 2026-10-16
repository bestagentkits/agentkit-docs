// Channel identity of the source tree.
//
// Each channel root (`content/docs/<channel>/meta.json` and its `.vi` variant)
// carries the navigation label rendered in breadcrumbs and search result
// breadcrumbs. Those files are copied verbatim by the whole-copy promotion
// pipeline, so the copied label describes the channel it was copied *from*: a
// promoted Stable root still says "Beta" (AGENTS.md forbids hand-editing
// Stable content, and a receipt-bound promotion would revert an edit anyway).
//
// The display label is therefore derived from the real source path in the
// source-adapter pipeline instead of trusting the copied value.

import { SEARCH_CHANNELS } from './search-scopes.mjs';

export const CHANNEL_ROOT_TITLES = Object.freeze({
  stable: 'Stable',
  beta: 'Beta',
});

const CHANNEL_ROOT_META = /^(stable|beta)\/meta(?:\.vi)?\.json$/;

// Channel whose root metadata a source path is, or `null` for every other file.
export function channelRootFromSourcePath(path) {
  const match = typeof path === 'string' ? path.match(CHANNEL_ROOT_META) : null;
  return match ? match[1] : null;
}

export function channelRootTitle(channel) {
  return SEARCH_CHANNELS.includes(channel) ? CHANNEL_ROOT_TITLES[channel] : null;
}

// Project channel-root metadata onto the label owned by the path's channel.
// Returns the metadata to store, or `null` when the file is not a channel root
// or already carries the correct label.
export function normalizeChannelRootMeta(path, data) {
  const channel = channelRootFromSourcePath(path);
  if (!channel) return null;

  const title = channelRootTitle(channel);
  if (data?.title === title) return null;

  return { ...data, title };
}
