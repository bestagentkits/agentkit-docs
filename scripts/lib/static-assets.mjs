import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SEARCH_SCOPES, searchShardPath } from '../../lib/search-scopes.mjs';

export const MEBIBYTE = 1024 * 1024;
export const MAX_ASSET_BYTES = 25 * MEBIBYTE;
// Aggregate budget for all search shards together. Each shard is a partition of
// the same discovery corpus, so this stays one shared 22 MiB allowance rather
// than four independent ones.
export const SEARCH_ASSET_BUDGET_BYTES = 22 * MEBIBYTE;
export const MAX_STATIC_ASSET_FILES = 100_000;

// The pre-sharding combined endpoint. It must not ship: it would double the
// search payload and the client never requests it.
export const LEGACY_SEARCH_ASSET_PATH = join('api', 'search');

async function collectFiles(directory, root = directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filepath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(filepath, root, files);
      continue;
    }

    const stats = await lstat(filepath);
    if (stats.isFile()) {
      files.push({ path: relative(root, filepath), size: stats.size });
    }
  }

  return files;
}

export function requiredSearchAssets() {
  return SEARCH_SCOPES.map(({ locale, channel }) => ({
    locale,
    channel,
    path: searchShardPath(locale, channel),
  }));
}

export async function inspectStaticAssets(
  outDir,
  {
    maxAssetBytes = MAX_ASSET_BYTES,
    searchAssetBudgetBytes = SEARCH_ASSET_BUDGET_BYTES,
    maxFiles = MAX_STATIC_ASSET_FILES,
  } = {},
) {
  const files = await collectFiles(outDir);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const requiredPaths = new Set(requiredSearchAssets().map((shard) => shard.path));
  const searchShards = requiredSearchAssets().map((shard) => {
    const file = byPath.get(shard.path);
    return { ...shard, size: file?.size ?? 0, missing: !file };
  });
  // Anything else under the search endpoint is a scope this site does not
  // serve. It must not ship at all, and its bytes still belong to the shared
  // aggregate budget — otherwise four in-budget shards plus a foreign shard
  // would be reported as within budget.
  const unexpectedSearchAssets = files
    .filter(
      (file) =>
        file.path.startsWith(`${LEGACY_SEARCH_ASSET_PATH}/`) && !requiredPaths.has(file.path),
    )
    .map((file) => ({ ...file }));
  const searchBytes = [...searchShards, ...unexpectedSearchAssets].reduce(
    (sum, entry) => sum + entry.size,
    0,
  );
  const oversized = files.filter((file) => file.size > maxAssetBytes);

  return {
    files,
    maxFiles,
    oversized,
    searchShards,
    missingSearchShards: searchShards.filter((shard) => shard.missing),
    unexpectedSearchAssets,
    searchBytes,
    maxSearchShardBytes: Math.max(0, ...searchShards.map((shard) => shard.size)),
    searchAssetBudgetBytes,
    legacySearchAsset: byPath.get(LEGACY_SEARCH_ASSET_PATH),
    tooManyFiles: files.length > maxFiles,
    searchOverBudget: searchBytes > searchAssetBudgetBytes,
  };
}

export function formatMebibytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(2)} MiB`;
}
