import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { validateManifest } from './manifest.mjs';
import { writeChannelReleaseNotes } from './release-notes.mjs';
import { worktreeChannelInventory } from './stable-promotion.mjs';

// Stable promotion. A stable release is a WHOLE-COPY of the exact beta docs tree
// it was promoted from (`manifest.promotedFrom`), checked out by the caller into
// `betaSourceDir`. The copy is delete-then-write so files removed upstream vanish
// from stable. Content is channel-neutral by design (channel identity is
// path-keyed in the layout, not baked into pages), so there is nothing to strip —
// this is asserted, never guessed.
//
// After the whole-copy, release notes are the one intentional channel-specific
// artifact: they are rewritten from the stable bundle's `release-notes.md` via
// the shared release-note renderer (same frontmatter + hygiene as beta sync).
// Leaving the copied beta notes would ship stale "beta channel (vX-beta.N)"
// metadata on the stable site.

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n');
}

function assertSourceDoesNotOverlapStable(repoRoot, betaSourceDir) {
  const source = resolve(betaSourceDir);
  const stable = resolve(repoRoot, 'content', 'docs', 'stable');
  const sourceFromStable = relative(stable, source);
  const stableFromSource = relative(source, stable);
  const nested = (value) => value !== '' && value !== '..' && !value.startsWith(`..${sep}`);
  if (source === stable || nested(sourceFromStable) || nested(stableFromSource)) {
    throw new Error('betaSourceDir must not equal, contain, or be contained by the Stable destination');
  }
}

// The promotion invariant: a promoted stable tree must contain no beta-only
// artifact. A hardcoded `/docs/beta/` link is the one that would survive a
// whole-copy and mislead readers, so we scan for it and fail loud.
async function assertChannelNeutral(dir) {
  const offenders = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (!e.isFile() || !/\.mdx?$/.test(e.name)) continue;
    const full = join(e.parentPath ?? e.path, e.name);
    const text = await readFile(full, 'utf8');
    if (text.includes('/docs/beta/')) offenders.push(full);
  }
  if (offenders.length) {
    throw new Error(
      `promotion aborted: beta-only links found in promoted content (must be channel-neutral):\n  ${offenders.join('\n  ')}`,
    );
  }
}

/**
 * Promote a beta docs tree into the stable channel.
 * @param {{repoRoot: string, betaSourceDir: string, manifest: object, bundleDir: string, releaseNotesSourceBytes?: Buffer}} args
 *   betaSourceDir: a checkout of `content/docs/beta/` at tag docs/{promotedFrom}
 *   bundleDir: stable docs-bundle directory (manifest + release-notes.md)
 * @returns {Promise<{tag:string, promotedFrom:string, version:string}>}
 */
export async function promoteToStable({ repoRoot, betaSourceDir, manifest, bundleDir, releaseNotesSourceBytes }) {
  const m = validateManifest(manifest, { expectedChannel: 'stable' });
  const { tag, sha, version, generatedAt, promotedFrom } = m;
  if (!bundleDir) {
    throw new Error('bundleDir is required (stable docs-bundle with release-notes.md)');
  }

  const stableDir = join(repoRoot, 'content', 'docs', 'stable');
  assertSourceDoesNotOverlapStable(repoRoot, betaSourceDir);

  // Reject unsafe entries and channel-specific source prose before the first
  // destructive write.
  await worktreeChannelInventory(repoRoot, 'beta', betaSourceDir);
  await assertChannelNeutral(betaSourceDir);

  // Whole-copy beta tree → stable (delete-then-copy; includes generated dirs).
  await rm(stableDir, { recursive: true, force: true });
  await cp(betaSourceDir, stableDir, { recursive: true });

  // Overwrite the copied beta release notes with the stable bundle body and
  // stable channel/tag frontmatter. Beta tree is left untouched on disk.
  const notesBytes = releaseNotesSourceBytes ?? await readFile(join(bundleDir, 'release-notes.md'));
  let notes;
  try {
    notes = new TextDecoder('utf-8', { fatal: true }).decode(notesBytes);
  } catch {
    throw new Error('release-notes.md must be valid UTF-8');
  }
  await writeChannelReleaseNotes({
    channelDir: stableDir,
    channel: 'stable',
    tag,
    body: notes,
  });

  await assertChannelNeutral(stableDir);

  // channels.json.stable only — beta is left untouched.
  const channelsPath = join(repoRoot, 'channels.json');
  const channels = await readJson(channelsPath);
  channels.stable = { version, tag, sha, syncedAt: generatedAt };
  await writeJson(channelsPath, channels);

  return { tag, promotedFrom, version };
}
