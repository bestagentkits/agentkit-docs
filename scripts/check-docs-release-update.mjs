#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateApprovalBinding, validateApprovalRequest } from './lib/docs-release-approval.mjs';
import { createCoverageGapAudit, verifyCoverageV1Physical } from './lib/docs-release-coverage.mjs';
import { writeCoverageGapReports } from './lib/docs-release-coverage-reports.mjs';
import { isCoverageApprovalRequest } from './lib/docs-release-coverage-schema.mjs';
import { cliError, parseArgs, readJson, required } from './lib/docs-release-cli.mjs';
import { createImpactMap } from './lib/docs-release-impact.mjs';
import { createReleaseLedger } from './lib/docs-release-ledger.mjs';
import { digest, stableJson } from './lib/docs-release-normalize.mjs';
import { assertV0WriteScope, normalizeRepoPath, v1WriteViolations } from './lib/docs-release-paths.mjs';
import { writeV0Reports } from './lib/docs-release-reports.mjs';
import { loadReleaseSource } from './lib/docs-release-source.mjs';

const FLAGS = [
  '--mode', '--from-ref', '--to-ref', '--from-source', '--to-source', '--channel',
  '--repo-root', '--output-root', '--target', '--request', '--approval', '--changes',
  '--ledger', '--impact-map', '--manifest', '--source-repository', '--docs-repository',
  '--docs-base-sha', '--target-branch', '--now', '--used-nonces', '--output-prefix',
  '--audit-source', '--source-root', '--issue-body',
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

async function runCoverageGap(args) {
  required(args, ['--audit-source', '--source-root', '--repo-root', '--output-root', '--target']);
  const result = await createCoverageGapAudit({
    auditSourcePath: args['--audit-source'],
    sourceRoot: args['--source-root'],
    docsRoot: args['--repo-root'],
    target: args['--target'],
  });
  const written = await writeCoverageGapReports({ ...result, outputRoot: args['--output-root'], target: args['--target'] });
  return {
    mode: 'coverage-gap',
    status: written.request.status,
    outputDir: written.outputDir,
    files: written.files,
    requestDigest: written.request.requestDigest,
  };
}

async function usedNonceSet(path) {
  if (!path) return new Set();
  const input = await readJson(path, 'used nonce ledger');
  const values = Array.isArray(input) ? input : input.nonces;
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) throw new Error('used nonce ledger must be an array or { "nonces": [] }');
  return new Set(values);
}

async function readRepoArtifact(path, repoRoot, label, digestMode = 'bytes') {
  const root = await realpath(resolve(repoRoot));
  const candidate = isAbsolute(path) ? path : resolve(root, path);
  const absolute = await realpath(candidate);
  const repoPath = normalizeRepoPath(relative(root, absolute));
  const bytes = await readFile(absolute);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`);
  }
  const sha256 = digestMode === 'request'
    ? String(value.requestDigest ?? '').replace(/^sha256:/, '')
    : digest(bytes).slice('sha256:'.length);
  return { path: repoPath, sha256, value };
}

async function runV1(args) {
  required(args, [
    '--request', '--ledger', '--impact-map', '--approval', '--changes', '--now', '--repo-root',
    '--source-repository', '--docs-repository', '--docs-base-sha', '--target-branch',
  ]);
  const requestArtifact = await readRepoArtifact(args['--request'], args['--repo-root'], 'approval request', 'request');
  const ledgerArtifact = await readRepoArtifact(args['--ledger'], args['--repo-root'], 'source ledger');
  const impactMapArtifact = await readRepoArtifact(args['--impact-map'], args['--repo-root'], 'docs impact map');
  const manifestArtifact = args['--manifest']
    ? await readRepoArtifact(args['--manifest'], args['--repo-root'], 'release manifest')
    : undefined;
  const approvalArtifact = await readRepoArtifact(args['--approval'], args['--repo-root'], 'durable approval');
  const request = validateApprovalRequest(requestArtifact.value);
  if (isCoverageApprovalRequest(request)) required(args, ['--source-root', '--issue-body']);
  const approval = approvalArtifact.value;
  validateApprovalBinding(request, approval, {
    sourceRepository: args['--source-repository'],
    docsRepository: args['--docs-repository'],
    docsBaseSha: args['--docs-base-sha'],
    targetBranch: args['--target-branch'],
    now: args['--now'],
    usedNonces: await usedNonceSet(args['--used-nonces']),
    artifacts: {
      request: requestArtifact,
      ledger: ledgerArtifact,
      impactMap: impactMapArtifact,
      ...(manifestArtifact ? { manifest: manifestArtifact } : {}),
    },
  });
  if (isCoverageApprovalRequest(request)) {
    await verifyCoverageV1Physical({
      request,
      ledger: ledgerArtifact.value,
      docsRoot: args['--repo-root'],
      sourceRoot: args['--source-root'],
      issueBodyPath: args['--issue-body'],
    });
  }
  const expectedApprovalPath = `docs-approvals/${approval.subject.sourceTag}-${approval.nonce}.json`;
  if (approvalArtifact.path !== expectedApprovalPath) throw new Error(`durable approval must be read from ${expectedApprovalPath}`);
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
    paths: approval.scope.paths,
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
  if (args['--mode'] === 'coverage-gap') return runCoverageGap(args);
  if (args['--mode'] === 'v1') return runV1(args);
  if (args['--mode'] === 'v0-scope') return runV0Scope(args);
  throw new Error('--mode must be v0, coverage-gap, v0-scope, or v1');
}

export async function main(argv = process.argv.slice(2)) {
  const args = required(parseArgs(argv, FLAGS), ['--mode']);
  process.stdout.write(stableJson(await runCheck(args)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(cliError);
