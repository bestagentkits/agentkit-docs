import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  inspectStaticAssets,
  LEGACY_SEARCH_ASSET_PATH,
  MEBIBYTE,
  requiredSearchAssets,
} from './lib/static-assets.mjs';
import { SEARCH_SCOPES } from '../lib/search-scopes.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ak-docs-assets-'));
  for (const { path } of requiredSearchAssets()) {
    await mkdir(join(directory, path, '..'), { recursive: true });
    await writeFile(join(directory, path), '{"type":"advanced"}');
  }
  return directory;
}

function shardPath(locale, channel) {
  return requiredSearchAssets().find(
    (shard) => shard.locale === locale && shard.channel === channel,
  ).path;
}

async function sparseFile(filepath, size) {
  const file = await open(filepath, 'w');
  await file.truncate(size);
  await file.close();
}

test('requires one shard for every locale/channel scope', async () => {
  assert.deepEqual(
    requiredSearchAssets().map((shard) => `${shard.locale}/${shard.channel}`),
    SEARCH_SCOPES.map((scope) => `${scope.locale}/${scope.channel}`),
  );
});

test('accepts output within limits', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<h1>AgentKit</h1>');

  const result = await inspectStaticAssets(directory);

  assert.equal(result.files.length, 5);
  assert.equal(result.missingSearchShards.length, 0);
  assert.equal(result.searchOverBudget, false);
  assert.equal(result.oversized.length, 0);
  assert.equal(result.tooManyFiles, false);
});

test('reports a missing shard instead of accepting a partial export', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await rm(join(directory, shardPath('vi', 'beta')));

  const result = await inspectStaticAssets(directory);

  assert.deepEqual(
    result.missingSearchShards.map((shard) => `${shard.locale}/${shard.channel}`),
    ['vi/beta'],
  );
});

test('reports a legacy combined search asset', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ak-docs-assets-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'api'), { recursive: true });
  await writeFile(join(directory, LEGACY_SEARCH_ASSET_PATH), '{}');

  const result = await inspectStaticAssets(directory);

  assert.equal(result.legacySearchAsset.path, LEGACY_SEARCH_ASSET_PATH);
  assert.equal(result.missingSearchShards.length, 4);
});

test('treats the shard budget as one aggregate allowance', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budget = 12 * MEBIBYTE;
  for (const { path } of requiredSearchAssets()) {
    await sparseFile(join(directory, path), budget / 4);
  }

  const withinBudget = await inspectStaticAssets(directory, { searchAssetBudgetBytes: budget });
  assert.equal(withinBudget.searchOverBudget, false);
  assert.equal(withinBudget.searchBytes, budget);

  const overBudget = await inspectStaticAssets(directory, { searchAssetBudgetBytes: budget - 1 });
  assert.equal(overBudget.searchOverBudget, true);
  // No single shard breaches the per-asset Cloudflare limit on its own.
  assert.equal(overBudget.oversized.length, 0);
});

test('reports the Cloudflare per-asset limit breach and largest shard', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await sparseFile(join(directory, shardPath('en', 'stable')), 26 * MEBIBYTE);
  await sparseFile(join(directory, 'oversized.bin'), 26 * MEBIBYTE);

  const result = await inspectStaticAssets(directory);

  assert.deepEqual(result.oversized.map((file) => file.path).sort(), ['oversized.bin', 'api/search/en/stable'].sort());
  assert.equal(result.maxSearchShardBytes, 26 * MEBIBYTE);
});

test('rejects an unexpected search asset and counts it in the aggregate budget', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const foreignPath = join('api', 'search', 'fr', 'stable');
  await mkdir(join(directory, 'api', 'search', 'fr'), { recursive: true });
  await writeFile(join(directory, foreignPath), '{"type":"advanced"}');

  const result = await inspectStaticAssets(directory);

  assert.deepEqual(result.unexpectedSearchAssets.map((file) => file.path), [foreignPath]);
  assert.equal(result.searchBytes, 5 * '{"type":"advanced"}'.length);

  const overBudget = await inspectStaticAssets(directory, {
    searchAssetBudgetBytes: 5 * '{"type":"advanced"}'.length - 1,
  });
  assert.equal(overBudget.searchOverBudget, true);
});

test('inspectStaticAssets uses the configured Paid Workers file limit', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'AgentKit');

  const result = await inspectStaticAssets(directory, { maxFiles: 1 });

  assert.equal(result.tooManyFiles, true);
});
