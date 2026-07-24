import type * as PageTree from 'fumadocs-core/page-tree';
import type { LinkItemType } from 'fumadocs-ui/layouts/shared';
import { i18n } from './i18n';
import {
  channelFromSlug,
  getChannelVersion,
  type ChannelId,
} from './channels';
import { localePath } from './locale-path';

// Top-level areas shown as visible navbar tabs. Desktop App is a page inside
// Docs (one teaser), not its own area. `kits` stays a product term in both locales.
export type DocsSection = 'docs' | 'kits' | 'reference';

const REFERENCE_FOLDER = '/reference';

const sectionLabels = {
  en: { docs: 'Docs', kits: 'Kits', reference: 'CLI Reference' },
  vi: { docs: 'Tài liệu', kits: 'Kits', reference: 'Tham chiếu CLI' },
} as const;

/** Strip locale prefix and return slug segments under the docs mount. */
export function docsSlugFromPathname(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean);
  if (
    segments[0] &&
    (i18n.languages as readonly string[]).includes(segments[0])
  ) {
    return segments.slice(1);
  }
  return segments;
}

export function getActiveChannel(slug: string[]): ChannelId {
  return channelFromSlug(slug) ?? 'beta';
}

export function getDocsSection(slug: string[]): DocsSection {
  const channel = channelFromSlug(slug);
  const rest = channel ? slug.slice(1) : slug;
  const head = rest[0];
  if (head === 'reference') return 'reference';
  if (head === 'kits') return 'kits';
  return 'docs'; // getting-started, guides, desktop-app, index …
}

/** Classify a channel-child node into its top-nav area. */
function nodeArea(node: PageTree.Node): DocsSection {
  if (node.type === 'folder') {
    const folder = node.$ref?.folder ?? '';
    const url = node.index?.url ?? '';
    if (folder.endsWith(REFERENCE_FOLDER) || folder.endsWith('reference') || url.includes('/reference')) {
      return 'reference';
    }
    if (folder.endsWith('/kits') || folder.endsWith('kits') || url.includes('/kits')) {
      return 'kits';
    }
    return 'docs';
  }
  // Leaf pages (incl. the desktop-app teaser) live in Docs.
  return 'docs';
}

function filterChannelChildren(
  children: PageTree.Node[],
  section: DocsSection,
): PageTree.Node[] {
  return children.filter((node) => nodeArea(node) === section);
}

function filterRootChildren(
  children: PageTree.Node[],
  section: DocsSection,
): PageTree.Node[] {
  return children.map((node) => {
    if (node.type !== 'folder' || !node.root) return node;
    return {
      ...node,
      children: filterChannelChildren(node.children, section),
    };
  });
}

/** Scope the sidebar tree to the active area within each channel root. */
export function filterPageTreeBySection(
  tree: PageTree.Root,
  section: DocsSection,
): PageTree.Root {
  return {
    ...tree,
    children: filterRootChildren(tree.children, section),
    fallback: tree.fallback
      ? {
          ...tree.fallback,
          children: filterRootChildren(tree.fallback.children, section),
        }
      : undefined,
  };
}

function channelIdFromFolder(node: PageTree.Folder): ChannelId | null {
  const folder = node.$ref?.folder ?? '';
  if (folder.includes('/stable') || folder.endsWith('stable')) return 'stable';
  if (folder.includes('/beta') || folder.endsWith('beta')) return 'beta';
  const url = node.index?.url ?? '';
  if (url.includes('/stable')) return 'stable';
  if (url.includes('/beta')) return 'beta';
  return null;
}

/** Add the released train version label to the channel sidebar dropdown. */
export function transformChannelTab(
  option: import('fumadocs-ui/layouts/shared').LayoutTab,
  node: PageTree.Folder,
): import('fumadocs-ui/layouts/shared').LayoutTab | null {
  const channel = channelIdFromFolder(node);
  if (!channel) return option;

  const version = getChannelVersion(channel);
  const title =
    typeof option.title === 'string' ? option.title : String(node.name ?? option.title);

  return {
    ...option,
    title: version ? `${title} · ${version}` : title,
  };
}

// Visible top-nav area tabs: Docs · Kits · CLI Reference. Active tab is derived
// from the pathname (nested-url), keeping all areas one click away.
export function buildAreaNav(
  locale: string,
  channel: ChannelId,
): LinkItemType[] {
  const labels = sectionLabels[locale as keyof typeof sectionLabels] ?? sectionLabels.en;
  const tab = (text: string, ...segments: string[]): LinkItemType => ({
    type: 'main',
    text,
    url: localePath(locale, channel, ...segments),
    on: 'nav',
    active: 'nested-url',
  });

  return [
    tab(labels.docs, 'getting-started'),
    tab(labels.kits, 'kits'),
    tab(labels.reference, 'reference', 'cli'),
  ];
}
