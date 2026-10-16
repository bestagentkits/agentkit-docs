import assert from 'node:assert/strict';
import test from 'node:test';
import { initAdvancedSearch } from 'fumadocs-core/search/server';
import {
  SEARCH_SHARD_DATABASE_OPTIONS,
  buildDiscoveryIndex,
  buildScopedDiscoveryIndex,
  groupPublishedPagesByScope,
  pageBreadcrumbs,
} from '../lib/search-index.mjs';
import { initSearchShard, querySearchShard } from '../lib/search-client.mjs';

const structuredData = {
  headings: [{ id: 'install', content: 'Install AgentKit' }],
  contents: [{ heading: 'install', content: 'Body-only installation detail' }],
};

function page(url, extra = {}) {
  return {
    url,
    data: {
      title: url,
      structuredData,
    },
    ...extra,
  };
}

function sourceFixture(pagesByLocale, treesByLocale) {
  return {
    getPages: (locale) => pagesByLocale[locale] ?? [],
    getPageTree: (locale) => treesByLocale[locale],
  };
}

test('buildDiscoveryIndex keeps discovery fields and removes body chunks', async () => {
  const result = await buildDiscoveryIndex({
    url: '/en/stable/installation',
    data: {
      title: 'Installation',
      description: 'Install AgentKit.',
      structuredData,
    },
  });

  assert.deepEqual(result, {
    title: 'Installation',
    description: 'Install AgentKit.',
    id: '/en/stable/installation',
    url: '/en/stable/installation',
    structuredData: {
      headings: structuredData.headings,
      contents: [],
    },
  });
});

test('buildDiscoveryIndex supports lazy page data', async () => {
  const result = await buildDiscoveryIndex({
    url: '/vi/beta/installation',
    data: {
      title: 'Cài đặt',
      structuredData: async () => structuredData,
    },
  });

  assert.deepEqual(result.structuredData.contents, []);
  assert.deepEqual(result.structuredData.headings, structuredData.headings);
});

test('buildDiscoveryIndex falls back to page data load', async () => {
  const result = await buildDiscoveryIndex({
    url: '/en/stable/lazy',
    data: {
      title: 'Lazy page',
      load: async () => ({ structuredData }),
    },
  });

  assert.deepEqual(result.structuredData.contents, []);
});

test('buildDiscoveryIndex rejects a page without structured data', async () => {
  await assert.rejects(
    () => buildDiscoveryIndex({ url: '/en/stable/empty', data: { title: 'Empty' } }),
    /Cannot find structured search data/,
  );
});

test('groupPublishedPagesByScope partitions pages by URL scope', () => {
  const { scopes, outsideChannel } = groupPublishedPagesByScope([
    page('/en/stable/getting-started'),
    page('/en/beta/getting-started'),
    page('/vi/stable/getting-started'),
    page('/en/_showcase'),
  ]);

  assert.deepEqual(
    [...scopes.get('en/stable')].map((entry) => entry.url),
    ['/en/stable/getting-started'],
  );
  assert.deepEqual(
    [...scopes.get('en/beta')].map((entry) => entry.url),
    ['/en/beta/getting-started'],
  );
  assert.deepEqual([...scopes.get('vi/stable')].map((entry) => entry.url), ['/vi/stable/getting-started']);
  assert.deepEqual([...scopes.get('vi/beta')], []);
  assert.deepEqual(outsideChannel, ['/en/_showcase']);
});

test('groupPublishedPagesByScope rejects malformed and duplicated URLs', () => {
  assert.throws(
    () => groupPublishedPagesByScope([page('/_showcase')]),
    /not prefixed with a supported locale/,
  );
  assert.throws(
    () => groupPublishedPagesByScope([{ url: 'en/stable/page', data: { structuredData } }]),
    /malformed docs URL/,
  );
  assert.throws(
    () =>
      groupPublishedPagesByScope([
        page('/en/stable/installation'),
        page('/en/stable/installation'),
      ]),
    /Duplicate searchable page URL/,
  );
});

test('buildScopedDiscoveryIndex keeps one scope and attaches page breadcrumbs', async () => {
  const tree = {
    name: undefined,
    children: [
      {
        type: 'folder',
        name: 'Beta',
        root: true,
        children: [
          {
            type: 'folder',
            name: 'Getting started',
            children: [{ type: 'page', name: 'Installation', url: '/en/beta/installation' }],
          },
        ],
      },
      {
        type: 'folder',
        name: 'Stable',
        root: true,
        children: [{ type: 'page', name: 'Installation', url: '/en/stable/installation' }],
      },
    ],
  };
  const source = sourceFixture(
    { en: [page('/en/beta/installation'), page('/en/stable/installation'), page('/en/_showcase')] },
    { en: tree },
  );

  const indexes = await buildScopedDiscoveryIndex(source, 'en', 'stable');

  assert.deepEqual(indexes.map((index) => index.url), ['/en/stable/installation']);
  assert.deepEqual(indexes[0].breadcrumbs, ['Stable']);
});

test('buildScopedDiscoveryIndex rejects an unsupported scope', async () => {
  const source = sourceFixture({ en: [] }, {});
  await assert.rejects(() => buildScopedDiscoveryIndex(source, 'fr', 'stable'), /unsupported search scope/);
});

test('pageBreadcrumbs returns undefined for a page outside the tree', () => {
  assert.equal(pageBreadcrumbs({ children: [] }, { url: '/en/stable/missing' }), undefined);
});

async function channelIndexes(urls) {
  const tree = {
    name: 'Docs',
    children: [
      {
        type: 'folder',
        name: 'Stable',
        root: true,
        children: urls.map((url) => ({ type: 'page', name: url, url })),
      },
    ],
  };
  const source = sourceFixture({ en: urls.map((url) => page(url)) }, { en: tree });
  return buildScopedDiscoveryIndex(source, 'en', 'stable');
}

// Build the served artifact through the same Fumadocs API the shard route uses.
async function shardExport(indexes, options = {}) {
  const server = initAdvancedSearch({ indexes, language: 'english', ...options });
  return JSON.parse(JSON.stringify(await server.export()));
}

test('the shipped shard options drop the unused sort index and keep every document', async () => {
  const indexes = await channelIndexes(['/en/stable/installation', '/en/stable/testing']);
  const shipped = await shardExport(indexes, SEARCH_SHARD_DATABASE_OPTIONS);
  const defaultOptions = await shardExport(indexes);

  assert.equal(shipped.sorting.enabled, false);
  assert.equal(defaultOptions.sorting.enabled, true);
  assert.deepEqual(shipped.docs, defaultOptions.docs);
  assert.ok(
    JSON.stringify(shipped).length < JSON.stringify(defaultOptions).length,
    'the shipped shard export must not carry the sort index bytes',
  );
});

test('the shipped shard options leave query results unchanged', async () => {
  const indexes = await channelIndexes(['/en/stable/installation', '/en/stable/testing']);
  const shipped = await shardExport(indexes, SEARCH_SHARD_DATABASE_OPTIONS);
  const defaultOptions = await shardExport(indexes);

  for (const query of ['installation', 'testing']) {
    const expected = await querySearchShard(initSearchShard(defaultOptions), { query });
    assert.ok(expected.length > 0, `fixture query "${query}" must produce results`);
    assert.deepEqual(await querySearchShard(initSearchShard(shipped), { query }), expected);
  }
});
