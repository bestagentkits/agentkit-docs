// One search implementation for the browser dialog and the build-time quality
// checks, so the UI and the CLI can never drift.
//
// A search is always scoped: it loads exactly one prerendered shard
// (`/{locale}/{channel}`) and never substitutes another locale or channel when
// that shard fails to load. Query and result-group adaptation mirrors
// Fumadocs' advanced-search semantics (page-grouped results with heading
// links) using only public Orama and Fumadocs APIs.
//
// Ranking is page-level and bounded. Primary retrieval is Orama's own
// relevance order; on top of it this module applies the site's intent rules:
// an explicit command/Skill identity first, then the page the query names
// itself, then a documented landing alias that covers every informative query
// term, and only then term coverage, phrase match, description/heading
// evidence and Orama relevance. Every candidate set is capped, so a broad
// query cannot turn into an unbounded scan or an unbounded result list.

import { create, getByID, load, search } from '@orama/orama';
import { createContentHighlighter } from 'fumadocs-core/search';
import {
  SEARCH_ENDPOINT_BASE,
  SEARCH_SCOPES,
  assertSupportedSearchScope,
  pageScopeFromUrl,
  searchScopeKey,
  searchScopePrefix,
  searchShardUrl,
} from './search-scopes.mjs';

// Orama ships no Vietnamese tokenizer, so `vi` reuses the English analyzer —
// the same choice the prerendered shards are built with.
export const SEARCH_LANGUAGE = 'english';

// Fumadocs caps a grouped advanced result at 60 entries with at most 8 hits per
// page group.
export const SEARCH_RESULT_LIMIT = 60;
export const SEARCH_GROUP_MAX_RESULT = 8;

// Bounds. Primary retrieval is capped before ranking (never after), the visible
// list is capped by page group rather than by row, and the alias supplement is
// a small exact lookup instead of a second search.
export const SEARCH_CANDIDATE_PAGE_GROUP_LIMIT = 60;
export const SEARCH_PAGE_GROUP_LIMIT = 12;
export const SEARCH_PAGE_GROUP_MAX_RESULT = 2;
export const SEARCH_LANDING_CANDIDATE_LIMIT = 5;

// At most the four known shards are retained.
const MAX_CACHED_SHARDS = SEARCH_SCOPES.length;

/**
 * @typedef {import('fumadocs-core/search').SortedResult<string>} SortedResult
 * @typedef {{ locale: string, channel: string, from?: string, fetchImpl?: typeof fetch, retryToken?: number }} ScopeOptions
 * @typedef {{ deps: string[], search: (query: string) => Promise<SortedResult[]> }} ScopedSearchClient
 */

// ---------------------------------------------------------------------------
// Query normalization and glossary
// ---------------------------------------------------------------------------

const COMBINING_MARKS = /[\u0300-\u036f]/g;

// Fold case, diacritics and whitespace so `Cài đặt`, `cai dat` and `CAI DAT`
// are one query. `đ` has no combining decomposition, so it is mapped
// explicitly. Normalization is only ever used for matching; rendered titles,
// excerpts and headings keep the original Vietnamese text.
/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

// A word keeps internal punctuation (`ak:plan`, `ak-update`, `ak/plan`) and
// drops only what surrounds it, so a command is never silently split into two
// unrelated terms.
function trimWordEdges(word) {
  return word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

// Small, documented glossary. Each group is `[canonical, ...surface forms]`;
// a surface form is replaced by its canonical form on both the index side and
// the query side, so `install`/`installation`/`cài đặt` and
// `skill`/`skills`/`danh mục` match the same pages. There is deliberately no
// ClaudeKit <-> AgentKit equivalence: they are different products with
// different migration pages, and merging them would hide the migration guide.
const TERM_GLOSSARY = Object.freeze([
  Object.freeze([
    'install',
    'installs',
    'installing',
    'installation',
    'installations',
    'setup',
    'cai',
    'cai-dat',
    'cai dat',
  ]),
  Object.freeze([
    'migrate',
    'migrates',
    'migrated',
    'migrating',
    'migration',
    'migrations',
    'chuyen',
    'chuyen-tu',
    'chuyen tu',
  ]),
  Object.freeze([
    'skill',
    'skills',
    'ky-nang',
    'ky nang',
    'danh-muc',
    'danh muc',
    'danh-sach',
    'danh sach',
  ]),
  Object.freeze(['workflow', 'workflows', 'quy-trinh', 'quy trinh']),
]);

const GLOSSARY_BY_SURFACE = new Map();
let GLOSSARY_MAX_WORDS = 1;
for (const [canonical, ...surfaces] of TERM_GLOSSARY) {
  for (const surface of surfaces) {
    GLOSSARY_BY_SURFACE.set(surface, canonical);
    GLOSSARY_MAX_WORDS = Math.max(GLOSSARY_MAX_WORDS, surface.split(' ').length);
  }
}

// Words that carry no lookup intent. Dropped after glossary expansion, so a
// multi-word surface form such as `chuyen tu` is still recognized first.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'from', 'of', 'for', 'and', 'or', 'in', 'on', 'with',
  'is', 'are', 'be', 'how', 'do', 'does', 'my', 'your', 'it', 'this', 'that',
  'cac', 'cua', 'cho', 'voi', 'mot', 'la', 'de', 'trong', 'khi', 'nhu',
]);

/**
 * Canonical, deduplicated terms for any text: normalized, glossary-expanded
 * and stripped of stopwords. The same function runs on page titles, aliases
 * and queries, which is what makes accent folding and glossary equivalence
 * symmetric.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function informativeSearchTerms(value) {
  const words = normalizeSearchText(value)
    .split(' ')
    .map(trimWordEdges)
    .filter(Boolean);
  const terms = [];
  for (let index = 0; index < words.length; index += 1) {
    let matched;
    for (let size = Math.min(GLOSSARY_MAX_WORDS, words.length - index); size >= 1; size -= 1) {
      const phrase = words.slice(index, index + size).join(' ');
      if (GLOSSARY_BY_SURFACE.has(phrase)) {
        matched = { canonical: GLOSSARY_BY_SURFACE.get(phrase), size };
        break;
      }
    }
    if (matched) {
      terms.push(matched.canonical);
      index += matched.size - 1;
    } else {
      terms.push(words[index]);
    }
  }

  const seen = new Set();
  const informative = [];
  for (const term of terms) {
    if (STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    informative.push(term);
  }
  return informative;
}

// Punctuation-insensitive identity of a command or a page title, used to tell
// `ak update`, `ak:update` and `ak-update` apart from every other page while
// still keeping `ak plan update` distinct from `ak update`.
function identityKey(value) {
  return informativeSearchTerms(value).join('').replace(/[^\p{L}\p{N}]/gu, '');
}

// ---------------------------------------------------------------------------
// Landing aliases and scoped shortcuts
// ---------------------------------------------------------------------------

// Declarative intent aliases: for each documented intent, the canonical
// channel-relative landing route and the phrases that mean it, per locale.
// Aliases are matching data only — a result always renders the page's own
// title and excerpt, and a page is only promoted when a single alias phrase
// covers every informative query term, so an unrelated query can never pull a
// landing page into the results.
//
// `instalation` and `claudkit` are documented common misspellings: Orama's
// fulltext mode has no typo tolerance, so they are declared here rather than
// guessed at query time.
export const SEARCH_INTENT_ALIASES = Object.freeze([
  Object.freeze({
    route: 'getting-started/installation',
    aliases: Object.freeze({
      en: Object.freeze([
        'install agentkit',
        'installation',
        'install',
        'set up agentkit',
        'setup agentkit',
        'instalation',
      ]),
      vi: Object.freeze(['cai dat agentkit', 'cai dat', 'cài đặt agentkit', 'cài đặt']),
    }),
  }),
  Object.freeze({
    route: 'kits/engineer',
    aliases: Object.freeze({
      en: Object.freeze(['engineer kit', 'engineer']),
      vi: Object.freeze(['engineer kit', 'kit engineer', 'engineer']),
    }),
  }),
  Object.freeze({
    route: 'kits',
    aliases: Object.freeze({
      en: Object.freeze(['skill catalog', 'skills', 'skill list', 'kit catalog', 'kits']),
      vi: Object.freeze(['danh muc skill', 'danh sach skill', 'danh muc kit', 'danh sach kit']),
    }),
  }),
  Object.freeze({
    route: 'kits/engineer/skills',
    aliases: Object.freeze({
      en: Object.freeze(['engineer skills', 'engineer skill', 'engineer skill list']),
      vi: Object.freeze(['skill engineer', 'danh muc skill engineer']),
    }),
  }),
  Object.freeze({
    route: 'kits/workflows',
    aliases: Object.freeze({
      en: Object.freeze(['workflow guides', 'workflow guide', 'workflows', 'workflow']),
      vi: Object.freeze(['quy trinh', 'workflow guides', 'workflow']),
    }),
  }),
  Object.freeze({
    route: 'kits/marketing',
    aliases: Object.freeze({
      en: Object.freeze(['marketing kit', 'marketing']),
      vi: Object.freeze(['marketing kit', 'marketing']),
    }),
  }),
  Object.freeze({
    route: 'guides/migrating-from-claudekit',
    aliases: Object.freeze({
      en: Object.freeze([
        'migrate claudekit to agentkit',
        'migrating from claudekit',
        'claudekit migration',
        'migrate claudekit',
        'claudekit',
        'claudkit',
      ]),
      vi: Object.freeze(['chuyen tu claudekit', 'chuyen claudekit', 'claudkit']),
    }),
  }),
]);

// Empty-query shortcuts. Shown as shortcuts, never as matches, and always
// scoped to the reader's current locale and channel.
export const SEARCH_SHORTCUTS = Object.freeze([
  Object.freeze({
    id: 'installation',
    route: 'getting-started/installation',
    labels: Object.freeze({ en: 'Installation', vi: 'Cài đặt' }),
  }),
  Object.freeze({
    id: 'engineer',
    route: 'kits/engineer',
    labels: Object.freeze({ en: 'Engineer Kit', vi: 'Engineer Kit' }),
  }),
  Object.freeze({
    id: 'skills',
    route: 'kits',
    labels: Object.freeze({ en: 'Skill Catalog', vi: 'Danh mục Skill' }),
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

/**
 * @param {{ route: string, locale: string, channel: string }} options
 * @returns {string}
 */
export function searchShortcutHref({ route, locale, channel }) {
  return `${searchScopePrefix(locale, channel)}/${route}`;
}

/**
 * @param {{ locale: string, channel: string }} options
 * @returns {{ id: string, label: string, href: string }[]}
 */
export function searchShortcutItems({ locale, channel }) {
  return SEARCH_SHORTCUTS.map((shortcut) => ({
    id: shortcut.id,
    label: shortcut.labels[locale] ?? shortcut.labels.en,
    href: searchShortcutHref({ route: shortcut.route, locale, channel }),
  }));
}

// ---------------------------------------------------------------------------
// Shard loading
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<unknown>>} */
const shardCache = new Map();

// Page-level lookup for one shard, keyed by the loaded database so it is built
// once per shard instead of reparsing every page on every keystroke.
/** @type {WeakMap<object, ReturnType<typeof buildShardLookup>>} */
const shardLookups = new WeakMap();

export function resetSearchClientState() {
  shardCache.clear();
}

function initOrama() {
  return create({ schema: { _: 'string' }, language: SEARCH_LANGUAGE });
}

// Every page document of one shard, with the matching data the ranker needs.
// Built from the export (not by re-querying Orama) and stored per database.
function buildShardLookup(exported) {
  /** @type {Map<string, object>} */
  const pages = new Map();
  for (const document of Object.values(exported?.docs?.docs ?? {})) {
    if (document?.type !== 'page') continue;
    if (pages.has(document.url)) continue;

    let scope;
    try {
      scope = pageScopeFromUrl(document.url);
    } catch {
      continue;
    }
    if (!scope) continue;

    const prefix = searchScopePrefix(scope.locale, scope.channel);
    const route = document.url.slice(prefix.length).replace(/^\//, '');
    const titleTerms = informativeSearchTerms(document.content);
    const aliases = SEARCH_INTENT_ALIASES.filter(
      (entry) => entry.route === route && entry.aliases[scope.locale],
    );
    const aliasPhrases = [];
    for (const entry of aliases) {
      for (const phrase of entry.aliases[scope.locale]) {
        const terms = informativeSearchTerms(phrase);
        if (terms.length === 0) continue;
        aliasPhrases.push({ terms, specificity: terms.length });
      }
    }

    pages.set(document.url, {
      url: document.url,
      route,
      locale: scope.locale,
      channel: scope.channel,
      title: document.content,
      titleTerms,
      titleKey: identityKey(document.content),
      identityKey: identityKey(document.content),
      commandKey: /^ak[\s:.\-/]/i.test(normalizeSearchText(document.content))
        ? identityKey(document.content)
        : null,
      aliasPhrases,
    });
  }

  return { pages };
}

// Restore one exported shard into a queryable database.
/**
 * @param {unknown} exported
 * @param {string} [source]
 */
export function initSearchShard(exported, source = 'search shard') {
  const exportType = /** @type {{type?: unknown}} */ (exported)?.type;
  if (exportType !== 'advanced') {
    throw new Error(
      `${source} must be a Fumadocs advanced search export; received ${exportType ?? 'nothing'}`,
    );
  }

  const database = initOrama();
  load(database, /** @type {Parameters<typeof load>[1]} */ (exported));
  shardLookups.set(database, buildShardLookup(exported));
  return database;
}

// A shard must contain only its own scope's records. Checked before a
// network-loaded shard is cached or queried, so a mismatched deployment (for
// example a Beta export served from the Stable URL) can never surface another
// channel's or locale's results in the dialog.
export function assertShardScope(exported, locale, channel, source = 'search shard') {
  for (const document of Object.values(exported?.docs?.docs ?? {})) {
    let scope;
    try {
      scope = pageScopeFromUrl(document?.url);
    } catch {
      throw new Error(`${source} contains a noncanonical record URL: ${String(document?.url)}`);
    }
    if (!scope || scope.locale !== locale || scope.channel !== channel) {
      throw new Error(
        `${source} contains a foreign-scope record for ${searchScopeKey(locale, channel)}: ${document.url}`,
      );
    }
  }
}

// Load (and cache) the shard for exactly one scope. Simultaneous callers share
// one fetch; a rejected promise is dropped so an explicit retry can succeed.
/**
 * @param {ScopeOptions} [options]
 * @returns {Promise<unknown>}
 */
export async function loadSearchShard({
  locale,
  channel,
  from = SEARCH_ENDPOINT_BASE,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertSupportedSearchScope(locale, channel);

  const url = searchShardUrl(locale, channel, from);
  const cached = shardCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetchImpl(url);
    if (!response?.ok) {
      throw new Error(
        `failed to load the ${searchScopeKey(locale, channel)} search index from ${url} (HTTP ${response?.status})`,
      );
    }

    const exported = await response.json();
    const source = `search index ${url}`;
    assertShardScope(exported, locale, channel, source);
    return initSearchShard(exported, source);
  })();

  shardCache.set(url, pending);
  while (shardCache.size > MAX_CACHED_SHARDS) {
    shardCache.delete(shardCache.keys().next().value);
  }
  pending.catch(() => {
    if (shardCache.get(url) === pending) shardCache.delete(url);
  });

  return pending;
}

// Drop one scope's cached shard so the next query refetches it. Used by the
// dialog's Retry action: a failed load is already evicted automatically, but an
// explicitly retried scope must not reuse a stale in-flight promise either.
/**
 * @param {{ locale: string, channel: string, from?: string }} options
 * @returns {boolean} whether a cached entry was dropped
 */
export function evictSearchShard({ locale, channel, from = SEARCH_ENDPOINT_BASE } = {}) {
  assertSupportedSearchScope(locale, channel);
  return shardCache.delete(searchShardUrl(locale, channel, from));
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

// Ordered rank tiers. Lower is better, and the order encodes the site's intent
// rules: an explicit command beats everything, a page the query names outright
// beats a landing alias, and a landing alias beats coincidental term overlap.
const TIER_COMMAND = 0;
const TIER_EXACT_IDENTITY = 1;
const TIER_LANDING = 2;
const TIER_RETRIEVAL = 3;

// Among equally relevant pages, Kit pages answer first and the CLI reference last:
// most searches look for a Skill, Agent, or workflow, and the CLI reference has
// many pages that repeat the same terms in generated help.
const SECTION_KIT = 0;
const SECTION_OTHER = 1;
const SECTION_CLI_REFERENCE = 2;

// Only Kit detail pages (a Skill, Agent, Hook, or workflow) get the preference;
// Kit hubs such as `kits` or `kits/engineer` are landings and rank like any page.
function sectionRank(route) {
  if (route.startsWith('kits/') && route.split('/').length >= 3) return SECTION_KIT;
  if (route === 'reference/cli' || route.startsWith('reference/cli/')) return SECTION_CLI_REFERENCE;
  return SECTION_OTHER;
}

function searchIntent(query) {
  const terms = informativeSearchTerms(query);
  const key = identityKey(query);
  return {
    terms,
    termSet: new Set(terms),
    normalized: normalizeSearchText(query),
    identityKey: key,
    commandKey: /^ak/.test(key) ? key : null,
  };
}

function covers(aliasTerms, queryTerms) {
  if (queryTerms.size === 0) return false;
  for (const term of queryTerms) {
    if (!aliasTerms.includes(term)) return false;
  }
  return true;
}

// Best (lowest extra, then most specific) alias phrase of a page for one query,
// or `null` when no phrase covers the query.
function bestLandingPhrase(entry, intent) {
  let best = null;
  for (const phrase of entry.aliasPhrases) {
    if (!covers(phrase.terms, intent.termSet)) continue;
    const extra = phrase.terms.length - intent.terms.length;
    const candidate = { extra, specificity: phrase.specificity };
    if (
      !best ||
      candidate.extra < best.extra ||
      (candidate.extra === best.extra && candidate.specificity > best.specificity)
    ) {
      best = candidate;
    }
  }
  return best;
}

function isOrderedSubset(pageTerms, queryTerms) {
  if (pageTerms.length === 0 || pageTerms.length > queryTerms.length) return false;
  let cursor = 0;
  for (const term of queryTerms) {
    if (term === pageTerms[cursor]) cursor += 1;
    if (cursor === pageTerms.length) return true;
  }
  return false;
}

// Page-level rank key for one candidate. Every component is either a bounded
// count or a stable identifier, so the ordering is total and reproducible.
function rankKey(entry, intent, children, oramaRank) {
  let tier = TIER_RETRIEVAL;
  let landing = null;
  if (entry.commandKey && intent.commandKey && entry.commandKey === intent.commandKey) {
    tier = TIER_COMMAND;
  } else if (intent.identityKey && entry.identityKey === intent.identityKey) {
    tier = TIER_EXACT_IDENTITY;
  } else {
    landing = bestLandingPhrase(entry, intent);
    if (landing) tier = TIER_LANDING;
  }

  const searchable = new Set([...entry.titleTerms, ...entry.aliasPhrases.flatMap((p) => p.terms)]);
  let covered = 0;
  for (const term of intent.termSet) {
    if (searchable.has(term)) covered += 1;
  }
  const coverage = intent.terms.length === 0 ? 0 : covered / intent.terms.length;

  // Title evidence is separated from alias evidence: a page whose own title
  // covers more of the query is a better answer than one that only matches
  // through a landing alias or a heading.
  let titleCovered = 0;
  for (const term of intent.termSet) {
    if (entry.titleTerms.includes(term)) titleCovered += 1;
  }
  const titleCoverage = intent.terms.length === 0 ? 0 : titleCovered / intent.terms.length;

  const titlePhrase =
    intent.normalized.length > 0 &&
    (intent.normalized.includes(normalizeSearchText(entry.title)) ||
      isOrderedSubset(entry.titleTerms, intent.terms))
      ? 1
      : 0;

  let evidence = 0;
  for (const child of children) {
    const terms = informativeSearchTerms(child.document?.content);
    if (terms.some((term) => intent.termSet.has(term))) evidence += 1;
  }

  return {
    tier,
    section: sectionRank(entry.route ?? ''),
    landingExtra: landing ? landing.extra : Number.MAX_SAFE_INTEGER,
    landingSpecificity: landing ? landing.specificity : 0,
    coverage,
    titleCoverage,
    titlePhrase,
    evidence,
    oramaRank,
  };
}

function compareRankKeys(left, right, leftId, rightId) {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.landingExtra !== right.landingExtra) return left.landingExtra - right.landingExtra;
  if (left.landingSpecificity !== right.landingSpecificity) {
    return right.landingSpecificity - left.landingSpecificity;
  }
  if (left.coverage !== right.coverage) return right.coverage - left.coverage;
  // Section preference only breaks ties between equally relevant pages, so a
  // loosely related Kit page never outranks a page that answers more of the query.
  if (left.section !== right.section) return left.section - right.section;
  if (left.titleCoverage !== right.titleCoverage) return right.titleCoverage - left.titleCoverage;
  if (left.titlePhrase !== right.titlePhrase) return right.titlePhrase - left.titlePhrase;
  if (left.evidence !== right.evidence) return right.evidence - left.evidence;
  if (left.oramaRank !== right.oramaRank) return left.oramaRank - right.oramaRank;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

// Primary retrieval, capped by page group before ranking. Orama's `limit`
// bounds the flattened hit list, not the group list, so the group cap is
// applied here explicitly.
async function collectPageGroups(database, { query, tag }) {
  const tags = tag === undefined ? [] : Array.isArray(tag) ? tag : [tag];
  /** @type {Record<string, unknown>} */
  const params = {
    limit: SEARCH_CANDIDATE_PAGE_GROUP_LIMIT * SEARCH_GROUP_MAX_RESULT,
    mode: 'fulltext',
    groupBy: { properties: ['page_id'], maxResult: SEARCH_GROUP_MAX_RESULT },
    properties: ['content'],
  };
  if (tags.length > 0) params.where = { tags: { containsAll: tags } };
  if (query.length > 0) params.term = query;

  const result = await search(
    /** @type {Parameters<typeof search>[0]} */ (database),
    /** @type {Parameters<typeof search>[1]} */ (params),
  );

  /** @type {{ id: string, page: any, children: any[], oramaRank: number }[]} */
  const groups = [];
  for (const [index, group] of (result.groups ?? []).entries()) {
    if (groups.length >= SEARCH_CANDIDATE_PAGE_GROUP_LIMIT) break;
    const page = getByID(
      /** @type {Parameters<typeof getByID>[0]} */ (database),
      group.values[0],
    );
    if (!page) continue;
    groups.push({
      id: String(group.values[0]),
      page,
      children: group.result.filter((hit) => hit.document.type !== 'page'),
      oramaRank: index,
    });
  }
  return groups;
}

// Rank one shard's page groups for one query and flatten them into Fumadocs
// results: at most `SEARCH_PAGE_GROUP_LIMIT` pages, each with at most
// `SEARCH_PAGE_GROUP_MAX_RESULT` matching section rows.
async function rankPageGroups(database, { query, tag, limit }) {
  const intent = searchIntent(query);
  const lookup = shardLookups.get(database);
  const groups = await collectPageGroups(database, { query, tag });

  const candidates = groups.map((group) => ({
    id: group.id,
    page: group.page,
    children: group.children,
    oramaRank: group.oramaRank,
    entry: lookup?.pages.get(group.page.url),
  }));

  // Bounded alias supplement: only pages actually present in this shard, only
  // when an alias phrase covers the whole query, and only when the page is not
  // already a primary candidate.
  const present = new Set(candidates.map((candidate) => candidate.page.url));
  const landings = [];
  if (lookup && intent.terms.length > 0) {
    for (const entry of lookup.pages.values()) {
      if (present.has(entry.url)) continue;
      if (!bestLandingPhrase(entry, intent)) continue;
      landings.push({ entry, extra: bestLandingPhrase(entry, intent).extra });
    }
    landings.sort((left, right) =>
      left.extra - right.extra || (left.entry.url < right.entry.url ? -1 : 1),
    );
  }
  for (const landing of landings.slice(0, SEARCH_LANDING_CANDIDATE_LIMIT)) {
    candidates.push({
      id: landing.entry.url,
      page: {
        content: landing.entry.title,
        url: landing.entry.url,
        breadcrumbs: undefined,
      },
      children: [],
      oramaRank: Number.MAX_SAFE_INTEGER,
      entry: landing.entry,
    });
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      key: candidate.entry
        ? rankKey(candidate.entry, intent, candidate.children, candidate.oramaRank)
        : {
            tier: TIER_RETRIEVAL,
            section: SECTION_OTHER,
            landingExtra: Number.MAX_SAFE_INTEGER,
            landingSpecificity: 0,
            coverage: 0,
            titlePhrase: 0,
            evidence: 0,
            oramaRank: candidate.oramaRank,
          },
    }))
    .sort((left, right) =>
      compareRankKeys(left.key, right.key, left.candidate.id, right.candidate.id),
    )
    .slice(0, SEARCH_PAGE_GROUP_LIMIT)
    .map((entry) => entry.candidate);

  const highlighter = createContentHighlighter(typeof query === 'string' ? query : '');
  /** @type {SortedResult[]} */
  const list = [];
  const seenPageUrls = new Set();
  for (const candidate of ranked) {
    const { page } = candidate;
    if (seenPageUrls.has(page.url)) continue;
    seenPageUrls.add(page.url);
    list.push({
      id: candidate.id,
      type: 'page',
      content: highlighter.highlightMarkdown(page.content),
      breadcrumbs: page.breadcrumbs,
      url: page.url,
    });
    for (const hit of candidate.children.slice(0, SEARCH_PAGE_GROUP_MAX_RESULT)) {
      list.push({
        id: String(hit.document.id),
        content: highlighter.highlightMarkdown(hit.document.content),
        breadcrumbs: hit.document.breadcrumbs,
        type: hit.document.type,
        url: hit.document.url,
      });
    }
  }

  return list.length > limit ? list.slice(0, limit) : list;
}

// Query one already-loaded shard and adapt the hits to Fumadocs results.
// Results are grouped by page, keep heading anchors, and are deduplicated by
// exact canonical page URL — different Kits may legitimately share a title.
/**
 * @param {unknown} database
 * @param {{ query?: string, tag?: string | string[], limit?: number }} [options]
 * @returns {Promise<SortedResult[]>}
 */
export async function querySearchShard(
  database,
  { query, tag, limit = SEARCH_RESULT_LIMIT } = {},
) {
  return rankPageGroups(database, {
    query: typeof query === 'string' ? query : '',
    tag,
    limit,
  });
}

// Fumadocs `useDocsSearch` client for one scope.
//
// A client is pure for its own scope: it never loads, caches or returns another
// locale's or channel's records, and `deps` carries the complete scope so a
// locale or channel change re-runs the query instead of reusing results.
// Deliberately no module-level "active scope": clients are created during
// render, and a discarded render for another scope must not be able to
// invalidate the mounted dialog's searches. Visible stale results are owned by
// the mounted dialog, which remounts per scope key.
//
// `retryToken` is part of `deps` so the dialog's Retry action re-runs the same
// query after a failed load or query instead of reusing the settled state.
/**
 * @param {ScopeOptions} [options]
 * @returns {ScopedSearchClient}
 */
export function createScopedSearchClient({
  locale,
  channel,
  from = SEARCH_ENDPOINT_BASE,
  fetchImpl,
  retryToken = 0,
} = {}) {
  assertSupportedSearchScope(locale, channel);

  return {
    deps: [locale, channel, from, String(retryToken)],
    async search(query) {
      const database = await loadSearchShard({ locale, channel, from, fetchImpl });
      return querySearchShard(database, { query });
    },
  };
}

// Convenience for non-React callers (build-time checks): load one shard and
// query it without participating in dialog scope supersession.
/**
 * @param {{ locale: string, channel: string, query: string, from?: string, fetchImpl?: typeof fetch, limit?: number }} [options]
 * @returns {Promise<SortedResult[]>}
 */
export async function queryScope({
  locale,
  channel,
  query,
  from = SEARCH_ENDPOINT_BASE,
  fetchImpl,
  limit = SEARCH_RESULT_LIMIT,
} = {}) {
  const database = await loadSearchShard({ locale, channel, from, fetchImpl });
  return querySearchShard(database, { query, limit });
}
