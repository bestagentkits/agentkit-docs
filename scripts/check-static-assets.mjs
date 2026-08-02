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
  if (!result.searchAsset) {
    throw new Error('static search asset not found at out/api/search');
  }

  const largest = [...result.files].sort((a, b) => b.size - a.size).slice(0, 10);
  console.error(`check-static-assets: ${result.files.length} files`);
  console.error(
    `check-static-assets: search ${formatMebibytes(result.searchAsset.size)} / ` +
      `${formatMebibytes(result.searchAssetBudgetBytes)} budget`,
  );
  console.error('check-static-assets: largest assets:');
  for (const file of largest) {
    console.error(`  ${formatMebibytes(file.size).padStart(10)}  ${file.path}`);
  }

  const failures = [];
  if (result.tooManyFiles) {
    failures.push(`${result.files.length} files exceed the Paid Workers limit of ${result.maxFiles}`);
  }
  if (result.searchOverBudget) {
    failures.push(
      `api/search is ${formatMebibytes(result.searchAsset.size)}; ` +
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
