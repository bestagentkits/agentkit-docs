// Build-time discovery indexes for the four static search shards.
//
// Fumadocs' `createFromSource` would export one database per locale containing
// both release channels; instead we group the published source pages by the
// locale/channel their URL actually belongs to and let each static shard route
// build its own index from that group. Discovery-only extraction is unchanged:
// titles, descriptions, headings and anchors stay, full body chunks do not.

import { findPath } from 'fumadocs-core/page-tree';
import {
  SEARCH_SCOPES,
  assertSupportedSearchScope,
  pageScopeFromUrl,
  searchScopeKey,
  searchScopePrefix,
} from './search-scopes.mjs';

// Database options every shard export is built with.
//
// Orama's sorter keeps, per sortable property, a value-ordered copy of the
// document ids so `sortBy` can seek into it. The advanced query path never
// sorts — it ranks hits by relevance and groups them by page — so that copy is
// dead payload: measured on the real shards it was ~0.97 MB of every ~5.6 MB
// export, and four shards share one 22 MiB aggregate budget. Disabling the
// sorter keeps every document, field and query result byte for byte; a `sortBy`
// on such a database throws Orama's SORT_DISABLED instead of returning a
// silently wrong order.
export const SEARCH_SHARD_DATABASE_OPTIONS = Object.freeze({
  sort: Object.freeze({ enabled: false }),
});

async function getStructuredData(page) {
  if (page.data.structuredData) {
    return typeof page.data.structuredData === 'function'
      ? page.data.structuredData()
      : page.data.structuredData;
  }

  if ('load' in page.data && typeof page.data.load === 'function') {
    return (await page.data.load()).structuredData;
  }

  return undefined;
}

export async function buildDiscoveryIndex(page) {
  const structuredData = await getStructuredData(page);
  if (!structuredData) {
    throw new Error(`Cannot find structured search data for ${page.url}`);
  }

  return {
    title: page.data.title ?? page.url,
    description: page.data.description,
    url: page.url,
    id: page.url,
    structuredData: {
      ...structuredData,
      contents: [],
    },
  };
}

function isBreadcrumbItem(item) {
  return typeof item === 'string' && item.length > 0;
}

// Mirrors the breadcrumbs Fumadocs' own index builder derives from the page
// tree, using its public `findPath` so separator and folder-index handling stay
// identical. Search results render these, so a Stable page must not inherit a
// copied "Beta" channel label here either.
export function pageBreadcrumbs(pageTree, page) {
  const path = findPath(
    pageTree.children,
    (node) => node.type === 'page' && node.url === page.url,
  );
  if (!path) return undefined;

  const breadcrumbs = [];
  path.pop();
  if (isBreadcrumbItem(pageTree.name)) breadcrumbs.push(pageTree.name);
  for (const segment of path) {
    if (!isBreadcrumbItem(segment.name)) continue;
    breadcrumbs.push(segment.name);
  }

  return breadcrumbs;
}

// Partition published source pages by the locale/channel of their URL.
// Pages outside every channel (for example the unlisted `_showcase` visual QA
// page) are real site pages but never search results, so they are reported
// separately rather than indexed into a channel.
export function groupPublishedPagesByScope(pages) {
  const scopes = new Map(SEARCH_SCOPES.map(({ locale, channel }) => [searchScopeKey(locale, channel), []]));
  const outsideChannel = [];
  const seenUrls = new Set();

  for (const page of pages) {
    const scope = pageScopeFromUrl(page.url);
    if (!scope) {
      outsideChannel.push(page.url);
      continue;
    }

    const key = searchScopeKey(scope.locale, scope.channel);
    if (seenUrls.has(page.url)) {
      throw new Error(`Duplicate searchable page URL: ${page.url}`);
    }
    seenUrls.add(page.url);
    scopes.get(key).push(page);
  }

  return { scopes, outsideChannel };
}

// Discovery indexes for one scope, ready for Fumadocs' advanced search API.
export async function buildScopedDiscoveryIndex(source, locale, channel) {
  assertSupportedSearchScope(locale, channel);

  const { scopes } = groupPublishedPagesByScope(source.getPages(locale));
  const pages = scopes.get(searchScopeKey(locale, channel)) ?? [];
  const pageTree = source.getPageTree(locale);
  const prefix = searchScopePrefix(locale, channel);

  const indexes = await Promise.all(
    pages.map(async (page) => {
      if (!page.url.startsWith(prefix)) {
        throw new Error(`Search index for ${locale}/${channel} received a foreign-scope page: ${page.url}`);
      }

      const index = await buildDiscoveryIndex(page);
      return {
        ...index,
        breadcrumbs: pageBreadcrumbs(pageTree, page),
      };
    }),
  );

  return indexes;
}
