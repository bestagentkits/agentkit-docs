#!/usr/bin/env node
// Stable promotion: whole-copy the beta docs tree at tag docs/{promotedFrom}
// into content/docs/stable. Emits a branch name; the workflow opens the PR
// (stable is never direct-committed).
//
//   node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable
//   node scripts/promote-docs.mjs --bundle <dir> --beta-source <dir>   # skip git checkout (tests)
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from './lib/manifest.mjs';
import { promoteToStable } from './lib/promote.mjs';
import { repoRoot } from './lib/paths.mjs';

async function main() {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' }, // stable bundle dir (for manifest.json)
      betaSource: { type: 'string' }, // optional: prebuilt beta tree (skip git)
      repoRoot: { type: 'string', default: repoRoot },
    },
  });
  if (!values.bundle) throw new Error('provide --bundle <stable-bundle-dir>');

  const manifest = parseManifest(
    await readFile(join(values.bundle, 'manifest.json'), 'utf8'),
    { expectedChannel: 'stable' },
  );
  const promotedFrom = manifest.promotedFrom; // validated as a beta tag

  let betaSource = values.betaSource;
  let worktree;
  if (!betaSource) {
    // Check out the exact docs state that matched the promoted beta.
    worktree = await mkdtemp(join(tmpdir(), 'promote-'));
    execFileSync('git', ['worktree', 'add', '--detach', worktree, `docs/${promotedFrom}`], {
      cwd: values.repoRoot,
      stdio: 'inherit',
    });
    betaSource = join(worktree, 'content', 'docs', 'beta');
  }

  try {
    const res = await promoteToStable({ repoRoot: values.repoRoot, betaSourceDir: betaSource, manifest });
    const branch = `docs-promotion/${res.tag}`;
    console.log(JSON.stringify({ ...res, branch }));
    console.error(`promoted ${res.promotedFrom} → stable ${res.tag}; open PR on branch ${branch}`);
  } finally {
    if (worktree) {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: values.repoRoot });
      await rm(worktree, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(`promote-docs failed: ${err.message}`);
  process.exit(1);
});
