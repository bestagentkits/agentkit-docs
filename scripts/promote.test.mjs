import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promoteToStable } from './lib/promote.mjs';

const stableBundleDir = fileURLToPath(new URL('../fixtures/docs-bundle-stable', import.meta.url));

const stableManifest = {
  schemaVersion: 1,
  channel: 'stable',
  tag: 'v0.42.0',
  sha: '1a2b3c4d5e6f7890abcdef1234567890abcdef12',
  version: '0.42.0',
  generatedAt: '2026-07-21T00:00:00Z',
  promotedFrom: 'v0.42.0-beta.7',
};

let repoRoot;
let betaSource;

async function snapshot(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = {};
  for (const e of entries) {
    if (e.isFile()) {
      const full = join(e.parentPath ?? e.path, e.name);
      files[full.slice(dir.length)] = await readFile(full, 'utf8');
    }
  }
  return files;
}

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'promote-test-'));
  // Stale stable tree with a file that must disappear after whole-copy.
  const stableDir = join(repoRoot, 'content', 'docs', 'stable', 'getting-started');
  await mkdir(stableDir, { recursive: true });
  await writeFile(join(stableDir, 'removed-guide.mdx'), '---\ntitle: gone\n---\n');
  // Pre-existing stable release notes that must be replaced (not left stale).
  await mkdir(join(repoRoot, 'content', 'docs', 'stable', 'reference'), { recursive: true });
  await writeFile(
    join(repoRoot, 'content', 'docs', 'stable', 'reference', 'release-notes.mdx'),
    '---\ntitle: Release notes\ndescription: Release notes for the stable channel (v0.41.0).\ngenerated: true\n---\nold stable notes\n',
  );
  await writeFile(
    join(repoRoot, 'channels.json'),
    JSON.stringify({ stable: { version: null }, beta: { version: '0.42.0-beta.7' } }, null, 2) + '\n',
  );
  // A channel-neutral beta source tree (as checked out from docs/{promotedFrom}).
  // Includes beta release-note metadata that must NOT survive on stable.
  betaSource = await mkdtemp(join(tmpdir(), 'beta-src-'));
  await mkdir(join(betaSource, 'getting-started'), { recursive: true });
  await mkdir(join(betaSource, 'reference'), { recursive: true });
  await writeFile(join(betaSource, 'index.mdx'), '---\ntitle: Introduction\n---\nSee [install](./getting-started/installation).\n');
  await writeFile(join(betaSource, 'getting-started', 'installation.mdx'), '---\ntitle: Installation\n---\nInstall it.\n');
  await writeFile(
    join(betaSource, 'reference', 'release-notes.mdx'),
    [
      '---',
      'title: Release notes',
      'description: Release notes for the beta channel (v0.42.0-beta.7).',
      'generated: true',
      '---',
      '# v0.42.0-beta.7',
      '',
      'Automated beta release cut after a green build.',
      '',
    ].join('\n'),
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await rm(betaSource, { recursive: true, force: true });
});

test('promote whole-copies beta into stable and updates channels.json', async () => {
  const res = await promoteToStable({
    repoRoot,
    betaSourceDir: betaSource,
    manifest: stableManifest,
    bundleDir: stableBundleDir,
  });
  assert.equal(res.tag, 'v0.42.0');
  assert.equal(res.promotedFrom, 'v0.42.0-beta.7');

  const stableDir = join(repoRoot, 'content', 'docs', 'stable');
  assert.ok(existsSync(join(stableDir, 'index.mdx')));
  assert.ok(existsSync(join(stableDir, 'getting-started', 'installation.mdx')));
  // Whole-copy: the stale stable-only file is gone.
  assert.ok(!existsSync(join(stableDir, 'getting-started', 'removed-guide.mdx')));

  const channels = JSON.parse(await readFile(join(repoRoot, 'channels.json'), 'utf8'));
  assert.deepEqual(channels.stable, {
    version: '0.42.0',
    tag: 'v0.42.0',
    sha: '1a2b3c4d5e6f7890abcdef1234567890abcdef12',
    syncedAt: '2026-07-21T00:00:00Z',
  });
  assert.deepEqual(channels.beta, { version: '0.42.0-beta.7' }, 'beta channel untouched');
});

test('stable release notes use stable channel metadata, not copied beta notes', async () => {
  await promoteToStable({
    repoRoot,
    betaSourceDir: betaSource,
    manifest: stableManifest,
    bundleDir: stableBundleDir,
  });

  const notes = await readFile(
    join(repoRoot, 'content', 'docs', 'stable', 'reference', 'release-notes.mdx'),
    'utf8',
  );
  assert.match(notes, /^---\ntitle: Release notes\n/);
  assert.match(notes, /description: Release notes for the stable channel \(v0\.42\.0\)\./);
  assert.match(notes, /generated: true/);
  assert.match(notes, /Promoted from v0\.42\.0-beta\.7/);
  assert.match(notes, /ak kit init --channel/);

  // Stale beta frontmatter/title must not survive promotion.
  assert.doesNotMatch(notes, /beta channel/);
  assert.doesNotMatch(notes, /v0\.42\.0-beta\.7\)/); // description tag paren form
  assert.doesNotMatch(notes, /Automated beta release/);
  assert.doesNotMatch(notes, /old stable notes/);
  assert.ok(notes.endsWith('\n'), 'release notes end with one newline');
  assert.ok(!notes.endsWith('\n\n'), 'release notes do not preserve trailing blank lines');

  // Beta source tree is never mutated.
  const betaNotes = await readFile(join(betaSource, 'reference', 'release-notes.mdx'), 'utf8');
  assert.match(betaNotes, /beta channel \(v0\.42\.0-beta\.7\)/);
});

test('re-promoting the same stable bundle is idempotent', async () => {
  const args = {
    repoRoot,
    betaSourceDir: betaSource,
    manifest: stableManifest,
    bundleDir: stableBundleDir,
  };
  await promoteToStable(args);
  const before = await snapshot(repoRoot);
  await promoteToStable(args);
  const after = await snapshot(repoRoot);
  assert.deepEqual(after, before);
});

test('promotion aborts if content is not channel-neutral', async () => {
  await writeFile(
    join(betaSource, 'getting-started', 'installation.mdx'),
    '---\ntitle: Installation\n---\nSee the [beta guide](/docs/beta/guides/updating).\n',
  );
  await assert.rejects(
    () => promoteToStable({
      repoRoot,
      betaSourceDir: betaSource,
      manifest: stableManifest,
      bundleDir: stableBundleDir,
    }),
    /channel-neutral/,
  );
});

test('a beta manifest is refused by promote', async () => {
  await assert.rejects(
    () => promoteToStable({
      repoRoot,
      betaSourceDir: betaSource,
      manifest: { ...stableManifest, channel: 'beta', tag: 'v0.42.0-beta.7' },
      bundleDir: stableBundleDir,
    }),
    /channel mismatch/,
  );
});

test('missing bundleDir is refused', async () => {
  await assert.rejects(
    () => promoteToStable({ repoRoot, betaSourceDir: betaSource, manifest: stableManifest }),
    /bundleDir is required/,
  );
});
