import type { LayoutTab } from 'fumadocs-ui/layouts/shared';
import type * as PageTree from 'fumadocs-core/page-tree';

export const productKeys = [
  'docs',
  'kits',
  'cli',
  'desktop',
  'changelog',
] as const;

export type ProductKey = (typeof productKeys)[number];

const productLabels: Record<'en' | 'vi', Record<ProductKey, string>> = {
  en: {
    docs: 'Docs',
    kits: 'Kits',
    cli: 'CLI Reference',
    desktop: 'Desktop App',
    changelog: 'Changelog',
  },
  vi: {
    docs: 'Tài liệu',
    kits: 'Bộ kit',
    cli: 'Tham chiếu CLI',
    desktop: 'Ứng dụng Desktop',
    changelog: 'Nhật ký thay đổi',
  },
};

function productFromUrl(url: string): ProductKey {
  const section = url.split('/').filter(Boolean)[2];

  if (section === 'kits') return 'kits';
  if (section === 'reference') return 'cli';
  if (section === 'desktop-app') return 'desktop';
  if (section === 'changelog') return 'changelog';
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

  return {
    ...node,
    children: node.children.filter(
      (child) => productFromNode(child) === product,
    ),
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
    {
      title: labels.changelog,
      url: `${prefix}/changelog`,
      urls: urls.changelog,
    },
  ];
}
