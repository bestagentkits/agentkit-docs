#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { cpus, release as osRelease, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { create, load, search } from '@orama/orama';
import { repoRoot } from './lib/paths.mjs';
import {
  inspectStaticAssets,
  MAX_ASSET_BYTES,
  MAX_STATIC_ASSET_FILES,
  MEBIBYTE,
  SEARCH_ASSET_BUDGET_BYTES,
} from './lib/static-assets.mjs';
import { collectPublishedChannelRoutes, inspectReleaseShape } from './release-quality-shape.mjs';

export const RELEASE_QUALITY_BASELINE = Object.freeze({
  schemaVersion: 1,
  reviewedAt: '2026-08-13',
  sourceCommit: 'e1f84b0b0203cb2578aad2e0c9b9b708233ec2c2',
  channels: ['beta', 'stable'],
  locales: ['en', 'vi'],
  deterministic: {
    outputBytes: 2_296_191_591,
    outputBudgetBytes: 2_870_239_489,
    fileCount: 18_523,
    fileCountBudget: 23_154,
    searchBytes: 20_067_964,
    searchBudgetBytes: SEARCH_ASSET_BUDGET_BYTES,
    // Per-channel: stable stays bound to channels.stable.tag; beta may include
    // pages authored ahead of the next stable promote.
    searchPagesPerLocaleChannel: { stable: 391, beta: 396 },
    reviewedSearchOutsideChannelRoutes: ['_showcase'],
    reviewedSearchExcludedPublishedRoutes: ['reference/cli/ak'],
    maxAssetBytesExclusive: MAX_ASSET_BYTES,
    cloudflareFileLimitExclusive: MAX_STATIC_ASSET_FILES,
  },
  benchmark: {
    profile: {
      id: 'apple-m3-pro-12c-36g-macos-26.5.1-arm64-node-22.21.1',
      cpu: 'Apple M3 Pro',
      cores: 12,
      memoryBytes: 38_654_705_664,
      os: 'macOS 26.5.1 (25F80)',
      kernel: 'Darwin 25.5.0',
      architecture: 'arm64',
      node: '22.21.1',
      pnpm: '10.26.2',
    },
    runs: 5,
    searchParseMedianMs: 98.621208,
    searchLoadMedianMs: 22.768916,
    searchPeakHeapMedianBytes: 111_501_968,
    buildMedianMs: 194_290,
    thresholds: { searchParse: 1.2, searchLoad: 1.2, searchPeakHeap: 1.2, build: 1.25 },
  },
  fixedQueries: [
    { locale: 'en', query: 'installation', expectedRoute: '/en/beta/getting-started/installation' },
    { locale: 'en', query: 'installation', expectedRoute: '/en/stable/getting-started/installation' },
    { locale: 'en', query: 'engineer kit', expectedRoute: '/en/beta/kits/engineer' },
    { locale: 'en', query: 'engineer kit', expectedRoute: '/en/stable/kits/engineer' },
    { locale: 'vi', query: 'Marketing Kit', expectedRoute: '/vi/beta/kits/marketing' },
    { locale: 'vi', query: 'Marketing Kit', expectedRoute: '/vi/stable/kits/marketing' },
    { locale: 'en', query: 'ak update', expectedRoute: '/en/beta/reference/cli/update' },
    { locale: 'en', query: 'ak update', expectedRoute: '/en/stable/reference/cli/update' },
    { locale: 'vi', query: 'Ứng dụng Desktop', expectedRoute: '/vi/beta/desktop-app' },
    { locale: 'vi', query: 'Ứng dụng Desktop', expectedRoute: '/vi/stable/desktop-app' },
    { locale: 'vi', query: 'quy ước CLI', expectedRoute: '/vi/beta/reference/cli-conventions' },
    { locale: 'vi', query: 'quy ước CLI', expectedRoute: '/vi/stable/reference/cli-conventions' },
    { locale: 'en', query: 'workflow guides', expectedRoute: '/en/beta/kits/workflows' },
    { locale: 'en', query: 'workflow guides', expectedRoute: '/en/stable/kits/workflows' },
  ],
});

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function ratio(current, baseline) {
  return Number((current / baseline).toFixed(4));
}

function formatMiB(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(2)} MiB`;
}

async function loadSearchDatabases(searchPath) {
  const raw = await readFile(searchPath, 'utf8');
  const exported = JSON.parse(raw);
  if (exported.type !== 'i18n') throw new Error(`search export type ${exported.type} is not i18n`);
  const locales = Object.keys(exported.data).sort();
  if (locales.join(',') !== 'en,vi') throw new Error(`search locales must be exactly en,vi; received ${locales.join(',')}`);
  const databases = new Map();
  for (const locale of locales) {
    const database = create({ schema: { _: 'string' }, language: 'english' });
    load(database, exported.data[locale]);
    databases.set(locale, database);
  }
  return { databases, exported };
}

async function queryReports(databases, queries) {
  const reports = [];
  const errors = [];
  for (const entry of queries) {
    const database = databases.get(entry.locale);
    if (!database) {
      errors.push(`${entry.locale}/${entry.query}: locale database is missing`);
      continue;
    }
    const result = await search(database, { term: entry.query, limit: 5 });
    const routes = result.hits.map((hit) => hit.document.url);
    const rank = routes.indexOf(entry.expectedRoute) + 1;
    reports.push({ ...entry, rank: rank || null, topFive: routes });
    if (rank === 0) {
      errors.push(`${entry.locale}/${entry.query}: expected ${entry.expectedRoute} in top 5; received [${routes.join(', ')}]`);
    }
  }
  if (errors.length) throw new Error(`Fixed search relevance check failed:\n- ${errors.join('\n- ')}`);
  return reports;
}

function searchPageShape(exported, baseline, publishedRoutes) {
  const errors = [];
  const routes = {};
  const outside = {};
  for (const locale of baseline.locales ?? ['en', 'vi']) {
    routes[locale] = { beta: new Set(), stable: new Set() };
    outside[locale] = new Set();
    const documents = Object.values(exported.data[locale]?.docs?.docs ?? {});
    const pageUrls = new Set(documents.filter((document) => document.type === 'page').map((document) => document.url));
    for (const url of pageUrls) {
      const match = url.match(new RegExp(`^/${locale}/(beta|stable)(?:/(.*))?$`));
      if (match) routes[locale][match[1]].add(match[2] ?? '');
      else if (url.startsWith(`/${locale}/`)) outside[locale].add(url.slice(locale.length + 2));
      else errors.push(`${locale}: page URL is outside its locale: ${url}`);
    }
    for (const channel of ['beta', 'stable']) {
      const count = routes[locale][channel].size;
      const expectedCount = baseline.deterministic.searchPagesPerLocaleChannel[channel];
      if (count !== expectedCount) {
        errors.push(`${locale}/${channel}: searchable page count ${count} does not match reviewed baseline ${expectedCount}`);
      }
      const expectedSearchRoutes = new Set(publishedRoutes[locale][channel]);
      for (const route of baseline.deterministic.reviewedSearchExcludedPublishedRoutes) {
        if (!expectedSearchRoutes.delete(route)) {
          errors.push(`${locale}/${channel}: reviewed search exclusion is not a published route: ${route}`);
        }
      }
      addSetDifference(
        errors,
        `${locale}/${channel} published/searchable route contract`,
        expectedSearchRoutes,
        routes[locale][channel],
      );
    }
    addSetDifference(
      errors,
      `${locale} reviewed search routes outside channels`,
      new Set(baseline.deterministic.reviewedSearchOutsideChannelRoutes),
      outside[locale],
    );
    addMissingSubset(
      errors,
      `${locale} stable ⊆ beta searchable route shape`,
      routes[locale].stable,
      routes[locale].beta,
    );
  }
  const [referenceLocale, ...otherLocales] = baseline.locales ?? ['en', 'vi'];
  for (const locale of otherLocales) {
    for (const channel of ['beta', 'stable']) {
      addSetDifference(
        errors,
        `${referenceLocale}/${locale} ${channel} searchable route parity`,
        routes[referenceLocale][channel],
        routes[locale][channel],
      );
    }
  }
  if (errors.length) throw new Error(`Search index shape check failed:\n- ${errors.join('\n- ')}`);
  return {
    pages: Object.fromEntries(
      Object.entries(routes).map(([locale, channels]) => [
        locale,
        Object.fromEntries(Object.entries(channels).map(([channel, values]) => [channel, values.size])),
      ]),
    ),
    reviewedOutsideChannelRoutes: baseline.deterministic.reviewedSearchOutsideChannelRoutes,
    reviewedExcludedPublishedRoutes: baseline.deterministic.reviewedSearchExcludedPublishedRoutes,
  };
}

function addSetDifference(errors, label, expected, actual) {
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  const extra = [...actual].filter((value) => !expected.has(value)).sort();
  if (missing.length || extra.length) errors.push(`${label}: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
}

function addMissingSubset(errors, label, expected, actual) {
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  if (missing.length) errors.push(`${label}: missing [${missing.join(', ')}]`);
}

export async function checkFixedQueries(searchPath, queries) {
  const { databases } = await loadSearchDatabases(searchPath);
  return queryReports(databases, queries);
}

async function inspectSearchQuality(searchPath, outDir, baseline) {
  const { databases, exported } = await loadSearchDatabases(searchPath);
  const locales = baseline.locales ?? ['en', 'vi'];
  const publishedRoutes = Object.fromEntries(locales.map((locale) => [locale, {}]));
  for (const channel of baseline.channels ?? ['beta', 'stable']) {
    const channelRoutes = await collectPublishedChannelRoutes(outDir, channel, locales);
    for (const [locale, routes] of Object.entries(channelRoutes)) publishedRoutes[locale][channel] = routes;
  }
  return {
    shape: searchPageShape(exported, baseline, publishedRoutes),
    relevance: await queryReports(databases, baseline.fixedQueries),
  };
}

export async function inspectReleaseMetrics({
  outDir = resolve(repoRoot, 'out'),
  baseline = RELEASE_QUALITY_BASELINE,
} = {}) {
  if (!existsSync(outDir)) throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  if (baseline.schemaVersion !== 1) throw new Error(`unsupported quality baseline schemaVersion ${baseline.schemaVersion}`);
  const assets = await inspectStaticAssets(outDir);
  if (!assets.searchAsset) throw new Error('static search asset not found at out/api/search');
  const observed = {
    outputBytes: assets.files.reduce((sum, file) => sum + file.size, 0),
    fileCount: assets.files.length,
    searchBytes: assets.searchAsset.size,
    largestAssetBytes: Math.max(...assets.files.map((file) => file.size)),
  };
  const budget = baseline.deterministic;
  const errors = [];
  if (observed.outputBytes > budget.outputBudgetBytes) {
    errors.push(`output ${observed.outputBytes} bytes exceeds reviewed budget ${budget.outputBudgetBytes}`);
  }
  if (observed.fileCount > budget.fileCountBudget) {
    errors.push(`file count ${observed.fileCount} exceeds reviewed budget ${budget.fileCountBudget}`);
  }
  if (observed.fileCount >= budget.cloudflareFileLimitExclusive) {
    errors.push(`file count ${observed.fileCount} must stay below Cloudflare limit ${budget.cloudflareFileLimitExclusive}`);
  }
  if (observed.searchBytes > budget.searchBudgetBytes) {
    errors.push(`search ${observed.searchBytes} bytes exceeds ${budget.searchBudgetBytes}`);
  }
  for (const file of assets.files.filter((entry) => entry.size >= budget.maxAssetBytesExclusive)) {
    errors.push(`${file.path} is ${file.size} bytes; each asset must stay below ${budget.maxAssetBytesExclusive}`);
  }
  const searchQuality = await inspectSearchQuality(resolve(outDir, 'api', 'search'), outDir, baseline);
  if (errors.length) throw new Error(`Release quality metric check failed:\n- ${errors.join('\n- ')}`);
  return {
    baseline: {
      reviewedAt: baseline.reviewedAt,
      sourceCommit: baseline.sourceCommit,
      outputBytes: budget.outputBytes,
      fileCount: budget.fileCount,
      searchBytes: budget.searchBytes,
    },
    observed,
    budgets: {
      outputBytes: budget.outputBudgetBytes,
      fileCount: budget.fileCountBudget,
      searchBytes: budget.searchBudgetBytes,
      maxAssetBytesExclusive: budget.maxAssetBytesExclusive,
    },
    searchShape: searchQuality.shape,
    relevance: searchQuality.relevance,
  };
}

async function parseOnce(outDir) {
  global.gc?.();
  let peakHeapBytes = process.memoryUsage().heapUsed;
  const raw = await readFile(resolve(outDir, 'api', 'search'), 'utf8');
  peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  const started = performance.now();
  const exported = JSON.parse(raw);
  const parseMs = performance.now() - started;
  peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  const loadStarted = performance.now();
  for (const locale of ['en', 'vi']) {
    const database = create({ schema: { _: 'string' }, language: 'english' });
    load(database, exported.data[locale]);
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  }
  const loadMs = performance.now() - loadStarted;
  return { parseMs, loadMs, parseLoadMs: parseMs + loadMs, peakHeapBytes };
}

function childJson(args) {
  const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'benchmark child failed');
  return JSON.parse(result.stdout);
}

export function benchmarkSearch({ outDir, runs = 5 }) {
  const samples = Array.from({ length: runs }, () => childJson(['--parse-once', '--out', outDir]));
  return {
    runs,
    parseMedianMs: median(samples.map((sample) => sample.parseMs)),
    loadMedianMs: median(samples.map((sample) => sample.loadMs)),
    parseLoadMedianMs: median(samples.map((sample) => sample.parseLoadMs)),
    peakHeapMedianBytes: median(samples.map((sample) => sample.peakHeapBytes)),
    samples,
  };
}

export function benchmarkBuild({ runs = 5 }) {
  const samplesMs = [];
  for (let run = 1; run <= runs; run += 1) {
    const started = performance.now();
    const result = spawnSync('pnpm', ['build'], { cwd: repoRoot, encoding: 'utf8' });
    const elapsed = performance.now() - started;
    if (result.status !== 0) {
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-4_000);
      throw new Error(`build benchmark run ${run}/${runs} failed:\n${output}`);
    }
    samplesMs.push(elapsed);
    console.error(`build benchmark ${run}/${runs}: ${(elapsed / 1000).toFixed(2)}s`);
  }
  return { runs, medianMs: median(samplesMs), samplesMs };
}

export function compareBenchmark(report, baseline = RELEASE_QUALITY_BASELINE) {
  const expected = baseline.benchmark;
  const comparisons = {
    searchParse: {
      ratio: ratio(report.search.parseMedianMs, expected.searchParseMedianMs),
      threshold: expected.thresholds.searchParse,
    },
    searchLoad: {
      ratio: ratio(report.search.loadMedianMs, expected.searchLoadMedianMs),
      threshold: expected.thresholds.searchLoad,
    },
    searchPeakHeap: {
      ratio: ratio(report.search.peakHeapMedianBytes, expected.searchPeakHeapMedianBytes),
      threshold: expected.thresholds.searchPeakHeap,
    },
  };
  if (report.build) {
    comparisons.build = {
      ratio: ratio(report.build.medianMs, expected.buildMedianMs),
      threshold: expected.thresholds.build,
    };
  }
  return Object.fromEntries(
    Object.entries(comparisons).map(([name, entry]) => [name, { ...entry, regressed: entry.ratio > entry.threshold }]),
  );
}

export function observeBenchmarkProfile() {
  const pnpm = spawnSync('pnpm', ['--version'], { cwd: repoRoot, encoding: 'utf8' });
  if (pnpm.status !== 0) throw new Error('unable to read pnpm version for benchmark profile');
  return {
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryBytes: totalmem(),
    os: observeOperatingSystemIdentity(),
    kernel: `${process.platform === 'darwin' ? 'Darwin' : process.platform} ${osRelease()}`,
    architecture: process.arch,
    node: process.versions.node,
    pnpm: pnpm.stdout.trim(),
  };
}

export function compareBenchmarkProfile(observed, expected = RELEASE_QUALITY_BASELINE.benchmark.profile) {
  const fields = ['cpu', 'cores', 'memoryBytes', 'os', 'kernel', 'architecture', 'node', 'pnpm'];
  const mismatches = fields
    .filter((field) => observed[field] !== expected[field])
    .map((field) => ({ field, expected: expected[field], observed: observed[field] }));
  return { matches: mismatches.length === 0, mismatches };
}

function observeOperatingSystemIdentity() {
  if (process.platform !== 'darwin') return `${process.platform} ${osRelease()}`;
  const result = spawnSync('sw_vers', [], { encoding: 'utf8' });
  if (result.status !== 0) return `macOS unknown (${osRelease()})`;
  const values = Object.fromEntries(
    result.stdout.split('\n').filter(Boolean).map((line) => {
      const [key, ...parts] = line.split(':');
      return [key.trim(), parts.join(':').trim()];
    }),
  );
  return `${values.ProductName} ${values.ProductVersion} (${values.BuildVersion})`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'out' },
      json: { type: 'boolean', default: false },
      benchmark: { type: 'boolean', default: false },
      'include-build': { type: 'boolean', default: false },
      runs: { type: 'string', default: '5' },
      'strict-advisory': { type: 'boolean', default: false },
      'parse-once': { type: 'boolean', default: false },
      receipt: { type: 'boolean', default: false },
    },
  });
  const outDir = resolve(repoRoot, values.out);
  if (values['parse-once']) {
    console.log(JSON.stringify(await parseOnce(outDir)));
    return;
  }
  if (values.receipt) {
    console.log(JSON.stringify({
      shape: await inspectReleaseShape({ outDir }),
      metrics: await inspectReleaseMetrics({ outDir }),
    }, null, 2));
    return;
  }
  if (values.benchmark) {
    const runs = Number(values.runs);
    if (!Number.isInteger(runs) || runs < 1 || runs % 2 === 0) throw new Error('--runs must be a positive odd integer');
    const observedProfile = observeBenchmarkProfile();
    const report = {
      advisory: true,
      profile: {
        expected: RELEASE_QUALITY_BASELINE.benchmark.profile,
        observed: observedProfile,
        ...compareBenchmarkProfile(observedProfile),
      },
      search: benchmarkSearch({ outDir, runs }),
      build: values['include-build'] ? benchmarkBuild({ runs }) : undefined,
    };
    report.comparisons = compareBenchmark(report);
    const regressions = Object.entries(report.comparisons).filter(([, entry]) => entry.regressed);
    console.log(JSON.stringify(report, null, 2));
    if (regressions.length) {
      console.error(`advisory regressions: ${regressions.map(([name]) => name).join(', ')}`);
      if (values['strict-advisory']) process.exitCode = 1;
    }
    if (!report.profile.matches) {
      console.error(`profile mismatch: ${report.profile.mismatches.map((entry) => entry.field).join(', ')}`);
      if (values['strict-advisory']) process.exitCode = 1;
    }
    return;
  }
  const report = await inspectReleaseMetrics({ outDir });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`output: ${formatMiB(report.observed.outputBytes)} / ${formatMiB(report.budgets.outputBytes)}`);
    console.log(`files: ${report.observed.fileCount} / ${report.budgets.fileCount}`);
    console.log(`search: ${formatMiB(report.observed.searchBytes)} / ${formatMiB(report.budgets.searchBytes)}`);
    for (const query of report.relevance) console.log(`search ${query.locale}/${query.query}: rank ${query.rank}`);
    console.log('release-quality-metrics: deterministic budgets and relevance OK.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
