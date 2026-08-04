#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  classifyReceipt,
  selectReleaseAssets,
  validateChannelAdvance,
  validateDispatchPayload,
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
  if (command === 'receipt') {
    const candidateText = await readFile(values.candidate, 'utf8');
    process.stdout.write(`${await classifyReceipt(values.existing, candidateText)}\n`);
    return;
  }
  if (command === 'advance') {
    validateChannelAdvance(await readJson(values.payload), await readJson(values.channels));
    return;
  }
  throw new Error('command must be payload, select, verify, receipt, or advance');
}

main().catch((error) => {
  console.error(`release-evidence failed: ${error.message}`);
  process.exit(1);
});
