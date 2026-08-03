import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBetaRelease } from './lib/sync.mjs';
import { DERIVED_DIR } from './lib/generate.mjs';

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
  const derivedDir = join(repoRoot, DERIVED_DIR);
  await mkdir(derivedDir, { recursive: true });
  // Pre-existing stale derived files that a sync must wipe.
  await writeFile(join(derivedDir, '.generated'), '{"stale":true}\n');
  await writeFile(join(derivedDir, 'ak_removed_command.mdx'), '---\ntitle: gone\n---\n');
  await mkdir(join(repoRoot, 'content', 'docs', 'beta', 'reference'), { recursive: true });
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

  const derivedDir = join(repoRoot, DERIVED_DIR);
  assert.ok(existsSync(join(derivedDir, 'index.mdx')));
  assert.ok(existsSync(join(derivedDir, 'ak_kit_init.mdx')));
  // Wholesale replace: the stale derived page is gone.
  assert.ok(!existsSync(join(derivedDir, 'ak_removed_command.mdx')));

  const marker = JSON.parse(await readFile(join(derivedDir, '.generated'), 'utf8'));
  assert.equal(marker.tag, 'v0.42.0-beta.7');
  assert.equal(marker.sha, '1a2b3c4d5e6f7890abcdef1234567890abcdef12');
  assert.equal(marker.generatedAt, '2026-07-20T00:00:00Z');
  assert.equal(marker.source, 'ak-cli');
  assert.ok(!('channel' in marker), 'marker must be channel-neutral');

  // Hygiene: private source-repo links are rewritten to the public support repo.
  const akPage = await readFile(join(derivedDir, 'ak.mdx'), 'utf8');
  assert.match(akPage, /github\.com\/bestagentkits\/agentkit-support/);
  assert.doesNotMatch(akPage, /github\.com\/bestagentkits\/agentkit(?![-\w])/);

  // The derived page is normalized: the duplicated H2 + Synopsis dump are gone
  // and flags are tabulated.
  assert.doesNotMatch(akPage, /^## ak$/m);
  assert.doesNotMatch(akPage, /### Synopsis/);
  assert.match(akPage, /### Flags\n\n\| Flag \| Description \|/);

  // The raw `ak --help` projection is committed under reference-raw/ as the
  // machine source of truth (scrubbed, still in cobra shape).
  const rawAk = await readFile(join(repoRoot, 'reference-raw', 'ak.mdx'), 'utf8');
  assert.match(rawAk, /### Synopsis/);
  assert.doesNotMatch(rawAk, /github\.com\/bestagentkits\/agentkit(?![-\w])/);

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
