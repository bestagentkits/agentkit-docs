#!/usr/bin/env node
// Beta docs sync: apply a docs-bundle to content/docs/beta and update
// channels.json. Bundle source is a local path (fixtures/tests) or, in CI, a
// tag whose `docs-bundle.tar.gz` asset is downloaded from ak-cli via `gh`.
//
//   node scripts/sync-release.mjs --bundle fixtures/docs-bundle-beta
//   node scripts/sync-release.mjs --bundle path/to/docs-bundle.tar.gz
//   node scripts/sync-release.mjs --tag v0.42.0-beta.7          # CI: gh download
//
// After the bundle applies, Layer A of the Desktop three-layer refresh runs
// automatically: ak-gui asset metadata is fetched from the release page and
// content/docs/<channel>/desktop-app/**.mdx are rewritten in place. Pass
// --skip-desktop to opt out (rare — a release with no ak-gui assets), or
// --desktop-assets <path> to load asset metadata from a local JSON file
// (test fixtures).
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBetaRelease } from './lib/sync.mjs';
import { syncDesktopAssets } from './lib/desktop-assets.mjs';
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

// gh api releases/tags/<tag> returns per-asset `digest` = "sha256:<hex>". Pull
// name + size + sha256 for every ak-gui asset the Desktop layer will render.
function fetchAkGuiAssets({ tag, repo }) {
  const raw = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/releases/tags/${tag}`,
      '--jq',
      '[.assets[] | select(.name | test("^ak-gui_.*\\\\.(zip|AppImage)$")) | {name, size, digest}]',
    ],
    { encoding: 'utf8' },
  );
  const raws = JSON.parse(raw);
  return raws.map((a) => {
    const m = /^sha256:([a-f0-9]{64})$/.exec(a.digest ?? '');
    if (!m) throw new Error(`asset ${a.name} missing sha256 digest on release ${tag}`);
    return { name: a.name, size: a.size, sha256: m[1] };
  });
}

async function loadDesktopAssets({ tag, repo, desktopAssets }) {
  if (desktopAssets) {
    const parsed = JSON.parse(await readFile(desktopAssets, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`--desktop-assets ${desktopAssets} must be a JSON array`);
    return parsed;
  }
  return fetchAkGuiAssets({ tag, repo });
}

async function readPreviousTag({ repoRoot: root, channel }) {
  try {
    const channels = JSON.parse(await readFile(join(root, 'channels.json'), 'utf8'));
    return channels[channel]?.tag ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' },
      tag: { type: 'string' },
      repo: { type: 'string', default: process.env.AK_CLI_REPO ?? 'bestagentkits/agentkit' },
      repoRoot: { type: 'string', default: repoRoot },
      skipDesktop: { type: 'boolean', default: false },
      desktopAssets: { type: 'string' },
    },
  });
  if (!values.bundle && !values.tag) {
    throw new Error('provide --bundle <path> or --tag <vX.Y.Z-beta.N>');
  }
  const bundleDir = await resolveBundleDir(values);
  const fromTag = await readPreviousTag({ repoRoot: values.repoRoot, channel: 'beta' });
  const summary = await syncBetaRelease({ repoRoot: values.repoRoot, bundleDir });

  let desktop = { skipped: true };
  if (!values.skipDesktop && fromTag && fromTag !== summary.tag) {
    const assets = await loadDesktopAssets({
      tag: summary.tag,
      repo: values.repo,
      desktopAssets: values.desktopAssets,
    });
    const result = await syncDesktopAssets({
      repoRoot: values.repoRoot,
      channel: 'beta',
      fromTag,
      toTag: summary.tag,
      assets,
    });
    desktop = { skipped: false, changed: result.changed.length, platforms: result.platforms };
  }

  // Machine-readable line for the workflow to build a commit message.
  console.log(JSON.stringify({ ...summary, desktop }));
  console.error(
    `synced beta ${summary.tag} (${summary.referenceFiles} reference files, sha ${summary.sha})`,
  );
  if (!desktop.skipped) {
    console.error(`refreshed ${desktop.changed} desktop-app pages for ${desktop.platforms} platforms`);
  }
}

main().catch((err) => {
  console.error(`sync-release failed: ${err.message}`);
  process.exit(1);
});
