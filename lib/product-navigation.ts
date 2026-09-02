import type { LayoutTab } from 'fumadocs-ui/layouts/shared';
import type * as PageTree from 'fumadocs-core/page-tree';

export const productKeys = ['docs', 'kits', 'cli', 'desktop'] as const;

export type ProductKey = (typeof productKeys)[number];

const productLabels: Record<'en' | 'vi', Record<ProductKey, string>> = {
  en: {
    docs: 'Docs',
    kits: 'Kits',
    cli: 'CLI Reference',
    desktop: 'Desktop App',
  },
  vi: {
    docs: 'Tài liệu',
    kits: 'Bộ kit',
    cli: 'Tham chiếu CLI',
    desktop: 'Ứng dụng Desktop',
  },
};
const skillCatalogLabels: Record<'en' | 'vi', string> = {
  en: 'Skill Catalog',
  vi: 'Danh mục Skill',
};

function resolveLocaleAndChannel(node: PageTree.Node): {
  locale: 'en' | 'vi';
  channel: string;
} {
  const url = firstPageUrl(node);
  if (!url) return { locale: 'en', channel: 'stable' };
  const segments = url.split('/').filter(Boolean);
  const locale = segments[0] === 'vi' ? 'vi' : 'en';
  const channel = segments[1] === 'beta' ? 'beta' : 'stable';
  return { locale, channel };
}

function productFromUrl(url: string): ProductKey {
  const section = url.split('/').filter(Boolean)[2];

  if (section === 'kits') return 'kits';
  if (section === 'reference') return 'cli';
  if (section === 'desktop-app') return 'desktop';
  return 'docs';
}

function firstPageUrl(node: PageTree.Node): string | undefined {
  if (node.type === 'page') return node.url;
  if (node.type === 'separator') return undefined;
  if (node.index) return node.index.url;

  for (const child of node.children) {
    const url = firstPageUrl(child);
    if (url) return url;
  }
}

function productFromNode(node: PageTree.Node): ProductKey | undefined {
  const url = firstPageUrl(node);
  return url ? productFromUrl(url) : undefined;
}

function collectPageUrls(node: PageTree.Node, urls: Set<string>) {
  if (node.type === 'page') {
    urls.add(node.url);
    return;
  }
  if (node.type === 'separator') return;

  if (node.index) urls.add(node.index.url);
  for (const child of node.children) collectPageUrls(child, urls);
}

function filterChannelRoot(
  node: PageTree.Node,
  product: ProductKey,
): PageTree.Node {
  if (node.type !== 'folder' || !node.root) return node;

  const { locale, channel } = resolveLocaleAndChannel(node);
  const catalogUrl = `/${locale}/${channel}/kits`;
  const catalogTitle = skillCatalogLabels[locale];

  const skillCatalogPageNode: PageTree.Item = {
    type: 'page',
    name: catalogTitle,
    url: catalogUrl,
  };

  const children = node.children.filter(
    (child) => productFromNode(child) === product,
  );

  if (product === 'docs') {
    const overviewIndex = children.findIndex(
      (child) => child.type === 'page' && child.url === `/${locale}/${channel}`,
    );

    const newChildren = [...children];
    if (overviewIndex >= 0) {
      newChildren.splice(overviewIndex + 1, 0, skillCatalogPageNode);
    } else {
      newChildren.unshift(skillCatalogPageNode);
    }

    return {
      ...node,
      children: newChildren,
    };
  }

  if (product === 'kits') {
    const newChildren = children.map((child) => {
      if (
        child.type === 'folder' &&
        (child.index?.url === catalogUrl ||
          child.name === 'Kits' ||
          child.name === 'Bộ kit')
      ) {
        return {
          ...child,
          name: catalogTitle,
        };
      }
      return child;
    });

    return {
      ...node,
      children: newChildren,
    };
  }

  if (product === 'cli' || product === 'desktop') {
    return {
      ...node,
      children: [skillCatalogPageNode, ...children],
    };
  }

  return {
    ...node,
    children,
  };
}

export function activeProduct(pathname: string): ProductKey {
  return productFromUrl(pathname);
}

export function filterTreeByProduct(
  tree: PageTree.Root,
  product: ProductKey,
): PageTree.Root {
  return {
    ...tree,
    // Fumadocs memoizes page trees by $id. Give each product projection a
    // distinct identity so switching tabs updates the sidebar immediately.
    $id: `${tree.$id ?? 'docs'}:${product}`,
    children: tree.children.map((node) => filterChannelRoot(node, product)),
    fallback: tree.fallback
      ? filterTreeByProduct(tree.fallback, product)
      : undefined,
  };
}

export function productTabs(
  tree: PageTree.Root,
  locale: string,
  channel: string,
): LayoutTab[] {
  const urls = Object.fromEntries(
    productKeys.map((product) => [product, new Set<string>()]),
  ) as Record<ProductKey, Set<string>>;

  for (const rootNode of tree.children) {
    if (rootNode.type !== 'folder' || !rootNode.root) continue;
    for (const node of rootNode.children) {
      const product = productFromNode(node);
      if (product) collectPageUrls(node, urls[product]);
    }
  }

  const prefix = `/${locale}/${channel}`;
  const labels = productLabels[locale === 'vi' ? 'vi' : 'en'];

  return [
    { title: labels.docs, url: prefix, urls: urls.docs },
    { title: labels.kits, url: `${prefix}/kits`, urls: urls.kits },
    {
      title: labels.cli,
      url: `${prefix}/reference/cli`,
      urls: urls.cli,
    },
    {
      title: labels.desktop,
      url: `${prefix}/desktop-app`,
      urls: urls.desktop,
    },
  ];
}
