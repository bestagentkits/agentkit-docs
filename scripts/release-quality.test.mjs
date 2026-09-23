import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initAdvancedSearch } from 'fumadocs-core/search/server';
import { SEARCH_LANGUAGE } from '../lib/search-client.mjs';
import { searchShardPath } from '../lib/search-scopes.mjs';
import {
  checkFixedQueries,
  checkNegativeQueries,
  compareBenchmark,
  compareBenchmarkProfile,
  inspectReleaseMetrics,
} from './release-quality-metrics.mjs';
import { inspectReleaseShape } from './release-quality-shape.mjs';

const temporaryRoots = [];

async function temporaryRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function write(path, body = '---\ntitle: Fixture\n---\n') {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body);
}

function shapeBaseline(overrides = {}) {
  return {
    schemaVersion: 1,
    reviewedAt: '2026-08-04',
    sourceCommit: 'fixture',
    channels: ['beta', 'stable'],
    locales: ['en', 'vi'],
    sourceRoutesPerLocaleChannel: { stable: 2, beta: 2 },
    routesPerLocaleChannel: { stable: 2, beta: 2 },
    reviewedSourceOnlyRoutes: [],
    reviewedGeneratedRoutes: [],
    reviewedVariants: [
      {
        route: 'reference/notes',
        en: 'shared-default',
        vi: 'native',
        classification: 'reviewed-shared-default-with-vi-override',
        rationale: 'Fixture review.',
      },
    ],
    ...overrides,
  };
}

async function makeShapeFixture() {
  const root = await temporaryRoot('ak-release-shape-');
  const docsRoot = join(root, 'content', 'docs');
  const outDir = join(root, 'out');
  for (const channel of ['beta', 'stable']) {
    await write(join(docsRoot, channel, 'index.en.mdx'));
    await write(join(docsRoot, channel, 'index.vi.mdx'));
    await write(join(docsRoot, channel, 'reference', 'notes.mdx'));
    await write(join(docsRoot, channel, 'reference', 'notes.vi.mdx'));
    for (const locale of ['en', 'vi']) {
      await write(join(outDir, locale, `${channel}.html`), '<h1>Fixture</h1>');
      await write(join(outDir, locale, channel, 'reference', 'notes.html'), '<h1>Notes</h1>');
    }
  }
  return { docsRoot, outDir, baseline: shapeBaseline() };
}

function installationTitle(locale) {
  return locale === 'en' ? 'Installation' : 'Cài đặt';
}

// Build the same Fumadocs advanced export the shard routes serve.
async function shardExport(locale, channel, routes) {
  const indexes = routes.map((route) => ({
    id: `/${locale}/${channel}/${route}`,
    title: route === 'installation' ? installationTitle(locale) : route,
    url: `/${locale}/${channel}/${route}`,
    breadcrumbs: [channel, locale],
    structuredData: {
      headings: [{ id: 'section', content: `${route} section` }],
      contents: [],
    },
  }));
  const server = initAdvancedSearch({ indexes, language: SEARCH_LANGUAGE });
  return JSON.parse(JSON.stringify(await server.export()));
}

function shardFile(outDir, locale, channel) {
  return join(outDir, searchShardPath(locale, channel));
}

async function makeMetricFixture({ betaOnlyRoutes = [], stableOnlyRoutes = [] } = {}) {
  const root = await temporaryRoot('ak-release-metrics-');
  const outDir = join(root, 'out');
  const routesByChannel = {
    beta: ['installation', ...betaOnlyRoutes],
    stable: ['installation', ...stableOnlyRoutes],
  };
  const htmlPaths = [];
  const searchPaths = [];
  for (const locale of ['en', 'vi']) {
    for (const channel of ['beta', 'stable']) {
      for (const route of routesByChannel[channel]) {
        const htmlPath = join(outDir, locale, channel, `${route}.html`);
        await write(htmlPath, `<h1>${route}</h1>`);
        htmlPaths.push(htmlPath);
      }
      const searchPath = shardFile(outDir, locale, channel);
      await write(searchPath, JSON.stringify(await shardExport(locale, channel, routesByChannel[channel])));
      searchPaths.push(searchPath);
    }
  }
  const searchBytes = (await Promise.all(searchPaths.map((searchPath) => stat(searchPath))))
    .reduce((sum, entry) => sum + entry.size, 0);
  const htmlBytes = (await Promise.all(htmlPaths.map((htmlPath) => stat(htmlPath))))
    .reduce((sum, entry) => sum + entry.size, 0);
  const fileCount = htmlPaths.length + searchPaths.length;
  const baseline = {
    schemaVersion: 1,
    reviewedAt: '2026-08-04',
    sourceCommit: 'fixture',
    deterministic: {
      outputBytes: searchBytes + htmlBytes,
      outputBudgetBytes: searchBytes + htmlBytes + 100,
      fileCount,
      fileCountBudget: fileCount + 2,
      searchBytes,
      searchBudgetBytes: searchBytes + 10,
      searchPagesPerLocaleChannel: {
        stable: routesByChannel.stable.length,
        beta: routesByChannel.beta.length,
      },
      reviewedSearchExcludedPublishedRoutes: [],
      maxAssetBytesExclusive: searchBytes + 10,
      cloudflareFileLimitExclusive: fileCount + 1,
    },
    benchmark: {
      searchParseMedianMs: 100,
      searchLoadMedianMs: 200,
      searchPeakHeapMedianBytes: 1_000,
      buildMedianMs: 1_000,
      thresholds: { searchParse: 1.2, searchLoad: 1.2, searchPeakHeap: 1.2, build: 1.25 },
    },
    fixedQueries: [
      { locale: 'en', query: 'Installation', route: 'installation', maxRank: 1 },
      { locale: 'vi', query: 'Cài đặt', route: 'installation', maxRank: 1 },
    ],
    fixedNegativeQueries: [
      {
        locale: 'en',
        query: 'quantum chromodynamics primer',
        absentRoutes: ['installation'],
        zeroResults: true,
      },
    ],
  };
  return { outDir, baseline };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('accepts exact locale/channel shape with reviewed shared-default variants', async () => {
  const fixture = await makeShapeFixture();
  const report = await inspectReleaseShape(fixture);
  assert.deepEqual(report.channels, { beta: { en: 2, vi: 2 }, stable: { en: 2, vi: 2 } });
  assert.equal(report.reviewedVariants[0].classification, 'reviewed-shared-default-with-vi-override');
});

test('rejects an unclassified English fallback', async () => {
  const fixture = await makeShapeFixture();
  await rm(join(fixture.docsRoot, 'beta', 'index.vi.mdx'));
  await assert.rejects(() => inspectReleaseShape(fixture), /reviewed locale variants/);
});

test('rejects Stable and Beta route divergence', async () => {
  const fixture = await makeShapeFixture();
  await rm(join(fixture.docsRoot, 'stable', 'index.en.mdx'));
  await rm(join(fixture.docsRoot, 'stable', 'index.vi.mdx'));
  await rm(join(fixture.outDir, 'en', 'stable', 'reference', 'notes.html'));
  await assert.rejects(() => inspectReleaseShape(fixture), /route count 1|route shape/);
});

test('rejects authored routes that silently disappear from every built locale and channel', async () => {
  const fixture = await makeShapeFixture();
  fixture.baseline.sourceRoutesPerLocaleChannel = { stable: 3, beta: 3 };
  for (const channel of ['beta', 'stable']) {
    await write(join(fixture.docsRoot, channel, 'orphan.en.mdx'));
    await write(join(fixture.docsRoot, channel, 'orphan.vi.mdx'));
  }
  await assert.rejects(() => inspectReleaseShape(fixture), /reviewed source-only routes.*orphan/);
});

test('checks deterministic output budgets and the expanded acceptance matrix', async () => {
  const fixture = await makeMetricFixture();
  const report = await inspectReleaseMetrics(fixture);
  assert.equal(report.observed.fileCount, 8);
  // One row per locale expands over both reviewed channels, so the same intent
  // is asserted in Stable and Beta without duplicating the row.
  assert.deepEqual(
    report.relevance.map((entry) => `${entry.locale}/${entry.channel}:${entry.rank}`),
    ['en/beta:1', 'en/stable:1', 'vi/beta:1', 'vi/stable:1'],
  );
  assert.deepEqual(
    report.negativeRelevance.map((entry) => `${entry.locale}/${entry.channel}:${entry.pageGroupCount}`),
    ['en/beta:0', 'en/stable:0'],
  );
});

test('allows searchable routes authored only in beta', async () => {
  const fixture = await makeMetricFixture({ betaOnlyRoutes: ['reference/beta-only'] });
  const report = await inspectReleaseMetrics(fixture);
  assert.deepEqual(report.searchShape.pages, {
    en: { beta: 2, stable: 1 },
    vi: { beta: 2, stable: 1 },
  });
});

test('rejects searchable stable routes that are missing from beta', async () => {
  const fixture = await makeMetricFixture({ stableOnlyRoutes: ['reference/stable-only'] });
  await assert.rejects(
    () => inspectReleaseMetrics(fixture),
    /stable ⊆ beta searchable route shape: missing \[reference\/stable-only\]/,
  );
});

test('rejects output growth beyond the reviewed deterministic budget', async () => {
  const fixture = await makeMetricFixture();
  fixture.baseline.deterministic.outputBudgetBytes = 1;
  await assert.rejects(() => inspectReleaseMetrics(fixture), /output .* exceeds reviewed budget/);
});

test('rejects a missing shard instead of checking a partial export', async () => {
  const fixture = await makeMetricFixture();
  await rm(shardFile(fixture.outDir, 'vi', 'beta'));
  await assert.rejects(() => inspectReleaseMetrics(fixture), /vi\/beta|missing/);
});

test('rejects a fixed query whose expected route leaves its reviewed rank bound', async () => {
  const fixture = await makeMetricFixture();
  await assert.rejects(
    () =>
      checkFixedQueries(
        fixture.outDir,
        [{ locale: 'en', channel: 'stable', query: 'Installation', route: 'missing', maxRank: 5 }],
        fixture.baseline,
      ),
    /expected \/en\/stable\/missing within rank 5/,
  );
});

test('rejects a negative control that promotes an unrelated landing page', async () => {
  const fixture = await makeMetricFixture();
  await assert.rejects(
    () =>
      checkNegativeQueries(
        fixture.outDir,
        [
          {
            locale: 'en',
            channel: 'stable',
            query: 'Installation',
            absentRoutes: ['/en/stable/installation'],
          },
        ],
        fixture.baseline,
      ),
    /unrelated landing pages were promoted \[\/en\/stable\/installation\]/,
  );
});

test('rejects a negative control whose query unexpectedly matches a page', async () => {
  const fixture = await makeMetricFixture();
  await assert.rejects(
    () =>
      checkNegativeQueries(
        fixture.outDir,
        [
          {
            locale: 'en',
            channel: 'stable',
            query: 'Installation',
            absentRoutes: [],
            zeroResults: true,
          },
        ],
        fixture.baseline,
      ),
    /expected no matching page/,
  );
});

test('rejects a fixed-query result whose URL leaves the scope without changing its prefix', async () => {
  const fixture = await makeMetricFixture();
  const searchPath = shardFile(fixture.outDir, 'en', 'stable');
  const exported = JSON.parse(await readFile(searchPath, 'utf8'));
  // A plain prefix match still accepts `/en/stable-preview/...`, so the
  // fixed-query isolation check must classify the URL canonically, exactly like
  // the shard shape check does.
  const page = Object.values(exported.docs.docs).find((document) => document.type === 'page');
  page.url = '/en/stable-preview/installation';
  await writeFile(searchPath, JSON.stringify(exported));

  await assert.rejects(
    () =>
      checkFixedQueries(
        fixture.outDir,
        [{ locale: 'en', channel: 'stable', query: 'Installation', expectedRoute: '/en/stable/installation' }],
        fixture.baseline,
      ),
    /returned records outside its scope/,
  );
});

test('rejects a shard holding records outside its own scope', async () => {
  const fixture = await makeMetricFixture();
  const searchPath = shardFile(fixture.outDir, 'en', 'stable');
  const exported = JSON.parse(await readFile(searchPath, 'utf8'));
  const betaEntry = Object.entries(exported.docs.docs).find(([, document]) => document.type === 'page');
  betaEntry[1].url = '/en/beta/installation';
  await writeFile(searchPath, JSON.stringify(exported));
  await assert.rejects(() => inspectReleaseMetrics(fixture), /Search index shape check failed/);
});

test('rejects a non-page record whose URL leaves the shard scope', async () => {
  const noncanonicalHeadings = [
    'https://docs.agentkit.best/en/beta/installation#section',
    '//en/beta/installation#section',
    '/en/stable/../../vi/beta/installation#section',
  ];

  for (const headingUrl of noncanonicalHeadings) {
    const fixture = await makeMetricFixture();
    const searchPath = shardFile(fixture.outDir, 'en', 'stable');
    const exported = JSON.parse(await readFile(searchPath, 'utf8'));
    // Heading and description documents are rendered as result URLs too, so a
    // foreign or noncanonical URL there must fail even though the page route
    // contract still holds.
    const heading = Object.values(exported.docs.docs).find((document) => document.type === 'heading');
    heading.url = headingUrl;
    await writeFile(searchPath, JSON.stringify(exported));

    await assert.rejects(
      () => inspectReleaseMetrics(fixture),
      /foreign-scope record in en\/stable|malformed search record URL/,
      `expected rejection for heading URL ${headingUrl}`,
    );
  }
});

test('rejects a missing channel from the searchable page index', async () => {
  const fixture = await makeMetricFixture();
  const searchPath = shardFile(fixture.outDir, 'en', 'beta');
  const exported = JSON.parse(await readFile(searchPath, 'utf8'));
  const betaEntry = Object.entries(exported.docs.docs)
    .find(([, document]) => document.url === '/en/beta/installation');
  delete exported.docs.docs[betaEntry[0]];
  await writeFile(searchPath, JSON.stringify(exported));
  await assert.rejects(() => inspectReleaseMetrics(fixture), /Search index shape check failed/);
});

test('rejects a uniformly substituted search route that is not published', async () => {
  const fixture = await makeMetricFixture();
  for (const locale of ['en', 'vi']) {
    for (const channel of ['beta', 'stable']) {
      const searchPath = shardFile(fixture.outDir, locale, channel);
      const exported = JSON.parse(await readFile(searchPath, 'utf8'));
      for (const document of Object.values(exported.docs.docs)) {
        document.url = document.url.replace('/installation', '/invented');
      }
      await writeFile(searchPath, JSON.stringify(exported));
    }
  }
  await assert.rejects(() => inspectReleaseMetrics(fixture), /published\/searchable route contract/);
});

test('classifies pinned-profile timing regressions as advisory evidence', () => {
  const baseline = {
    benchmark: {
      searchParseMedianMs: 100,
      searchLoadMedianMs: 200,
      searchPeakHeapMedianBytes: 1_000,
      buildMedianMs: 2_000,
      thresholds: { searchParse: 1.2, searchLoad: 1.2, searchPeakHeap: 1.2, build: 1.25 },
    },
  };
  const comparisons = compareBenchmark({
    search: { parseMedianMs: 121, loadMedianMs: 200, peakHeapMedianBytes: 1_100 },
    build: { medianMs: 2_501 },
  }, baseline);
  assert.equal(comparisons.searchParse.regressed, true);
  assert.equal(comparisons.searchPeakHeap.regressed, false);
  assert.equal(comparisons.build.regressed, true);
});

test('a benchmark measured on a different artifact shape is not presented as comparable', () => {
  const baseline = {
    benchmark: {
      scope: 'whole index',
      searchParseMedianMs: 100,
      searchLoadMedianMs: 200,
      searchPeakHeapMedianBytes: 1_000,
      thresholds: { searchParse: 1.2, searchLoad: 1.2, searchPeakHeap: 1.2 },
    },
  };
  const report = {
    search: {
      scope: 'worst shard of 4',
      parseMedianMs: 400,
      loadMedianMs: 800,
      peakHeapMedianBytes: 4_000,
    },
  };

  const comparisons = compareBenchmark(report, baseline);
  assert.equal(comparisons.scope.comparable, false);
  assert.deepEqual(comparisons.scope, {
    expected: 'whole index',
    observed: 'worst shard of 4',
    comparable: false,
  });
  assert.equal(comparisons.searchParse.comparable, false);
  assert.equal(
    comparisons.searchParse.regressed,
    false,
    'an incomparable ratio must not be reported as a regression',
  );

  const sameScope = compareBenchmark({ search: { ...report.search, scope: 'whole index' } }, baseline);
  assert.equal(sameScope.scope.comparable, true);
  assert.equal(sameScope.searchParse.comparable, true);
  assert.equal(sameScope.searchParse.regressed, true);
});

test('strict benchmark profile comparison detects a different runtime', () => {
  const expected = {
    cpu: 'Fixture CPU', cores: 4, memoryBytes: 1_000, os: 'Fixture OS', kernel: 'Fixture 1',
    architecture: 'arm64', node: '22.21.1', pnpm: '10.26.2',
  };
  assert.equal(compareBenchmarkProfile(expected, expected).matches, true);
  const comparison = compareBenchmarkProfile({ ...expected, node: '24.16.0' }, expected);
  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.mismatches.map((entry) => entry.field), ['node']);
});

test('each committed-style shard is a standalone advanced export', async () => {
  const fixture = await makeMetricFixture();
  for (const locale of ['en', 'vi']) {
    for (const channel of ['beta', 'stable']) {
      const parsed = JSON.parse(await readFile(shardFile(fixture.outDir, locale, channel), 'utf8'));
      assert.equal(parsed.type, 'advanced');
    }
  }
});
