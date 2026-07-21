import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promoteToStable } from './lib/promote.mjs';

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

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'promote-test-'));
  // Stale stable tree with a file that must disappear after whole-copy.
  const stableDir = join(repoRoot, 'content', 'docs', 'stable', 'getting-started');
  await mkdir(stableDir, { recursive: true });
  await writeFile(join(stableDir, 'removed-guide.mdx'), '---\ntitle: gone\n---\n');
  await writeFile(
    join(repoRoot, 'channels.json'),
    JSON.stringify({ stable: { version: null }, beta: { version: '0.42.0-beta.7' } }, null, 2) + '\n',
  );
  // A channel-neutral beta source tree (as checked out from docs/{promotedFrom}).
  betaSource = await mkdtemp(join(tmpdir(), 'beta-src-'));
  await mkdir(join(betaSource, 'getting-started'), { recursive: true });
  await writeFile(join(betaSource, 'index.mdx'), '---\ntitle: Introduction\n---\nSee [install](./getting-started/installation).\n');
  await writeFile(join(betaSource, 'getting-started', 'installation.mdx'), '---\ntitle: Installation\n---\nInstall it.\n');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await rm(betaSource, { recursive: true, force: true });
});

test('promote whole-copies beta into stable and updates channels.json', async () => {
  const res = await promoteToStable({ repoRoot, betaSourceDir: betaSource, manifest: stableManifest });
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

test('promotion aborts if content is not channel-neutral', async () => {
  await writeFile(
    join(betaSource, 'getting-started', 'installation.mdx'),
    '---\ntitle: Installation\n---\nSee the [beta guide](/docs/beta/guides/updating).\n',
  );
  await assert.rejects(
    () => promoteToStable({ repoRoot, betaSourceDir: betaSource, manifest: stableManifest }),
    /channel-neutral/,
  );
});

test('a beta manifest is refused by promote', async () => {
  await assert.rejects(
    () => promoteToStable({ repoRoot, betaSourceDir: betaSource, manifest: { ...stableManifest, channel: 'beta', tag: 'v0.42.0-beta.7' } }),
    /channel mismatch/,
  );
});
