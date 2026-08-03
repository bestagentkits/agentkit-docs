#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { validateApprovalBinding, validateApprovalRequest } from './lib/docs-release-approval.mjs';
import { cliError, parseArgs, readJson, required } from './lib/docs-release-cli.mjs';
import { createImpactMap } from './lib/docs-release-impact.mjs';
import { createReleaseLedger } from './lib/docs-release-ledger.mjs';
import { stableJson } from './lib/docs-release-normalize.mjs';
import { assertV0WriteScope, v1WriteViolations } from './lib/docs-release-paths.mjs';
import { writeV0Reports } from './lib/docs-release-reports.mjs';
import { loadReleaseSource } from './lib/docs-release-source.mjs';

const FLAGS = [
  '--mode', '--from-ref', '--to-ref', '--from-source', '--to-source', '--channel',
  '--repo-root', '--output-root', '--target', '--request', '--approval', '--changes',
  '--now', '--used-nonces', '--output-prefix',
];

async function runV0(args) {
  required(args, ['--from-ref', '--to-ref', '--from-source', '--to-source', '--channel', '--repo-root', '--output-root', '--target']);
  const from = await loadReleaseSource(args['--from-source'], { ref: args['--from-ref'], channel: args['--channel'] });
  const to = await loadReleaseSource(args['--to-source'], { ref: args['--to-ref'], channel: args['--channel'] });
  const ledger = createReleaseLedger(from, to, args['--channel']);
  const impactMap = createImpactMap(ledger, { repoRoot: args['--repo-root'] });
  const result = await writeV0Reports({
    ledger,
    impactMap,
    outputRoot: args['--output-root'],
    target: args['--target'],
  });
  return {
    mode: 'v0',
    status: result.request.status,
    outputDir: result.outputDir,
    files: result.files,
    requestDigest: result.request.requestDigest,
  };
}

async function usedNonceSet(path) {
  if (!path) return new Set();
  const input = await readJson(path, 'used nonce ledger');
  const values = Array.isArray(input) ? input : input.nonces;
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) throw new Error('used nonce ledger must be an array or { "nonces": [] }');
  return new Set(values);
}

async function runV1(args) {
  required(args, ['--request', '--approval', '--changes', '--now']);
  const request = validateApprovalRequest(await readJson(args['--request'], 'approval request'));
  const approval = await readJson(args['--approval'], 'approval artifact');
  validateApprovalBinding(request, approval, {
    now: args['--now'],
    usedNonces: await usedNonceSet(args['--used-nonces']),
  });
  const changes = await readJson(args['--changes'], 'V1 changes');
  if (!Array.isArray(changes)) throw new Error('V1 changes must be an array');
  const violations = v1WriteViolations(changes, request.paths);
  if (violations.length) throw new Error(`V1 write scope rejected:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  return {
    mode: 'v1',
    status: 'approved',
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    nonce: approval.nonce,
    paths: request.paths,
  };
}

async function runV0Scope(args) {
  required(args, ['--changes', '--output-prefix']);
  const changes = await readJson(args['--changes'], 'V0 changes');
  if (!Array.isArray(changes)) throw new Error('V0 changes must be an array');
  const violations = assertV0WriteScope(changes, args['--output-prefix']);
  if (violations.length) throw new Error(`V0 write scope rejected:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  return { mode: 'v0-scope', status: 'allowed', outputPrefix: args['--output-prefix'] };
}

export async function runCheck(args) {
  if (args['--mode'] === 'v0') return runV0(args);
  if (args['--mode'] === 'v1') return runV1(args);
  if (args['--mode'] === 'v0-scope') return runV0Scope(args);
  throw new Error('--mode must be v0, v0-scope, or v1');
}

export async function main(argv = process.argv.slice(2)) {
  const args = required(parseArgs(argv, FLAGS), ['--mode']);
  process.stdout.write(stableJson(await runCheck(args)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(cliError);
