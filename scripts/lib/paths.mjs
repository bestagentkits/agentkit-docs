import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root is two levels up from scripts/lib/. Resolving from the module URL
// (not process.cwd()) means the scripts work regardless of the caller's cwd.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const docsDir = join(repoRoot, 'content', 'docs');
export const channelsPath = join(repoRoot, 'channels.json');

export function channelDir(root, channel) {
  return join(root, 'content', 'docs', channel);
}
