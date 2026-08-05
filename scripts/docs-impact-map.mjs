#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { createApprovalRequest } from './lib/docs-release-approval.mjs';
import { cliError, parseArgs, readJson, required } from './lib/docs-release-cli.mjs';
import { createImpactMap } from './lib/docs-release-impact.mjs';
import { renderImpactMap, renderUnresolved } from './lib/docs-release-reports.mjs';
import { stableJson } from './lib/docs-release-normalize.mjs';
import { assertNoSymlinkPath, atomicWrite, releaseOutputDir } from './lib/docs-release-paths.mjs';
import { validateLedger } from './lib/docs-release-schema.mjs';

const FLAGS = ['--ledger', '--repo-root', '--output-root', '--target'];

export async function runImpactMap(options) {
  const ledger = validateLedger(await readJson(options.ledger, 'source ledger'));
  const impactMap = createImpactMap(ledger, { repoRoot: options.repoRoot });
  const request = createApprovalRequest({ ledger, impactMap, target: options.target });
  const outputDir = releaseOutputDir(options.outputRoot, options.target);
  await assertNoSymlinkPath(options.outputRoot, outputDir);
  const files = new Map([
    ['docs-impact-map.json', stableJson(impactMap)],
    ['docs-impact-map.md', renderImpactMap(impactMap)],
    ['unresolved-evidence.md', renderUnresolved(ledger, impactMap)],
    ['approval-request.json', stableJson(request)],
  ]);
  for (const [name, contents] of files) await atomicWrite(join(outputDir, basename(name)), contents);
  return { impactMap, request, outputDir, files: [...files.keys()] };
}

export async function main(argv = process.argv.slice(2)) {
  const args = required(parseArgs(argv, FLAGS), FLAGS);
  const result = await runImpactMap({
    ledger: args['--ledger'],
    repoRoot: args['--repo-root'],
    outputRoot: args['--output-root'],
    target: args['--target'],
  });
  process.stdout.write(stableJson({ status: result.request.status, outputDir: result.outputDir, files: result.files }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(cliError);
