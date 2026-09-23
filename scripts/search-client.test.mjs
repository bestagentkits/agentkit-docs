import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { initAdvancedSearch } from 'fumadocs-core/search/server';
import {
  SEARCH_PAGE_GROUP_LIMIT,
  SEARCH_PAGE_GROUP_MAX_RESULT,
  createScopedSearchClient,
  evictSearchShard,
  informativeSearchTerms,
  initSearchShard,
  loadSearchShard,
  normalizeSearchText,
  queryScope,
  querySearchShard,
  resetSearchClientState,
  searchShortcutItems,
} from '../lib/search-client.mjs';

function index(url, { title = url, description, headings = [], breadcrumbs = [] } = {}) {
  return {
    id: url,
    title,
    description,
    url,
    breadcrumbs,
    structuredData: { headings, contents: [] },
  };
}

// Build a real Fumadocs advanced export — the exact artifact the shard routes
// serve — so the client is exercised against its production transport.
async function shardExport(indexes) {
  const server = initAdvancedSearch({ indexes, language: 'english' });
  return JSON.parse(JSON.stringify(await server.export()));
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function recordingFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return jsonResponse({ message: 'not found' }, { ok: false, status: 404 });
    return typeof route === 'function' ? route() : jsonResponse(route);
  };
  impl.calls = calls;
  return impl;
}

function urls(results) {
  return results.map((result) => result.url);
}

// Page groups only: section rows share their page's URL, and the acceptance
// contract is about which pages a query reaches and in what order.
function pageUrls(results) {
  return results.filter((result) => result.type === 'page').map((result) => result.url);
}

beforeEach(() => {
  resetSearchClientState();
});

test('initSearchShard rejects a non-advanced export', () => {
  assert.throws(() => initSearchShard({ type: 'i18n', data: {} }), /must be a Fumadocs advanced search export/);
});

test('a query returns only its own scope records, grouped by page', async () => {
  const stable = await shardExport([
    index('/en/stable/installation', {
      title: 'Installation',
      headings: [{ id: 'install', content: 'Installation steps' }],
      breadcrumbs: ['Stable', 'Getting started'],
    }),
  ]);
  const beta = await shardExport([index('/en/beta/installation', { title: 'Installation' })]);
  const fetchImpl = recordingFetch({
    '/api/search/en/stable': stable,
    '/api/search/en/beta': beta,
  });

  const results = await queryScope({ locale: 'en', channel: 'stable', query: 'installation', fetchImpl });

  assert.deepEqual(urls(results), ['/en/stable/installation', '/en/stable/installation#install']);
  assert.equal(results[0].breadcrumbs[0], 'Stable');
  assert.deepEqual(fetchImpl.calls, ['/api/search/en/stable']);
});

test('simultaneous queries share one shard load', async () => {
  const exportData = await shardExport([index('/en/beta/workflow')]);
  const fetchImpl = recordingFetch({ '/api/search/en/beta': exportData });
  const client = createScopedSearchClient({ locale: 'en', channel: 'beta', fetchImpl });

  const [first, second] = await Promise.all([client.search('workflow'), client.search('workflow')]);

  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(urls(first), urls(second));
});

test('reopening a scope reuses the cached shard', async () => {
  const fetchImpl = recordingFetch({
    '/api/search/en/stable': await shardExport([index('/en/stable/installation')]),
  });
  const client = createScopedSearchClient({ locale: 'en', channel: 'stable', fetchImpl });

  await client.search('installation');
  await client.search('installation');

  assert.equal(fetchImpl.calls.length, 1);
});

test('every scope keeps its own shard in cache', async () => {
  const routes = {};
  for (const locale of ['en', 'vi']) {
    for (const channel of ['stable', 'beta']) {
      routes[`/api/search/${locale}/${channel}`] = await shardExport([
        index(`/${locale}/${channel}/installation`),
      ]);
    }
  }
  const fetchImpl = recordingFetch(routes);

  const scopes = [
    { locale: 'en', channel: 'stable' },
    { locale: 'en', channel: 'beta' },
    { locale: 'vi', channel: 'stable' },
    { locale: 'vi', channel: 'beta' },
  ];
  for (const scope of scopes) {
    const results = await queryScope({ ...scope, query: 'installation', fetchImpl });
    assert.deepEqual(urls(results), [`/${scope.locale}/${scope.channel}/installation`]);
  }
  for (const scope of scopes) {
    await queryScope({ ...scope, query: 'installation', fetchImpl });
  }

  assert.equal(fetchImpl.calls.length, 4);
});

test('a failed shard load rejects, never falls back to another scope, and retries', async () => {
  const stable = await shardExport([index('/en/stable/installation')]);
  const beta = await shardExport([index('/en/beta/installation')]);
  let failFirst = true;
  const fetchImpl = recordingFetch({
    '/api/search/en/beta': () => {
      if (failFirst) {
        failFirst = false;
        return jsonResponse({ message: 'boom' }, { ok: false, status: 500 });
      }
      return jsonResponse(beta);
    },
    '/api/search/en/stable': stable,
  });

  await assert.rejects(
    () => loadSearchShard({ locale: 'en', channel: 'beta', fetchImpl }),
    /failed to load the en\/beta search index/,
  );
  const results = await queryScope({ locale: 'en', channel: 'beta', query: 'installation', fetchImpl });

  assert.deepEqual(urls(results), ['/en/beta/installation']);
  assert.deepEqual(fetchImpl.calls, ['/api/search/en/beta', '/api/search/en/beta']);
});

test('a delayed shard load still resolves only its own scope records', async () => {
  const stable = await shardExport([index('/en/stable/installation')]);
  const beta = await shardExport([index('/en/beta/installation')]);
  let releaseStable;
  const stableGate = new Promise((resolve) => {
    releaseStable = resolve;
  });
  const fetchImpl = recordingFetch({
    '/api/search/en/stable': async () => {
      await stableGate;
      return jsonResponse(stable);
    },
    '/api/search/en/beta': beta,
  });

  const stableClient = createScopedSearchClient({ locale: 'en', channel: 'stable', fetchImpl });
  const pending = stableClient.search('installation');
  await Promise.resolve();

  // A reader moving to another scope must never receive the previous scope's
  // records, and must never be served the new scope's shard by the old client.
  const betaClient = createScopedSearchClient({ locale: 'en', channel: 'beta', fetchImpl });
  assert.deepEqual(urls(await betaClient.search('installation')), ['/en/beta/installation']);

  releaseStable();
  assert.deepEqual(urls(await pending), ['/en/stable/installation']);
  assert.deepEqual(fetchImpl.calls, ['/api/search/en/stable', '/api/search/en/beta']);
});

test('creating a client for another scope does not invalidate an existing client', async () => {
  const stable = await shardExport([index('/en/stable/installation')]);
  const fetchImpl = recordingFetch({ '/api/search/en/stable': stable });
  const stableClient = createScopedSearchClient({ locale: 'en', channel: 'stable', fetchImpl });

  // Mirrors a React render that creates a Beta client and is then discarded:
  // the mounted Stable dialog must keep working.
  createScopedSearchClient({ locale: 'en', channel: 'beta', fetchImpl });

  assert.deepEqual(urls(await stableClient.search('installation')), ['/en/stable/installation']);
});

test('a shard whose heading URL is a network-path reference is rejected before caching', async () => {
  const exported = await shardExport([
    index('/en/stable/installation', {
      title: 'Installation',
      headings: [{ id: 'section', content: 'Installation section' }],
    }),
  ]);
  const heading = Object.values(exported.docs.docs).find((document) => document.type === 'heading');
  heading.url = '//en/stable/installation#section';
  let serve = exported;
  const fetchImpl = recordingFetch({ '/api/search/en/stable': () => jsonResponse(serve) });

  await assert.rejects(
    () => loadSearchShard({ locale: 'en', channel: 'stable', fetchImpl }),
    /contains a noncanonical record URL: \/\/en\/stable\/installation#section/,
  );

  // The rejected shard must not be cached, so a corrected shard can load.
  const corrected = await shardExport([index('/en/stable/installation', { title: 'Installation' })]);
  serve = corrected;
  const results = await queryScope({ locale: 'en', channel: 'stable', query: 'installation', fetchImpl });

  assert.deepEqual(urls(results), ['/en/stable/installation']);
});

test('a shard whose heading URL traverses into another scope is rejected', async () => {
  const exported = await shardExport([
    index('/en/stable/installation', {
      title: 'Installation',
      headings: [{ id: 'section', content: 'Installation section' }],
    }),
  ]);
  const heading = Object.values(exported.docs.docs).find((document) => document.type === 'heading');
  heading.url = '/en/stable/../../vi/beta/installation#section';
  const fetchImpl = recordingFetch({ '/api/search/en/stable': exported });

  await assert.rejects(
    () => loadSearchShard({ locale: 'en', channel: 'stable', fetchImpl }),
    /contains a noncanonical record URL/,
  );
});

test('a shard holding another scope record is rejected before caching', async () => {
  const exported = await shardExport([
    index('/en/stable/installation', {
      title: 'Installation',
      headings: [{ id: 'section', content: 'Installation section' }],
    }),
  ]);
  const heading = Object.values(exported.docs.docs).find((document) => document.type === 'heading');
  heading.url = '/en/beta/installation#section';
  const fetchImpl = recordingFetch({ '/api/search/en/stable': exported });

  await assert.rejects(
    () => loadSearchShard({ locale: 'en', channel: 'stable', fetchImpl }),
    /contains a foreign-scope record for en\/stable: \/en\/beta\/installation#section/,
  );
});

test('results are deduplicated by canonical page URL', async () => {
  const duplicated = await shardExport([
    index('/en/stable/kits/engineer', { title: 'Engineer Kit' }),
    { ...index('/en/stable/kits/engineer', { title: 'Engineer Kit (kit copy)' }), id: 'duplicate' },
  ]);
  const fetchImpl = recordingFetch({ '/api/search/en/stable': duplicated });
  const client = createScopedSearchClient({ locale: 'en', channel: 'stable', fetchImpl });

  const results = await client.search('engineer kit');
  const pageUrls = urls(results).filter((url) => !url.includes('#'));

  assert.deepEqual(pageUrls, ['/en/stable/kits/engineer']);
});

test('querySearchShard highlights matched terms and honours the limit', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/one', { title: 'Workflow guides' }),
      index('/en/stable/two', { title: 'Workflow overview' }),
    ]),
  );

  const limited = await querySearchShard(database, { query: 'workflow', limit: 1 });
  const full = await querySearchShard(database, { query: 'workflow' });

  assert.equal(limited.length, 1);
  assert.equal(full.length, 2);
  assert.match(full[0].content, /<mark>workflow<\/mark>/i);
});

test('an unsupported scope is rejected instead of inventing a URL', () => {
  assert.throws(
    () => createScopedSearchClient({ locale: 'en', channel: 'preview' }),
    /unsupported search scope en\/preview/,
  );
  assert.throws(() => createScopedSearchClient({ locale: 'fr', channel: 'stable' }), /unsupported search scope fr\/stable/);
});

test('normalization folds Vietnamese diacritics and đ without touching command identity', () => {
  assert.equal(normalizeSearchText('Cài Đặt  AgentKit'), 'cai dat agentkit');
  assert.deepEqual(informativeSearchTerms('danh mục Skill'), ['skill']);
  assert.deepEqual(informativeSearchTerms('cài đặt AgentKit'), ['install', 'agentkit']);
  assert.deepEqual(informativeSearchTerms('migrate ClaudeKit to AgentKit'), [
    'migrate',
    'claudekit',
    'agentkit',
  ]);
  // A command keeps its identity instead of being split into two terms.
  assert.deepEqual(informativeSearchTerms('ak:plan'), ['ak:plan']);
  assert.deepEqual(informativeSearchTerms('ak kit install'), ['ak', 'kit', 'install']);
});

test('shortcuts are localized and scoped to the reader', () => {
  const vi = searchShortcutItems({ locale: 'vi', channel: 'beta' });

  assert.equal(vi.length, 5);
  assert.deepEqual(
    vi.map((item) => item.href),
    [
      '/vi/beta/getting-started/installation',
      '/vi/beta/kits/engineer',
      '/vi/beta/kits',
      '/vi/beta/kits/workflows',
      '/vi/beta/guides/migrating-from-claudekit',
    ],
  );
  assert.deepEqual(
    vi.map((item) => item.label),
    ['Cài đặt', 'Engineer Kit', 'Danh mục Skill', 'Workflow', 'Chuyển từ ClaudeKit'],
  );
  assert.equal(searchShortcutItems({ locale: 'en', channel: 'stable' })[2].label, 'Skill Catalog');
});

test('migration intent reaches the migration guide, not an unrelated migrate heading', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/guides/migrating-from-claudekit', { title: 'Migrating from ClaudeKit' }),
      index('/en/stable/reference/cli/migrate', {
        title: 'ak migrate',
        headings: [{ id: 'migrate', content: 'Migrate a project to AgentKit' }],
      }),
    ]),
  );

  const results = await querySearchShard(database, { query: 'migrate ClaudeKit to AgentKit' });

  assert.equal(pageUrls(results)[0], '/en/stable/guides/migrating-from-claudekit');
});

test('an exact Skill query is not answered by the generic Skill Catalog landing', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/kits', { title: 'Choose a Kit', headings: [{ id: 'skills', content: 'Skills' }] }),
      index('/en/stable/kits/engineer/skills/cook', { title: 'Implement a plan with ak:cook' }),
    ]),
  );

  const catalog = await querySearchShard(database, { query: 'skill catalog' });
  assert.equal(pageUrls(catalog)[0], '/en/stable/kits');

  const skill = await querySearchShard(database, { query: 'cook' });
  assert.equal(pageUrls(skill)[0], '/en/stable/kits/engineer/skills/cook');
  assert.ok(!pageUrls(skill).includes('/en/stable/kits'));
});

test('explicit Marketing intent and explicit Engineer intent stay on their own Kit', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/kits/engineer', { title: 'Engineer Kit' }),
      index('/en/stable/kits/marketing', { title: 'Marketing Kit' }),
    ]),
  );

  const marketing = await querySearchShard(database, { query: 'Marketing Kit' });
  const engineer = await querySearchShard(database, { query: 'Engineer Kit' });

  assert.equal(pageUrls(marketing)[0], '/en/stable/kits/marketing');
  assert.equal(pageUrls(engineer)[0], '/en/stable/kits/engineer');
});

test('accented and unaccented Vietnamese queries reach the same page', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/vi/stable/getting-started/installation', { title: 'Cài đặt' }),
      index('/vi/stable/desktop-app/installation', { title: 'Cài đặt ứng dụng Desktop' }),
    ]),
  );

  const accented = await querySearchShard(database, { query: 'cài đặt AgentKit' });
  const unaccented = await querySearchShard(database, { query: 'cai dat AgentKit' });

  assert.equal(pageUrls(accented)[0], '/vi/stable/getting-started/installation');
  assert.deepEqual(pageUrls(unaccented), pageUrls(accented));
});

test('distinct pages that share a title are both kept', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/kits/engineer/skills', { title: 'Choose a Skill' }),
      index('/en/stable/kits/marketing/skills', { title: 'Choose a Skill' }),
    ]),
  );

  const results = await querySearchShard(database, { query: 'choose a skill' });

  assert.deepEqual(pageUrls(results).sort(), [
    '/en/stable/kits/engineer/skills',
    '/en/stable/kits/marketing/skills',
  ]);
});

test('an unknown query is allowed to match nothing', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/kits', { title: 'Choose a Kit', headings: [{ id: 'skills', content: 'Skills' }] }),
      index('/en/stable/getting-started/installation', { title: 'Installation' }),
    ]),
  );

  const results = await querySearchShard(database, { query: 'quantum chromodynamics primer' });

  assert.deepEqual(pageUrls(results), []);
});

test('an extra uncovered term stops a landing alias from being promoted', async () => {
  const database = initSearchShard(
    await shardExport([
      index('/en/stable/kits', { title: 'Choose a Kit', headings: [{ id: 'skills', content: 'Skills' }] }),
      index('/en/stable/kits/marketing', { title: 'Marketing Kit' }),
    ]),
  );

  const covered = await querySearchShard(database, { query: 'skills' });
  assert.equal(pageUrls(covered)[0], '/en/stable/kits');

  // `marketing` is not covered by any Skill Catalog alias, so the catalog must
  // not be promoted above the page that actually matches the query.
  const overreach = await querySearchShard(database, { query: 'skills marketing' });
  assert.notEqual(pageUrls(overreach)[0], '/en/stable/kits');
});

test('the visible list is capped by page group and by section rows per page', async () => {
  const pages = Array.from({ length: SEARCH_PAGE_GROUP_LIMIT + 8 }, (_, position) =>
    index(`/en/stable/page-${position}`, { title: `Workflow page ${position}` }),
  );
  const grouped = initSearchShard(await shardExport(pages));

  const groups = (await querySearchShard(grouped, { query: 'workflow' })).filter(
    (result) => result.type === 'page',
  );
  assert.equal(groups.length, SEARCH_PAGE_GROUP_LIMIT);

  const sectioned = initSearchShard(
    await shardExport([
      index('/en/stable/one', {
        title: 'Workflow',
        headings: Array.from({ length: SEARCH_PAGE_GROUP_MAX_RESULT + 3 }, (_, position) => ({
          id: `section-${position}`,
          content: `Workflow section ${position}`,
        })),
      }),
    ]),
  );

  const rows = await querySearchShard(sectioned, { query: 'workflow' });
  assert.equal(rows.filter((result) => result.type === 'page').length, 1);
  assert.equal(rows.filter((result) => result.type === 'heading').length, SEARCH_PAGE_GROUP_MAX_RESULT);
});

test('evictSearchShard drops the cached shard so a retry refetches it', async () => {
  const exported = await shardExport([index('/en/stable/installation')]);
  const fetchImpl = recordingFetch({ '/api/search/en/stable': exported });

  await queryScope({ locale: 'en', channel: 'stable', query: 'installation', fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(evictSearchShard({ locale: 'en', channel: 'stable' }), true);

  await queryScope({ locale: 'en', channel: 'stable', query: 'installation', fetchImpl });
  assert.equal(fetchImpl.calls.length, 2);
  // A second eviction without a query in between has nothing left to drop.
  assert.equal(evictSearchShard({ locale: 'en', channel: 'stable' }), true);
  assert.equal(evictSearchShard({ locale: 'en', channel: 'stable' }), false);
});
