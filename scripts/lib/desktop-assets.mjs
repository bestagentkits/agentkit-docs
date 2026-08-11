// Layer A of the Desktop three-layer refresh: mechanical rewrite of every
// ak-gui reference in content/docs/<channel>/desktop-app/**. The docs bundle
// carries no Desktop payload, so evidence comes from the release-page
// ak-gui_*.zip/AppImage metadata (name, size, sha256).
//
// Deterministic: same (fromTag, toTag, assets) → same file bytes.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PLATFORM_KEYS = ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'windows_amd64'];
const AK_GUI_ASSET_RE = /^ak-gui_[\d.\w-]+_(darwin_amd64|darwin_arm64|linux_amd64|windows_amd64)\.(zip|AppImage)$/;

/**
 * Extract the platform key from an ak-gui asset filename.
 * @param {string} name Release asset filename.
 * @returns {string|null} Platform key or null if the name does not match.
 */
export function classifyAsset(name) {
  const m = name.match(AK_GUI_ASSET_RE);
  return m ? m[1] : null;
}

/**
 * Turn a list of release assets into a {platformKey: {size, sha256}} map.
 * Missing platforms throw so the caller cannot silently drop a row.
 * @param {Array<{name: string, size: number, sha256: string}>} assets
 */
export function buildPlatformMap(assets) {
  const map = {};
  for (const asset of assets) {
    const key = classifyAsset(asset.name);
    if (!key) continue;
    if (map[key]) {
      throw new Error(`duplicate ak-gui asset for platform ${key}: ${map[key].name} and ${asset.name}`);
    }
    if (typeof asset.size !== 'number' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`ak-gui asset ${asset.name} missing size or sha256`);
    }
    map[key] = { name: asset.name, size: asset.size, sha256: asset.sha256 };
  }
  const missing = PLATFORM_KEYS.filter((k) => !map[k]);
  if (missing.length) {
    throw new Error(`ak-gui assets missing for platforms: ${missing.join(', ')}`);
  }
  return map;
}

async function collectMdx(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.mdx')) {
      files.push(join(e.parentPath ?? e.path, e.name));
    }
  }
  return files.sort();
}

function escapeForRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite each artifact-table row for the given platform to the new size + sha256.
 * The row shape (filename column, size column, sha256 column) is invariant
 * across EN and VI installation pages, so one regex covers both.
 */
function rewriteArtifactTable(source, platforms, toVersion) {
  let out = source;
  for (const [key, meta] of Object.entries(platforms)) {
    const escapedName = escapeForRegex(meta.name);
    // Row pattern: | ... | `<filename>` | <size> | `<sha256>` |
    const rowRe = new RegExp(
      `(\\| \`${escapedName}\` \\| )[\\d,]+( \\| \`)[a-f0-9]{64}(\` \\|)`,
      'g',
    );
    out = out.replace(rowRe, (_, pre, mid, tail) => `${pre}${meta.size.toLocaleString('en-US')}${mid}${meta.sha256}${tail}`);
  }
  return out;
}

/**
 * Apply Desktop Layer A refresh: bulk swap the tag and rewrite the artifact
 * table across every *.mdx in content/docs/<channel>/desktop-app/.
 *
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {'beta'|'stable'} args.channel
 * @param {string} args.fromTag Previous tag (e.g. v2.12.1-beta.6). Used only for token swap.
 * @param {string} args.toTag New tag (e.g. v2.12.1-beta.8). Prose lines swap to this token.
 * @param {Array<{name:string,size:number,sha256:string}>} args.assets Release-page ak-gui assets.
 * @returns {Promise<{changed: string[], platforms: number}>}
 */
export async function syncDesktopAssets({ repoRoot, channel, fromTag, toTag, assets }) {
  if (!fromTag || !toTag) throw new Error('syncDesktopAssets requires fromTag and toTag');
  const platforms = buildPlatformMap(assets);
  if (fromTag === toTag) return { changed: [], platforms: Object.keys(platforms).length };

  const desktopDir = join(repoRoot, 'content', 'docs', channel, 'desktop-app');
  const files = await collectMdx(desktopDir);
  // Strip the leading v so both `v2.12.1-beta.8` and `2.12.1-beta.8` land in one pass.
  const fromToken = fromTag.replace(/^v/, '');
  const toToken = toTag.replace(/^v/, '');
  const tokenRe = new RegExp(escapeForRegex(fromToken), 'g');

  const changed = [];
  for (const path of files) {
    const before = await readFile(path, 'utf8');
    let after = before.replace(tokenRe, toToken);
    after = rewriteArtifactTable(after, platforms, toToken);
    if (after !== before) {
      await writeFile(path, after);
      changed.push(path);
    }
  }
  return { changed, platforms: Object.keys(platforms).length };
}
