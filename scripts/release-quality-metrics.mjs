#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { cpus, release as osRelease, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  inspectStaticAssets,
  MAX_ASSET_BYTES,
  MAX_STATIC_ASSET_FILES,
  MEBIBYTE,
  SEARCH_ASSET_BUDGET_BYTES,
} from './lib/static-assets.mjs';
import { collectPublishedChannelRoutes, inspectReleaseShape } from './release-quality-shape.mjs';
import { initSearchShard, querySearchShard } from '../lib/search-client.mjs';
import {
  SEARCH_SCOPES,
  pageScopeFromUrl,
  searchScopeKey,
  searchScopePrefix,
  searchShardPath,
} from '../lib/search-scopes.mjs';

export const RELEASE_QUALITY_BASELINE = Object.freeze({
  schemaVersion: 1,
  reviewedAt: '2026-09-23',
  sourceCommit: '5a69e47',
  channels: ['beta', 'stable'],
  locales: ['en', 'vi'],
  deterministic: {
    outputBytes: 3_047_146_912,
    // Preserve the previous per-route allowance as coverage grows 411 -> 449 -> 456 -> 481 -> 482 -> 485.
    outputBudgetBytes: 3_387_022_265,
    fileCount: 23_584,
    fileCountBudget: 25_687,
    // Aggregate across the four locale/channel shards.
    searchBytes: 20_067_964,
    searchBudgetBytes: SEARCH_ASSET_BUDGET_BYTES,
    // Counts follow each channel's reviewed route inventory. Equal Kit artifact
    // snapshots require equal Kit route coverage across Stable and Beta.
    // Beta includes the bilingual guides/pi-extensions page ahead of promotion.
    searchPagesPerLocaleChannel: { stable: 456, beta: 485 },
    // Pages outside every channel (the unlisted `_showcase` visual QA page) are
    // real site routes but never search results: each shard must contain only
    // the pages served under its own locale/channel prefix.
    reviewedSearchExcludedPublishedRoutes: ['reference/cli/ak'],
    maxAssetBytesExclusive: MAX_ASSET_BYTES,
    cloudflareFileLimitExclusive: MAX_STATIC_ASSET_FILES,
  },
  benchmark: {
    // Historical pre-sharding observation: the search figures below measured
    // one whole-corpus index, while `benchmarkSearch` now reports the worst of
    // the four scope shards (`scope: 'worst shard of 4'`). The recorded numbers
    // are left untouched as history; a `--strict-advisory` comparison against
    // them is only meaningful after a new receipt is recorded on this profile.
    scope: 'whole index',
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
  // Acceptance matrix. Each row is expanded over every channel in
  // `channels` for its named locale, so a row asserts the same intent in
  // Stable and Beta. `route` is channel-relative; `maxRank` is the reviewed
  // bound on the page's position among distinct page groups.
  fixedQueries: [
    // Documented intent matrix.
    { locale: 'en', query: 'install AgentKit', route: 'getting-started/installation', maxRank: 3 },
    { locale: 'en', query: 'Engineer kit', route: 'kits/engineer', maxRank: 1 },
    { locale: 'en', query: 'skills', route: 'kits', maxRank: 3 },
    { locale: 'en', query: 'Engineer skills', route: 'kits/engineer/skills', maxRank: 3 },
    { locale: 'en', query: 'migrate ClaudeKit to AgentKit', route: 'guides/migrating-from-claudekit', maxRank: 3 },
    { locale: 'en', query: 'workflow', route: 'kits/workflows', maxRank: 3 },
    { locale: 'en', query: 'Marketing Kit', route: 'kits/marketing', maxRank: 1 },
    { locale: 'en', query: 'ak update', route: 'reference/cli/update', maxRank: 3 },
    { locale: 'vi', query: 'cài đặt AgentKit', route: 'getting-started/installation', maxRank: 3 },
    { locale: 'vi', query: 'cai dat AgentKit', route: 'getting-started/installation', maxRank: 3 },
    { locale: 'vi', query: 'Engineer Kit', route: 'kits/engineer', maxRank: 1 },
    { locale: 'vi', query: 'danh mục Skill', route: 'kits', maxRank: 3 },
    { locale: 'vi', query: 'danh muc Skill', route: 'kits', maxRank: 3 },
    { locale: 'vi', query: 'chuyển từ ClaudeKit', route: 'guides/migrating-from-claudekit', maxRank: 3 },
    { locale: 'vi', query: 'chuyen tu ClaudeKit', route: 'guides/migrating-from-claudekit', maxRank: 3 },
    { locale: 'vi', query: 'Marketing Kit', route: 'kits/marketing', maxRank: 1 },
    { locale: 'vi', query: 'ak update', route: 'reference/cli/update', maxRank: 3 },
    // Retained scenarios: plain term, accented and unaccented VI, a heading-led
    // page and a workflow-discovery phrase.
    { locale: 'en', query: 'installation', route: 'getting-started/installation', maxRank: 3 },
    { locale: 'en', query: 'engineer kit', route: 'kits/engineer', maxRank: 3 },
    { locale: 'en', query: 'workflow guides', route: 'kits/workflows', maxRank: 5 },
    { locale: 'vi', query: 'Ứng dụng Desktop', route: 'desktop-app', maxRank: 5 },
    { locale: 'vi', query: 'quy ước CLI', route: 'reference/cli-conventions', maxRank: 5 },
    { locale: 'vi', query: 'cai dat', route: 'getting-started/installation', maxRank: 3 },
    // Exact Skill and command identities, a reordered phrase and a documented
    // misspelling: none of these may be answered by a generic landing page.
    { locale: 'en', query: 'ak:xia', route: 'kits/engineer/skills/xia', maxRank: 3 },
    { locale: 'en', query: 'ak:update', route: 'reference/cli/update', maxRank: 3 },
    { locale: 'en', query: 'AgentKit install', route: 'getting-started/installation', maxRank: 3 },
    { locale: 'en', query: 'instalation', route: 'getting-started/installation', maxRank: 5 },
    { locale: 'en', query: 'claudkit migration', route: 'guides/migrating-from-claudekit', maxRank: 3 },
  ],
  // Negative controls. `absentRoutes` must not be promoted into the top three
  // page groups, so a blanket landing boost or an overreaching alias fails
  // here even though it would look fine on the positive rows.
  fixedNegativeQueries: [
    {
      locale: 'en',
      query: 'quantum chromodynamics primer',
      absentRoutes: [],
      zeroResults: true,
    },
    {
      locale: 'en',
      query: 'kubernetes operator tuning',
      absentRoutes: [
        'getting-started/installation',
        'kits/engineer',
        'kits',
        'kits/engineer/skills',
        'kits/workflows',
        'kits/marketing',
        'guides/migrating-from-claudekit',
      ],
    },
    {
      locale: 'en',
      query: 'skills marketing',
      absentRoutes: [
        'kits',
        'kits/workflows',
        'getting-started/installation',
        'guides/migrating-from-claudekit',
      ],
    },
    {
      locale: 'en',
      query: 'install kubernetes',
      absentRoutes: [
        'kits',
        'kits/workflows',
        'kits/engineer',
        'kits/marketing',
        'guides/migrating-from-claudekit',
      ],
    },
    {
      locale: 'vi',
      query: 'nấu phở bò',
      absentRoutes: [
        'getting-started/installation',
        'kits/engineer',
        'kits',
        'kits/engineer/skills',
        'kits/workflows',
        'kits/marketing',
        'guides/migrating-from-claudekit',
      ],
    },
    {
      locale: 'vi',
      query: 'danh mục marketing',
      absentRoutes: [
        'kits',
        'kits/workflows',
        'getting-started/installation',
        'guides/migrating-from-claudekit',
      ],
    },
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

// Load each scope's own prerendered shard. The quality runner reads the same
// four exports the browser fetches, through the same query implementation, so
// the CLI report and the UI cannot disagree.
async function loadSearchShards(outDir, baseline) {
  const assets = await inspectStaticAssets(outDir);
  const shards = new Map();
  const errors = [];
  for (const shard of assets.searchShards) {
    if (shard.missing) {
      errors.push(`${shard.path} is missing; every locale/channel scope must export its own shard`);
      continue;
    }

    const raw = await readFile(resolve(outDir, shard.path), 'utf8');
    const exported = JSON.parse(raw);
    shards.set(searchScopeKey(shard.locale, shard.channel), {
      locale: shard.locale,
      channel: shard.channel,
      path: shard.path,
      size: shard.size,
      exported,
      database: initSearchShard(exported, `search shard ${shard.path}`),
    });
  }
  if (errors.length) throw new Error(`Search shard loading failed:\n- ${errors.join('\n- ')}`);

  const expected = baseline?.locales?.length * baseline?.channels?.length;
  if (expected && shards.size !== expected) {
    throw new Error(`expected ${expected} search shards; received ${shards.size}`);
  }
  return shards;
}

// Expand the reviewed matrix over every channel so one row asserts the same
// intent in Stable and Beta without duplicating the row per channel.
function expandFixedQueries(baseline) {
  const channels = baseline.channels ?? ['beta', 'stable'];
  const expanded = [];
  for (const entry of baseline.fixedQueries ?? []) {
    for (const channel of channels) {
      expanded.push({
        ...entry,
        channel,
        expectedRoute: `/${entry.locale}/${channel}/${entry.route}`,
      });
    }
  }
  return expanded;
}

function expandNegativeQueries(baseline) {
  const channels = baseline.channels ?? ['beta', 'stable'];
  const expanded = [];
  for (const entry of baseline.fixedNegativeQueries ?? []) {
    for (const channel of channels) {
      expanded.push({
        ...entry,
        channel,
        absentRoutes: (entry.absentRoutes ?? []).map((route) => `/${entry.locale}/${channel}/${route}`),
      });
    }
  }
  return expanded;
}

// Records outside the queried scope can never be rendered as a result. Shared
// by the positive and negative reports so both classify URLs the same way.
function foreignScopeRoutes(routes, entry) {
  return routes.filter((url) => {
    try {
      const scope = pageScopeFromUrl(url);
      return !scope || scope.locale !== entry.locale || scope.channel !== entry.channel;
    } catch {
      return true;
    }
  });
}

// Page groups, not rows: the CLI reports how many distinct pages a query
// matched, so heading rows and duplicate channel URLs cannot inflate a count.
function pageGroupRoutes(results) {
  return results.filter((result) => result.type === 'page').map((result) => result.url);
}

// Relevance and scope isolation for the acceptance matrix. Each query runs
// against one shard only, so a Beta/VI record must never appear in an
// EN/Stable result, and the expected page must land inside its reviewed bound.
async function queryReports(shards, queries) {
  const reports = [];
  const errors = [];
  for (const entry of queries) {
    const key = searchScopeKey(entry.locale, entry.channel);
    const shard = shards.get(key);
    if (!shard) {
      errors.push(`${key}/${entry.query}: locale/channel shard is missing`);
      continue;
    }

    const results = await querySearchShard(shard.database, { query: entry.query });
    const routes = pageGroupRoutes(results);
    const topThree = routes.slice(0, 3);
    const foreign = foreignScopeRoutes(routes, entry);
    if (foreign.length) {
      errors.push(`${key}/${entry.query}: returned records outside its scope [${foreign.join(', ')}]`);
    }

    const rank = routes.indexOf(entry.expectedRoute) + 1;
    reports.push({
      locale: entry.locale,
      channel: entry.channel,
      query: entry.query,
      expectedRoute: entry.expectedRoute,
      maxRank: entry.maxRank,
      rank: rank || null,
      pageGroupCount: routes.length,
      topThree,
    });
    if (rank === 0 || rank > entry.maxRank) {
      errors.push(
        `${key}/${entry.query}: expected ${entry.expectedRoute} within rank ${entry.maxRank}; received [${topThree.join(', ')}]`,
      );
    }
  }
  if (errors.length) throw new Error(`Fixed search relevance check failed:\n- ${errors.join('\n- ')}`);
  return reports;
}

// Negative controls: an unrelated query must not promote a landing page, and a
// genuinely unknown query must be allowed to match nothing.
async function negativeQueryReports(shards, queries) {
  const reports = [];
  const errors = [];
  for (const entry of queries) {
    const key = searchScopeKey(entry.locale, entry.channel);
    const shard = shards.get(key);
    if (!shard) {
      errors.push(`${key}/${entry.query}: locale/channel shard is missing`);
      continue;
    }

    const results = await querySearchShard(shard.database, { query: entry.query });
    const routes = pageGroupRoutes(results);
    const topThree = routes.slice(0, 3);
    const foreign = foreignScopeRoutes(routes, entry);
    if (foreign.length) {
      errors.push(`${key}/${entry.query}: returned records outside its scope [${foreign.join(', ')}]`);
    }

    const promoted = new Set(topThree);
    const leaked = entry.absentRoutes.filter((route) => promoted.has(route));
    if (leaked.length) {
      errors.push(`${key}/${entry.query}: unrelated landing pages were promoted [${leaked.join(', ')}]`);
    }
    if (entry.zeroResults && routes.length > 0) {
      errors.push(`${key}/${entry.query}: expected no matching page; received [${topThree.join(', ')}]`);
    }

    reports.push({
      locale: entry.locale,
      channel: entry.channel,
      query: entry.query,
      pageGroupCount: routes.length,
      topThree,
      promotedUnrelated: leaked,
    });
  }
  if (errors.length) throw new Error(`Negative search relevance check failed:\n- ${errors.join('\n- ')}`);
  return reports;
}

function shardRoute(document, locale, channel) {
  let scope;
  try {
    scope = pageScopeFromUrl(document.url);
  } catch (error) {
    return { error: `${locale}/${channel}: malformed search record URL ${document.url} (${error.message})` };
  }

  if (!scope || scope.locale !== locale || scope.channel !== channel) {
    return { error: `foreign-scope record in ${locale}/${channel}: ${document.url}` };
  }

  const prefix = searchScopePrefix(locale, channel);
  return { route: document.url.slice(prefix.length).replace(/^\//, '') };
}

// Every shard must contain exactly the pages published under its own prefix,
// after the reviewed exclusions, and nothing else. Every document in the shard
// — page, heading or description — is scope-checked, because any of them can be
// rendered as a search result URL.
function searchPageShape(shards, baseline, publishedRoutes) {
  const errors = [];
  const routes = {};
  const shardBytes = {};
  for (const { locale, channel } of SEARCH_SCOPES) {
    const key = searchScopeKey(locale, channel);
    const shard = shards.get(key);
    const scopeRoutes = new Set();

    routes[locale] ??= {};
    routes[locale][channel] = scopeRoutes;
    shardBytes[key] = shard?.size ?? 0;

    if (!shard) {
      errors.push(`${locale}/${channel}: search shard is missing`);
      continue;
    }

    const pageUrls = new Set();
    for (const document of Object.values(shard.exported?.docs?.docs ?? {})) {
      const { route, error } = shardRoute(document, locale, channel);
      if (error) {
        errors.push(error);
        continue;
      }
      if (document.type !== 'page') continue;

      if (pageUrls.has(document.url)) {
        errors.push(`${locale}/${channel}: duplicate searchable page URL ${document.url}`);
        continue;
      }
      pageUrls.add(document.url);
      scopeRoutes.add(route);
    }

    const count = scopeRoutes.size;
    const expectedCount = baseline.deterministic.searchPagesPerLocaleChannel[channel];
    if (count !== expectedCount) {
      errors.push(`${locale}/${channel}: searchable page count ${count} does not match reviewed baseline ${expectedCount}`);
    }

    const expectedSearchRoutes = new Set(publishedRoutes[locale]?.[channel] ?? []);
    for (const route of baseline.deterministic.reviewedSearchExcludedPublishedRoutes) {
      if (!expectedSearchRoutes.delete(route)) {
        errors.push(`${locale}/${channel}: reviewed search exclusion is not a published route: ${route}`);
      }
    }
    addSetDifference(
      errors,
      `${locale}/${channel} published/searchable route contract`,
      expectedSearchRoutes,
      scopeRoutes,
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
  for (const locale of baseline.locales ?? ['en', 'vi']) {
    addMissingSubset(
      errors,
      `${locale} stable ⊆ beta searchable route shape`,
      routes[locale].stable,
      routes[locale].beta,
    );
  }

  if (errors.length) throw new Error(`Search index shape check failed:\n- ${errors.join('\n- ')}`);
  return {
    pages: Object.fromEntries(
      Object.entries(routes).map(([locale, channels]) => [
        locale,
        Object.fromEntries(Object.entries(channels).map(([channel, values]) => [channel, values.size])),
      ]),
    ),
    shardBytes,
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

export async function checkFixedQueries(outDir, queries, baseline = RELEASE_QUALITY_BASELINE) {
  const shards = await loadSearchShards(outDir, baseline);
  return queryReports(
    shards,
    queries.map((entry) => ({
      ...entry,
      expectedRoute: entry.expectedRoute ?? `/${entry.locale}/${entry.channel}/${entry.route}`,
    })),
  );
}

export async function checkNegativeQueries(outDir, queries, baseline = RELEASE_QUALITY_BASELINE) {
  const shards = await loadSearchShards(outDir, baseline);
  return negativeQueryReports(
    shards,
    queries.map((entry) => ({
      ...entry,
      absentRoutes:
        entry.absentRoutes?.map((route) =>
          route.startsWith('/') ? route : `/${entry.locale}/${entry.channel}/${route}`,
        ) ?? [],
    })),
  );
}

async function inspectSearchQuality(outDir, baseline) {
  const shards = await loadSearchShards(outDir, baseline);
  const locales = baseline.locales ?? ['en', 'vi'];
  const publishedRoutes = Object.fromEntries(locales.map((locale) => [locale, {}]));
  for (const channel of baseline.channels ?? ['beta', 'stable']) {
    const channelRoutes = await collectPublishedChannelRoutes(outDir, channel, locales);
    for (const [locale, routes] of Object.entries(channelRoutes)) publishedRoutes[locale][channel] = routes;
  }
  return {
    shape: searchPageShape(shards, baseline, publishedRoutes),
    relevance: await queryReports(shards, expandFixedQueries(baseline)),
    negativeRelevance: await negativeQueryReports(shards, expandNegativeQueries(baseline)),
  };
}

export async function inspectReleaseMetrics({
  outDir = resolve(repoRoot, 'out'),
  baseline = RELEASE_QUALITY_BASELINE,
} = {}) {
  if (!existsSync(outDir)) throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  if (baseline.schemaVersion !== 1) throw new Error(`unsupported quality baseline schemaVersion ${baseline.schemaVersion}`);
  const assets = await inspectStaticAssets(outDir);
  const missingShards = assets.missingSearchShards.map((shard) => shard.path);
  if (missingShards.length) {
    throw new Error(`static search shards not found at ${missingShards.join(', ')} — run \`pnpm build\` first`);
  }
  const observed = {
    outputBytes: assets.files.reduce((sum, file) => sum + file.size, 0),
    fileCount: assets.files.length,
    // Aggregate across the four shards: they partition one discovery corpus.
    searchBytes: assets.searchBytes,
    largestSearchShardBytes: assets.maxSearchShardBytes,
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
    errors.push(`search shards total ${observed.searchBytes} bytes; budget is ${budget.searchBudgetBytes}`);
  }
  for (const file of assets.files.filter((entry) => entry.size >= budget.maxAssetBytesExclusive)) {
    errors.push(`${file.path} is ${file.size} bytes; each asset must stay below ${budget.maxAssetBytesExclusive}`);
  }
  const searchQuality = await inspectSearchQuality(outDir, baseline);
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
    negativeRelevance: searchQuality.negativeRelevance,
  };
}

// Cold-load cost of every shard. Shards are measured individually because a
// search only ever loads one of them; the reported parse/load figures are the
// worst shard, which is not directly comparable to a pre-sharding
// whole-index receipt.
async function parseOnce(outDir) {
  global.gc?.();
  let peakHeapBytes = process.memoryUsage().heapUsed;
  const shards = {};
  const retained = [];
  let parseMs = 0;
  let loadMs = 0;

  for (const { locale, channel } of SEARCH_SCOPES) {
    const path = resolve(outDir, searchShardPath(locale, channel));
    const raw = await readFile(path, 'utf8');
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);

    const parseStarted = performance.now();
    const exported = JSON.parse(raw);
    const shardParseMs = performance.now() - parseStarted;

    const loadStarted = performance.now();
    retained.push(initSearchShard(exported, `search shard ${path}`));
    const shardLoadMs = performance.now() - loadStarted;

    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    shards[searchScopeKey(locale, channel)] = { bytes: Buffer.byteLength(raw), parseMs: shardParseMs, loadMs: shardLoadMs };
    parseMs = Math.max(parseMs, shardParseMs);
    loadMs = Math.max(loadMs, shardLoadMs);
  }

  return {
    parseMs,
    loadMs,
    parseLoadMs: parseMs + loadMs,
    peakHeapBytes,
    shards,
    retainedShards: retained.length,
  };
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
  const shards = {};
  for (const { locale, channel } of SEARCH_SCOPES) {
    const key = searchScopeKey(locale, channel);
    shards[key] = {
      bytes: samples[0].shards[key]?.bytes ?? 0,
      parseMedianMs: median(samples.map((sample) => sample.shards[key].parseMs)),
      loadMedianMs: median(samples.map((sample) => sample.shards[key].loadMs)),
    };
  }
  const worstParseShard = Object.entries(shards).sort(([, left], [, right]) => right.parseMedianMs - left.parseMedianMs)[0]?.[0];
  const worstLoadShard = Object.entries(shards).sort(([, left], [, right]) => right.loadMedianMs - left.loadMedianMs)[0]?.[0];

  return {
    runs,
    scope: 'worst shard of 4',
    shards,
    worstParseShard,
    worstLoadShard,
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
  const observedScope = report.search.scope ?? 'whole index';
  const expectedScope = expected.scope ?? 'whole index';
  const comparisons = {
    searchParse: {
      ratio: ratio(report.search.parseMedianMs, expected.searchParseMedianMs),
      threshold: expected.thresholds.searchParse,
      scope: observedScope,
    },
    searchLoad: {
      ratio: ratio(report.search.loadMedianMs, expected.searchLoadMedianMs),
      threshold: expected.thresholds.searchLoad,
      scope: observedScope,
    },
    searchPeakHeap: {
      ratio: ratio(report.search.peakHeapMedianBytes, expected.searchPeakHeapMedianBytes),
      threshold: expected.thresholds.searchPeakHeap,
      scope: 'all shards loaded',
    },
  };
  if (report.build) {
    comparisons.build = {
      ratio: ratio(report.build.medianMs, expected.buildMedianMs),
      threshold: expected.thresholds.build,
    };
  }

  // A ratio against a baseline measured on a different artifact shape is not a
  // regression signal. The search medians were recorded on the whole-corpus
  // index and sharding changed what is measured, so a comparison that is not
  // comparable reports the two scopes and is never counted as a regression —
  // the scope mismatch itself is what `--strict-advisory` fails on.
  const scopeComparable = observedScope === expectedScope;
  const compared = Object.fromEntries(
    Object.entries(comparisons).map(([name, entry]) => {
      const comparable = name === 'build' ? true : scopeComparable;
      return [
        name,
        {
          ...entry,
          comparable,
          regressed: comparable && entry.ratio > entry.threshold,
        },
      ];
    }),
  );

  return { ...compared, scope: { expected: expectedScope, observed: observedScope, comparable: scopeComparable } };
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
    if (!report.comparisons.scope.comparable) {
      console.error(
        `benchmark scope mismatch: baseline measured "${report.comparisons.scope.expected}", ` +
          `this run measured "${report.comparisons.scope.observed}"; record a new receipt before comparing`,
      );
      if (values['strict-advisory']) process.exitCode = 1;
    }
    return;
  }
  const report = await inspectReleaseMetrics({ outDir });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`output: ${formatMiB(report.observed.outputBytes)} / ${formatMiB(report.budgets.outputBytes)}`);
    console.log(`files: ${report.observed.fileCount} / ${report.budgets.fileCount}`);
    console.log(
      `search: ${formatMiB(report.observed.searchBytes)} / ${formatMiB(report.budgets.searchBytes)} ` +
        `(largest shard ${formatMiB(report.observed.largestSearchShardBytes)})`,
    );
    for (const query of report.relevance) {
      console.log(
        `search ${query.locale}/${query.channel} "${query.query}": rank ${query.rank}/${query.maxRank} ` +
          `of ${query.pageGroupCount} pages; top 3 [${query.topThree.join(', ')}]`,
      );
    }
    for (const query of report.negativeRelevance ?? []) {
      console.log(
        `negative ${query.locale}/${query.channel} "${query.query}": ${query.pageGroupCount} pages; ` +
          `top 3 [${query.topThree.join(', ')}]`,
      );
    }
    console.log('release-quality-metrics: deterministic budgets, relevance and negative controls OK.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
