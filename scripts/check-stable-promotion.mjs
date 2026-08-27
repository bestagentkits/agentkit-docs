#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { checkStablePromotion } from './lib/stable-promotion.mjs';
import { repoRoot } from './lib/paths.mjs';

export async function run(argv = process.argv.slice(2), root = repoRoot) {
  if (argv.length < 1 || argv.length > 2 || !argv[0]) {
    throw new Error('usage: node scripts/check-stable-promotion.mjs <base> [docs-promotions/<stable-tag>.json]');
  }
  const result = await checkStablePromotion({ root, base: argv[0], receiptPath: argv[1] ?? null });
  console.log(
    `checked ${result.receiptPath}: beta=${result.betaCommit}, stable-files=${result.stablePaths}, ` +
      `changed-stable-paths=${result.changedStablePaths}, digest=${result.receipt.receiptDigest}`,
  );
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
