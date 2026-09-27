#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  formatMebibytes,
  inspectStaticAssets,
  MAX_ASSET_BYTES,
} from './lib/static-assets.mjs';

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: 'out' } },
  });
  const outDir = resolve(repoRoot, values.out);
  if (!existsSync(outDir)) {
    throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  }

  const result = await inspectStaticAssets(outDir);
  const largest = [...result.files].sort((a, b) => b.size - a.size).slice(0, 10);
  console.error(`check-static-assets: ${result.files.length} files`);
  console.error('check-static-assets: search shards:');
  for (const shard of result.searchShards) {
    console.error(
      `  ${formatMebibytes(shard.size).padStart(10)}  ${shard.path}${shard.missing ? ' (missing)' : ''}`,
    );
  }
  console.error(
    `check-static-assets: search total ${formatMebibytes(result.searchBytes)} / ` +
      `${formatMebibytes(result.searchAssetBudgetBytes)} budget ` +
      `(largest shard ${formatMebibytes(result.maxSearchShardBytes)})`,
  );
  console.error('check-static-assets: largest assets:');
  for (const file of largest) {
    console.error(`  ${formatMebibytes(file.size).padStart(10)}  ${file.path}`);
  }

  const failures = [];
  if (result.tooManyFiles) {
    failures.push(`${result.files.length} files exceed the Paid Workers limit of ${result.maxFiles}`);
  }
  for (const shard of result.missingSearchShards) {
    failures.push(`${shard.path} is missing; every locale/channel scope must export its own shard`);
  }
  if (result.legacySearchAsset) {
    failures.push(
      `api/search is still emitted as a single combined asset ` +
        `(${formatMebibytes(result.legacySearchAsset.size)}); the scoped shards replace it`,
    );
  }
  for (const file of result.unexpectedSearchAssets) {
    failures.push(
      `${file.path} is not one of the four scoped search shards ` +
        `(${formatMebibytes(file.size)}); only /api/search/{en|vi}/{stable|beta} may ship`,
    );
  }
  if (result.searchOverBudget) {
    failures.push(
      `search shards total ${formatMebibytes(result.searchBytes)}; ` +
        `budget is ${formatMebibytes(result.searchAssetBudgetBytes)}`,
    );
  }
  for (const file of result.oversized) {
    failures.push(
      `${file.path} is ${formatMebibytes(file.size)}; ` +
        `Cloudflare limit is ${formatMebibytes(MAX_ASSET_BYTES)}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`static asset limits exceeded:\n  - ${failures.join('\n  - ')}`);
  }

  console.error('check-static-assets: Cloudflare limits OK.');
}

main().catch((error) => {
  console.error(`check-static-assets failed: ${error.message}`);
  process.exit(1);
});
