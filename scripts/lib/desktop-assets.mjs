// Desktop release evidence acquisition and historical text replay.
// Current marker-based pages resolve immutable metadata at build time.
// Legacy snapshots retain deterministic (fromTag, toTag, assets) rewrites.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
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
function rewriteArtifactTable(source, platforms) {
  let out = source;
  for (const meta of Object.values(platforms)) {
    const escapedName = escapeForRegex(meta.name);
    const size = meta.size.toLocaleString('en-US');
    const replacements = [
      new RegExp(`(\\| \`${escapedName}\` \\| )[\\d,]+( \\| \`)[a-f0-9]{64}(\` \\|)`, 'g'),
      new RegExp(
        `(\\| \\\[\`${escapedName}\`\\\]\\([^)]+\\) \\| )[\\d,]+( \\| \`)[a-f0-9]{64}(\` \\|)`,
        'g',
      ),
    ];
    for (const rowRe of replacements) {
      out = out.replace(rowRe, (_, pre, mid, tail) => `${pre}${size}${mid}${meta.sha256}${tail}`);
    }
  }
  return out;
}

export function applyDesktopLayerAText(source, fromTag, toTag, assets) {
  if (!fromTag || !toTag) throw new Error('applyDesktopLayerAText requires fromTag and toTag');
  const platforms = buildPlatformMap(assets);
  if (fromTag === toTag) return source;
  const fromToken = fromTag.replace(/^v/, '');
  const toToken = toTag.replace(/^v/, '');
  const tokenRe = new RegExp(escapeForRegex(fromToken), 'g');
  return rewriteArtifactTable(source.replace(tokenRe, toToken), platforms);
}

/**
 * Persist release evidence; marker-based pages require no source edits.
 * Replay the legacy text transform only for historical snapshots.
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
  if (!['beta', 'stable'].includes(channel)) throw new Error('Invalid Desktop channel');
  const platforms = buildPlatformMap(assets);
  for (const asset of Object.values(platforms)) {
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !asset.name.startsWith(`ak-gui_${toTag.slice(1)}_`)) throw new Error('Desktop asset version/size mismatch');
  }

  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(toTag)) throw new Error('Invalid Desktop evidence tag');
  const evidenceDir = join(repoRoot, 'release-evidence', 'desktop');
  await mkdir(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, `${toTag}.json`);
  const evidenceText = JSON.stringify({ schemaVersion: 1, tag: toTag, fromTag, assets }, null, 2) + '\n';
  let previous;
  try { previous = await readFile(evidencePath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && previous !== evidenceText) {
    const recorded = JSON.parse(previous);
    // A same-tag coverage audit preserves the original transition provenance.
    const sameRelease = fromTag === toTag && recorded.schemaVersion === 1 && recorded.tag === toTag && JSON.stringify(recorded.assets) === JSON.stringify(assets);
    if (!sameRelease) throw new Error(`Conflicting Desktop evidence: ${toTag}`);
  }
  if (!previous) await writeFile(evidencePath, evidenceText);
  const desktopDir = join(repoRoot, 'content', 'docs', channel, 'desktop-app');
  const files = await collectMdx(desktopDir);
  const changed = [];
  for (const path of files) {
    const before = await readFile(path, 'utf8');
    const after = /AK_DESKTOP_|<DesktopDownloads/.test(before) ? before : applyDesktopLayerAText(before, fromTag, toTag, assets);
    if (after !== before) {
      await writeFile(path, after);
      changed.push(path);
    }
  }
  return { changed, platforms: PLATFORM_KEYS.length };
}
