#!/usr/bin/env node
import { isMainThread } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { atomicWrite, assertNoSymlinkPath, releaseOutputDir } from './lib/docs-release-paths.mjs';
import { cliError, parseArgs, required } from './lib/docs-release-cli.mjs';
import { loadReleaseSource } from './lib/docs-release-source.mjs';
import { createReleaseLedger } from './lib/docs-release-ledger.mjs';
import { renderDelta, renderSourceLedger } from './lib/docs-release-reports.mjs';
import { stableJson } from './lib/docs-release-normalize.mjs';

const FLAGS = ['--from-ref', '--to-ref', '--from-source', '--to-source', '--channel', '--output-root', '--target'];

export async function runReleaseDiff(options) {
  const from = await loadReleaseSource(options.fromSource, { ref: options.fromRef, channel: options.channel });
  const to = await loadReleaseSource(options.toSource, { ref: options.toRef, channel: options.channel });
  const ledger = createReleaseLedger(from, to, options.channel);
  const outputDir = releaseOutputDir(options.outputRoot, options.target);
  await assertNoSymlinkPath(options.outputRoot, outputDir);
  const version = ledger.from.version;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) throw new Error('unsafe from version');
  const files = new Map([
    ['source-ledger.json', stableJson(ledger)],
    ['source-ledger.md', renderSourceLedger(ledger)],
    [`delta-from-${version}.md`, renderDelta(ledger)],
  ]);
  for (const [name, contents] of files) await atomicWrite(join(outputDir, basename(name)), contents);
  return { ledger, outputDir, files: [...files.keys()] };
}

export async function main(argv = process.argv.slice(2)) {
  const args = required(parseArgs(argv, FLAGS), FLAGS);
  const result = await runReleaseDiff({
    fromRef: args['--from-ref'],
    toRef: args['--to-ref'],
    fromSource: args['--from-source'],
    toSource: args['--to-source'],
    channel: args['--channel'],
    outputRoot: args['--output-root'],
    target: args['--target'],
  });
  process.stdout.write(`${stableJson({ status: result.ledger.status, outputDir: result.outputDir, files: result.files })}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && isMainThread) main().catch(cliError);
