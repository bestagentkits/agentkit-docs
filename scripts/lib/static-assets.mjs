import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const MEBIBYTE = 1024 * 1024;
export const MAX_ASSET_BYTES = 25 * MEBIBYTE;
export const SEARCH_ASSET_BUDGET_BYTES = 22 * MEBIBYTE;
export const MAX_STATIC_ASSET_FILES = 100_000;

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

export async function inspectStaticAssets(
  outDir,
  {
    maxAssetBytes = MAX_ASSET_BYTES,
    searchAssetBudgetBytes = SEARCH_ASSET_BUDGET_BYTES,
    maxFiles = MAX_STATIC_ASSET_FILES,
  } = {},
) {
  const files = await collectFiles(outDir);
  const searchAsset = files.find((file) => file.path === join('api', 'search'));
  const oversized = files.filter((file) => file.size > maxAssetBytes);

  return {
    files,
    maxFiles,
    oversized,
    searchAsset,
    searchAssetBudgetBytes,
    tooManyFiles: files.length > maxFiles,
    searchOverBudget: searchAsset?.size > searchAssetBudgetBytes,
  };
}

export function formatMebibytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(2)} MiB`;
}
