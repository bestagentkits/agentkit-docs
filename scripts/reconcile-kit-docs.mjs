#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  applyReconciliation,
  checkReconciliation,
  checkReconciliationHistory,
  createReconciliation,
  DEFAULT_MANIFEST_PATH,
} from './lib/kit-docs-reconciliation.mjs';

export async function run(argv = process.argv.slice(2), root = repoRoot) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      create: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      'check-history': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      'check-diff': { type: 'string' },
      manifest: { type: 'string', default: DEFAULT_MANIFEST_PATH },
    },
  });
  const modes = [
    ...(values.create ? ['create'] : []),
    ...(values.check ? ['check'] : []),
    ...(values['check-history'] ? ['check-history'] : []),
    ...(values.apply ? ['apply'] : []),
    ...(values['check-diff'] ? ['check-diff'] : []),
  ];
  if (modes.length > 1) throw new Error('choose exactly one of --create, --check, --check-history, --apply, or --check-diff <base>');
  const mode = modes[0] ?? 'check';
  const options = { root, manifestPath: values.manifest };
  if (mode === 'create') {
    const result = await createReconciliation(options);
    console.log(`${result.created ? 'created' : 'verified'} ${values.manifest}: copies=${result.manifest.counts.copyOperations}, claims=${result.manifest.counts.externalClaims}, writes=${result.manifest.counts.targetWrites}, digest=${result.manifest.manifestDigest}`);
    return result;
  }
  if (mode === 'apply') {
    const result = await applyReconciliation(options);
    console.log(`applied ${values.manifest}: writes=${result.writes}, skipped=${result.skipped}, digest=${result.manifest.manifestDigest}`);
    return result;
  }
  if (mode === 'check-history') {
    const result = await checkReconciliationHistory(options);
    console.log(`historically checked ${values.manifest}: operations=${result.checked}, digest=${result.manifest.manifestDigest}`);
    return result;
  }
  const result = await checkReconciliation({ ...options, ...(mode === 'check-diff' ? { diffBase: values['check-diff'] } : {}) });
  console.log(`checked ${values.manifest}: postimages=${result.checked}${result.diffChecked ? `, diff-base=${values['check-diff']}` : ''}, digest=${result.manifest.manifestDigest}`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
