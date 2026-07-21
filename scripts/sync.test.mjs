import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBetaRelease } from './lib/sync.mjs';

const bundleDir = fileURLToPath(new URL('../fixtures/docs-bundle-beta', import.meta.url));
let repoRoot;

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
  repoRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
  const cliDir = join(repoRoot, 'content', 'docs', 'beta', 'reference', 'cli');
  await mkdir(cliDir, { recursive: true });
  // Pre-existing stale generated files that a sync must wipe.
  await writeFile(join(cliDir, '.generated'), '{"stale":true}\n');
  await writeFile(join(cliDir, 'ak_removed_command.mdx'), '---\ntitle: gone\n---\n');
  // Human-owned nav config co-located in the generated dir — must SURVIVE sync.
  await writeFile(join(cliDir, 'meta.json'), '{"title":"CLI commands"}\n');
  await writeFile(join(cliDir, 'meta.vi.json'), '{"title":"Lệnh CLI"}\n');
  await writeFile(
    join(repoRoot, 'content', 'docs', 'beta', 'reference', 'release-notes.mdx'),
    '---\ntitle: old\n---\nold notes\n',
  );
  await writeFile(
    join(repoRoot, 'channels.json'),
    JSON.stringify({ stable: { version: null }, beta: { version: null } }, null, 2) + '\n',
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

test('sync applies the beta bundle and reports a summary', async () => {
  const res = await syncBetaRelease({ repoRoot, bundleDir });
  assert.equal(res.channel, 'beta');
  assert.equal(res.tag, 'v0.42.0-beta.7');
  assert.ok(res.referenceFiles >= 4);

  const cliDir = join(repoRoot, 'content', 'docs', 'beta', 'reference', 'cli');
  assert.ok(existsSync(join(cliDir, 'index.mdx')));
  assert.ok(existsSync(join(cliDir, 'ak_kit_init.mdx')));
  // Wholesale replace: the stale generated page is gone...
  assert.ok(!existsSync(join(cliDir, 'ak_removed_command.mdx')));
  // ...but human-owned nav meta is preserved (regression: sync must not wipe it).
  assert.equal(await readFile(join(cliDir, 'meta.json'), 'utf8'), '{"title":"CLI commands"}\n');
  assert.equal(await readFile(join(cliDir, 'meta.vi.json'), 'utf8'), '{"title":"Lệnh CLI"}\n');

  const marker = JSON.parse(await readFile(join(cliDir, '.generated'), 'utf8'));
  assert.equal(marker.tag, 'v0.42.0-beta.7');
  assert.equal(marker.sha, '1a2b3c4d5e6f7890abcdef1234567890abcdef12');
  assert.equal(marker.generatedAt, '2026-07-20T00:00:00Z');
  assert.equal(marker.source, 'ak-cli');
  assert.ok(!('channel' in marker), 'marker must be channel-neutral for promotion');

  const notes = await readFile(
    join(repoRoot, 'content', 'docs', 'beta', 'reference', 'release-notes.mdx'),
    'utf8',
  );
  assert.match(notes, /^---\ntitle: Release notes/);
  assert.match(notes, /generated: true/);
  assert.match(notes, /Automated beta release/);

  const channels = JSON.parse(await readFile(join(repoRoot, 'channels.json'), 'utf8'));
  assert.deepEqual(channels.beta, {
    version: '0.42.0-beta.7',
    tag: 'v0.42.0-beta.7',
    sha: '1a2b3c4d5e6f7890abcdef1234567890abcdef12',
    syncedAt: '2026-07-20T00:00:00Z',
  });
  assert.deepEqual(channels.stable, { version: null }, 'stable channel untouched');
});

test('re-syncing the same tag is idempotent (no diff)', async () => {
  await syncBetaRelease({ repoRoot, bundleDir });
  const before = await snapshot(repoRoot);
  await syncBetaRelease({ repoRoot, bundleDir });
  const after = await snapshot(repoRoot);
  assert.deepEqual(after, before);
});

test('channel mismatch is refused', async () => {
  const stableBundle = fileURLToPath(new URL('../fixtures/docs-bundle-stable', import.meta.url));
  await assert.rejects(() => syncBetaRelease({ repoRoot, bundleDir: stableBundle }), /channel mismatch/);
});
