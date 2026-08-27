#!/usr/bin/env node
// Stable promotion: whole-copy the exact beta docs tree for
// manifest.promotedFrom into content/docs/stable, rewrite stable release notes
// from the bundle, update channels.json.stable, and atomically write a bound
// promotion receipt. Emits a branch name for a reviewed PR.
//
// Real promotion always binds a git snapshot (default tag docs/{promotedFrom}):
//   node scripts/promote-docs.mjs --bundle path/to/docs-bundle-stable
//   node scripts/promote-docs.mjs --bundle path/to/docs-bundle-stable --beta-ref docs/v2.8.0-beta.14
//
// Fixture / unit-test only (not evidence of promotedFrom):
//   node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable \
//     --beta-source /tmp/fixture-beta --allow-unverified-beta-source \
//     --receipt-output /tmp/stable-promotion-fixture.json
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseManifest } from './lib/manifest.mjs';
import { promoteToStable } from './lib/promote.mjs';
import { repoRoot } from './lib/paths.mjs';
import {
  absoluteReceiptPath,
  assertSafeReceiptDestination,
  canonicalJson,
  createPromotionEvidence,
  createPromotionReceipt,
  gitChannelInventory,
  promotionBetaRef,
  promotionReceiptPath,
  removePromotionEvidence,
  repositoryRelativePath,
  resolveCommit,
  resolvePromotionBetaCommit,
  stablePromotionEvidencePaths,
  worktreeChannelInventory,
} from './lib/stable-promotion.mjs';

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

function cleanupWorktree(worktree, root) {
  if (!worktree) return;
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    // Best-effort if git already dropped the worktree.
  }
  try {
    rmSync(worktree, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * After checking out a beta-ref worktree, require channels.beta.tag === promotedFrom.
 * Proves the snapshot identifies the promoted beta, not merely that the ref exists.
 */
function assertWorktreeMatchesPromotedFrom(worktree, promotedFrom, ref) {
  const channelsPath = join(worktree, 'channels.json');
  let channels;
  try {
    channels = JSON.parse(readFileSync(channelsPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `beta-ref ${JSON.stringify(ref)} is missing a readable channels.json ` +
        `(required to prove channels.beta.tag === ${promotedFrom}): ${err.message}`,
    );
  }
  const tag = channels?.beta?.tag;
  if (tag !== promotedFrom) {
    throw new Error(
      `beta-ref ${JSON.stringify(ref)} does not identify promotedFrom ${promotedFrom}: ` +
        `channels.beta.tag is ${JSON.stringify(tag)} (expected exact match). ` +
        'Use the docs snapshot that was tagged for that beta release.',
    );
  }
}

/**
 * Resolve the beta tree to whole-copy.
 * Real promotion: git ref (default docs/{promotedFrom}), verified via channels.beta.tag.
 * Fixtures: --beta-source only with --allow-unverified-beta-source.
 */
function resolveBetaSource({ values, promotedFrom, root }) {
  const betaSource = values['beta-source'] ?? values.betaSource;
  const allowUnverified = values['allow-unverified-beta-source'] === true;
  const betaRefOpt = values['beta-ref'] ?? values.betaRef;

  if (betaSource && betaRefOpt) {
    throw new Error('use either --beta-ref (real promotion) or --beta-source (fixtures), not both');
  }

  if (betaSource) {
    if (!allowUnverified) {
      throw new Error(
        '--beta-source is fixtures/tests only and is not evidence of the promoted beta snapshot. ' +
          `For real promotion, omit it so the script checks out docs/${promotedFrom}, ` +
          'or pass --beta-ref <exact-git-ref>. ' +
          'For local fixtures only, also pass --allow-unverified-beta-source.',
      );
    }
    return { betaSource, worktree: null, boundRef: null, betaCommit: null, betaChannelsTagProof: null };
  }

  const ref = betaRefOpt || promotionBetaRef(promotedFrom);
  let betaCommit;
  try {
    betaCommit = resolvePromotionBetaCommit(root, promotedFrom, ref);
  } catch (error) {
    throw new Error(
      `cannot resolve beta docs snapshot from the required tag ${JSON.stringify(promotionBetaRef(promotedFrom))}: ` +
        `${error.message}. Fetch that exact tag before promoting.`,
    );
  }

  const worktree = mkdtempSync(join(tmpdir(), 'promote-'));
  try {
    // Keep stdout clean (CLI prints one JSON summary line on success).
    execFileSync('git', ['worktree', 'add', '--detach', worktree, betaCommit], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    assertWorktreeMatchesPromotedFrom(worktree, promotedFrom, ref);
  } catch (err) {
    cleanupWorktree(worktree, root);
    throw err;
  }

  return {
    betaSource: join(worktree, 'content', 'docs', 'beta'),
    worktree,
    boundRef: ref,
    betaCommit,
    betaChannelsTagProof: promotedFrom,
  };
}

function assertPromotionTargetsClean(root, receiptRepoPath, stableTag) {
  const evidencePaths = stablePromotionEvidencePaths(stableTag);
  const output = execFileSync(
    'git',
    ['status', '--porcelain=v1', '-z', '--', 'content/docs/stable', 'channels.json', receiptRepoPath, ...Object.values(evidencePaths)],
    { cwd: root },
  );
  if (output.length) {
    throw new Error(
      'real promotion requires clean Stable, channels.json, and target receipt paths before it runs',
    );
  }
}

function resolveReceiptDestination({ root, stableTag, unverified, requested }) {
  if (!unverified) {
    if (requested) throw new Error('--receipt-output is fixtures/tests only; real promotions write docs-promotions/<stable-tag>.json');
    const repoPath = promotionReceiptPath(stableTag);
    return { absolute: absoluteReceiptPath(root, repoPath), repoPath };
  }
  if (!requested) throw new Error('fixture promotion requires --receipt-output <temporary-path>');
  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(process.cwd(), requested);
  if (repositoryRelativePath(root, absolute) !== null) {
    throw new Error('unverified fixture receipts must be written outside the repository');
  }
  return { absolute, repoPath: null };
}

async function assertPromotionPreimageSafe(root) {
  await worktreeChannelInventory(root, 'stable');
  const channels = await lstat(join(root, 'channels.json'));
  if (channels.isSymbolicLink() || !channels.isFile()) {
    throw new Error('channels.json must be a regular file before promotion');
  }
}

async function assertBetaSourceMatchesBinding({ root, betaSource, betaCommit }) {
  const worktreeInventory = await worktreeChannelInventory(root, 'beta', betaSource);
  if (!betaCommit) return;
  const gitInventory = gitChannelInventory(root, betaCommit, 'beta');
  if (canonicalJson(worktreeInventory) !== canonicalJson(gitInventory)) {
    throw new Error('checked-out Beta source does not equal the bound Git tree');
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' }, // stable bundle dir (manifest.json + release-notes.md)
      // Exact git snapshot for real promotion (must equal refs/tags/docs/{promotedFrom}).
      'beta-ref': { type: 'string' },
      betaRef: { type: 'string' },
      // Fixture-only local tree; requires --allow-unverified-beta-source.
      'beta-source': { type: 'string' },
      betaSource: { type: 'string' },
      'allow-unverified-beta-source': { type: 'boolean', default: false },
      'receipt-output': { type: 'string' },
      repoRoot: { type: 'string', default: repoRoot },
    },
  });
  if (!values.bundle) throw new Error('provide --bundle <stable-bundle-dir>');

  const manifestBytes = await readFile(join(values.bundle, 'manifest.json'));
  const releaseNotesSourceBytes = await readFile(join(values.bundle, 'release-notes.md'));
  const manifest = parseManifest(decodeUtf8(manifestBytes, 'manifest.json'), { expectedChannel: 'stable' });
  decodeUtf8(releaseNotesSourceBytes, 'release-notes.md');
  const promotedFrom = manifest.promotedFrom; // validated as a beta tag
  const unverified = Boolean(values['beta-source'] ?? values.betaSource);
  if (unverified && values['allow-unverified-beta-source'] !== true) {
    throw new Error(
      '--beta-source is fixtures/tests only and requires --allow-unverified-beta-source; real promotion requires a bound Beta git ref',
    );
  }
  const receiptDestination = resolveReceiptDestination({
    root: values.repoRoot,
    stableTag: manifest.tag,
    unverified,
    requested: values['receipt-output'],
  });
  const baseDocsCommit = resolveCommit(values.repoRoot, 'HEAD');
  if (!unverified) assertPromotionTargetsClean(values.repoRoot, receiptDestination.repoPath, manifest.tag);
  await assertPromotionPreimageSafe(values.repoRoot);
  await assertSafeReceiptDestination(values.repoRoot, receiptDestination.absolute);

  const { betaSource, worktree, boundRef, betaCommit, betaChannelsTagProof } = resolveBetaSource({
    values,
    promotedFrom,
    root: values.repoRoot,
  });

  try {
    await assertBetaSourceMatchesBinding({ root: values.repoRoot, betaSource, betaCommit });
    const res = await promoteToStable({
      repoRoot: values.repoRoot,
      betaSourceDir: betaSource,
      manifest,
      bundleDir: values.bundle,
      releaseNotesSourceBytes,
    });
    let evidenceCreated = false;
    try {
      if (boundRef) {
        await createPromotionEvidence({
          root: values.repoRoot,
          stableTag: manifest.tag,
          manifestBytes,
          releaseNotesSourceBytes,
        });
        evidenceCreated = true;
      }
      const receipt = await createPromotionReceipt({
        root: values.repoRoot,
        baseDocsCommit,
        manifest,
        manifestBytes,
        releaseNotesSourceBytes,
        betaRef: boundRef,
        betaCommit,
        betaChannelsTagProof,
        unverifiedBetaSourceDir: boundRef ? null : betaSource,
        receiptPath: receiptDestination.absolute,
      });
      const branch = `docs-promotion/${res.tag}`;
      console.log(JSON.stringify({
        ...res,
        branch,
        betaRef: boundRef,
        receipt: receiptDestination.repoPath ?? receiptDestination.absolute,
        evidence: receipt.evidence,
        receiptDigest: receipt.receiptDigest,
      }));
      const bound = boundRef ? ` from ${boundRef}` : ' from unverified local beta-source';
      console.error(`promoted ${res.promotedFrom} → stable ${res.tag}${bound}; open PR on branch ${branch}`);
    } catch (error) {
      if (evidenceCreated) await removePromotionEvidence(values.repoRoot, manifest.tag).catch(() => {});
      throw error;
    }
    return;
  } finally {
    cleanupWorktree(worktree, values.repoRoot);
    if (worktree) {
      // Async cleanup in case sync remove left anything (rare).
      await rm(worktree, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(`promote-docs failed: ${err.message}`);
  process.exit(1);
});
