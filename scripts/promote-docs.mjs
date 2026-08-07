#!/usr/bin/env node
// Stable promotion: whole-copy the exact beta docs tree for
// manifest.promotedFrom into content/docs/stable, rewrite stable release notes
// from the bundle, and update channels.json.stable. Emits a branch name for a
// reviewed PR (stable is never direct-committed under the manual operating model).
//
// Real promotion always binds a git snapshot (default tag docs/{promotedFrom}):
//   node scripts/promote-docs.mjs --bundle path/to/docs-bundle-stable
//   node scripts/promote-docs.mjs --bundle path/to/docs-bundle-stable --beta-ref docs/v2.8.0-beta.14
//
// Fixture / unit-test only (not evidence of promotedFrom):
//   node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable \
//     --beta-source /tmp/fixture-beta --allow-unverified-beta-source
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from './lib/manifest.mjs';
import { promoteToStable } from './lib/promote.mjs';
import { repoRoot } from './lib/paths.mjs';

function gitRevParse(ref, cwd) {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
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
    return { betaSource, worktree: null, boundRef: null };
  }

  const ref = betaRefOpt || `docs/${promotedFrom}`;
  try {
    gitRevParse(ref, root);
  } catch {
    throw new Error(
      `cannot resolve beta docs snapshot ref ${JSON.stringify(ref)} ` +
        `(expected the exact docs tree for promotedFrom ${promotedFrom}). ` +
        'Fetch or create that tag/ref before promoting.',
    );
  }

  const worktree = mkdtempSync(join(tmpdir(), 'promote-'));
  try {
    // Keep stdout clean (CLI prints one JSON summary line on success).
    execFileSync('git', ['worktree', 'add', '--detach', worktree, ref], {
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
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' }, // stable bundle dir (manifest.json + release-notes.md)
      // Exact git snapshot for real promotion (default: docs/{promotedFrom}).
      'beta-ref': { type: 'string' },
      betaRef: { type: 'string' },
      // Fixture-only local tree; requires --allow-unverified-beta-source.
      'beta-source': { type: 'string' },
      betaSource: { type: 'string' },
      'allow-unverified-beta-source': { type: 'boolean', default: false },
      repoRoot: { type: 'string', default: repoRoot },
    },
  });
  if (!values.bundle) throw new Error('provide --bundle <stable-bundle-dir>');

  const manifest = parseManifest(
    await readFile(join(values.bundle, 'manifest.json'), 'utf8'),
    { expectedChannel: 'stable' },
  );
  const promotedFrom = manifest.promotedFrom; // validated as a beta tag

  const { betaSource, worktree, boundRef } = resolveBetaSource({
    values,
    promotedFrom,
    root: values.repoRoot,
  });

  try {
    const res = await promoteToStable({
      repoRoot: values.repoRoot,
      betaSourceDir: betaSource,
      manifest,
      bundleDir: values.bundle,
    });
    const branch = `docs-promotion/${res.tag}`;
    console.log(JSON.stringify({ ...res, branch, betaRef: boundRef }));
    const bound = boundRef ? ` from ${boundRef}` : ' from unverified local beta-source';
    console.error(`promoted ${res.promotedFrom} → stable ${res.tag}${bound}; open PR on branch ${branch}`);
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
