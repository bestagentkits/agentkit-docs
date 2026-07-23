import type * as PageTree from 'fumadocs-core/page-tree';
import type { LinkItemType } from 'fumadocs-ui/layouts/shared';
import { i18n } from './i18n';
import {
  channelFromSlug,
  getChannelVersion,
  type ChannelId,
} from './channels';
import { localePath } from './locale-path';

export type DocsSection = 'docs' | 'reference';

const REFERENCE_FOLDER = '/reference';

const sectionLabels = {
  en: { docs: 'Docs', reference: 'CLI Reference' },
  vi: { docs: 'Tài liệu', reference: 'Tham chiếu CLI' },
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
  return rest[0] === 'reference' ? 'reference' : 'docs';
}

function isReferenceFolder(node: PageTree.Node): boolean {
  if (node.type !== 'folder') return false;
  const folder = node.$ref?.folder ?? '';
  if (folder.endsWith(REFERENCE_FOLDER) || folder.endsWith('reference')) {
    return true;
  }
  return node.index?.url.includes('/reference') ?? false;
}

function filterChannelChildren(
  children: PageTree.Node[],
  section: DocsSection,
): PageTree.Node[] {
  if (section === 'reference') {
    return children.filter(isReferenceFolder);
  }
  return children.filter((node) => !isReferenceFolder(node));
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

/** Scope the sidebar tree to Docs vs CLI Reference within each channel root. */
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

/** Add the released version label to channel dropdown entries. */
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

export function buildSectionNavLinks(
  locale: string,
  channel: ChannelId,
): LinkItemType[] {
  const labels = sectionLabels[locale as keyof typeof sectionLabels] ?? sectionLabels.en;

  return [
    {
      type: 'main',
      text: labels.docs,
      url: localePath(locale, channel, 'getting-started'),
      on: 'nav',
      active: 'nested-url',
    },
    {
      type: 'main',
      text: labels.reference,
      url: localePath(locale, channel, 'reference', 'cli'),
      on: 'nav',
      active: 'nested-url',
    },
  ];
}
