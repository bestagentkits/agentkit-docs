import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPlatformMap } from './desktop-assets.mjs';

const LABELS = {
  darwin_amd64: 'macOS Intel', darwin_arm64: 'macOS Apple silicon',
  linux_amd64: 'Linux x64', windows_amd64: 'Windows x64',
};

export function readDesktopRelease(root, channel) {
  if (!['beta', 'stable'].includes(channel)) throw new Error(`Invalid Desktop channel: ${channel}`);
  const identity = JSON.parse(readFileSync(resolve(root, 'channels.json'), 'utf8'))[channel];
  if (!identity?.tag || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(identity.tag)) {
    throw new Error(`Desktop ${channel}: missing published channel tag`);
  }
  const evidence = JSON.parse(readFileSync(resolve(root, `release-evidence/desktop/${identity.tag}.json`), 'utf8'));
  if (evidence.schemaVersion !== 1 || evidence.tag !== identity.tag) throw new Error('Desktop evidence tag/schema mismatch');
  const platforms = buildPlatformMap(evidence.assets);
  for (const asset of Object.values(platforms)) {
    if (!asset.name.startsWith(`ak-gui_${identity.version}_`) || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Desktop asset does not match channel version or size: ${asset.name}`);
    }
  }
  return { tag: identity.tag, version: identity.version, platforms };
}

const text = (value) => ({ type: 'text', value });
const cell = (...children) => ({ type: 'tableCell', children });
const row = (...children) => ({ type: 'tableRow', children });
export function desktopDownloads(release, locale) {
  return {
    type: 'table', align: [null, null, 'right', null], children: [
      row(...(locale === 'vi' ? ['Nền tảng', 'Artifact', 'Bytes', 'SHA-256'] : ['Platform', 'Artifact', 'Bytes', 'SHA-256']).map((s) => cell(text(s)))),
      ...Object.entries(release.platforms).map(([key, asset]) => row(
        cell(text(LABELS[key] ?? key)),
        cell({ type: 'link', url: `https://github.com/bestagentkits/agentkit/releases/download/${release.tag}/${asset.name}`, children: [{ type: 'inlineCode', value: asset.name }] }),
        cell(text(asset.size.toLocaleString('en-US'))), cell({ type: 'inlineCode', value: asset.sha256 }),
      )),
    ],
  };
}

// Expand into ordinary Markdown nodes before Fumadocs extracts processed Markdown.
// No browser fetch, component-only data, or second copy of the release metadata.
export function expandDesktopRelease(tree, release, locale) {
  function replace(value) {
    return value.replace(/AK_DESKTOP_(VERSION|TAG|FILE_[a-z0-9_]+)/g, (_, key) => {
      if (key === 'VERSION') return release.version;
      if (key === 'TAG') return release.tag;
      const asset = release.platforms[key.slice(5)];
      if (!asset) throw new Error(`Unknown Desktop platform marker: ${key}`);
      return asset.name;
    });
  }
  function visit(node) {
    if (typeof node.value === 'string' && !['yaml', 'html'].includes(node.type)) node.value = replace(node.value);
    if (typeof node.url === 'string') node.url = replace(node.url);
    if (node.children) node.children = node.children.map((child) => {
      if (child.type === 'mdxJsxFlowElement' && child.name === 'DesktopDownloads') {
        if (child.attributes?.length || child.children?.length) throw new Error('DesktopDownloads does not accept attributes or children');
        return desktopDownloads(release, locale);
      }
      visit(child);
      return child;
    });
  }
  visit(tree);
}

export function remarkDesktopRelease(options = {}) {
  const root = options.root ?? process.cwd();
  return (tree, file) => {
    const path = String(file.path ?? '').replaceAll('\\', '/');
    const channel = path.match(/content\/docs\/(beta|stable)\/desktop-app\//)?.[1];
    if (!channel || !JSON.stringify(tree).match(/AK_DESKTOP_|DesktopDownloads/)) return;
    const release = readDesktopRelease(root, channel);
    // Match Fumadocs' include plugin: data-only updates must invalidate cached MDX.
    file.data?._compiler?.addDependency(resolve(root, 'channels.json'));
    file.data?._compiler?.addDependency(resolve(root, `release-evidence/desktop/${release.tag}.json`));
    expandDesktopRelease(tree, release, path.endsWith('.vi.mdx') ? 'vi' : 'en');
  };
}
