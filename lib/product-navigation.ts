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

// The Engineer entry keeps its product name in both locales: `Engineer` is the
// Kit's name, not a translatable noun.
const engineerEntryLabels: Record<'en' | 'vi', string> = {
  en: 'Engineer',
  vi: 'Engineer',
};

// Channel-relative Engineer landing route. The sidebar entry, the start links
// below and the search acceptance matrix all name this same route, so
// navigation and search cannot drift to different destinations.
export const ENGINEER_OVERVIEW_ROUTE = 'kits/engineer';

// One localized set of Engineer start-link descriptors, shared by the channel
// home and the Engineer landing. `route` is channel-relative and always
// resolved against the reader's own locale and channel — a link is never
// rewritten to another scope.
export const ENGINEER_START_LINKS = Object.freeze([
  Object.freeze({
    id: 'installation',
    route: 'getting-started/installation',
    labels: Object.freeze({ en: 'Installation', vi: 'Cài đặt' }),
  }),
  Object.freeze({
    id: 'engineer',
    route: ENGINEER_OVERVIEW_ROUTE,
    labels: Object.freeze({ en: 'Engineer overview', vi: 'Tổng quan Engineer' }),
  }),
  Object.freeze({
    id: 'engineer-skills',
    route: 'kits/engineer/skills',
    labels: Object.freeze({ en: 'Engineer Skills', vi: 'Skill Engineer' }),
  }),
  Object.freeze({
    id: 'workflows',
    route: 'kits/workflows',
    labels: Object.freeze({ en: 'Workflows', vi: 'Workflow' }),
  }),
  Object.freeze({
    id: 'migration',
    route: 'guides/migrating-from-claudekit',
    labels: Object.freeze({ en: 'Migration', vi: 'Chuyển từ ClaudeKit' }),
  }),
]);

const engineerStartLinkTitles: Record<'en' | 'vi', string> = {
  en: 'Start here',
  vi: 'Bắt đầu',
};

const engineerStartLinkAriaLabels: Record<'en' | 'vi', string> = {
  en: 'Engineer start links',
  vi: 'Liên kết bắt đầu Engineer',
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

// Every projected sidebar exposes exactly one immediately visible Engineer
// destination — one activation away in a freshly opened sidebar. The `kits`
// projection already renders the Engineer folder as a child of its
// `defaultOpen: true` catalog group, which is that visible destination and the
// natural folder/index representation; injecting a page node as well would
// duplicate the URL node, and Fumadocs renders a tree by node identity, so a
// duplicate is a real defect rather than a cosmetic one. The entry is therefore
// injected directly under the channel root only when the projection does not
// already expose that URL.
function withEngineerEntry(
  children: PageTree.Node[],
  { url, name, afterUrl }: { url: string; name: string; afterUrl: string },
): PageTree.Node[] {
  const exposed = new Set<string>();
  for (const child of children) collectPageUrls(child, exposed);
  if (exposed.has(url)) return children;

  const entry: PageTree.Item = { type: 'page', name, url };
  // Insert after the node that renders the catalog destination: the injected
  // Skill Catalog page on `docs`/`cli`/`desktop`, or the renamed Kits folder
  // (which owns the catalog URL as its index) on `kits`. Otherwise the entry
  // leads the projection and can push a group out of its reviewed position.
  const afterIndex = children.findIndex((child) =>
    child.type === 'page'
      ? child.url === afterUrl
      : child.type === 'folder' && child.index?.url === afterUrl,
  );
  if (afterIndex === -1) return [entry, ...children];

  return [
    ...children.slice(0, afterIndex + 1),
    entry,
    ...children.slice(afterIndex + 1),
  ];
}

function filterChannelRoot(
  node: PageTree.Node,
  product: ProductKey,
): PageTree.Node {
  if (node.type !== 'folder' || !node.root) return node;

  const { locale, channel } = resolveLocaleAndChannel(node);
  const catalogUrl = `/${locale}/${channel}/kits`;
  const catalogTitle = skillCatalogLabels[locale];
  const engineerEntry = {
    url: `/${locale}/${channel}/${ENGINEER_OVERVIEW_ROUTE}`,
    name: engineerEntryLabels[locale],
    afterUrl: catalogUrl,
  };

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
      children: withEngineerEntry(newChildren, engineerEntry),
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
      children: withEngineerEntry(newChildren, engineerEntry),
    };
  }

  if (product === 'cli' || product === 'desktop') {
    return {
      ...node,
      children: withEngineerEntry([skillCatalogPageNode, ...children], engineerEntry),
    };
  }

  return {
    ...node,
    children: withEngineerEntry(children, engineerEntry),
  };
}

export type EngineerStartLink = {
  id: string;
  label: string;
  href: string;
};

export type EngineerStartLinks = {
  title: string;
  ariaLabel: string;
  items: EngineerStartLink[];
  missing: string[];
};

// A link set is always built for one real channel. An unknown channel is a
// programming error: silently defaulting would point a Beta reader at Stable
// content (or the reverse) without any visible signal.
function resolveChannel(channel: string): 'stable' | 'beta' {
  if (channel !== 'stable' && channel !== 'beta') {
    throw new Error(
      `unsupported docs channel "${channel}"; expected "stable" or "beta"`,
    );
  }
  return channel;
}

// Resolve the Engineer start links for one locale and channel. `currentRoute`
// (channel-relative, `''` for the channel home) drops the self-link, and
// `exists` lets the caller resolve destinations against its own source tree:
// a route that does not exist in this scope is reported in `missing` and never
// rendered, so a missing Beta or VI page can never be answered by another
// channel's or locale's page.
export function engineerStartLinks({
  locale,
  channel,
  currentRoute = '',
  exists,
}: {
  locale: string;
  channel: string;
  currentRoute?: string;
  exists?: (route: string) => boolean;
}): EngineerStartLinks {
  const resolvedLocale: 'en' | 'vi' = locale === 'vi' ? 'vi' : 'en';
  const resolvedChannel = resolveChannel(channel);

  const items: EngineerStartLink[] = [];
  const missing: string[] = [];

  for (const link of ENGINEER_START_LINKS) {
    if (link.route === currentRoute) continue;
    if (exists && !exists(link.route)) {
      missing.push(link.route);
      continue;
    }

    items.push({
      id: link.id,
      label: link.labels[resolvedLocale],
      href: `/${resolvedLocale}/${resolvedChannel}/${link.route}`,
    });
  }

  return {
    title: engineerStartLinkTitles[resolvedLocale],
    ariaLabel: engineerStartLinkAriaLabels[resolvedLocale],
    items,
    missing,
  };
}

// The two surfaces that render the start-link block: the channel home (where
// the reader has no product context yet) and the Engineer landing (where the
// stated reach is one activation to each destination).
export function showsEngineerStartLinks(route: string): boolean {
  return route === '' || route === ENGINEER_OVERVIEW_ROUTE;
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
