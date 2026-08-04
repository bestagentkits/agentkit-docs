#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateApprovalRequest } from './lib/docs-release-approval.mjs';
import { verifyCoverageV1Physical } from './lib/docs-release-coverage.mjs';
import { isCoverageApprovalRequest } from './lib/docs-release-coverage-schema.mjs';
import { cliError, parseArgs, readJson, required } from './lib/docs-release-cli.mjs';
import {
  MANUAL_OWNER_APPROVAL_SCHEMA,
  createManualOwnerApprovalRecord,
  resolveManualOwnerDocsBase,
  validateManualOwnerApprovalBinding,
} from './lib/docs-release-manual-approval.mjs';
import { digest, stableJson } from './lib/docs-release-normalize.mjs';
import {
  assertNoSymlinkPath,
  atomicWrite,
  normalizeRepoPath,
  v1WriteViolations,
} from './lib/docs-release-paths.mjs';

const FLAGS = [
  '--mode', '--repo-root', '--request', '--ledger', '--impact-map', '--manifest',
  '--request-id', '--owner-label', '--approval-statement', '--issued-at', '--expires-at',
  '--nonce', '--now', '--approval', '--changes', '--docs-base-sha', '--target-branch',
  '--used-nonces', '--source-root', '--issue-body',
];

async function readRepoArtifact(path, repoRoot, label, digestMode = 'bytes') {
  const candidate = isAbsolute(path) ? resolve(path) : resolve(repoRoot, path);
  const absolute = await realpath(candidate);
  const repoPath = normalizeRepoPath(relative(repoRoot, absolute));
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

async function readEvidence(args, repoRoot) {
  return {
    request: await readRepoArtifact(args['--request'], repoRoot, 'approval request', 'request'),
    ledger: await readRepoArtifact(args['--ledger'], repoRoot, 'source ledger'),
    impactMap: await readRepoArtifact(args['--impact-map'], repoRoot, 'docs impact map'),
    ...(args['--manifest'] ? {
      manifest: await readRepoArtifact(args['--manifest'], repoRoot, 'release manifest'),
    } : {}),
  };
}

async function usedNonceSet(path) {
  const input = await readJson(path, 'used nonce ledger');
  const values = Array.isArray(input) ? input : input.nonces;
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('used nonce ledger must be an array or { "nonces": [] }');
  }
  return new Set(values);
}

async function createManualApproval(args) {
  required(args, [
    '--repo-root', '--request', '--ledger', '--impact-map', '--request-id', '--owner-label',
    '--approval-statement', '--issued-at', '--expires-at', '--nonce', '--now',
  ]);
  const repoRoot = await realpath(resolve(args['--repo-root']));
  const artifacts = await readEvidence(args, repoRoot);
  const request = validateApprovalRequest(artifacts.request.value);
  const docsBaseSha = await resolveManualOwnerDocsBase(repoRoot);
  const approval = createManualOwnerApprovalRecord({
    request,
    requestId: args['--request-id'],
    ownerLabel: args['--owner-label'],
    approvalStatement: args['--approval-statement'],
    docsBaseSha,
    issuedAt: args['--issued-at'],
    expiresAt: args['--expires-at'],
    nonce: args['--nonce'],
    now: args['--now'],
    artifacts,
  });

  const expectedDir = `plans/releases/${request.target}`;
  if (dirname(artifacts.request.path) !== expectedDir) {
    throw new Error(`approval request must be read from ${expectedDir}/`);
  }
  const outputPath = resolve(repoRoot, expectedDir, 'manual-owner-approval.json');
  await assertNoSymlinkPath(repoRoot, outputPath);
  await atomicWrite(outputPath, stableJson(approval));
  return {
    mode: 'create',
    approvalMode: 'manual-owner',
    schemaVersion: MANUAL_OWNER_APPROVAL_SCHEMA,
    status: 'created',
    path: `${expectedDir}/manual-owner-approval.json`,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    nonce: approval.nonce,
  };
}

async function validateManualV1(args) {
  required(args, [
    '--repo-root', '--request', '--ledger', '--impact-map', '--approval', '--changes',
    '--docs-base-sha', '--target-branch', '--now', '--used-nonces',
  ]);
  const repoRoot = await realpath(resolve(args['--repo-root']));
  const artifacts = await readEvidence(args, repoRoot);
  const approvalArtifact = await readRepoArtifact(args['--approval'], repoRoot, 'manual-owner approval');
  const request = validateApprovalRequest(artifacts.request.value);
  if (isCoverageApprovalRequest(request)) required(args, ['--source-root', '--issue-body']);
  const approval = approvalArtifact.value;
  validateManualOwnerApprovalBinding(request, approval, {
    docsBaseSha: args['--docs-base-sha'],
    targetBranch: args['--target-branch'],
    now: args['--now'],
    usedNonces: await usedNonceSet(args['--used-nonces']),
    artifacts,
  });
  await resolveManualOwnerDocsBase(repoRoot, approval.docsBaseSha);
  if (isCoverageApprovalRequest(request)) {
    await verifyCoverageV1Physical({
      request,
      ledger: artifacts.ledger.value,
      docsRoot: repoRoot,
      sourceRoot: args['--source-root'],
      issueBodyPath: args['--issue-body'],
    });
  }
  const expectedApprovalPath = `plans/releases/${request.target}/manual-owner-approval.json`;
  if (approvalArtifact.path !== expectedApprovalPath) {
    throw new Error(`manual-owner approval must be read from ${expectedApprovalPath}`);
  }
  const changes = await readJson(args['--changes'], 'V1 changes');
  if (!Array.isArray(changes)) throw new Error('V1 changes must be an array');
  const violations = v1WriteViolations(changes, request.paths);
  if (violations.length) {
    throw new Error(`V1 write scope rejected:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  }
  return {
    mode: 'v1',
    approvalMode: 'manual-owner',
    status: 'approved',
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    nonce: approval.nonce,
    paths: approval.scope.paths,
  };
}

export async function runManualApproval(args) {
  if (args['--mode'] === 'create') return createManualApproval(args);
  if (args['--mode'] === 'v1') return validateManualV1(args);
  throw new Error('--mode must be create or v1');
}

export async function main(argv = process.argv.slice(2)) {
  const args = required(parseArgs(argv, FLAGS), ['--mode']);
  process.stdout.write(stableJson(await runManualApproval(args)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(cliError);
