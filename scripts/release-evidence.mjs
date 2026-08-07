#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  classifyReceipt,
  createLegacyDocsBackfillProvenance,
  inspectStableReplay,
  selectReleaseAssets,
  validateChannelAdvance,
  validateBetaReplay,
  validateDispatchPayload,
  validateStableReplayTree,
  verifyReleaseEvidence,
} from './lib/release-evidence.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const command = process.argv[2];
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      payload: { type: 'string' },
      release: { type: 'string' },
      assets: { type: 'string' },
      bundle: { type: 'string' },
      output: { type: 'string' },
      existing: { type: 'string' },
      candidate: { type: 'string' },
      channels: { type: 'string' },
      repo: { type: 'string', default: '.' },
      tag: { type: 'string' },
      receiptPath: { type: 'string' },
      branchRef: { type: 'string' },
      currentRef: { type: 'string', default: 'HEAD' },
      expectedTree: { type: 'string' },
    },
  });
  if (command === 'payload') {
    const payload = validateDispatchPayload(await readJson(values.payload));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (command === 'select') {
    const result = selectReleaseAssets(await readJson(values.release), await readJson(values.payload));
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'verify') {
    const result = await verifyReleaseEvidence({
      payload: await readJson(values.payload),
      release: await readJson(values.release),
      assetsDir: values.assets,
      bundleDir: values.bundle,
    });
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, result.receiptText);
    process.stdout.write(`${JSON.stringify({ channel: result.manifest.channel, tag: result.manifest.tag, sha: result.manifest.sha })}\n`);
    return;
  }
  if (command === 'legacy-backfill-provenance') {
    const result = createLegacyDocsBackfillProvenance(
      await readJson(values.release),
      await readJson(values.payload),
    );
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, result);
    return;
  }
  if (command === 'receipt') {
    const candidateText = await readFile(values.candidate, 'utf8');
    process.stdout.write(`${await classifyReceipt(values.existing, candidateText)}\n`);
    return;
  }
  if (command === 'advance') {
    validateChannelAdvance(await readJson(values.payload), await readJson(values.channels));
    return;
  }
  if (command === 'beta-replay') {
    const candidateText = await readFile(values.candidate, 'utf8');
    process.stdout.write(`${validateBetaReplay({
      repoRoot: values.repo,
      tag: values.tag,
      receiptPath: values.receiptPath,
      candidateText,
      currentRef: values.currentRef,
    })}\n`);
    return;
  }
  if (command === 'stable-replay') {
    const candidateText = await readFile(values.candidate, 'utf8');
    process.stdout.write(`${JSON.stringify(inspectStableReplay({
      repoRoot: values.repo,
      branchRef: values.branchRef,
      receiptPath: values.receiptPath,
      candidateText,
      currentRef: values.currentRef,
    }))}\n`);
    return;
  }
  if (command === 'stable-replay-tree') {
    process.stdout.write(`${validateStableReplayTree({
      repoRoot: values.repo,
      branchRef: values.branchRef,
      expectedTree: values.expectedTree,
    })}\n`);
    return;
  }
  throw new Error('unsupported release-evidence command');
}

main().catch((error) => {
  console.error(`release-evidence failed: ${error.message}`);
  process.exit(1);
});
