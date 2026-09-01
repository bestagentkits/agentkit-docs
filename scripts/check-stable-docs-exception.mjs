#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/paths.mjs';
import { checkStableDocsException } from './lib/stable-docs-exception.mjs';

export async function run(argv = process.argv.slice(2), root = repoRoot) {
  if (argv.length !== 2 || !argv[0] || !argv[1]) {
    throw new Error('usage: node scripts/check-stable-docs-exception.mjs <base> <stable-docs-exceptions/<id>.json>');
  }
  const result = await checkStableDocsException({ root, base: argv[0], receiptPath: argv[1] });
  console.log(
    `checked ${result.receiptPath}: stable=${result.receipt.stableTag}, routes=${result.receipt.routes.join(',')}, ` +
      `changed-stable-paths=${result.changedStablePaths.length}, digest=${result.receipt.receiptDigest}`,
  );
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
