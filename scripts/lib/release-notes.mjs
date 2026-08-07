import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scrubPrivateLinks } from './hygiene.mjs';

/**
 * Render channel release notes MDX from a docs-bundle body.
 * Frontmatter is deterministic from channel + tag only (no clock).
 * Body is hygiene-scrubbed so private source-repo links never ship.
 *
 * @param {{channel: 'beta'|'stable', tag: string, body: string}} args
 * @returns {string}
 */
export function renderReleaseNotesMdx({ channel, tag, body }) {
  if (channel !== 'beta' && channel !== 'stable') {
    throw new Error(`release notes channel must be beta|stable, got ${JSON.stringify(channel)}`);
  }
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error(`release notes tag must be a non-empty string, got ${JSON.stringify(tag)}`);
  }
  if (typeof body !== 'string') {
    throw new Error('release notes body must be a string');
  }

  const frontmatter = [
    '---',
    'title: Release notes',
    `description: Release notes for the ${channel} channel (${tag}).`,
    'generated: true',
    '---',
    '',
  ].join('\n');

  const normalizedBody = scrubPrivateLinks(body.trimStart().trimEnd());
  return `${frontmatter}${normalizedBody}\n`;
}

/**
 * Write `reference/release-notes.mdx` under a channel docs root.
 * @param {{channelDir: string, channel: 'beta'|'stable', tag: string, body: string}} args
 */
export async function writeChannelReleaseNotes({ channelDir, channel, tag, body }) {
  const dest = join(channelDir, 'reference', 'release-notes.mdx');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, renderReleaseNotesMdx({ channel, tag, body }));
  return dest;
}
