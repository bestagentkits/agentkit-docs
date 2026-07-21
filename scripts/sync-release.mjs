#!/usr/bin/env node
// Beta docs sync: apply a docs-bundle to content/docs/beta and update
// channels.json. Bundle source is a local path (fixtures/tests) or, in CI, a
// tag whose `docs-bundle.tar.gz` asset is downloaded from ak-cli via `gh`.
//
//   node scripts/sync-release.mjs --bundle fixtures/docs-bundle-beta
//   node scripts/sync-release.mjs --bundle path/to/docs-bundle.tar.gz
//   node scripts/sync-release.mjs --tag v0.42.0-beta.7          # CI: gh download
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBetaRelease } from './lib/sync.mjs';
import { repoRoot } from './lib/paths.mjs';

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function extractTarball(tar) {
  const dir = await mkdtemp(join(tmpdir(), 'docs-bundle-'));
  execFileSync('tar', ['-xzf', tar, '-C', dir]);
  return dir;
}

async function resolveBundleDir({ bundle, tag, repo }) {
  if (bundle) {
    return (await isDir(bundle)) ? bundle : extractTarball(bundle);
  }
  // --tag path: download the release asset from the (private) ak-cli repo.
  const dir = await mkdtemp(join(tmpdir(), 'docs-bundle-'));
  execFileSync(
    'gh',
    ['release', 'download', tag, '--repo', repo, '--pattern', 'docs-bundle.tar.gz', '--dir', dir],
    { stdio: 'inherit' },
  );
  execFileSync('tar', ['-xzf', join(dir, 'docs-bundle.tar.gz'), '-C', dir]);
  return dir;
}

async function main() {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' },
      tag: { type: 'string' },
      repo: { type: 'string', default: process.env.AK_CLI_REPO ?? 'bestagentkits/agentkit' },
      repoRoot: { type: 'string', default: repoRoot },
    },
  });
  if (!values.bundle && !values.tag) {
    throw new Error('provide --bundle <path> or --tag <vX.Y.Z-beta.N>');
  }
  const bundleDir = await resolveBundleDir(values);
  const summary = await syncBetaRelease({ repoRoot: values.repoRoot, bundleDir });
  // Machine-readable line for the workflow to build a commit message.
  console.log(JSON.stringify(summary));
  console.error(
    `synced beta ${summary.tag} (${summary.referenceFiles} reference files, sha ${summary.sha})`,
  );
}

main().catch((err) => {
  console.error(`sync-release failed: ${err.message}`);
  process.exit(1);
});
