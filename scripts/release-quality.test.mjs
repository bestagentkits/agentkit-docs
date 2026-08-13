import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create, insertMultiple, save } from '@orama/orama';
import {
  checkFixedQueries,
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

function searchDocument(locale, route, title) {
  return {
    id: route,
    page_id: route,
    type: 'page',
    content: title,
    breadcrumbs: [locale],
    tags: [],
    url: route,
  };
}

async function serializedSearchData(routesByChannel) {
  const data = {};
  for (const [locale, title] of [['en', 'Installation'], ['vi', 'Cài đặt']]) {
    const database = create({
      schema: {
        id: 'string',
        page_id: 'string',
        type: 'string',
        content: 'string',
        breadcrumbs: 'string[]',
        tags: 'string[]',
        url: 'string',
      },
      language: 'english',
    });
    const routes = [
      ['beta', 'installation'],
      ['stable', 'installation'],
      ...routesByChannel.beta.filter((route) => route !== 'installation').map((route) => ['beta', route]),
      ...routesByChannel.stable.filter((route) => route !== 'installation').map((route) => ['stable', route]),
    ];
    await insertMultiple(database, routes.map(([channel, route]) => {
      const url = `/${locale}/${channel}/${route}`;
      return searchDocument(locale, url, route === 'installation' ? title : route);
    }));
    data[locale] = { type: 'advanced', ...save(database) };
  }
  return JSON.stringify({ type: 'i18n', data });
}

async function makeMetricFixture({ betaOnlyRoutes = [], stableOnlyRoutes = [] } = {}) {
  const root = await temporaryRoot('ak-release-metrics-');
  const outDir = join(root, 'out');
  const routesByChannel = {
    beta: ['installation', ...betaOnlyRoutes],
    stable: ['installation', ...stableOnlyRoutes],
  };
  const htmlPaths = [];
  for (const locale of ['en', 'vi']) {
    for (const channel of ['beta', 'stable']) {
      for (const route of routesByChannel[channel]) {
        const htmlPath = join(outDir, locale, channel, `${route}.html`);
        await write(htmlPath, `<h1>${route}</h1>`);
        htmlPaths.push(htmlPath);
      }
    }
  }
  const searchBody = await serializedSearchData(routesByChannel);
  await write(join(outDir, 'api', 'search'), searchBody);
  const searchBytes = (await stat(join(outDir, 'api', 'search'))).size;
  const htmlBytes = (await Promise.all(htmlPaths.map((htmlPath) => stat(htmlPath))))
    .reduce((sum, entry) => sum + entry.size, 0);
  const baseline = {
    schemaVersion: 1,
    reviewedAt: '2026-08-04',
    sourceCommit: 'fixture',
    deterministic: {
      outputBytes: searchBytes + htmlBytes,
      outputBudgetBytes: searchBytes + htmlBytes + 100,
      fileCount: htmlPaths.length + 1,
      fileCountBudget: htmlPaths.length + 2,
      searchBytes,
      searchBudgetBytes: searchBytes + 10,
      searchPagesPerLocaleChannel: {
        stable: routesByChannel.stable.length,
        beta: routesByChannel.beta.length,
      },
      reviewedSearchOutsideChannelRoutes: [],
      reviewedSearchExcludedPublishedRoutes: [],
      maxAssetBytesExclusive: searchBytes + 10,
      cloudflareFileLimitExclusive: 10,
    },
    benchmark: {
      searchParseMedianMs: 100,
      searchLoadMedianMs: 200,
      searchPeakHeapMedianBytes: 1_000,
      buildMedianMs: 1_000,
      thresholds: { searchParse: 1.2, searchLoad: 1.2, searchPeakHeap: 1.2, build: 1.25 },
    },
    fixedQueries: [
      { locale: 'en', query: 'Installation', expectedRoute: '/en/stable/installation' },
      { locale: 'vi', query: 'Cài đặt', expectedRoute: '/vi/stable/installation' },
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

test('checks deterministic output budgets and fixed top-five relevance', async () => {
  const fixture = await makeMetricFixture();
  const report = await inspectReleaseMetrics(fixture);
  assert.equal(report.observed.fileCount, 5);
  assert.deepEqual(report.relevance.map((entry) => entry.rank), [2, 2]);
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

test('rejects a fixed query whose expected route leaves the top five', async () => {
  const fixture = await makeMetricFixture();
  await assert.rejects(
    () => checkFixedQueries(join(fixture.outDir, 'api', 'search'), [
      { locale: 'en', query: 'Installation', expectedRoute: '/en/stable/missing' },
    ]),
    /expected \/en\/stable\/missing in top 5/,
  );
});

test('rejects a missing channel from the searchable page index', async () => {
  const fixture = await makeMetricFixture();
  const searchPath = join(fixture.outDir, 'api', 'search');
  const exported = JSON.parse(await readFile(searchPath, 'utf8'));
  const betaEntry = Object.entries(exported.data.en.docs.docs)
    .find(([, document]) => document.url === '/en/beta/installation');
  delete exported.data.en.docs.docs[betaEntry[0]];
  await writeFile(searchPath, JSON.stringify(exported));
  await assert.rejects(() => inspectReleaseMetrics(fixture), /Search index shape check failed/);
});

test('rejects a uniformly substituted search route that is not published', async () => {
  const fixture = await makeMetricFixture();
  const searchPath = join(fixture.outDir, 'api', 'search');
  const exported = JSON.parse(await readFile(searchPath, 'utf8'));
  for (const locale of ['en', 'vi']) {
    for (const document of Object.values(exported.data[locale].docs.docs)) {
      document.url = document.url.replace('/installation', '/invented');
    }
  }
  await writeFile(searchPath, JSON.stringify(exported));
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

test('search fixture remains a committed-style i18n export', async () => {
  const fixture = await makeMetricFixture();
  const parsed = JSON.parse(await readFile(join(fixture.outDir, 'api', 'search'), 'utf8'));
  assert.deepEqual(Object.keys(parsed.data).sort(), ['en', 'vi']);
});
